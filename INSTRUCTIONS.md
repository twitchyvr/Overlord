# OVERLORD WEB — Agent Operations Guide

> **Version**: 1.2.0
> **Last updated**: 2026-03-03 (commit 1c4872f)
> **Active branch**: `milestone/virtual-crew-chief-foundation-core-architecture`
> **Server**: http://localhost:3031

---

## 1. Project Overview

OVERLORD Web is a browser-based AI coding assistant platform built on Node.js, Express, and Socket.IO. It uses the MiniMax Anthropic-compatible API and exposes a single-page frontend (`public/index.html`) with no frontend build step required.

The server is modular: every capability is a Hub module that registers services and listens to events. All inter-module communication flows through `hub.js`.

---

## 2. Directory Structure

```
overlord-web/
├── hub.js                          # Central event bus + Socket.IO bridge
├── server.js                       # Entry point; loads all modules
├── public/
│   └── index.html                  # Full SPA frontend (inline JS/CSS, ~2600+ lines)
├── modules/
│   ├── ai-module.js                # MiniMax API client, system prompt builder
│   ├── orchestration-module.js     # AI/tool loop coordinator, approval flow
│   ├── tools-v5.js                 # Tool definitions + execute() router
│   ├── mcp-module.js               # MCP subprocess (uvx minimax-coding-plan-mcp)
│   ├── mcp-manager-module.js       # Multi-server MCP manager
│   ├── token-manager-module.js     # Context window tracking + compaction
│   ├── conversation-module.js      # Conversation persistence, task/milestone store
│   ├── summarization-module.js     # AI-powered context compaction
│   ├── minimax-image-module.js     # Image generation → .overlord/generated/
│   ├── minimax-tts-module.js       # TTS via T2A v2 → .overlord/audio/
│   ├── minimax-files-module.js     # File upload API (upload/list/delete)
│   └── agents/
│       └── index.js                # Agent manager (DB-backed agent registry)
├── tests/
│   ├── token-manager.test.js
│   ├── skills.test.js
│   ├── approval.test.js
│   └── integration/
│       ├── module-loading.test.js
│       └── tool-execution.test.js
├── .overlord/
│   ├── conversations/              # Persisted conversation JSON files
│   ├── generated/                  # AI-generated images
│   ├── audio/                      # TTS output files
│   ├── session-notes.md            # Persistent AI session notes (injected in system prompt)
│   └── TIMELINE.md                 # Append-only event log (injected in system prompt)
├── package.json                    # v1.2.0
└── INSTRUCTIONS.md                 # This file
```

---

## 3. Setup and Running

```bash
# Install dependencies
cd overlord-web
npm install

# Start the server
node server.js

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint
npm run lint
```

Server starts on **port 3031** by default (override with `PORT` env var).

---

## 4. Architecture: Hub-Module Pattern

All modules are loaded by `server.js` and communicate exclusively through `hub.js`:

| Pattern | Usage |
|---|---|
| `hub.registerService(name, obj)` | Register a module's public API |
| `hub.getService(name)` | Retrieve another module's API |
| `hub.on(event, handler)` | Subscribe to hub events |
| `hub.emit(event, ...args)` | Emit a hub event |
| `hub.broadcast(event, data)` | Emit to the active conversation's Socket.IO room |
| `hub.broadcastAll(event, data)` | Emit to all connected sockets (server-wide) |
| `hub.broadcastToRoom(room, event, data)` | Emit to a specific named room |
| `hub.log(message, level)` | Centralized logging |

### Broadcast Error Guards (added commit `1c4872f`)

All four broadcast paths — `broadcast()`, `broadcastVolatile()`, `broadcastAll()`, and the metrics `setInterval` volatile emit — are wrapped in try-catch blocks. Any socket.io exception (e.g. `BroadcastOperator is not a constructor` from zombie processes) is caught, logged at `warn` level, and swallowed so the server process never crashes. The metrics interval self-reschedules on error to prevent rapid error loops.

### Socket.IO Rooms

Each conversation has its own room `conv:{conversationId}`. Clients join by emitting `join_conversation`. `hub.broadcast()` scopes events to only the active conversation's room.

---

## 5. Key Socket Events Reference

### Client to Server

| Event | Payload | Description |
|---|---|---|
| `user_input` | `string` | Send a message to the AI |
| `cancel` | — | Cancel the current AI request |
| `new_conversation` | — | Start a fresh conversation |
| `join_conversation` | `convId` | Join a conversation room (ack: `{joined}`) |
| `set_mode` | `'auto' or 'plan' or 'ask'` | Set chat mode |
| `approve_plan` | — | Approve an AI-generated plan |
| `cancel_plan` | — | Cancel a plan |
| `revise_plan` | `string` | Send plan revision feedback |
| `approval_response` | `{toolId, approved}` | Respond to T3/T4 tool approval |
| `focus_task` | `{taskId}` | Mark task in_progress + launch parent milestone |
| `orchestrate_milestone` | `milestoneId` | Launch milestone + instruct AI to begin |
| `launch_milestone` | `milestoneId` | Launch a milestone (checkout branch) |
| `update_config` | config object | Update server configuration |
| `manual_compact` | — | Trigger AI context compaction |

### Server to Client

| Event | Description |
|---|---|
| `agent_activity` | Activity feed events (`tool_start`, `tool_complete`, `milestone_launched`, etc.) |
| `orchestration_state` | Current agent/task/tool state snapshot |
| `tasks_update` | Full task list broadcast after any task mutation |
| `approval_request` | T3/T4 tool needs user approval (blocking) |
| `approval_timeout` | Auto-deny after 5 minutes |
| `images_generated` | Fires after `generate_image` completes |
| `audio_ready` | Fires after `speak` completes |
| `mcp_servers_updated` | MCP server list changed |
| `context_warning` | Context usage stats |

---

## 6. AI Orchestration from Task and Milestone Views

**Introduced in commit**: `b77e983` — 2026-02-28

This feature adds the ability to kick off AI orchestration directly from the UI without typing a message in the chat input.

### 6.1 Start Task (Task Detail Sheet)

When a user opens a task's detail sheet and clicks the **"Start Task"** button in the footer:

1. The frontend calls `socket.emit('focus_task', { taskId })`.
2. `hub.js` handles `focus_task`:
   - Calls `conv.updateTask(taskId, { status: 'in_progress' })`.
   - If the task has a `milestoneId` and the milestone is not yet active, calls `conv.launchMilestone()` and broadcasts `agent_activity` with type `milestone_launched`.
   - Broadcasts `tasks_update` to all clients in the conversation room.
3. After the socket ack resolves, the frontend auto-sends a structured orchestration prompt to the AI that:
   - Identifies the task by ID and title.
   - Instructs the AI to call `update_task_status` to set `in_progress` when starting, and `completed` or `blocked` when done.

**CSS class**: `.sheet-btn-orchestrate` (amber/plasma-breathe animation active during orchestration run).

### 6.2 Orchestrate All (Milestone Detail Panel)

The milestone detail panel has two new orchestration controls:

**"Orchestrate All (N)" button** (top-right of milestone detail):
1. Frontend calls `socket.emit('orchestrate_milestone', milestoneId)`.
2. `hub.js` calls `conv.launchMilestone(milestoneId)`, broadcasts `tasks_update` and `agent_activity`.
3. Frontend auto-sends a multi-task orchestration prompt listing every pending task with its ID, instructing the AI to work through them sequentially and call `update_task_status` per task.

**Per-task start buttons** (inline on each task row):
- Each task row in the milestone detail has a `>` button.
- Clicking a task row opens its task detail sheet.
- Clicking the `>` button calls `orchestrateTask(taskId, taskTitle)` directly without opening the sheet.

**CSS classes**: `.ms-orchestrate-btn` (milestone-level), `.ms-task-start-btn` (per-task).

### 6.3 update_task_status AI Tool

Registered dynamically in `orchestration-module.js` during `init()`. This is the critical feedback loop that keeps the kanban board accurate while the AI works.

```
Tool name: update_task_status
Inputs:
  taskId  (string, required) — e.g. "task_1234567890"
  status  (enum, required)   — pending | in_progress | completed | blocked | skipped
  notes   (string, optional) — completion notes, blockers, or next steps
```

What the tool does:
- Looks up the task by ID in the conversation service.
- Calls `conv.updateTask(taskId, updates)`.
- Sets `completed: true` and `completedAt: ISO timestamp` when status is `completed`.
- Broadcasts `tasks_update` so the kanban board refreshes in real time.
- Returns a human-readable confirmation string to the AI.

Registration retries every 2 seconds if the `tools` service is not yet available at module `init` time (deferred registration pattern).

---

## 7. Tiered Approval System

Tool execution follows a four-tier approval model:

| Tier | Type | Behavior |
|---|---|---|
| T1 | Read-only (safe) | Execute immediately, no approval |
| T2 | Low-risk writes | Execute immediately with logging |
| T3 | Medium-risk | Pause, emit `approval_request` to client, wait up to 5 min |
| T4 | High-risk (destructive) | Same as T3, but logged with elevated audit trail |

Pending approvals are stored in the `pendingApprovalResolvers` Map (toolId mapped to `{resolve, timer}`) inside `orchestration-module.js`.

---

## 8. AI Context Management

| Feature | Module | Details |
|---|---|---|
| Context tracking | `token-manager-module.js` | Tracks token usage, warns at thresholds |
| AI compaction | `summarization-module.js` | Replaces history with AI-generated summary |
| Manual compact | Socket `manual_compact` | User-triggered via UI button |
| Auto compact | Config `autoCompact` | Triggers automatically when context fills |
| Session notes | `.overlord/session-notes.md` | Injected into system prompt each turn |
| Timeline log | `.overlord/TIMELINE.md` | Append-only, injected into system prompt |

---

## 9. Plan Mode

When `chatMode` is set to `'plan'`:
1. AI generates a structured plan before executing any tools.
2. Plan is presented to the user for review.
3. User can `approve_plan`, `cancel_plan`, or send `revise_plan` with feedback.
4. On approval, orchestration proceeds.
5. Switching away from plan mode emits `plan_cancelled` to clean up state.

---

## 10. AutoQA

After any file-write tool executes, AutoQA can automatically:
- Run ESLint (`autoQALint`)
- Run TypeScript type checks (`autoQATypes`)
- Run Jest tests (`autoQATests`)

Failures are injected back into the AI's context for self-correction. Max retries: `maxQAAttempts` (default 3).

---

## 11. Agent System

Agents are stored in a SQLite database via `modules/agents/index.js` (the `agentManager` service).

Each agent has:
- `name`, `role`, `description`, `instructions`
- `capabilities` list
- `securityRole`: one of `developer | security-aware | security-analyst | security-lead | ciso | readonly`
- `tools` list (subset of available tools this agent may use)
- `status`: `IDLE | ACTIVE | PAUSED`

Multi-agent sessions run in parallel up to `maxParallelAgents` (default 3, max 8). Each agent maintains its own conversation history and inbox inside `orchestration-module.js`.

---

## 12. MCP Integration

| Server type | Module | Notes |
|---|---|---|
| Primary MCP | `mcp-module.js` | `uvx minimax-coding-plan-mcp` subprocess |
| Multi-server | `mcp-manager-module.js` | Presets: GitHub, filesystem |
| DuckDuckGo | `mcp-module.js` | Fallback web search |

---

## 13. Client-Side Settings Persistence (localStorage)

These preferences live in the browser and are independent of the server-side config. They are read on every page load and synced bidirectionally between the toolbar and the Settings modal.

| localStorage key | Values | Default | Description |
|---|---|---|---|
| `overlord_notifications` | `'on'` / `'off'` | `'on'` (absent = on) | App-level notification toggle; `'off'` suppresses `notifyUser()` entirely |
| `overlord_long_running` | `'on'` / `'off'` | `'off'` (absent = off) | Long-running mode; survives page reload |
| `theme` | `'dark'` / `'light'` | `'dark'` | UI theme; set via `data-theme` on `<html>` |

### 13.1 Settings Modal Layout (General Tab)

Three sections were added to the Settings modal under the **General** tab:

**Appearance**
- Dark / Light chip buttons (`.theme-chip-group`).
- Active chip is highlighted. Calls `setTheme(value)` — identical to the toolbar toggle.

**Notifications**
- Toggle checkbox (`#settings-notif-enabled`) bound to `setNotifEnabled(bool)`.
- Status line (`.notif-status-line`) is color-coded:
  - Green (`.ok`) — browser permission granted and app setting is on.
  - Red (`.err`) — browser blocked; shows a "open Site Settings" prompt.
  - Neutral — permission not yet requested.
- "Test" button is disabled until permission is `granted`.
- The toolbar bell icon (`#btn-notif`) now **only opens Settings** — it does not toggle directly.

**Session Behavior**
- Long-running mode toggle (`#settings-long-running`) bound to `setLongRunning(bool)`.
- Kept in sync with the toolbar checkbox (`#long-running-mode`) via `setLongRunning()`.

### 13.2 Notification Flow

```
notifyUser(title, body)
  └─ _notifAppEnabled()            ← checks localStorage.overlord_notifications !== 'off'
       └─ Notification.permission === 'granted'
            └─ new Notification(title, { body, tag: 'overlord-alert' })
```

`notifyUser()` is called by:
- `socket.on('message')` — when the window is not focused and the AI sends a reply.
- `socket.on('approval_request')` — T3/T4 tool waiting for user action.
- `socket.on('plan_ready')` — plan is ready for review.

`updateNotifUI()` keeps the bell color and status line text in sync after any permission or preference change.

---

## 14. Kanban Board

### 14.1 Column Definitions

Columns are defined in `KANBAN_COLS` (inside `public/index.html`). Status values **must match the task sheet dropdown exactly**.

| Column label | `status` value | Header color | Card style |
|---|---|---|---|
| Pending | `pending` | `--text-secondary` | Default |
| In Progress | `in_progress` | `--electric` (cyan) | Default |
| Plan Pending | `plan_pending` | `#f0ad4e` (amber) | Default |
| Blocked | `blocked` | `#a855f7` (purple) | Default |
| Completed | `completed` | `#3fb950` (green) | Default |
| Skipped | `skipped` | `--text-muted` | `.status-skipped` — 50% opacity + strikethrough |

The Skipped column was added so tasks marked `skipped` remain visible on the board instead of disappearing.

### 14.2 Task Status Badge Styles

Used in the milestone detail panel task rows (`.ms-task-status-badge.<status>`):

| Status | Badge appearance |
|---|---|
| `completed` | Green background/border |
| `in_progress` | Cyan background/border |
| `pending` | Muted grey |
| `blocked` | Purple background/border |
| `skipped` | Grey + strikethrough text |
| `plan_pending` | Amber background/border |

### 14.3 Drag-and-Drop

Cards are draggable. Dropping onto a column emits `task_updated` with `{ id, status, completed }`. `completed` is set to `true` only when status is `'completed'`.

### 14.4 Task Badge Counter

The tasks panel badge (`#tasks-badge`) counts tasks where `!t.completed && t.status !== 'skipped'`. Skipped tasks are excluded from the "pending" count but remain in the total.

---

## 15. Configuration Reference

Key config fields (persisted to disk, editable via Settings UI):

| Key | Default | Description |
|---|---|---|
| `maxAICycles` | 250 (0=unlimited) | Max AI to tool to AI cycles per message |
| `maxQAAttempts` | 3 | AutoQA retries per file |
| `approvalTimeoutMs` | 300000 (5 min) | T3/T4 approval window |
| `requestTimeoutMs` | 90000 | AI API request timeout |
| `autoCompact` | true | Auto-compact context when near limit |
| `compactKeepRecent` | 20 | Recent messages to preserve during compaction |
| `chatMode` | `'auto'` | `auto` or `plan` or `ask` or `pm` |
| `autoModelSwitch` | `false` | Opt-in: auto-switch model when entering PM mode (affects billing — disabled by default) |
| `pmModel` | `'MiniMax-Text-01'` | Model used in PM mode when `autoModelSwitch` is `true` (overridable via `PM_MODEL` env var) |
| `maxParallelAgents` | 3 | Max concurrent agent sessions |
| `rateLimitTokens` | 20 | Socket rate limit bucket size |
| `rateLimitRefillRate` | 4 | Tokens/sec refill rate |
| `messageQueueSize` | 3 | Max buffered messages while AI is processing |
| `autoCreateIssues` | false | Auto-create GitHub issues for bugs/TODOs |
| `autoQA` | true | Master AutoQA toggle |
| `autoQALint` | true | Run ESLint after file writes |
| `autoQATypes` | true | Run TypeScript checks after file writes |
| `autoQATests` | false | Run Jest after file writes |

---

## 16. Agent Roles and Responsibilities

The following agents operate on this project. All agents must treat this file as the canonical operational guide and must concur with its current contents before making changes.

### gitops-orchestrator
Maintains INSTRUCTIONS.md, manages all Git operations (commits, branches, PRs, issues, milestones, project board), creates GitHub releases, and keeps documentation synchronized. Invoked automatically after every code change.

### developer
Writes code, implements features, fixes bugs. Always works on a feature branch. Follows the commit conventions and pre-commit checks documented here. Does not push directly to `master` without review.

### project-manager
Creates and maintains issues, milestones, and project board cards. Prioritizes work. Links issues to PRs and milestones.

### ui-designer
Owns all CSS and frontend layout in `public/index.html`. Coordinates with developer on socket event contracts. Validates visual output before marking tasks complete.

### scrum-master
Facilitates sprint planning, manages the kanban board state, runs retrospectives, and removes blockers. Updates task statuses and milestone progress.

### qa-engineer
Writes and maintains tests in `tests/`. Validates that AutoQA gates pass before merge. Reviews PRs for test coverage. Runs end-to-end validation of socket event flows.

---

## 17. Testing

```bash
npm test                  # Run all tests
npm run test:coverage     # With coverage report
```

Current test suite (93/94 pass — 1 pre-existing failure in `token-manager.test.js`):

| File | Coverage area |
|---|---|
| `tests/token-manager.test.js` | Token tracking and history truncation |
| `tests/skills.test.js` | YAML frontmatter parser, skill file loading |
| `tests/approval.test.js` | Promise-based T3/T4 approval flow |
| `tests/integration/module-loading.test.js` | All 27 modules load without errors |
| `tests/integration/tool-execution.test.js` | Tool cycle, AutoQA, cycle guard |

Known issue: `truncateHistory` in `token-manager-module.js` does not guarantee tool pair preservation at the 100-token limit — pre-existing bug, not introduced by recent work.

---

## 18. Commit and Branch Conventions

### Commit Format

```
type(scope): subject

body (optional)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

**Types**: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `style`, `perf`

**Scopes** (common): `ui`, `hub`, `orchestrate`, `context`, `tools`, `agents`, `mcp`, `auth`, `config`

### Branch Naming

```
feature/short-description
fix/short-description
hotfix/short-description
chore/short-description
docs/short-description
```

### Pre-Commit Checklist

- [ ] No debug `console.log` statements left in production paths
- [ ] No commented-out code blocks
- [ ] DOM manipulation uses `textContent` or safe DOM methods — never raw HTML injection
- [ ] Shell commands use `execFileSync` with array args — never shell string interpolation
- [ ] Tests pass: `npm test`
- [ ] Lint passes: `npm run lint`
- [ ] INSTRUCTIONS.md updated if architecture or workflow changed

---

## 19. Image Upload Flow (Paste / File-Picker)

**Introduced in commit**: `821709c` — 2026-02-28

### 19.1 Overview

Users can attach images to a message by pasting from the clipboard or choosing a file via the file picker. Each attachment appears as a pill in the chat input area with a real thumbnail, filename, and metadata.

### 19.2 Server-Side

| Concern | Detail |
|---|---|
| Multer destination | `uploads/` directory at project root |
| Route | `POST /upload` — handled by `upload.single('image')` middleware |
| Static serving | `app.use('/uploads', express.static(...))` — registered so uploaded files are browser-accessible |
| File names | Multer saves files **without an extension** (e.g. `3a7f8e12b4c9d5f0`). The browser cannot infer MIME type from the path alone, which is why client-side blob URLs are preferred for thumbnails. |
| Response shape | `{ path, url?, dimensions?, exif? }` |

`uploads/` is auto-created by `server.js` at startup alongside `.overlord/generated/` and `.overlord/audio/`.

### 19.3 Client-Side: `localThumb` Blob URL Pattern

Because Multer strips file extensions, a server-side `<img src="/uploads/filename">` cannot reliably render. The fix is to create a client-side blob URL **before** the upload fetch completes.

**Flow for paste path (`uploadImageFromFile`):**

```
user pastes image
  └─ URL.createObjectURL(file) → localThumb  (instant, same-tick)
       └─ fetch POST /upload
            ├─ success → imageData = { path, size, type, ..., localThumb }
            │               attachedImages.push(imageData)
            │               renderInputImages()          ← uses localThumb for <img src>
            └─ failure / catch → URL.revokeObjectURL(localThumb)
```

**Flow for file-picker path (`handleImageUpload`):**

Identical — `URL.createObjectURL(file)` is called before the fetch, stored as `localThumb`, and cleaned up the same way.

### 19.4 Thumbnail Resolution in `renderInputImages()`

```js
const thumbUrl = img.localThumb || ('/uploads/' + img.path.split(/[/\\]/).pop());
```

`localThumb` is always preferred. The `/uploads/` fallback exists as a safety net for any attachment object that arrives without a blob URL (e.g. reconstructed from server state).

### 19.5 Blob URL Lifecycle (memory management)

| Event | Action |
|---|---|
| Upload fails or throws | `URL.revokeObjectURL(localThumb)` immediately |
| User removes a pill | `URL.revokeObjectURL(removed.localThumb)` in `removeAttachedImage()` |
| User sends the message | All blob URLs in `imagesToSend` are revoked after `socket.emit('user_input', ...)` |

Blob URLs are never stored beyond the send boundary; in-chat image pills (rendered after send) use the `/uploads/` server path instead.

### 19.6 Adding New Image Entry Points

Any new code path that accepts image files for attachment **must** follow this pattern:

1. Call `URL.createObjectURL(file)` and store the result as `localThumb` before any async work.
2. Populate `imageData` with `localThumb` on success.
3. Call `URL.revokeObjectURL(localThumb)` in every failure/catch branch.
4. Do **not** rely on the `/uploads/` path alone for the input-area thumbnail.

---

## 20. Tool Chips in the Thoughts Bubble

**Introduced in commit**: `8eca8d6` — 2026-02-28

When the AI calls a tool during streaming, a compact interactive chip appears inside the thoughts bubble instead of plain text.

### Sentinel format (server → client)

`orchestration-module.js` emits into the neural stream:
```javascript
hub.neural('\x00CHIP:' + JSON.stringify({ name: tool.name, id: tool.id }) + '\x00');
```
This sentinel is emitted at `content_block_start` (when the AI *announces* a tool) — before the tool actually executes, so the chip appears immediately in the stream.

### Client rendering pipeline

```
neural_thought event
  └─ renderThoughtsContent(container, raw)
       ├─ text segments → <pre class="tb-text-seg">
       └─ CHIP sentinels → createToolChipEl(chip) → <details class="tc">
                                                        ├─ <summary> (compact row)
                                                        └─ <div class="tc-body"> (expanded)

agent_activity tool_start  → updateToolChip(id, name, input, null, null, null)
                               populates .tc-param with toolParamSummary(name, input)
                               sets .tc-body to input JSON + "Running…"

agent_activity tool_complete → updateToolChip(id, name, null, output, durationMs, success)
                                sets .tc-dot to .ok or .err
                                sets .tc-dur to elapsed time
                                sets .tc-body to input + output
```

### `toolParamSummary(name, input)` logic

| Input field present | Label produced |
|---|---|
| `path` / `file_path` / `filepath` | `basename.ext:start–end` (or `:start+` / `:line`) |
| `command` | First 55 chars of command string |
| `query` | `"quoted query"` |
| `url` | `hostname/path` |
| `taskId` + `status` | `id12345 → completed` |
| fallback | First value, 50 chars |

### CSS classes

| Class | Purpose |
|---|---|
| `.tc` | `<details>` chip wrapper |
| `.tc-chevron` | Rotate-on-open indicator |
| `.tc-name` | Monospace tool name (cyan) |
| `.tc-param` | Smart parameter label (muted) |
| `.tc-dur` | Elapsed time |
| `.tc-dot.run/.ok/.err` | 5px status dot — pulsing/green/red |
| `.tc-body` | Expanded input+output area |
| `.tb-text-seg` | Plain thinking text segments between chips |
| `.tb-content` | Container div replacing old `.tb-text` pre |

### Key invariant

`renderThoughtsContent` re-runs on every `neural_thought` chunk. It preserves existing chip DOM nodes (keyed by `data-tc-id`) so open/closed state and already-populated data are not lost on re-render.

---

## 21. Active Project Selection (Project Manager Panel)

**Fixed in commit**: `360c7e1` — 2026-03-01

### 21.1 Problem Addressed

The previous implementation had a race condition in the `project_switched` socket event handler. `hub.js` emits `{ projectId, projectName }` when a project is switched, but `_applyProjectData()` emits `{ project, data }` for the same event. The handler only understood the second format, so the first broadcast temporarily set `_projActiveId = undefined`, causing the badge and context bar to flicker or show no active project.

### 21.2 Changes Made (all in `public/index.html`)

**Dual-format `project_switched` handler**
```js
socket.on('project_switched', (payload) => {
  // Handle hub.js format: { projectId, projectName }
  if (payload.projectId) {
    _projActiveId = payload.projectId;
    _updateProjBadge(payload.projectName);
    return;
  }
  // Handle _applyProjectData format: { project, data }
  if (payload.project) { ... }
});
```

**`_updateProjBadge(name)` helper**
Centralises all badge update logic (context-bar text + `#icb-proj-dot` indicator) so there is a single authoritative code path instead of three separate copy-paste blocks. Called from:
- `project_switched` handler (both formats)
- `projSwitchToProject()` callback (belt-and-suspenders; no longer waits solely on socket event)
- `openProjectManager()` on initial load
- `get_active_project` socket callback on reconnect

**"Use" button on project list items**
Each project row in the manager now renders a `▶ Use` button (`class="proj-use-btn"`) visible on row hover. Clicking it calls `projSwitchToProject(id)` directly — no need to open the detail panel first.

**Active project highlight**
List items for the currently active project get `class="active-project"`, which applies a subtle green left-border (CSS: `border-left: 2px solid var(--green)`).

**Input-context-bar badge**
- Project name turns cyan + bold (`color: var(--electric); font-weight: 600`) when a project is active.
- `#icb-proj-dot` — 6px filled green circle — is shown only when active; hidden when no project is set.

### 21.3 UX Before / After

| Scenario | Before | After |
|---|---|---|
| Switch project via detail panel | Badge flickered → sometimes showed "No project" | Badge updates instantly, no flicker |
| Select project without opening detail | Not possible | One-click "▶ Use" button on list row |
| Active project visual cue in list | None | Green left-border on active row |
| Context bar project name style | Plain white text always | Cyan + bold when active; dim grey when inactive |

---

## 22. Per-Mode Model Switching (PM Mode)

**Introduced in commit**: `9d5c27e` — 2026-03-01

### 22.1 Overview

PM mode (`chatMode = 'pm'`) can optionally use a different AI model than the coding modes (AUTO, PLAN). This lets project-management conversations use a cheaper or differently-tuned model (e.g. `MiniMax-Text-01`) without changing the primary coding model. The feature is **disabled by default** to protect billing; users must explicitly enable it in Settings.

### 22.2 How It Works

The resolution logic lives in a single pure helper in `modules/ai-module.js`:

```js
function _effectiveModel(cfg) {
    if (cfg && cfg.autoModelSwitch && cfg.chatMode === 'pm' && cfg.pmModel) {
        return cfg.pmModel;
    }
    return (cfg && cfg.model) || 'MiniMax-M2.5-highspeed';
}
```

Key invariant: `config.model` is **never mutated**. The effective model is resolved fresh on each request. This means the user's primary coding model is always preserved regardless of which mode is active.

`_effectiveModel(cfg)` is called in two places:
- `AIClient.buildContext()` — so the system prompt's `model.name` field reflects the model actually in use.
- `AIClient` API request body — so the correct model is sent to the MiniMax API.

### 22.3 Configuration

| Config key | Default | Source |
|---|---|---|
| `autoModelSwitch` | `false` | Persisted to disk; toggle in Settings |
| `pmModel` | `'MiniMax-Text-01'` | Persisted to disk; `PM_MODEL` env var override |

Both keys are in `PERSISTENT_KEYS` in `config-module.js` and survive server restarts.

### 22.4 Hub / Socket Protocol

`hub.js` handles the new fields in:

| Event / Handler | Change |
|---|---|
| `update_config` socket event | Accepts `autoModelSwitch` (boolean) and `pmModel` (string) |
| `get_config` response | Includes `autoModelSwitch` and `pmModel` |
| `config_updated` broadcast | Includes `autoModelSwitch` and `pmModel` |
| `chatMode` validation | Now accepts `'pm'` in addition to `'auto'`, `'plan'`, `'ask'` |

### 22.5 Frontend (Settings UI)

The Settings modal **General** tab has a new "PM Mode: Auto-Switch Model" section:

| Element | Purpose |
|---|---|
| `BILLING` pill | Red badge warning that enabling this changes billing |
| Warning text | Explains that a different API model will be billed when in PM mode |
| Toggle checkbox (`#settings-auto-model-switch`) | Enables/disables the feature |
| PM model text input (`#settings-pm-model`) | Editable model name; hidden unless toggle is on |
| "Active model" indicator (`#settings-active-model-label`) | Live display of which model will be used given the current mode and setting state |

**Model dropdown** (`#model-select`) now includes `MiniMax-Text-01` as a third option alongside the existing choices.

### 22.6 Mode-Switch Toast

When the user switches chat modes, `setChatMode()` calls `_notifyModelSwitch()` internally. This function:
- Computes the effective model before and after the mode switch.
- Shows a toast notification only when the effective model **actually changes** (e.g. switching from AUTO to PM when `autoModelSwitch` is on).
- Remains silent for same-model transitions (e.g. PM → PM, or mode switch with feature disabled).

Example toast message: `PM mode: switched to MiniMax-Text-01`.

### 22.7 Helper Functions (frontend)

| Function | Trigger | Purpose |
|---|---|---|
| `_applyModelSwitchSettings(data)` | `config_data` / `config_updated` socket events | Syncs checkbox, text input, and active label from server config |
| `_refreshActiveModelLabel()` | Any mode change | Recomputes and renders the "Active model" text |
| `onAutoModelSwitchToggle()` | Checkbox change | Shows/hides the PM model text input row |

---

## 23. Recent Significant Commits

| Commit | Description |
|---|---|
| `1c4872f` | fix(hub): harden all socket.io broadcast paths with try-catch guards |
| `d38325c` | fix(stability): graceful web-push degradation + early startup banner |
| `3dc111a` | feat(auth+ui): session-based auth system + delegate_to_agent magic chip animation |
| `1aa3cc0` | fix: milestone progress always 0% + data consistency across all views |
| `bc98758` | fix(ui): mobile-first overhaul — landscape layout, dashboard access, CSS fixes |
| `b9e4117` | feat: hard-enforce orchestrator delegation + Web Push lock-screen notifications |
| `3e73e05` | fix: full cross-device sync for approvals, plan bar, and notifications |
| `9d5c27e` | feat(pm): auto-switch model per chat mode with billing safeguard |
| `360c7e1` | fix(projects): active project selection now works reliably + clearer UX |
| `cf6be28` | fix(overlord): 5 UI bug fixes — neural panel, ctx details, project badge, live thinking timer, live tokens |

---

## 24. Known Open Issues

| Issue | GitHub | Status |
|---|---|---|
| UI blank space below input / system log panels | #1 | Open |
| `token-manager.test.js` truncateHistory tool-pair preservation | — | Pre-existing bug, not blocking |
| Socket.io broadcast hardening (resolved in `1c4872f`) | #23 | Closed via PR #24 |

---

## 25. Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3031` | HTTP server port |
| `MINIMAX_API_KEY` | required | MiniMax API key |
| `MINIMAX_BASE_URL` | `https://api.minimax.io/anthropic` | API base URL |
| `PM_MODEL` | `MiniMax-Text-01` | Model used in PM mode when `autoModelSwitch` is enabled |

---

*This file is maintained by the `gitops-orchestrator` agent. Do not edit manually without also updating the "Last updated" date and "Recent Significant Commits" table above.*

<!-- Last sync: 2026-03-03 — commit 1c4872f — fix(hub): harden all socket.io broadcast paths with try-catch guards -->
