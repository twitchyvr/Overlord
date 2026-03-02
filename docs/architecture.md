# Architecture

## Overview

OVERLORD is a Node.js application with a browser-based frontend. The backend uses an event-driven hub pattern; the frontend communicates entirely via Socket.IO.

```
Browser ──Socket.IO──► hub.js ──emit/on──► Modules
                                    │
                                    ├─ ai-module (MiniMax API)
                                    ├─ orchestration-module (AI loop)
                                    ├─ agent-manager-module (SQLite)
                                    ├─ tools-v5 (tool registry)
                                    ├─ conversation-module (history)
                                    ├─ config-module (settings)
                                    └─ mcp-module (MCP servers)
```

## Hub (`hub.js`)

The hub is the central event bus and Socket.IO bridge. It:
- Manages Socket.IO rooms (one room per conversation)
- Routes socket events to hub events (`hub.emit`)
- Provides `hub.broadcast(event, data)` (room-scoped) and `hub.broadcastAll(event, data)` (server-wide)
- Manages the message queue (`_msgQueue`) with drain mode support
- Handles rate limiting per socket (token bucket, 20 tokens / 4 per second)

## Orchestration Module

The orchestration module drives the AI→tool→AI loop:

1. User message arrives → `handleUserMessage()`
2. Plan Mode check — if enabled, injects plan instruction into history
3. `ai.chatStream()` — streams response from MiniMax API
4. Tool calls extracted → `executeToolCall()` for each
5. T3/T4 tools → approval flow → `waitForApproval()`
6. Tool results appended → loop repeats until no more tool calls
7. Plan Mode — if plan JSON in response, calls `extractAndCreatePlanTasks()`
8. Awaits plan decision (`waitForPlanDecision()`)

## Socket.IO Rooms

Each conversation has a room: `conv:{conversationId}`. Clients join by emitting `join_conversation` with the conversation ID. `hub.broadcast()` emits only to the active room, preventing cross-conversation data leakage.

## Agent Session Engine

Agent sessions run independently of the main orchestration loop via `runAgentSession(agentName, message)`:
- Each agent has its own `session.history` (in-memory)
- Sessions are queued via `session.inbox` when the agent is busy
- Agents can be paused/resumed
- Per-agent thinking mode overrides global thinking settings
- Chain depth guard (`_agentChainDepth`) prevents runaway delegation
