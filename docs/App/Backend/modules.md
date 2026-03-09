# Overlord Backend Module Reference

Complete reference for all backend modules, organized by architectural layer.

---

## Table of Contents

1. [Entry Points](#entry-points)
2. [Core Infrastructure](#core-infrastructure)
3. [AI and Orchestration](#ai-and-orchestration)
4. [Agent System](#agent-system)
5. [Tools and MCP](#tools-and-mcp)
6. [Data and Persistence](#data-and-persistence)
7. [MiniMax Platform Services](#minimax-platform-services)
8. [Utilities](#utilities)

---

## Entry Points

### launcher.js

**Purpose:** OS-agnostic entry point that bootstraps the application environment and spawns the server.

**Init pattern:** Direct execution (`node launcher.js` or `npm start`). Runs the `main()` async function.

**Key functions:**

| Function | Description |
|----------|-------------|
| `loadEnv()` | Parses `.env` manually (pre-dotenv), then re-applies with dotenv once installed |
| `checkNode()` | Exits with error if Node.js < 18 |
| `ensureDeps()` | Runs `npm install` if `node_modules/express` is missing |
| `stopExisting()` | Reads PID file, sends SIGTERM to previous instance, waits up to 8s |
| `checkPrerequisites()` | Validates API key, finds `uvx` binary, writes `prereqs.json` |
| `findUvx()` | Searches PATH and common locations for the `uvx` binary (Windows/Mac/Linux) |
| `openBrowser(url)` | OS-agnostic browser launch (`open` / `cmd /c start` / `xdg-open`) |
| `waitForPort(port)` | TCP poll with 250ms interval, 20s timeout |

**Services registered:** None (not a module).

**Data persistence:**

| File | Format | Purpose |
|------|--------|---------|
| `.overlord/server.pid` | Plain text (integer) | Single-instance PID lock |
| `.overlord/prereqs.json` | JSON | Cached prerequisite check results (API key, uvx path) |

**Dependencies:** `path`, `fs`, `net`, `os`, `child_process`

---

### server.js

**Purpose:** Express HTTP server with Socket.IO, authentication system, file upload, and sequential module loader.

**Init pattern:** Spawned by `launcher.js` (or run directly with `node server.js`). Calls `start()` which initializes hub, loads all modules, then calls `server.listen()`.

**Key functions:**

| Function | Description |
|----------|-------------|
| `loadModules()` | Iterates `moduleFiles` array, `require()`s each, calls `m.init(hub)` |
| `gracefulShutdown(signal)` | Emits `hub.emit('shutdown')`, disconnects sockets, closes HTTP server (5s hard timeout) |
| `_isAuthEnabled()` | Returns true if `AUTH_ENABLED=true`, `ACCESS_PASSWORD` is set, or `users.json` exists |
| `_requireAuth(req, res, next)` | Express middleware; redirects to `/login.html` or returns 401 |

**HTTP routes:**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Yes | Serves `public/index.html` |
| GET | `/api/auth/status` | No | Auth state check |
| POST | `/api/auth/register` | No | User registration (PBKDF2, 100k iterations) |
| POST | `/api/auth/login` | No | Session login (cookie: `_ov_session`, 30d TTL) |
| POST | `/api/auth/logout` | No | Session invalidation |
| GET | `/api/browse-dirs` | Yes | Directory browser API for folder picker |
| POST | `/upload` | No | Multer file upload (dest: `uploads/`) |
| GET | `/generated/*` | No | Static: `.overlord/generated/` |
| GET | `/audio/*` | No | Static: `.overlord/audio/` |

**Socket.IO configuration:**

| Setting | Value |
|---------|-------|
| `maxHttpBufferSize` | 50 MB |
| `pingTimeout` | 60,000 ms |
| `pingInterval` | 25,000 ms |
| `connectionStateRecovery.maxDisconnectionDuration` | 120,000 ms (2 min) |

**Services registered:** None (server.js is the loader, not a module).

**Data persistence:**

| File | Format | Purpose |
|------|--------|---------|
| `.overlord/users.json` | JSON array | Registered user accounts (id, username, hash, salt, role) |

**Dependencies:** `express`, `http`, `socket.io`, `multer`, `exif-parser` (optional), `crypto`, `fs`, `path`

---

## Core Infrastructure

### hub.js

**Purpose:** Central EventEmitter and Socket.IO bridge. All inter-module communication flows through the hub.

**Init pattern:** `hub.init(io, config)` called by `server.js` after Socket.IO is created.

**Key functions:**

| Function | Description |
|----------|-------------|
| `registerModule(name, module)` | Stores module reference in internal Map |
| `registerService(name, service)` | Publishes a service API for other modules to consume |
| `getService(name)` | Retrieves a registered service by name |
| `broadcast(event, data)` | Emits to all clients in the active conversation room |
| `broadcastAll(event, data)` | Emits to every connected socket (server-wide) |
| `broadcastVolatile(event, data)` | Non-critical broadcast (dropped if client not ready) |
| `broadcastToRoom(room, event, data)` | Targeted room broadcast |
| `broadcastContextInfo()` | Pushes updated context stats to all clients |
| `joinConversationRoom(socket, convId)` | Puts socket into `conv:{id}` room, sends state resync |
| `checkRateLimit(socket)` | Token bucket rate limiter (configurable tokens/refill rate) |
| `queueUserMessage(text)` | Buffers messages when AI is busy (max configurable size) |
| `drainMessageQueue()` | Processes queued messages (consolidated or sequential mode) |
| `sendPush(title, body, opts)` | Web Push notification via VAPID |

**Rate limiting:** Token bucket algorithm. Default: 20 tokens, refills at 4/sec. Configurable via `rateLimitTokens` and `rateLimitRefillRate` settings.

**Message queue:** Buffers up to `messageQueueSize` (default 5) user messages when AI is processing. Drain modes: `consolidated` (join all into one prompt) or `sequential` (process one at a time).

**Process state tracking:** Updates every 5 seconds: PID, uptime, memory (RSS, heap).

**Socket event bridge:** 149 socket event handlers that forward socket events as hub events with pattern `socket:{eventName}`.

**Services registered:** None (hub itself is the registry).

**Dependencies:** `events`, `fs`, `path`, `web-push` (optional)

---

### config-module.js

**Purpose:** Loads environment variables, manages runtime configuration, and persists user-adjustable settings.

**Init pattern:** `init(hub)` -- first module loaded. Reads `.env` via dotenv, builds config object, loads persisted settings overlay.

**Key exports/functions:**

| Function/Property | Description |
|-------------------|-------------|
| `config.*` | All configuration properties (model, API keys, limits, toggles) |
| `config.save()` | Persists PERSISTENT_KEYS to `.overlord/settings.json` |
| `config.setThinkingLevel(1-5)` | Updates thinking budget (512/1024/2048/4096/8192 tokens) |

**Configuration categories:**

| Category | Key examples |
|----------|-------------|
| API | `baseUrl`, `apiKey`, `imgApiKey`, `model` |
| Model | `maxTokens`, `temperature`, `thinkingLevel`, `thinkingBudget` |
| Behavior | `chatMode`, `maxAICycles`, `maxQAAttempts`, `approvalTimeoutMs` |
| AutoQA | `autoQA`, `autoQALint`, `autoQATypes`, `autoQATests` |
| Compaction | `autoCompact`, `compactKeepRecent` |
| Rate limiting | `rateLimitTokens`, `rateLimitRefillRate`, `messageQueueSize` |
| GitOps | `gitOpsEnabled`, `gitOpsTrigger`, `gitOpsCommitStyle`, `gitOpsPush` |
| TTS | `ttsEnabled`, `ttsMode`, `ttsVoice`, `ttsSpeed` |
| OS detection | `platform`, `isWindows`, `isMac`, `isLinux`, `shell`, `shellArgs` |

**Persistent keys:** 29 user-adjustable settings survive restarts via JSON overlay.

**Model specifications:**

| Model | Context Window | Max Output |
|-------|---------------|------------|
| MiniMax-M2.5-highspeed | 204,800 | 66,000 |
| MiniMax-M2.5 | 204,800 | 66,000 |

**Service registered:** `config`

**Data persistence:** `.overlord/settings.json` (JSON, subset of config keys)

**Dependencies:** `fs`, `path`, `dotenv`, `os`

---

### database-module.js

**Purpose:** SQLite persistence layer via better-sqlite3.

**Init pattern:** `init(hub)` -- requires `config` service. Creates DB file and tables if missing.

**Tables:**

| Table | Columns | Purpose |
|-------|---------|---------|
| `conversations` | id, title, messages, roadmap, working_dir, tasks, created_at, updated_at | Conversation storage |
| `tasks` | id, conversation_id, title, description, priority, completed, sort_order, metadata, created_at, updated_at | Task persistence |
| `settings` | key, value | Key-value settings store |

**Service API (`database`):**

| Method | Description |
|--------|-------------|
| `getConversation(id)` | Retrieve conversation by ID |
| `saveConversation(data)` | Upsert conversation record |
| `listConversations()` | List all conversations |
| `deleteConversation(id)` | Remove conversation |
| `getTasks(convId)` | Get tasks for a conversation |
| `saveTask(task)` | Insert or update task |
| `deleteTask(id)` | Remove task |
| `updateTask(id, updates)` | Partial task update |
| `reorderTasks(ids)` | Update sort_order for task list |
| `getWorkingDir()` | Get persisted working directory |
| `setWorkingDir(dir)` | Persist working directory |
| `query(sql, params)` | Raw SQL query |
| `run(sql, params)` | Raw SQL execution |

**Service registered:** `database`

**Data persistence:** `.overlord/data.db` (SQLite file)

**Dependencies:** `better-sqlite3`, `fs`, `path`

---

## AI and Orchestration

### orchestration-module.js

**Purpose:** Coordinates the AI loop, tool dispatch, approval system, agent delegation, plan mode, and chat modes.

**Init pattern:** `init(hub)` -- last module loaded. Requires `config`, `ai`, `tools`, `conversation`, `agents`, `tokenManager`, `contextTracker`, `summarizer`.

**Key state:**

| Variable | Type | Description |
|----------|------|-------------|
| `orchestrationState` | Object | Pipeline status (idle/thinking/tool_executing/delegating/waiting_approval) |
| `isProcessing` | Boolean | Whether the AI loop is active |
| `cycleDepth` | Number | Current recursive AI-tool-AI cycle count |
| `MAX_CYCLES` | Number | Max cycles per user message (default from config, up to 250) |
| `pendingApproval` | Object/null | Current T3-T4 approval request |
| `planExecutionActive` | Boolean | When true, skip individual tool approvals |
| `agentChatRooms` | Map | Active agent chat rooms for inter-agent communication |

**Chat modes:**

| Mode | Description |
|------|-------------|
| `auto` | Full autonomy, T1-T2 auto-approved |
| `plan` | AI proposes plan as task list, waits for user approval |
| `ask` | Every tool use requires explicit approval |
| `pm` | Project manager -- discussion only, can switch to auto via handoff |
| `bypass` | Plan execution bypass, all tools auto-approved |

**Network error handling:** Automatic single retry for transient errors (ECONNRESET, ETIMEDOUT, ECONNABORTED, EPIPE, ENOTFOUND, ENETUNREACH, EAI_AGAIN, socket hang up).

**Agent chat rooms:** Up to 5 agents per room, with user presence, meeting notes generation, and discussion round timers.

**Service API (`orchestration`):**

| Method | Description |
|--------|-------------|
| `isProcessing()` | Whether AI loop is active |
| `checkpoint()` | Save current state |
| `getState()` | Get orchestration state snapshot |
| `getDashboard()` | Get full dashboard data |
| `broadcastDashboard()` | Push dashboard update to clients |
| `_updateLimits(cfg)` | Update runtime limits (cycles, QA attempts, timeout) |
| `runAgentSession(...)` | Start an agent session |
| `runAgentSessionInRoom(...)` | Run agent in a chat room |
| `pauseAgent(name)` | Pause agent execution |
| `resumeAgent(name)` | Resume paused agent |
| `getAgentSessionState(name)` | Get agent session snapshot |
| `getAgentHistory(name)` | Get agent conversation history |
| `getAgentInbox(name)` | Get agent pending messages |
| `getOrchestratorState()` | Full orchestrator state |
| `getAllAgentStates()` | All active agent states |
| `createChatRoom(...)` | Create agent chat room |
| `addRoomMessage(...)` | Add message to chat room |
| `endChatRoom(roomId)` | Close a chat room |
| `listChatRooms()` | List all active rooms |
| `getChatRoom(roomId)` | Get room details |
| `pullAgentIntoRoom(...)` | Add agent to existing room |
| `userJoinRoom(roomId)` | User joins room |
| `userLeaveRoom(roomId)` | User leaves room |
| `endMeeting(roomId)` | End meeting and generate notes |
| `generateMeetingNotes(roomId)` | AI-powered meeting summary |

**Service registered:** `orchestration`

**Dependencies:** `path`, all core services via hub

---

### ai-module.js

**Purpose:** MiniMax/Anthropic-compatible API client with streaming, thinking budget, and context awareness.

**Init pattern:** `init(hub)` -- requires `config` service. Instantiates `AIClient`.

**Key functions:**

| Function | Description |
|----------|-------------|
| `AIClient.chatStream(messages, tools, system, callbacks)` | Streaming chat completion with tool support |
| `AIClient.abort()` | Abort active HTTP request |
| `AIClient.quickComplete(messages, system)` | Lightweight internal completion (no tools, no streaming) |
| `buildSystemPrompt()` | Constructs the full system prompt with context, skills, notes, instructions |
| `_effectiveModel(cfg)` | Returns model name (switches to `pmModel` in PM mode if `autoModelSwitch` enabled) |
| `sanitizeForJSON(str)` | Removes lone surrogates and control characters |
| `safeJSONParse(str)` | JSON.parse with sanitization fallback |

**Streaming protocol:** Uses raw HTTPS with chunked transfer. Parses Server-Sent Events (SSE) format. Emits partial tokens via callbacks for real-time streaming to clients.

**Context awareness:** After each request, broadcasts `api_context_snapshot` with input/output token counts from the API response.

**Service API (`ai`):**

| Method | Description |
|--------|-------------|
| `chatStream(...)` | Full streaming chat with tools |
| `abort()` | Cancel active request |
| `quickComplete(...)` | Fast internal completion |
| `buildSystemPrompt()` | Get constructed system prompt |
| `getLastContext()` | Last API context snapshot |

**Service registered:** `ai`

**Dependencies:** `https`, `url`, guardrail-module (optional import)

---

### token-manager-module.js

**Purpose:** Token estimation, history truncation, and context window management.

**Init pattern:** `init(hub)` -- requires `config` service.

**Constants:**

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_CONTEXT_TOKENS` | 204,800 | Full model context window |
| `MAX_INPUT_TOKENS` | 138,800 | Safe input limit (context - max output) |
| `SYSTEM_OVERHEAD_RESERVE` | 55,000 | Reserved for system prompt + tool definitions |
| `MAX_HISTORY_TOKENS` | 83,800 | History budget (input limit - overhead) |
| `ESTIMATE_TOKENS_MULTI` | 0.25 | Rough estimate: 1 token per 4 chars |
| `MAX_OUTPUT_TOKENS` | 66,000 | Default max output |

**Key functions:**

| Function | Description |
|----------|-------------|
| `estimateTokens(text)` | Character-based token estimate (length * 0.25) |
| `estimateMessageTokens(msg)` | Token estimate for a message (content + 20 overhead) |
| `calculateHistoryTokens(history)` | Sum of all message token estimates |
| `truncateHistory(history, maxTokens)` | Smart truncation preserving tool_use/tool_result pairs |
| `sanitizeHistory(history)` | Repair broken tool chains (orphaned tool_use/tool_result) |
| `stripScreenshots(history)` | Remove base64 image data to save tokens |
| `truncateFileContent(content, maxChars)` | Truncate file content with indicator |
| `truncateToolResult(result, maxChars)` | Truncate tool output (default 32,000 chars) |
| `needsTruncation(history)` | Check if history exceeds token budget |
| `validateHistory(history)` | Validate message structure integrity |

**Service API (`tokenManager`):**

| Method | Description |
|--------|-------------|
| `estimateTokens` | Estimate tokens for text |
| `estimateMessageTokens` | Estimate tokens for a message |
| `calculateHistoryTokens` | Calculate total history tokens |
| `truncateHistory` | Smart history truncation |
| `needsTruncation` | Check if truncation needed |
| `truncateFileContent` | Truncate file content |
| `truncateToolResult` | Truncate tool result |
| `sanitizeHistory` | Fix broken tool chains |
| `stripScreenshots` | Remove screenshot data |
| `hasStrippableScreenshots` | Check for screenshot data |
| `getStats` | Get token statistics |
| `validateHistory` | Validate history structure |
| `CONFIG` | Direct access to constants |

**Service registered:** `tokenManager`

**Dependencies:** None (self-contained)

---

### context-tracker-module.js

**Purpose:** Tracks request timing, compaction statistics, and actual API token accounting.

**Init pattern:** `init(hub)` -- requires `config` service.

**Tracked state:**

| Property | Description |
|----------|-------------|
| `chatStartTime` | ISO timestamp of session start |
| `lastRequestTime` | Timestamp of last API request |
| `lastRequestDuration` | Duration of last request (ms) |
| `compactionCount` | Number of context compactions this session |
| `lastCompactionTime` | Timestamp of last compaction |
| `lastCompactionSize` | Tokens freed by last compaction |
| `requestHistory` | Last 20 request durations |
| `lastInputTokens` / `lastOutputTokens` | Actual API token counts from last request |
| `totalInputTokens` / `totalOutputTokens` | Cumulative API token counts |

**Service API (`contextTracker`):**

| Method | Description |
|--------|-------------|
| `recordRequestStart()` | Mark request start time |
| `recordRequestEnd()` | Calculate request duration |
| `getLastRequestDuration()` | Get last request time (ms) |
| `recordCompaction(data)` | Log a compaction event |
| `getCompactionStats()` | Get compaction count and timing |
| `getContextInfo()` | Full context state for clients |
| `getFullStatus()` | Extended status with history |
| `recordApiTokens(input, output)` | Record actual API token counts |
| `getApiTokens()` | Get token accounting data |
| `resetChat()` | Reset all tracking state |
| `getState()` | Raw state snapshot |

**Service registered:** `contextTracker`

**Dependencies:** None

---

### summarization-module.js

**Purpose:** AI-powered context compaction using progressive disclosure -- preserves user demands, failures, lessons, and task state.

**Init pattern:** `init(hub)` -- simple registration. Uses `ai` and `config` services at runtime.

**Key functions:**

| Function | Description |
|----------|-------------|
| `canCompact(history)` | Returns true if history has 10+ messages |
| `compactHistory(history)` | Splits history at `keepRecent` boundary, summarizes older messages via AI, returns `[summaryPair, ...recentMessages]` |

**Compaction algorithm:**
1. Keep last N messages intact (configurable via `compactKeepRecent`, default 20)
2. Extract text from older messages (up to 800 chars each)
3. Call AI to produce a structured summary
4. Replace old messages with a summary user/assistant message pair
5. Emit `summarization_start` and `summarization_complete` events

**Service API (`summarizer`):**

| Method | Description |
|--------|-------------|
| `compactHistory(history)` | Compact history via AI summarization |
| `canCompact(history)` | Check if history is large enough to compact |

**Service registered:** `summarizer`

**Dependencies:** Uses `ai` service (via hub) for summarization calls

---

## Agent System

### agent-system-module.js

**Purpose:** Agent execution system with 4-tier approval, learned patterns, and decision history.

**Init pattern:** `init(hub)` -- requires `config` service. Loads built-in agents via `AgentManager`, loads learned patterns from disk.

**Approval tiers:**

| Tier | Name | Tools |
|------|------|-------|
| T1 | Self-approve | read_file, list_dir, web_search, understand_image, qa_check_*, notes |
| T2 | Orchestrator | write_file, patch_file, edit_file, bash, qa_run_tests, set_working_dir, delegate_to_agent |
| T3 | Human required | delete_file, git_commit, git_push |
| T4 | Full review | delete_directory, deploy |

**Tool tier registry:** Declarative metadata map (`TOOL_TIER_REGISTRY`) with tier, category, risk level, and description for each tool.

**Learned patterns:** Approval decisions are recorded and used to auto-approve similar future decisions. Stored in `.overlord/learned_patterns.json`.

**Periodic check-ins:** Every 10 actions, the system pauses for a user check-in.

**Service API (`agentSystem` / `agents`):**

| Method | Description |
|--------|-------------|
| `getAgentList()` | List all available agents |
| `getAgent(name)` | Get agent definition |
| `executeTask(name, task, context)` | Execute a task via named agent |
| `assignTask(name, task)` | Assign task to agent queue |
| `getStatus()` | Current agent, queue length, running state |
| `getCurrent()` | Currently executing agent |
| `getQueue()` | Pending task queue |
| `cancel()` | Cancel current agent execution |
| `reloadAgents()` | Reload agents from disk |
| `classifyApprovalTier(tool, args)` | Determine tool's approval tier |
| `shouldProceed(tier, tool, args)` | Check learned patterns for auto-approval |
| `recordDecision(tool, args, decision)` | Record approval decision for learning |
| `getLearnedPatterns()` | Get all learned patterns |
| `getActionCount()` | Actions since last check-in |
| `maybeCheckIn()` | Trigger check-in if interval reached |
| `APPROVAL_TIERS` | Tier constants |
| `getToolRegistry()` | Full tool tier registry |
| `TOOL_TIER_REGISTRY` | Direct registry access |

**Service registered:** `agentSystem` and `agents` (same object, dual name)

**Data persistence:**

| File | Format | Purpose |
|------|--------|---------|
| `.overlord/learned_patterns.json` | JSON | Approval pattern learning data |
| `.overlord/recommendation_history.jsonl` | JSONL | Decision audit trail |

**Dependencies:** `fs`, `path`, `./agents/index` (AgentManager)

---

### agents/index.js

**Purpose:** Built-in agent definitions and the `AgentManager` class that loads both built-in and custom agents.

**Init pattern:** Imported by `agent-system-module.js`. `AgentManager` instantiated during agent system init.

**Built-in agents:**


| Agent | Role | Specialties |
|---|---|---|
| `orchestrator` | Orchestrator | Master coordinator for all multi-agent workflows. Decomposes goals into tasks, delegates work to specialist agents, tracks progress, and closes milestones. Never implements code directly — always delegates to the right specialist. |
| `project-manager` | Project Manager | Plans projects, creates milestones, and hands execution plans to the orchestrator. Coordinates scope, timelines, and requirements. Must coordinate and plan rather than implement directly. |

**AgentManager class:**

| Method | Description |
|--------|-------------|
| `loadTeamAgents()` | Scans `.overlord/team/{name}/ROLE.md` for custom agent definitions |
| `getAgentList()` | Returns array of all agent summaries |
| `getAgent(name)` | Get full agent definition by name |
| `assignTask(name, task)` | Queue a task for an agent |

**Custom agents:** Defined as Markdown files in `.overlord/team/{agentName}/ROLE.md`. Loaded at startup and on `reloadAgents()`.

**Service registered:** None (consumed by agent-system-module)

**Dependencies:** `fs`, `path`

---

### agents/framework.js

**Purpose:** Provides `CommandSandbox` for safe shell command execution with timeout and platform detection.

**Init pattern:** Imported by agent modules as needed.

**Key classes:**

**`CommandSandbox`:**

| Property/Method | Description |
|-----------------|-------------|
| `constructor(workingDir, options)` | Set working directory and timeout (default 60s) |
| `execute(command, shell)` | Run command in child process with timeout |

**Execution details:**
- Windows: `cmd.exe /c <command>`
- Unix: `/bin/bash -c <command>`
- Returns `{ success, stdout, stderr, exitCode, duration }`
- Timeout via `setTimeout` + `SIGTERM` (not spawn timeout option, for cross-platform compatibility)

**Service registered:** None (utility class)

**Dependencies:** `fs`, `path`, `child_process`

---

### agent-manager-module.js

**Purpose:** Comprehensive agent management with CRUD, tool permissions, groups, language specialization, and security roles.

**Init pattern:** `init(hub)` -- requires `config` and `database` services. Creates `agents` and `agent_groups` tables in SQLite.

**Security roles:**

| Role | Label | Allowed Categories |
|------|-------|--------------------|
| `full-access` | Full Access | All (wildcard) |
| `implementer` | Implementer | read, write, execute, diagnostic, memory, ai, notes |
| `contributor` | Contributor | read, diagnostic, memory, notes |
| `observer` | Observer | read only |

**Tool categories:**

| Category | Tools |
|----------|-------|
| shell | bash, powershell, cmd |
| files | read_file, read_file_lines, write_file, patch_file, append_file, list_dir |
| ai | web_search, understand_image, fetch_webpage, save_webpage_to_vault |
| system | system_info, get_working_dir, set_working_dir, set_thinking_level |
| agents | list_agents, get_agent_info, assign_task |
| qa | qa_run_tests, qa_check_lint, qa_check_types, qa_check_coverage, qa_audit_deps |
| github | github |
| notes | record_note, recall_notes |
| skills | list_skills, get_skill, activate_skill, deactivate_skill |

**Database tables:**

| Table | Key columns |
|-------|-------------|
| `agents` | id, name, role, description, instructions, group_id, languages, tools, tool_policy, security_role, scope, thinking_enabled |
| `agent_groups` | id, name, description, agents (JSON), metadata |

**Service API (`agentManager`):**

| Method | Description |
|--------|-------------|
| `createAgent(data)` | Create new agent |
| `getAgent(id)` | Get agent by ID |
| `updateAgent(id, data)` | Update agent |
| `deleteAgent(id)` | Delete agent |
| `listAgents(filter)` | List agents with optional filter |
| `createGroup(data)` | Create agent group |
| `getGroup(id)` | Get group by ID |
| `updateGroup(id, data)` | Update group |
| `deleteGroup(id)` | Delete group |
| `listGroups()` | List all groups |
| `getAgentTools(agentId)` | Get agent's allowed tools |
| `isToolAllowedForRole(tool, role)` | Check tool permission |
| `findCapableAgent(task)` | Find agent matching task requirements |
| `TOOL_CATEGORIES` | Tool category definitions |
| `PROGRAMMING_LANGUAGES` | Supported language list |
| `SECURITY_ROLES` | Role definitions |

**Service registered:** `agentManager`

**Dependencies:** `fs`, `path`

---

## Tools and MCP

### tools-v5.js

**Purpose:** Complete tool suite with 42+ native tools, dynamic tool registration, and alias resolution.

**Init pattern:** `init(hub)` -- requires `config` service.

**Tool categories:**

| Category | Tools |
|----------|-------|
| Shell | `bash`, `powershell`, `cmd` |
| Files | `read_file`, `read_file_lines`, `write_file`, `patch_file`, `append_file`, `list_dir`, `search_files`, `delete_file` |
| Web/AI | `web_search`, `understand_image`, `fetch_webpage`, `save_webpage_to_vault` |
| QA | `qa_run_tests`, `qa_check_lint`, `qa_check_types`, `qa_check_coverage`, `qa_audit_deps` |
| Notes | `record_note`, `recall_notes` |
| System | `system_info`, `get_working_dir`, `set_working_dir`, `set_thinking_level` |
| Agents | Dynamically registered by orchestration-module |
| GitHub | `github` (multi-action: get_repo, list_issues, create_issue, etc.) |

**Tool aliases:** 30+ aliases map common misnomers to canonical tool names (e.g., `run_command` -> `bash`, `edit_file` -> `patch_file`, `cat` -> `read_file`, `google` -> `web_search`).

**Dynamic tool registration:** Modules register tools at runtime via `tools.registerTool(def, handler)`. Used by file-tools-module (file_tree, git_diff, project_info), screenshot-module, obsidian-vault-module, minimax-image-module, minimax-tts-module, minimax-files-module.

**Timeouts:**
- Default: 60,000 ms
- Long (installs/tests): 180,000 ms

**Max result size:** 32,000 characters (truncated with indicator)

**Task mode:** Agents can temporarily change working directory; restored when task completes via `startTask()` / `endTask()`.

**Service API (`tools`):**

| Method | Description |
|--------|-------------|
| `execute(toolName, args)` | Execute a tool by name (resolves aliases) |
| `getDefinitions()` | Get all tool definitions (native + dynamic) |
| `getCategorizedTools()` | Get tools grouped by category |
| `startTask(dir)` | Enter task mode with temporary working directory |
| `endTask()` | Exit task mode, restore original directory |
| `registerTool(def, handler)` | Register a dynamic tool |

**Service registered:** `tools`

**Dependencies:** `fs`, `path`, `os`, `child_process`, `https`, `zlib`

---

### mcp-module.js

**Purpose:** MiniMax MCP subprocess client for `web_search` and `understand_image` capabilities via JSON-RPC over stdin/stdout.

**Init pattern:** `init(hub)` -- waits for `config` service. Spawns `uvx minimax-coding-plan-mcp -y` subprocess.

**Tool priority chain:**
1. MCP subprocess (uvx minimax-coding-plan-mcp) -- real results
2. DuckDuckGo Instant Answers API -- fallback search
3. MiniMax vision API -- fallback image understanding
4. Model-based response -- last resort

**McpSubprocessClient class:**

| Method | Description |
|--------|-------------|
| `ensureReady()` | Start subprocess if not running (waits up to 30s) |
| `callTool(name, args)` | JSON-RPC tool call with response matching |
| `destroy()` | Kill subprocess |

**Service API (`mcp`):**

| Method | Description |
|--------|-------------|
| `understandImage(imagePath, prompt, cfg)` | Analyze image content |
| `webSearch(query)` | Web search via MCP |
| `chatWithTools(messages, tools)` | Chat completion with MCP tools |
| `getToolDefinitions()` | Get MCP tool schemas |
| `getMcpClient()` | Direct client access |

**Lifecycle:** Subprocess killed on `hub.emit('shutdown')`.

**Service registered:** `mcp`

**Dependencies:** `https`, `http`, `fs`, `path`, `child_process`, `os`

---

### mcp-manager-module.js

**Purpose:** Multi-MCP server manager supporting multiple concurrent JSON-RPC subprocess connections.

**Init pattern:** `init(hub)` -- loads server config from `.overlord/mcp-servers.json`, starts enabled servers.

**Server presets:**

| Preset | Command | Description |
|--------|---------|-------------|
| `minimax` | `uvx minimax-coding-plan-mcp -y` | Web search, image understanding |
| `github` | `uvx mcp-server-github` | Repos, issues, PRs, file browsing |
| `filesystem` | `npx @modelcontextprotocol/server-filesystem` | File read/write via MCP protocol |
| `sequential_thinking` | `npx @modelcontextprotocol/server-sequential-thinking` | Structured reasoning steps |
| `obsidian` | `npx obsidian-local-rest-api-mcp-server` | Obsidian vault read/write/search |

**McpServerConnection class:**
- Status: `disconnected` | `connecting` | `connected` | `error`
- Reconnect: up to 3 attempts with backoff
- Timeout: 60s per operation (configurable via `MCP_TIMEOUT_MS` env var)
- JSON-RPC over stdin/stdout
- Auto-discovers available tools on connect

**Service API (`mcpManager`):**

| Method | Description |
|--------|-------------|
| `listServers()` | Get all server statuses |
| `enableServer(name)` | Enable and connect a server |
| `disableServer(name)` | Disable and disconnect a server |
| `getServer(name)` | Get server connection object |
| `callServerTool(serverName, toolName, args)` | Call a tool on a specific server |

**Service registered:** `mcpManager`

**Data persistence:** `.overlord/mcp-servers.json` (JSON, server configurations and enabled state)

**Dependencies:** `child_process`, `fs`, `path`, `os`

---

## Data and Persistence

### conversation-module.js

**Purpose:** Manages conversation history, tasks, roadmap, milestones, and working directory. Core persistence layer for chat sessions.

**Init pattern:** `init(hub)` -- requires `config` service. Creates conversations directory, loads last conversation.

**Context limits:**

| Limit | Value | Purpose |
|-------|-------|---------|
| `MAX_CONTEXT_TOKENS` | 204,800 | Full model context window |
| `MAX_INPUT_TOKENS` | 138,800 | Safe input limit |
| `SOFT_LIMIT_TOKENS` | 120,000 | Start warning here |
| `WARNING_THRESHOLD` | 85% | Warn at 85% of soft limit |
| `CRITICAL_THRESHOLD` | 95% | Critical at 95% of soft limit |

**Service API (`conversation`):**

| Method | Description |
|--------|-------------|
| `getId()` | Current conversation ID |
| `getHistory()` | Message history array |
| `getRoadmap()` | Roadmap items |
| `getMilestones()` | Filtered roadmap (milestones only) |
| `getWorkingDirectory()` | Current working directory |
| `setWorkingDirectory(dir)` | Change working directory |
| `getTasks()` | Task list |
| `addTask(task)` | Add task |
| `toggleTask(id)` | Toggle task completion |
| `deleteTask(id)` | Remove task |
| `updateTask(id, updates)` | Update task |
| `reorderTasks(ids)` | Reorder tasks |
| `addMilestone(ms)` | Add milestone |
| `updateMilestone(id, updates)` | Update milestone |
| `deleteMilestone(id)` | Delete milestone |
| `launchMilestone(id)` | Launch/activate milestone |
| `addUserMessage(text)` | Append user message to history |
| `addAssistantMessage(content)` | Append assistant message |
| `addToolResult(result)` | Append tool result |
| `addRoadmapItem(item)` | Add roadmap item |
| `checkpoint()` | Save current state |
| `sanitize()` | Clean history |
| `save()` | Persist to disk |
| `new()` | Start new conversation |
| `getState()` | Full state snapshot |
| `listConversations()` | List all saved conversations |
| `loadConversation(id)` | Load a specific conversation |
| `getContextUsage()` | Calculate context usage stats |
| `shouldWarnContext()` | Check if context warning needed |
| `isContextCritical()` | Check if context is critical |
| `clearHistory()` | Clear for new chat |
| `replaceHistory(history)` | Replace entire history |
| `archiveCurrentAndNew()` | Archive current, start new |
| `loadProjectData(data)` | Load project-specific data |
| `getChildren(taskId)` | Get child tasks |
| `getDescendants(taskId)` | Get all descendants |
| `getAncestors(taskId)` | Get ancestor chain |
| `getBreadcrumb(taskId)` | Get breadcrumb path |
| `getTaskTree()` | Full hierarchical task tree |
| `summarizeAndCompact()` | Trigger AI summarization |
| `saveSessionNote(note)` | Save persistent note |
| `recallSessionNotes(filter)` | Recall session notes |

**Service registered:** `conversation`

**Data persistence:**

| Path | Format | Purpose |
|------|--------|---------|
| `.overlord/conversations/` | Directory | Conversation JSON files |
| `.overlord/conversations/conversations.json` | JSON | Metadata index |
| `.overlord/notes.md` | Markdown | Session notes (legacy, also used by conversation module) |

**Dependencies:** `fs`, `path`

---

### tasks-engine.js

**Purpose:** Dedicated task and milestone socket event handling with hierarchical task tree support (up to 10 levels deep).

**Init pattern:** `init(hub)` -- binds socket event handlers, registers service. Delegates storage to conversation-module.

**Socket events handled:**

| Event | Handler |
|-------|---------|
| `task_added` | Add new task |
| `task_toggled` | Toggle task completion |
| `task_deleted` | Delete task |
| `task_updated` | Update task fields |
| `tasks_reorder` | Reorder task list |
| `focus_task` | Set task focus |
| `assign_task_to_milestone` | Link task to milestone |
| `add_child_task` | Add child under parent |
| `reparent_task` | Move task to new parent |
| `get_task_tree` | Get full hierarchy |
| `get_task_children` | Get direct children |
| `get_task_breadcrumb` | Get ancestor path |

**Service API (`tasks`):**

| Method | Description |
|--------|-------------|
| `getTasks()` | All tasks (flat list) |
| `addTask(task)` | Add task and broadcast |
| `updateTask(id, updates)` | Update task and broadcast |
| `deleteTask(id, cascade)` | Delete task (optionally with children) |
| `toggleTask(id)` | Toggle completion and broadcast |
| `reorderTasks(ids)` | Reorder and broadcast |
| `addMilestone(ms)` | Add milestone |
| `updateMilestone(id, updates)` | Update milestone |
| `deleteMilestone(id)` | Delete milestone |
| `launchMilestone(id)` | Launch milestone |
| `getMilestones()` | Get milestones |
| `getRoadmap()` | Get full roadmap |
| `getChildren(taskId)` | Direct children |
| `getDescendants(taskId)` | All descendants |
| `getAncestors(taskId)` | Ancestor chain |
| `getBreadcrumb(taskId)` | Breadcrumb path |
| `getTaskTree()` | Full hierarchical tree |
| `addChildTask(parentId, task)` | Add child under parent |
| `reparentTask(taskId, newParentId)` | Move task |
| `broadcastSnapshot()` | Push task list to clients |
| `broadcastTree()` | Push task tree to clients |

**Emits:** `tasks_update`, `task_tree_update` broadcasts.

**Service registered:** `tasks`

**Dependencies:** Uses `conversation` service for storage

---

### project-module.js

**Purpose:** Multi-project management with working directory switching, project-scoped agents, and linked projects.

**Init pattern:** `init(hub)` -- requires `config` service. Loads project index from disk.

**Service API (`projects`):**

| Method | Description |
|--------|-------------|
| `listProjects()` | List all projects |
| `getProject(id)` | Get project metadata |
| `createProject(data)` | Create new project |
| `updateProject(id, data)` | Update project |
| `deleteProject(id)` | Delete project |
| `switchProject(id)` | Switch active project (restores context, tasks, agents) |
| `getActiveProject()` | Get currently active project |
| `getActiveProjectId()` | Get active project ID |
| `linkProjects(id1, id2)` | Create link between projects |
| `unlinkProjects(id1, id2)` | Remove link |
| `getProjectData(id)` | Get project-specific data |
| `saveProjectData(id, data)` | Save project-specific data |
| `saveCurrentProjectState()` | Save current project state |
| `listProjectAgents(id)` | List agents scoped to project |
| `addProjectAgent(id, agent)` | Add agent to project |
| `removeProjectAgent(id, agentId)` | Remove agent from project |

**Service registered:** `projects`

**Data persistence:**

| Path | Format | Purpose |
|------|--------|---------|
| `.overlord/projects/index.json` | JSON | Project list and active project ID |
| `.overlord/projects/{id}/data.json` | JSON | Per-project data (tasks, roadmap, settings) |

**Dependencies:** `fs`, `path`

---

### notes-module.js

**Purpose:** Persistent session notes with categories and timestamps. Implements `record_note` and `recall_notes` tools.

**Init pattern:** `init(hub)` -- requires `config` service.

**Features:**
- Lazy file creation (file created only on first note)
- Note categories: `user_preference`, `project_info`, `decision`, `lesson`, `bug`, `todo`, etc.
- ISO timestamps on every note
- Search/filter by category

**Service API (`notes`):**

| Method | Description |
|--------|-------------|
| `recordNote(content, category)` | Save a note with timestamp |
| `recallNotes(category)` | Retrieve notes, optionally filtered |
| `getNotesCount()` | Number of stored notes |
| `clearNotes()` | Delete all notes |
| `getNotesFilePath()` | Path to notes file |

**Service registered:** `notes`

**Data persistence:** `.overlord/notes.json` (JSON array of `{ content, category, timestamp }`)

**Dependencies:** `fs`, `path`

---

### skills-module.js

**Purpose:** Skill document loading from Markdown files with YAML frontmatter. Skills inject specialized knowledge into the system prompt.

**Init pattern:** `init(hub)` -- requires `config` service. Auto-loads all `.md` files from skills directory.

**Skill format:** Markdown files in `.overlord/skills/` with YAML frontmatter:
```yaml
---
name: Skill Name
description: What this skill provides
---
# Skill content (injected into system prompt when activated)
```

**Service API (`skills`):**

| Method | Description |
|--------|-------------|
| `loadSkills()` | Scan and load all skill files |
| `getSkill(name)` | Get full skill content |
| `listSkills()` | List skill summaries |
| `getSkillsPrompt()` | Get combined prompt for active skills |
| `getSkillsMetadataPrompt()` | Get skill list for system prompt |
| `activateSkill(name)` | Activate a skill (inject into prompt) |
| `deactivateSkill(name)` | Deactivate a skill |
| `getActiveSkills()` | List currently active skills |
| `reloadSkills()` | Re-scan skills directory |

**Service registered:** `skills`

**Data persistence:** `.overlord/skills/*.md` (Markdown with YAML frontmatter, user-created)

**Dependencies:** `fs`, `path`, `js-yaml`

---

## MiniMax Platform Services

### minimax-image-module.js

**Purpose:** Image generation via MiniMax image_generation API. Registers the `generate_image` dynamic tool.

**Init pattern:** `init(hub)` -- registers dynamic tool and service.

**Generation options:**
- Model: `image-01`
- Aspect ratios: `1:1`, `16:9`, `9:16`, etc.
- Up to 4 images per request
- Style presets: `anime`, `realistic`, `sketch`, etc.
- Optional prompt optimization

**Service API (`imageGen`):**

| Method | Description |
|--------|-------------|
| `generateImage(prompt, options)` | Generate image(s) |
| `handleGenerateImage(data, socket)` | Socket event handler |

**Service registered:** `imageGen`

**Data persistence:** Generated images saved to `.overlord/generated/`

**Dependencies:** `https`, `http`, `fs`, `path`, `url`

---

### minimax-tts-module.js

**Purpose:** Text-to-speech synthesis via MiniMax T2A v2 API. Registers the `speak` dynamic tool.

**Init pattern:** `init(hub)` -- registers dynamic tool and service.

**Voice options:** 18 voices including Chinese and English options. Model: `speech-01-turbo`.

**Configuration:** Speed (0.5-2.0), volume, pitch adjustable.

**Service API (`tts`):**

| Method | Description |
|--------|-------------|
| `synthesize(text, options)` | Generate speech audio |
| `handleSpeak(data, socket)` | Socket event handler |
| `getVoices()` | List available voices |

**Service registered:** `tts`

**Data persistence:** Generated audio saved to `.overlord/audio/`

**Dependencies:** `https`, `http`, `fs`, `path`, `url`

---

### minimax-files-module.js

**Purpose:** File upload/management via MiniMax Files API. Registers upload, list, and delete tools.

**Init pattern:** `init(hub)` -- registers dynamic tools and service.

**Service API (`minimaxFiles`):**

| Method | Description |
|--------|-------------|
| `uploadFile(filePath, purpose)` | Upload file to MiniMax |
| `listFiles()` | List uploaded files |
| `getFile(fileId)` | Get file metadata |
| `deleteFile(fileId)` | Delete uploaded file |

**Service registered:** `minimaxFiles`

**Dependencies:** `https`, `http`, `fs`, `path`, `url`

---

### test-server-module.js

**Purpose:** Spawns a sandboxed server instance for testing on a separate port. Optional Docker integration.

**Init pattern:** `init(hub)` -- requires `config` service.

**Configuration:**
- Default test port: 3002
- Docker container: `overlord-test` on port 3003

**Service API (`testServer`):**

| Method | Description |
|--------|-------------|
| `start()` | Start test server |
| `stop()` | Stop test server |
| `status()` | Get server status |
| `getLogs()` | Get accumulated logs |
| `setPort(port)` | Set test port |
| `getPort()` | Get test port |
| `dockerStart()` | Start Docker container |
| `dockerStop()` | Stop Docker container |

**Service registered:** `testServer`

**Dependencies:** `child_process`, `fs`, `path`, `os`

---

### screenshot-module.js

**Purpose:** Provides `take_screenshot` tool for visual inspection of web apps during development. Uses puppeteer-core with system Chrome.

**Init pattern:** `init(hub)` -- registers dynamic tool. Requires Chrome/Chromium installed on the system.

**Features:**
- Full page or viewport screenshots
- CSS selector targeting
- Configurable viewport (default 1280x800)
- HTTP/HTTPS URLs only

**Service registered:** None (dynamic tool only)

**Data persistence:** Screenshots saved to `.overlord/screenshots/`

**Dependencies:** `puppeteer-core` (optional), `fs`, `path`, `os`

---

## Utilities

### guardrail-module.js

**Purpose:** Comprehensive input/output sanitization and security. All code outputs and file operations can pass through this module.

**Init pattern:** `init(hub)` -- pure utility, no dependencies.

**Sanitization layers:**
- Zero-width character removal
- Directional formatting character removal
- Control character stripping (preserves newlines, tabs)
- HTML entity decoding
- Smart quote normalization
- Injection pattern detection
- Dangerous shell command detection
- Path traversal prevention

**Service API (`guardrail`):**

| Method | Description |
|--------|-------------|
| `sanitizeForOutput(str)` | Clean string for safe output |
| `sanitizeForSearch(str)` | Normalize string for search operations |
| `sanitizePath(path)` | Validate and clean file path |
| `detectInjection(input)` | Check for injection patterns |
| `detectDangerousCommand(cmd)` | Check for dangerous shell commands |
| `safeWriteFile(path, content)` | Write file with path validation |
| `safeReadFile(path)` | Read file with path validation |
| `validatePatch(original, patch)` | Validate a file patch |
| `safePatch(path, search, replace)` | Apply patch with validation |

**Exposed constants:** `CHAR_MAP`, `HTML_ENTITIES`, `QUOTE_MAP`, `DASH_MAP`, `INJECTION_PATTERNS`, `DANGEROUS_PATTERNS`

**Service registered:** `guardrail`

**Dependencies:** `fs`, `path`

---

### git-module.js

**Purpose:** Automatic git commits with AI-generated messages. Configurable triggers and commit styles.

**Init pattern:** `init(hub)` -- requires `config` service. Binds event listeners for auto-commit triggers.

**Commit triggers:**

| Trigger | Description |
|---------|-------------|
| `every` | Commit on every file change (3s debounce) |
| `count` | Commit after N file changes (configurable via `gitOpsMinChanges`) |
| `task` | Commit on task completion |
| `milestone` | Commit on milestone completion |
| `manual` | User-initiated only |

**Commit styles:** `comprehensive` (detailed), `conventional` (Conventional Commits format), `brief` (one-liner).

**Push modes:** `always`, `never`, `ask`.

**Event listeners:**

| Event | Trigger mode |
|-------|-------------|
| `file_changed` | `every`, `count` |
| `task_complete` | `task` |
| `milestone_completed` | `task`, `milestone` |
| `gitops_commit_now` | `manual` |

**Service API (`git`):**

| Method | Description |
|--------|-------------|
| `commit(message)` | Create git commit |
| `commitAndPush(message)` | Commit and push |
| `getStatus()` | Get git status |
| `createIssue(title, body)` | Create GitHub issue (via `gh`) |
| `createPR(title, body)` | Create pull request |
| `getIssues()` | List issues |
| `getPullRequests()` | List PRs |
| `linkIssueToCommit(issue, sha)` | Link issue to commit |
| `checkoutBranch(name)` | Checkout/create branch |
| `mergeBranch(source, target)` | Merge branches |
| `triggerAutoCommit()` | Force auto-commit |

**Service registered:** `git`

**Dependencies:** `child_process`, `path`, `fs`

---

### file-tools-module.js

**Purpose:** OS-agnostic file manipulation utilities and dynamic tool registration for file_tree, git_diff, and project_info.

**Init pattern:** `init(hub)` -- requires `config` and `tools` services.

**Chunk size:** 64 KB default for large file operations.

**Dynamic tools registered:**

| Tool | Description |
|------|-------------|
| `file_tree` | Recursive directory tree (skips node_modules, .git, etc., max depth 4) |
| `git_diff` | Git diff of current changes |
| `project_info` | Project metadata (package.json, README, etc.) |

**Service API (`fileTools`):**

| Method | Description |
|--------|-------------|
| `readChunked(path, options)` | Read file in chunks |
| `writeChunked(path, content, options)` | Write file in chunks |
| `appendToFile(path, content)` | Append to file |
| `insertInFile(path, position, content)` | Insert at position |
| `patchFile(path, search, replace)` | Search and replace in file |
| `createFile(path, content)` | Create new file with directories |
| `deleteFile(path)` | Delete file |
| `listDirectory(path)` | List directory contents |
| `getFileInfo(path)` | Get file metadata (size, dates) |
| `searchInFile(path, pattern)` | Search file contents |
| `replaceInFile(path, search, replace)` | Replace in file |
| `readFileLines(path, start, end)` | Read specific line range |
| `ensureDirectory(path)` | Create directory recursively |

**Service registered:** `fileTools`

**Dependencies:** `fs`, `path`, `os`, `child_process`

---

### obsidian-vault-module.js

**Purpose:** Obsidian vault discovery and AI tools for reading/writing/searching vault notes via the filesystem.

**Init pattern:** `init(hub)` -- requires `config` and `tools` services.

**Vault discovery:** Scans common locations (Documents, Desktop, Dropbox, OneDrive, iCloud) for directories containing `.obsidian/` subdirectory.

**Dynamic tools registered:**

| Tool | Description |
|------|-------------|
| `vault_list` | List notes in vault (or subfolder) |
| `vault_read` | Read a note by relative path |
| `vault_write` | Write/create a note |
| `search_notes` | Full-text search across vault |

**Service API (`obsidian`):**

| Method | Description |
|--------|-------------|
| `discoverVaults()` | Scan for Obsidian vaults |
| `getVaultPath()` | Get configured vault path |
| `listNotes(folder)` | List markdown files in vault |

**Service registered:** `obsidian`

**Dependencies:** `fs`, `path`, `os`

---

### markdown-module.js

**Purpose:** Markdown parsing and rendering using the `marked` library with GitHub Flavored Markdown support.

**Init pattern:** `init(hub)` -- loads `marked` library.

**marked configuration:**
- `gfm: true` (GitHub Flavored Markdown)
- `breaks: true` (newlines to `<br>`)
- `smartLists: true`

**Service API (`markdown`):**

| Method | Description |
|--------|-------------|
| `parse(text)` | Render markdown to HTML |
| `toPlainText(text)` | Strip markdown to plain text |
| `escape(text)` | HTML entity escaping |

**Service registered:** `markdown`

**Dependencies:** `marked`

---

### character-normalization.js

**Purpose:** Unicode character normalization and Levenshtein similarity. Ensures consistent character handling across code updates.

**Init pattern:** `init(hub)` -- pure utility, no dependencies on other services.

**Normalization rules:**

| Category | Examples |
|----------|---------|
| HTML entities | `&gt;` -> `>`, `&lt;` -> `<`, `&amp;` -> `&` |
| Smart quotes | Curly quotes -> straight quotes |
| Dashes | En dash, em dash, non-breaking hyphen -> `-` |
| Problem chars | Zero-width space, BOM -> removed |

**Key functions:**

| Function | Description |
|----------|-------------|
| `normalizeForSearch(str)` | Normalize string for search operations |
| `normalizeForCode(str)` | Normalize for code (HTML entities, quotes, dashes) |
| `levenshteinSimilarity(a, b)` | String similarity score (0-1) |

**Service registered:** None (pure utility, exports functions directly)

**Dependencies:** None
