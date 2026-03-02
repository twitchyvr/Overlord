<div align="center">

# OVERLORD

**AI Orchestration Platform — Multi-Agent Development Environment**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![MiniMax](https://img.shields.io/badge/AI-MiniMax%20M2.5-purple.svg)](https://api.minimax.io)

*An AI-powered development platform where you orchestrate intelligent agents to plan, build, and ship software.*

</div>

---

## What is OVERLORD?

OVERLORD is a browser-based AI orchestration platform that transforms how you develop software. Instead of typing code yourself, you direct a team of specialized AI agents — each with defined roles, tool permissions, and their own session memory — to plan, implement, review, and deploy your software.

Built on the **MiniMax M2.5** API (Anthropic-compatible), OVERLORD provides a real-time collaborative workspace where the AI thinks, acts, and reports back while you watch — or delegate and walk away.

## Features

- **Multi-Agent System** — Create unlimited specialized agents (frontend dev, QA engineer, security auditor, etc.) with custom roles, capabilities, and tool permissions
- **Plan Mode** — AI generates multi-variant plans (Short / Regular / Long / Unlimited) with approval workflow before any code is written
- **Real-Time Activity** — Live sparkline graphs, tool inspector, neural thoughts stream, and activity feed per agent
- **Message Queue** — Queue messages while AI is working; send individually or consolidate all into one prompt
- **Project Dashboard** — Kanban board, milestone tracker, KPI charts, and AI Project Manager chat
- **Extended Thinking** — Optional per-agent thinking mode with configurable token budget
- **MCP Servers** — Connect Model Context Protocol servers (GitHub, filesystem, custom) for expanded tool access
- **Approval Flow** — T3/T4 tier tools (file writes, shell commands) require user approval via any connected device
- **Socket.IO Rooms** — Multi-tab / multi-device support with scoped broadcasting per conversation
- **AutoQA** — Automatic lint, type-check, and test runs after every file write
- **Context Compaction** — AI-powered summarization when context window fills
- **Agent-to-Agent Comms** — Agents delegate sub-tasks to peer agents with chain depth guards
- **Backchannel** — Internal agent communication log, separate from main conversation

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (index.html)                  │
│  Chat · Activity · Team Panel · Dashboard · Settings    │
└────────────────┬──────────────────────────────────────┘
                 │ Socket.IO
┌────────────────▼──────────────────────────────────────┐
│                    Node.js Server                        │
│  hub.js — Event bus + Socket bridge                     │
├────────────────────────────────────────────────────────┤
│  Modules (loaded dynamically):                          │
│  ai-module       → MiniMax API client (streaming)       │
│  orchestration   → AI loop, tool dispatch, plan mode    │
│  agent-manager   → Agent CRUD (SQLite)                  │
│  tools-v5        → Tool registry + execute()            │
│  mcp-module      → MCP server subprocess manager        │
│  conversation    → History + tasks + milestones         │
│  config          → Settings persistence (.env + JSON)   │
│  token-manager   → Context window tracking              │
│  summarization   → AI-powered context compaction        │
└────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/overlord-web.git
cd overlord-web

# 2. Install dependencies
npm install

# 3. Configure your API key
cp .env.example .env
# Edit .env and set MINIMAX_API_KEY=your_key_here

# 4. Start the server
node server.js

# 5. Open in browser
open http://localhost:3031
```

## Configuration

All settings can be adjusted via the `.env` file or the in-app Settings panel. See [`.env.example`](.env.example) for a complete list of options.

| Variable | Default | Description |
|----------|---------|-------------|
| `MINIMAX_API_KEY` | — | **Required.** MiniMax API key |
| `ANTHROPIC_MODEL` | `MiniMax-M2.5-highspeed` | AI model to use |
| `MAX_TOKENS` | `66000` | Max output tokens per response |
| `MAX_AI_CYCLES` | `250` | Max AI→tool cycles per message (0=unlimited) |
| `THINKING_LEVEL` | `3` | Thinking budget level 1-5 (when enabled) |
| `AUTO_QA` | `true` | Run lint/type checks after file writes |
| `CHAT_MODE` | `auto` | Default chat mode: auto/plan/ask/pm |
| `MAX_PARALLEL_AGENTS` | `3` | Max concurrent agent sessions |
| `PORT` | `3031` | Server port |

## Agent System

Agents are AI personas with defined roles, capabilities, and tool permissions. Create them in the Team panel or Agent Manager:

1. **Global Agents** — Available across all projects (stored in SQLite)
2. **Project Agents** — Scoped to a single project (stored in project data)

Each agent has:
- **Role** — What the agent does (e.g. "Frontend Developer")
- **Capabilities** — Skills list shown on the agent card
- **Tool Policy** — Allowlist or denylist of tools the agent can use
- **Thinking Mode** — Optional per-agent extended thinking with custom budget
- **Group** — Organizational grouping (version-control, development, quality-assurance, etc.)

## MCP Servers

Connect Model Context Protocol servers to expand available tools:

1. Open Settings → MCP Servers
2. Add a server with a name and command (e.g. `uvx minimax-coding-plan-mcp`)
3. The server's tools become available to the AI immediately

Built-in presets: GitHub, filesystem, DuckDuckGo search.

## Development

```bash
# Run tests
npm test

# Run with auto-restart on changes
npm run dev  # requires nodemon: npm i -g nodemon
```

## License

MIT — see [LICENSE](LICENSE) for details.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
