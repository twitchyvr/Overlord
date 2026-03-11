# Overlord Data Persistence Map

Complete map of all files and directories under `.overlord/` and other persisted locations.
All paths are relative to the project root (the directory containing `server.js`).

---

## Directory Structure

```
.overlord/
  server.pid
  prereqs.json
  users.json
  settings.json
  data.db
  notes.json
  notes.md
  learned_patterns.json
  recommendation_history.jsonl
  mcp-servers.json
  conversations/
    conversations.json
    {conversation-id}.json
    ...
  projects/
    index.json
    {project-id}/
      data.json
  team/
    {agent-name}/
      ROLE.md
  skills/
    *.md
  generated/
    *.png, *.jpg
  audio/
    *.mp3
  screenshots/
    *.png
uploads/
  (multer temp files)
```

---

## File Reference

### Process and Startup

| File Path | Format | Module Owner | Purpose | Created When | Deleted When | Size Limit |
|-----------|--------|-------------|---------|-------------|-------------|------------|
| `.overlord/server.pid` | Plain text (integer) | launcher.js | Single-instance PID lock. Prevents multiple server instances. | Server starts | Server stops (or stale PID removed on next launch) | ~10 bytes |
| `.overlord/prereqs.json` | JSON | launcher.js | Cached prerequisite check results: API key presence, uvx path, timestamp. Read by mcp-module and server.js at startup. | Every launcher.js run | Overwritten on each launch | ~200 bytes |

---

### Authentication

| File Path | Format | Module Owner | Purpose | Created When | Deleted When | Size Limit |
|-----------|--------|-------------|---------|-------------|-------------|------------|
| `.overlord/users.json` | JSON array | server.js | Registered user accounts. Each entry: `{ id, username, hash, salt, role, createdAt }`. Password hashed with PBKDF2 (100k iterations, SHA-512). | First user registers | Manual deletion only | Grows with user count |

---

### Configuration

| File Path | Format | Module Owner | Purpose | Created When | Deleted When | Size Limit |
|-----------|--------|-------------|---------|-------------|-------------|------------|
| `.overlord/settings.json` | JSON object | config-module.js | Persisted user-adjustable settings (29 keys). Overlays on top of `.env` defaults at startup. Written on every `config.save()` call. | First settings change via UI | Never (overwritten) | ~2 KB |

---

### Database

| File Path | Format | Module Owner | Purpose | Created When | Deleted When | Size Limit |
|-----------|--------|-------------|---------|-------------|-------------|------------|
| `.overlord/data.db` | SQLite (better-sqlite3) | database-module.js | Primary database. Tables: `conversations`, `tasks`, `settings`. Used by conversation-module for storage, agent-manager for agent/group persistence. | First server start | Manual deletion only | Grows unbounded (typical: 1-50 MB) |

---

### Conversations

| File Path | Format | Module Owner | Purpose | Created When | Deleted When | Size Limit |
|-----------|--------|-------------|---------|-------------|-------------|------------|
| `.overlord/conversations/` | Directory | conversation-module.js | Container for conversation JSON files. | First server start | Never | N/A |
| `.overlord/conversations/conversations.json` | JSON | conversation-module.js | Metadata index listing all conversations with titles, dates, and IDs. | First server start | Never (overwritten) | Grows with conversation count |
| `.overlord/conversations/{id}.json` | JSON | conversation-module.js | Individual conversation state: history (messages), tasks, roadmap, milestones, working directory. | New conversation created | Conversation deleted by user | Varies (1 KB - 5 MB per conversation; shrinks after compaction) |

---

### Session Notes

| File Path | Format | Module Owner | Purpose | Created When | Deleted When | Size Limit |
|-----------|--------|-------------|---------|-------------|-------------|------------|
| `.overlord/notes.json` | JSON array | notes-module.js | Persistent session notes. Each entry: `{ content, category, timestamp }`. Categories include: user_preference, project_info, decision, lesson, bug, todo. | First `record_note` call (lazy creation) | `clearNotes()` or manual deletion | Grows unbounded |
| `.overlord/notes.md` | Markdown | conversation-module.js | Legacy session notes in Markdown format. Also used for session note display. | First session note saved | Manual deletion | Configurable via `sessionNotesLines` (default: 100 lines in system prompt) |

---

### Agent System

| File Path | Format | Module Owner | Purpose | Created When | Deleted When | Size Limit |
|-----------|--------|-------------|---------|-------------|-------------|------------|
| `.overlord/learned_patterns.json` | JSON object | agent-system-module.js | Approval decision learning data. Maps tool+context patterns to auto-approval decisions. Improves over time. | First approval decision recorded | Manual deletion | Grows with usage (typical: 1-50 KB) |
| `.overlord/recommendation_history.jsonl` | JSON Lines | agent-system-module.js | Decision audit trail. One JSON object per line recording every approval decision with timestamp, tool, args, tier, and outcome. | First approval decision | Manual deletion | Append-only, grows unbounded |
| `.overlord/team/` | Directory | agents/index.js | Container for custom agent definitions. | First custom agent created or on agent reload | Never | N/A |
| `.overlord/team/{name}/ROLE.md` | Markdown | agents/index.js | Custom agent definition. Contains agent role description, capabilities, and instructions. Loaded at startup by AgentManager. | User creates custom agent | User deletes agent | User-defined |

---

### Skills

| File Path | Format | Module Owner | Purpose | Created When | Deleted When | Size Limit |
|-----------|--------|-------------|---------|-------------|-------------|------------|
| `.overlord/skills/` | Directory | skills-module.js | Container for skill definition files. Created with default examples if missing. | First server start | Never | N/A |
| `.overlord/skills/*.md` | Markdown (YAML frontmatter) | skills-module.js | Skill definitions. YAML frontmatter has `name` and `description`. Body content is injected into system prompt when skill is activated. | Default skills on first start; user-created thereafter | Manual deletion | User-defined |

---

### Projects

| File Path | Format | Module Owner | Purpose | Created When | Deleted When | Size Limit |
|-----------|--------|-------------|---------|-------------|-------------|------------|
| `.overlord/projects/` | Directory | project-module.js | Container for project data. | First server start | Never | N/A |
| `.overlord/projects/index.json` | JSON | project-module.js | Project index: `{ activeProjectId, projects: [...] }`. Lists all projects with metadata (name, description, working directory, created date). | First server start | Never (overwritten) | Grows with project count |
| `.overlord/projects/{id}/data.json` | JSON | project-module.js | Per-project data: tasks, roadmap, milestones, settings overrides, linked project IDs. | Project created | Project deleted | Varies (1-100 KB per project) |

---

### MCP Servers

| File Path | Format | Module Owner | Purpose | Created When | Deleted When | Size Limit |
|-----------|--------|-------------|---------|-------------|-------------|------------|
| `.overlord/mcp-servers.json` | JSON | mcp-manager-module.js | MCP server configurations. Stores enabled/disabled state, custom server definitions, environment variables for each server. Presets (minimax, github, filesystem, sequential_thinking, obsidian) are merged at startup. | First MCP config change | Manual deletion | ~2-5 KB |

---

### Generated Content

| File Path | Format | Module Owner | Purpose | Created When | Deleted When | Size Limit |
|-----------|--------|-------------|---------|-------------|-------------|------------|
| `.overlord/generated/` | Directory | launcher.js (created), minimax-image-module.js (used) | AI-generated images. Served at `/generated/` URL path. | Launcher startup | Manual cleanup | Grows with usage |
| `.overlord/generated/*.png` | PNG image | minimax-image-module.js | Individual generated images. Named with timestamp or hash. | Image generation request | Manual cleanup | ~100 KB - 5 MB per image |
| `.overlord/audio/` | Directory | launcher.js (created), minimax-tts-module.js (used) | AI-generated speech audio. Served at `/audio/` URL path. | Launcher startup | Manual cleanup | Grows with usage |
| `.overlord/audio/*.mp3` | MP3 audio | minimax-tts-module.js | Generated speech files. | TTS synthesis request | Manual cleanup | ~50 KB - 2 MB per file |
| `.overlord/screenshots/` | Directory | screenshot-module.js | Browser screenshots for visual inspection. | First screenshot taken | Manual cleanup | Grows with usage |
| `.overlord/screenshots/*.png` | PNG image | screenshot-module.js | Individual screenshots. | Screenshot request | Manual cleanup | ~100 KB - 3 MB per screenshot |

---

### Uploads

| File Path | Format | Module Owner | Purpose | Created When | Deleted When | Size Limit |
|-----------|--------|-------------|---------|-------------|-------------|------------|
| `uploads/` | Directory | server.js (multer) | Temporary file upload storage. Located at project root, not inside `.overlord/`. Served at `/uploads/` URL path. | Launcher startup / first upload | Manual cleanup | Limited by multer defaults and disk space |

---

## Database Schema (data.db)

### conversations

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Conversation UUID |
| `title` | TEXT | Conversation title |
| `messages` | TEXT | JSON-encoded message history |
| `roadmap` | TEXT | JSON-encoded roadmap/milestones |
| `working_dir` | TEXT | Working directory path |
| `tasks` | TEXT | JSON-encoded task list |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

### tasks

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Task UUID |
| `conversation_id` | TEXT (FK) | Parent conversation |
| `title` | TEXT | Task title |
| `description` | TEXT | Task description |
| `priority` | TEXT | `normal`, `high`, `low` |
| `completed` | INTEGER | 0 or 1 |
| `sort_order` | INTEGER | Display order |
| `metadata` | TEXT | JSON-encoded extra data (parentId, milestoneId, etc.) |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

### settings

| Column | Type | Description |
|--------|------|-------------|
| `key` | TEXT PRIMARY KEY | Setting name |
| `value` | TEXT | Setting value |

### agents (created by agent-manager-module)

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Agent UUID |
| `name` | TEXT UNIQUE | Agent name |
| `role` | TEXT | Role description |
| `description` | TEXT | Agent description |
| `instructions` | TEXT | Custom instructions |
| `group_id` | TEXT | Agent group FK |
| `languages` | TEXT | JSON array of languages |
| `tools` | TEXT | JSON array of allowed/denied tools |
| `tool_policy` | TEXT | `allowlist` or `denylist` |
| `auto_add_tools` | INTEGER | Auto-add new tools (0/1) |
| `security_role` | TEXT | `full-access`, `implementer`, `contributor`, `observer` |
| `capabilities` | TEXT | JSON array of capabilities |
| `metadata` | TEXT | JSON extra data |
| `status` | TEXT | `active`, `inactive` |
| `scope` | TEXT | `global` or `project` |
| `thinking_enabled` | INTEGER | Extended thinking (0/1) |
| `thinking_budget` | INTEGER | Token budget for thinking |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

### agent_groups (created by agent-manager-module)

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Group UUID |
| `name` | TEXT UNIQUE | Group name |
| `description` | TEXT | Group description |
| `agents` | TEXT | JSON array of agent IDs |
| `metadata` | TEXT | JSON extra data |
| `created_at` | TEXT | ISO timestamp |

---

## Lifecycle Summary

### Files created on first launch
- `.overlord/` directory tree
- `.overlord/server.pid`
- `.overlord/prereqs.json`
- `.overlord/data.db` (with schema)
- `.overlord/conversations/` directory
- `.overlord/projects/` directory
- `.overlord/skills/` directory (with default skills)
- `.overlord/generated/` directory
- `.overlord/audio/` directory
- `uploads/` directory

### Files created on first use
- `.overlord/users.json` (first registration)
- `.overlord/settings.json` (first settings change)
- `.overlord/notes.json` (first `record_note`)
- `.overlord/notes.md` (first session note)
- `.overlord/learned_patterns.json` (first approval decision)
- `.overlord/recommendation_history.jsonl` (first approval decision)
- `.overlord/mcp-servers.json` (first MCP config change)
- `.overlord/team/{name}/ROLE.md` (first custom agent)
- `.overlord/conversations/{id}.json` (first conversation)
- `.overlord/projects/index.json` (first project)

### Files that grow unbounded (consider periodic cleanup)
- `.overlord/data.db` -- grows with conversations and tasks
- `.overlord/recommendation_history.jsonl` -- append-only audit log
- `.overlord/generated/` -- accumulates generated images
- `.overlord/audio/` -- accumulates TTS audio files
- `.overlord/screenshots/` -- accumulates screenshots
- `uploads/` -- accumulates uploaded files

### Files safe to delete for a fresh start
Deleting the entire `.overlord/` directory resets all state. The server will recreate
required directories and files on the next launch. This is the equivalent of a "factory reset."

Individual reset options:
- Delete `.overlord/data.db` to clear all conversations and tasks
- Delete `.overlord/settings.json` to reset to `.env` defaults
- Delete `.overlord/learned_patterns.json` to reset approval learning
- Delete `.overlord/mcp-servers.json` to reset MCP server configuration
- Delete `.overlord/conversations/` to clear conversation history
- Delete `.overlord/notes.json` and `.overlord/notes.md` to clear notes
