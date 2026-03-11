# Overlord Backend Architecture

## Overview

The Overlord backend is a Node.js application built on Express and Socket.IO that provides
an AI-powered coding assistant. It follows a modular plugin architecture where all modules
communicate through a central event hub.

**Stack:** Node.js 18+, Express, Socket.IO v4, SQLite (better-sqlite3), MiniMax API (Anthropic-compatible)

**Entry point:** `launcher.js` (spawns `server.js`)

**Default port:** 3031

---

## Architecture Diagram

```
                          +-------------------+
                          |   launcher.js     |
                          | (PID, env, deps)  |
                          +--------+----------+
                                   |
                                   v
                          +-------------------+
                          |    server.js      |
                          | Express + Auth    |
                          | Module Loader     |
                          +--------+----------+
                                   |
                     +-------------+-------------+
                     |                           |
                     v                           v
              +------+------+           +--------+--------+
              |   hub.js    |           | Socket.IO (io)  |
              | EventEmitter|<--------->| Rooms, Push,    |
              | Service Reg.|           | Rate Limiting   |
              +------+------+           +-----------------+
                     |
       +-------------+-------------+-------------+
       |             |             |             |
       v             v             v             v
  +---------+  +---------+  +---------+  +-----------+
  | Config  |  |   AI    |  |  Tools  |  | Orchestr. |
  | Module  |  | Module  |  |  v5     |  | Module    |
  +---------+  +---------+  +---------+  +-----------+
       |             |             |             |
       v             v             v             v
  +---------+  +---------+  +---------+  +-----------+
  |Database |  |Summariz.|  |MCP Mgr. |  |Agent Sys. |
  | Module  |  | Module  |  | Module  |  | Module    |
  +---------+  +---------+  +---------+  +-----------+
       |             |             |             |
       v             v             v             v
  +---------+  +---------+  +---------+  +-----------+
  |Conversa.|  | Token   |  |  MCP    |  |  Agent    |
  | Module  |  | Manager |  | Client  |  | Manager   |
  +---------+  +---------+  +---------+  +-----------+
```

---

## Module Initialization Order

Modules are loaded sequentially by `server.js`. Order matters because later modules
depend on services registered by earlier ones.

```
 1. config-module           -- Service: 'config'
 2. markdown-module         -- Service: 'markdown'
 3. guardrail-module        -- Service: 'guardrail'
 4. character-normalization -- No service (utility)
 5. token-manager-module    -- Service: 'tokenManager'
 6. context-tracker-module  -- Service: 'contextTracker'
 7. mcp-module              -- Service: 'mcp'
 8. mcp-manager-module      -- Service: 'mcpManager'
 9. database-module         -- Service: 'database'
10. notes-module            -- Service: 'notes'
11. skills-module           -- Service: 'skills'
12. tools-v5                -- Service: 'tools'
13. agent-system-module     -- Service: 'agentSystem', 'agents'
14. agent-manager-module    -- Service: 'agentManager'
15. ai-module               -- Service: 'ai'
16. summarization-module    -- Service: 'summarizer'
17. test-server-module      -- Service: 'testServer'
18. file-tools-module       -- Service: 'fileTools'
19. screenshot-module       -- No service (dynamic tools only)
20. minimax-image-module    -- Service: 'imageGen'
21. minimax-tts-module      -- Service: 'tts'
22. minimax-files-module    -- Service: 'minimaxFiles'
23. project-module          -- Service: 'projects'
24. obsidian-vault-module   -- Service: 'obsidian'
25. conversation-module     -- Service: 'conversation'
26. tasks-engine            -- Service: 'tasks'
27. git-module              -- Service: 'git'
28. orchestration-module    -- Service: 'orchestration'
```

---

## Data Flow: User Message to AI Response

```
User (browser)
    |
    |  socket.io 'user_message'
    v
hub.js (Socket.IO bridge)
    |
    |  hub.emit('user_message', text)
    v
orchestration-module
    |
    +-- 1. Check message queue (if AI busy, queue it)
    +-- 2. Build system prompt (ai-module)
    +-- 3. Prepare history (conversation-module)
    +-- 4. Truncate if needed (token-manager-module)
    +-- 5. Call AI API (ai-module.chatStream)
    |       |
    |       +-- Stream tokens --> hub.broadcast('stream') --> client
    |
    +-- 6. Parse tool_use blocks from AI response
    +-- 7. Classify approval tier (agent-system-module: T1-T4)
    +-- 8. Execute approved tools (tools-v5.execute)
    |       |
    |       +-- MCP tools --> mcp-module / mcp-manager-module
    |       +-- File tools --> file-tools-module
    |       +-- Agent tools --> agent-system-module
    |       +-- QA tools --> shell commands
    |
    +-- 9. AutoQA: run lint/types on written files
    +-- 10. Inject tool results into history
    +-- 11. Loop back to step 5 (until no more tool calls or MAX_CYCLES)
    +-- 12. Save conversation (conversation-module)
    +-- 13. Check context usage (context-tracker-module)
    +-- 14. Auto-compact if threshold hit (summarization-module)
    +-- 15. Broadcast final response --> client
```

---

## Key Concepts

### Service Registry

Modules register themselves via `hub.registerService(name, api)`. Other modules consume
services via `hub.getService(name)`. This provides loose coupling -- modules never
require each other directly.

### Socket.IO Rooms

- `conv:{conversationId}` -- one room per conversation
- `broadcast()` targets the active conversation room
- `broadcastAll()` targets every connected socket
- Connection State Recovery allows 2-minute reconnect window

### Approval Tiers

| Tier | Name | Behavior |
|------|------|----------|
| T1 | Self-approve | Agent proceeds immediately (read-only ops) |
| T2 | Orchestrator | Orchestrator reviews (writes, shell commands) |
| T3 | Human required | User must approve (destructive, VCS) |
| T4 | Full review | User + explicit sign-off (critical/irreversible) |

### Chat Modes

| Mode | Description |
|------|-------------|
| `auto` | Full autonomy -- AI uses tools freely |
| `plan` | AI proposes a plan, waits for approval before executing |
| `ask` | AI asks before every tool use |
| `pm` | Project manager mode -- discussion only, no tool use |
| `bypass` | Skip all approval gates (plan execution active) |

---

## Related Documentation

- [Module Reference](modules.md) -- Detailed documentation for all 30 backend modules
- [Service Registry](services.md) -- Every registered service and its API
- [Data Persistence](data-persistence.md) -- All files under `.overlord/` and their lifecycle
