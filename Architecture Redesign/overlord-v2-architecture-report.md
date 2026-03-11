# Overlord v2: The Rebuild

**Architecture Report — Updated 03-10**

A comprehensive blueprint for v2 — from the Building/Room/Table spatial framework and Phase Zero onboarding to Lua-scriptable modularity, exit documents, and provider-agnostic AI. Synthesized from codebase analysis and collaborative design sessions.

| Metric | Value |
|---|---|
| Lines Backend | 18.5K |
| Lines Frontend | 8.2K |
| v2 Modules | ~20 |
| Floor Types | 7 |
| Build Phases | 6 |

---

## 1. Philosophy: What's Fundamentally Changing

The single most important architectural principle driving v2, plus two new design tenets surfaced in collaborative design review.

### "Don't change the agent — change the framework."

Instead of tweaking individual agent prompts to fix behavior (fragile, doesn't scale), v2 builds *room-level constraints* that any agent entering that room must follow. The testing room prevents test-changing behavior regardless of which agent is testing.

| Approach | Description |
|---|---|
| **v1: Agent-Centric** | Each agent carries its own rules, instructions, and behavioral constraints in its system prompt. Changes require editing individual agents. If 5 agents can test, you update 5 prompts. |
| **v2: Framework-Centric** | Rooms define constraints. When an agent enters a room, the room's rules merge into their context. Change the testing room rules once — every agent that enters inherits them. |
| **Impact: Scalability** | Add a new agent type? It just works in existing rooms. Add a new room? Existing agents can enter it with no changes. Framework scales horizontally — like snapping new floors onto a building. |

### "One agent, one task."

Agents operate with "todos" rather than broad "tasks." A todo is a focused, single-purpose instruction. Tasks are milestones — todos are the granular units of work. This mirrors agentic best practices: simple instructions, clear scope, no ambiguity. Context management is the constraint that makes this essential — you can't ask a model to "know all the things all the time" any more than you can tow a boat with a compact car.

### "Build the tool, not the monolith."

Overlord is not a chat screen with previous chats. It's a **tool** — with dashboards, project management, KPIs, agent orchestration, and a chat component embedded within it. The user starts from a project-centric dashboard, not a blank conversation. The building metaphor isn't just architecture — it's the *interface*.

---

## 2. The Building Model

Think of it like a tycoon game: each floor has a purpose, each room has tools, each table has seats. You build floor by floor, scale up or down, and can even build multiple buildings that communicate.

### 🏢 Governance Floor — Sign-off & Review

| Room | Purpose | Agents/Tags |
|---|---|---|
| **Review Room** | Go/no-go decisions. Risk questionnaire. Requires independent analysis from each reviewer. Exit document required before phase transition. | `Gate` `PM` `Architect` |
| **Audit Room** | Security review, compliance checks, code audit. Read-only tools. Must cite specific evidence in structured output. | `Gate` `Security` |
| **Release Lounge** | Pre-release checklist, deployment readiness, rollback plan review. Final sign-off before deploy. | `DevOps` `Architect` |

### 💻 Execution Floor — Build & Implement

| Room | Purpose | Agents/Tags |
|---|---|---|
| **Code Lab** | Implementation room. Full file read/write/shell access. Scoped to assigned files via taskScope. Focus Desk mode for solo work. | `Dev` `Focus Desk` |
| **Integration Room** | Multi-agent collaboration on dependent tasks. Shared context, cross-references. Collaboration Table mode. | `Dev` `Collab Table` |
| **Testing Lab** | **Cannot modify source code.** Can only run tests, report results, log failures. The framework enforces this structurally. | `QA` `No write_file` |
| **Boardroom** | Large-group coordination when a table isn't enough. Staff meetings, cross-team alignment. Higher agent capacity than standard tables. | `All leads` `Expanded` |

### 💬 Collaboration Floor — Plan & Design

| Room | Purpose | Agents/Tags |
|---|---|---|
| **Discovery Room** | First phase. Define business outcomes, constraints, unknowns. Produces: requirements doc, gap analysis, risk assessment. | `PM` `SMEs` `Orch` |
| **Architecture Room** | Design phase. Produces: milestones, task breakdown, dependency graph, tech decisions. | `Architect` `PM` |
| **War Room** | Incident response. All-hands troubleshooting. Elevated access. Time-boxed. Escalated from Monitoring Room. | `Principal` `All` |

### ⚙️ Operations Floor — Deploy & Monitor

| Room | Purpose | Agents/Tags |
|---|---|---|
| **Deploy Room** | Git operations, CI/CD triggers, deployment verification. Requires Release Lounge sign-off first. | `DevOps` `Gate` |
| **Monitoring Room** | Health checks, log analysis, performance metrics. Read-only. Escalates to War Room on critical issues. | `DevOps` `Auto` |

### 🔌 Integration Floor — External I/O & Plugins

| Room | Purpose | Agents/Tags |
|---|---|---|
| **Plugin Hub** | The single floor that can talk outside the building. External API connections, third-party integrations, data transforms. Keeps the rest of the building secure. | `Secure` `External` |
| **Data Bridge** | Interprets and transforms data between buildings, platforms, or external systems. Integration-ready output. | `Transform` `Bridge` |

### 🎯 Strategy Floor — Phase Zero & Consulting

| Room | Purpose | Agents/Tags |
|---|---|---|
| **Strategist Suite** | Phase Zero. Before any project work begins. The strategist asks consultative questions to understand success, inputs, outputs, and project type. Suggests building layout. | `Strategist` `User` |
| **Template Gallery** | Pre-built building configurations: documentation-only (2 floors), full app build (5+ floors), research, risk management. Quick Start vs Advanced Start. | `Templates` `Quick Start` |

### 🚪 Lobby — Dashboard & Routing

| Room | Purpose | Agents/Tags |
|---|---|---|
| **Main Dashboard** | Project overview, KPIs, phase progress, pending approvals, test pass/fail, issues, PRs, branches. The "PA system" for the building. Not just a chat screen. | `User` `Orchestrator` |
| **Chat Interface** | Embedded chat with slash commands, @agent mentions, #room tags. Messages routed to rooms by the orchestrator. One component of the larger tool. | `User` `Commands` |
| **Security Desk** | Agent badging & access control management. Assign which agents can enter which rooms, what they can print/export. User-controlled permissions. | `Access` `User` |

### Scaling: From Buildings to Cities

A project might need two floors. Another might need two *buildings*. The second building could be a dedicated integration layer that transforms data between platforms. Buildings communicate through the Integration Floor. Spin up, spin down, add floors, remove rooms — the modularity is total. Same tycoon principle: the lobby always stays at ground level, but everything else is configurable.

---

## 3. Phase Zero: The Strategist

Before any building exists, before discovery, before the orchestrator. The strategist is the first agent a new user meets — a senior consultant who helps design the building itself.

**New User (Empty Canvas):** User has nothing. No projects, no building, no agents. The strategist asks consultative questions: *"What are you trying to get out of this? What does success look like? What are the inputs and outputs?"* Based on answers, the strategist suggests a building layout — which floors, which rooms, which agent types. The user can accept the template, modify it, or go fully custom.

**Power User (Full Portfolio):** User has many projects, each with their own building. The lobby dashboard shows all buildings at a glance: tests passed/failed, open items, phase status, active agents. Projects at different stages: one in discovery, one deploying, one in maintenance. Each building scales independently.

### The Startup Flow

Phase Zero isn't a room inside the building — it's the **architect** helping you *design* the building. Once the strategist finishes, they hand off to the orchestrator, who manages day-to-day operations. The strategist answers: "What kind of project is this? Who are my SMEs? What agent types do I need? What are the dependencies?" Then it suggests templates with well-timed branching logic.

```
New User → Strategist Agent
               |
      "What are you trying to build?"
      "What does success look like?"
      "What are the inputs and outputs?"
               |
          Template Suggestion
            /         \
       Accept        Customize
          |               |
  Building Generated   Drag & Drop Builder
          |               |
          ——— Handoff to Orchestrator ———
               |
      Project Begins (Phase 1: Discovery)
```

### Quick Start vs Advanced Start

| Mode | Description |
|---|---|
| **Quick Start** | Select project type from templates: Documentation, App Build, Research, Risk Analysis, Brainstorming. System auto-generates building layout with appropriate floors and default agent roster. |
| **Guided Start** | Strategist asks 6–10 questions about project scope, outputs, inputs, team size, and constraints. Suggests a customized building with reasoning for each floor. User confirms or adjusts. |
| **Advanced / Custom** | Full manual control. Drag-and-drop rooms into floors, create custom agent types, define your own room contracts. For super-users who want total control over the architecture. |

---

## 4. Exit Documents & Phase Gates

No room exit without a completed exit document. No phase transition without a go/no-go sign-off. Critical decisions are logged in a searchable RAID log so downstream phases always have context.

### Exit Documents

Every room has a prescriptive exit protocol. Before an agent can leave a table (or a room), they must complete a structured document capturing: decisions made, reasoning, background context, what it affects, and the final deliverable for that phase.

This isn't optional. You can't just say "it's done, sign off." The document is a template with required fields — the same way a project manager documents critical decisions at every phase gate. Content can change, but the hierarchy and organization stay consistent.

### RAID Log / Project Log

A searchable, persistent database of all phase checkpoints, critical decisions, and sign-offs. When an agent enters a new room, it can reference the RAID log to understand what has already been planned and decided.

This solves the midstream scope change problem: if you're in testing and want to add a feature, the system references the RAID log to see all prior discovery and architecture decisions before executing. You don't lose context across phases.

### Midstream Scope Changes

What happens if priorities change mid-project? You're in test phase but want to add a feature before deploy. The system checks the RAID log for all prior decisions, references the exit documents from discovery and architecture, and either routes the new feature through the existing execution pipeline with full context — or sends everyone back to the discovery room *with what has already happened*. No downstream dependency breaks because the exit docs carry the full decision trail.

### Exit Document Template (Universal)

```json
{
  "roomId": "discovery-room-abc123",
  "phase": "discovery",
  "completedBy": ["pm-agent", "sme-agent"],
  "decisions": [
    {
      "decision": "Use WebSocket for real-time comms",
      "reasoning": "Lower latency than polling; team has experience",
      "alternatives": ["SSE", "Long polling"],
      "affects": ["architecture", "deployment"],
      "madeBy": "architect-agent"
    }
  ],
  "deliverables": { /* room-specific output template */ },
  "openItems": ["Need to evaluate Redis vs Socket.IO native"],
  "signOff": {
    "status": "go",
    "approver": "orchestrator",
    "timestamp": "2026-03-10T20:30:00Z"
  }
}
```

### Phase Flow

```
Discovery Room → Exit Doc → Go/No-Go → RAID Log → Architecture Room → Exit Doc → Go/No-Go → RAID Log → Execution → ...
```

---

## 5. Fundamental Differences: v1 vs v2

### Conceptual

| v1: Flat Agent Pool | v2: Building / Room / Table |
|---|---|
| Agents live in a flat list — no spatial organization | Agents move between purpose-built rooms on designated floors |
| Orchestrator directly dispatches to any agent for any task | Rooms define what can happen, who can enter, what tools exist |
| Context is per-agent-session — no shared workspace | Context is room-scoped — shared workspace for collaborators |
| No concept of "where" work happens — just "who" does it | "Where" dictates "how" — same agent behaves differently per room |
| Behavioral rules baked into each agent's system prompt | Behavioral rules owned by the room framework, not individual agents |
| No phases, gates, or sign-off checkpoints | Phase gates with structured exit docs and go/no-go decisions |
| No Phase Zero — user just starts chatting | Phase Zero strategist helps design the building before work begins |
| No exit documents, no RAID log, no decision trail | RAID log captures every critical decision for downstream reference |

### Structural

| v1: Hub-Spoke Monolith | v2: Layered Domain Architecture |
|---|---|
| 48+ modules all registered into a single hub instance | Clear domain boundaries: Rooms, Agents, Tools, Transport, Storage |
| Modules loaded in strict sequential order (dependency-sensitive) | Each domain is self-contained with explicit interface |
| Circular dependency workarounds (lazy require) | No circular deps — dependency injection at boot |
| God object: hub.js is 800+ lines | Hub is thin: just event bus + service registry (~100 lines) |
| orchestration-core.js handles everything | Orchestration is one room type, not a god-module |
| Backward-compat wrappers add indirection | No backward-compat wrappers — clean break |
| Services registered by string name — no type safety | Typed interfaces with Universal I/O Contract |
| 67 files in modules/ — many with overlapping concerns | ~20 focused modules with single responsibilities |

### Technical

| v1 | v2 |
|---|---|
| Raw Socket.IO events (83 event types, string-matched) | Typed message protocol: ~20 message types with schemas |
| Message format: mixed OpenAI + Anthropic + custom hybrid | Message format: Anthropic-native only (no translation layer) |
| Tool parsing: native + text fallback (synthetic IDs) | Tool calls: native API only (no text fallback) |
| History sanitization as a post-hoc fix | History correctness by construction (append-only, validated) |
| MiniMax-specific hacks (emoji-to-ASCII, Unicode repair) | Provider-agnostic AI layer (adapter at boundary) |
| Config: .env + runtime + settings.json (3 sources of truth) | Config: single config service with validation + defaults |
| Agent sessions: in-memory only, lost on restart | Agent sessions: persistent, survive restarts |
| SQLite for conversations, JSON for everything else | Full database for everything (evaluating Redis, Docker stack) |

### Behavioral

| v1 | v2 |
|---|---|
| Agent can change tests to make them pass | Testing room: structurally prevents test modification |
| Orchestrator asks for permission on read-only tools | Room-scoped tool access eliminates tier misclassification |
| Agent delegation messages appear as USER | All messages tagged with origin (room, agent, table type) |
| API error 2013: orphaned tool_results break conversation | History validated on insert — impossible orphaned results |
| No discovery phase — AI just starts building | Discovery room is a required first phase |
| No go/no-go gates — work proceeds without checkpoints | Exit documents + RAID log at every phase transition |
| Tool denial leaves empty results → history corruption | Every tool execution path produces a result |
| No way to handle midstream scope changes | RAID log enables context-aware scope changes midstream |

### Data Model

| v1 | v2 |
|---|---|
| Messages: `{ role, content, tool_calls?, ts }` | Messages: `{ id, role, content, roomId, tableId, agentId, parentId, ts }` |
| Agent session: in-memory, no persistence | Agent session: persistent DB record with room history |
| Orchestration state: flat object with 30+ fields | Room state: `{ id, type, phase, agents[], tools[], rules, io_template }` |
| Tool history: last 50 entries in flat array | Tool execution: linked to room + table + agent context |
| No concept of "room" in data model | Room is a first-class entity with its own table |
| No concept of "table" or work mode | Tables = work modes (focus, collab, review, boardroom) |
| No phase tracking or gate records | Phase gates: `{ phase, roomId, signoffs[], status, evidence }` |
| Conversations = flat message array | RAID log: `{ decisions[], risks[], actions[], issues[] }` |

---

## 6. System Architecture Comparison

### v1: Hub-Spoke with 48+ Modules

```
                            [ server.js ]
                                  |
                     [ hub.js (800+ lines) ]
                   /    |    |    |    |    \
  config  ai-client  orchestration-core  tools-registry  agent-mgr  conv-store
                        |         |     \           |                 |
                 chat-stream  orch-state  tool-executor  shell-exec  agent-session
                        |         |           |      file-ops         |
                 msg-builder  approval   agent-sys  web-fetch    chat-room
                        |                     |      system-tools
                 tool-parser                  |      qa-tools
                                        tier-registry github-tools

  + 30 more modules: guardrail, markdown, token-mgr, context-tracker,
    mcp, mcp-mgr, database, notes, skills, summarization, test-server...

  Problem: Everything talks through hub. Circular deps via lazy require().
  Module boundaries unclear. Compat wrappers add indirection. ~67 files total.
```

### v2: Layered Domain Architecture (~20 focused modules)

```
  [ server.js ]         ← HTTP + WebSocket (thin, ~200 lines)
        |
  [ core/bus.js ]       ← Event bus only (~100 lines)
        |
  ======|================================  Domain Boundary
        |
  STRATEGY LAYER (Phase Zero)
  ├─ strategist.js        ← Onboarding, templates, building design
  ├─ template-gallery.js  ← Pre-built building configurations
        |
  TRANSPORT LAYER
  ├─ socket-handler.js    ← Socket.IO ↔ typed messages
  ├─ api-handler.js       ← REST endpoints
        |
  ROOM LAYER (the core innovation)
  ├─ room-manager.js      ← Create, destroy, list rooms
  ├─ room-types/           ← Lua-scriptable room definitions
  │   ├─ discovery.lua
  │   ├─ architecture.lua
  │   ├─ testing.lua
  │   ├─ execution.lua
  │   ├─ review.lua
  │   ├─ deploy.lua
  │   └─ custom/*.lua      ← User-defined room types
  ├─ table.js              ← Work modes: focus, collab, review, boardroom
  ├─ phase-gate.js         ← Go/no-go + exit document validation
  ├─ raid-log.js           ← Decision persistence + cross-phase reference
        |
  AGENT LAYER
  ├─ agent-registry.js     ← Agent definitions + capabilities
  ├─ agent-session.js      ← Agent lifecycle (persistent)
  ├─ agent-router.js       ← Routes agents to rooms (security badge check)
        |
  TOOL LAYER
  ├─ tool-registry.js      ← Tool defs + room-scoped access
  ├─ tool-executor.js      ← Execute with room context
  ├─ providers/             ← Shell, file, web, git, MCP adapters
        |
  AI LAYER (provider-agnostic)
  ├─ ai-provider.js        ← Adapter interface (Anthropic, MiniMax, open-source)
  ├─ ai-stream.js          ← Streaming + delta parsing
  ├─ prompt-builder.js     ← Room-aware prompt construction
        |
  STORAGE LAYER
  ├─ db.js                 ← Primary DB (evaluating Redis + Docker stack)
  ├─ models/               ← Room, Agent, Message, Task, PhaseGate, RAIDLog
        |
  INTEGRATION LAYER (single point of external I/O)
  ├─ plugin-manager.js     ← External plugin loading + validation
  ├─ data-bridge.js        ← Cross-building / cross-platform transforms

  ~20 focused modules. No circular deps. No compat wrappers.
  Each layer only depends on layers below it.
  Room types are Lua-scriptable — end users can add custom rooms.
```

---

## 7. Data Flow

### v1: Linear Pipeline

```
  User → Socket → handleUserMessage() → AI (sendMessageStreamed)
                                          |
                                     Parse response
                                          |
                                  tool_calls? ——— No ——→ Display response
                                     Yes |
                                         v
                              classifyApprovalTier()
                                    /        \
                            T1: auto     T2+: prompt
                                    \        /
                                         v
                              tool-executor.executeToolCall()
                                         |
                              Add result to conversation
                                         |
                              runAICycle()  ←—— loop (max 10)

  Problems:
  • Flat pipeline — no concept of "where"
  • Agent delegation is a tool call, not spatial
  • Tool approval is per-tool, not per-context
  • No phase awareness, no exit documents
```

### v2: Room-Routed Pipeline

```
  User → Socket → Lobby (Dashboard / Chat)
                                   |
                          Orchestrator analyzes intent
                                   |
                    "Build feature X" → checks current phase + RAID log
                                   |
                     Phase = Discovery?
                          /              \
                    Yes                No (past discovery)
                      |                         |
           Enter Discovery Room     Check RAID log for prior decisions
                      |                         |
          Room injects:              Enter Execution Room with context
          • rules (no code yet)       • rules (build only assigned)
          • I/O template              • I/O template
          • allowed tools             • allowed tools (write_file OK)
          • required outputs          • taskScope (files/dirs)
                      |                         |
             Agents work at tables     Agent works at focus desk
                      |                         |
               Output matches template?  Output matches template?
                 /         \                /         \
            Yes          No          Yes          No
              |           |               |           |
        Exit Doc       Retry       Exit Doc       Retry
              |                           |
        RAID Log → Next Phase   RAID Log → Review Room
```

### Midstream Scope Change: Adding a Feature During Test Phase

```
  User: "I want to add feature Y before we deploy"
                                   |
                          Orchestrator checks RAID log
                                   |
                   Found: Discovery decisions, Architecture plan,
                          Execution deliverables, Test results
                                   |
                   Is this a major scope change?
                          /              \
                    Minor               Major
                      |                       |
           Route to Execution Room  Route back to Discovery Room
           with RAID log context     with ALL prior exit docs loaded
                      |                       |
           Build feature Y with    Re-evaluate impact on architecture,
           existing architecture   dependencies, and test coverage
                      |                       |
           Test → Review → Deploy  New exit docs → New phase gates

  Key: Nothing is lost. The RAID log ensures all prior decisions
  are available to whoever handles the scope change.
```

---

## 8. Agent System Redesign

Agents become simpler. Rooms become smarter. Security badging controls where agents can go.

### v1 Agent Definition (490+ lines)

```javascript
// v1: Agent carries everything
{
  name: "testing-engineer",
  role: "QA Lead",
  description: "...",
  instructions: `
    You are a testing engineer.
    NEVER modify source code.
    NEVER change tests to make them pass.
    ALWAYS report failures accurately.
    Only use: qa_run_tests, qa_check_lint...
    Output format: ...
  `,  // 200+ line system prompt
  securityRole: "reviewer",
  tools: ["qa_run_tests", ...],
  blockedTools: ["write_file", ...],
}
```

### v2 Agent + Room + Badge

```javascript
// v2: Agent is identity + capabilities + badge
{
  name: "testing-engineer",
  role: "QA Lead",
  capabilities: ["testing", "qa", "analysis"],
  badge: {
    rooms: ["testing-lab", "review"],
    canExport: false,
    clearance: "standard"
  }
}

// Room defines behavior (separately)
{
  type: "testing-lab",
  allowedTools: ["qa_run_tests", "read_file"],
  blockedTools: ["write_file", "bash"],
  rules: "Report failures. Never modify tests.",
  exitTemplate: { /* structured */ },
}
```

### Agent System Comparison

| Aspect | v1 (Current) | v2 (New) |
|---|---|---|
| Agent count | 15+ with 200+ line prompts each | Same agents, 10-line definitions |
| Tool access | Per-agent allowlist/blocklist | Per-room — agent inherits from room |
| Behavior rules | Baked into each agent's prompt | Room-level constraints at runtime |
| Context | Per-session, in-memory, lost on restart | Room-scoped + persistent (survives restarts) |
| Access control | String-based security role | Security badge: rooms, clearance, export rights |
| Collaboration | chat-room.js (basic, max 5) | Tables (focus/collab/review) + Boardroom for larger groups |
| Dispatch | `delegate_to_agent` tool call | Orchestrator routes to room → room assigns table |
| Session lifecycle | Created on demand, garbage collected | Persistent with room history, resumable |
| Orchestrator | God module handling everything | PA system: routes agents, manages sign-offs, escalates to user |

---

## 9. Tool Access & Approval Redesign

Room-scoped tool access replaces the 4-tier approval system. The room IS the access control. Security badging adds agent-level granularity.

### v1: 4-Tier Approval

Every tool call goes through `classifyApprovalTier()` with a static registry. Tiers are global — `write_file` is always T2 regardless of context. Led to constant permission prompts on safe tools.

```javascript
// v1: Static tier, context-blind
classifyApprovalTier("write_file")
  → { tier: 2, confidence: 0.80 }
  → if (confidence < 0.70) askUser()

// Result: orchestrator prompted for file_tree
// because it defaulted to T2/0.50
```

### v2: Room-Scoped + Badge

Each room defines `allowedTools`. If the tool isn't there, it doesn't exist. Agent badge adds additional constraints: can this specific agent use tools that export data? Need a key to enter a locked room.

```javascript
// v2: Room defines available tools
testingRoom.allowedTools = [
  "read_file", "qa_run_tests",
  "qa_check_lint", "list_dir"
]

// Agent tries write_file?
// Tool doesn't exist in this room.
// No prompt. No denial. Just not there.

// Agent badge: can't print confidential?
// Even allowed tools filtered by clearance.
```

---

## 10. Room Types & Their Contracts

Each room type is a first-class object with rules, tools, templates, access controls, and a required exit document.

### Discovery Room — Phase 1: Requirements & Gap Analysis

**Purpose:** Define what we're building, why, and what "done" looks like.

- **Allowed agents:** Orchestrator, PM, SMEs, Architect
- **Allowed tools:** read_file, web_search, list_dir, file_tree, ask_user, record_note
- **Blocked tools:** write_file, bash, git_*, deploy (no building allowed)
- **Table modes:** Collaboration (brainstorm), Focus (individual research)
- **Rules:** No code changes. Produce requirements, not implementations.

**Required output template:**

```json
{
  "businessOutcomes": ["..."],
  "constraints": ["..."],
  "unknowns": ["..."],
  "gapAnalysis": { "current": "...", "target": "...", "gaps": [...] },
  "riskAssessment": [{ "risk": "...", "analysis": "...", "citation": "..." }]
}
```

**Exit document:** Decisions, reasoning, alternatives considered, what it affects, and sign-off status. Feeds into RAID log and is referenced by the Architecture Room.

### Architecture Room — Phase 2: Milestones & Task Breakdown

**Purpose:** Break discovery output into milestones, tasks, dependencies.

- **Allowed agents:** Architect, PM, Orchestrator
- **Allowed tools:** read_file, file_tree, web_search, record_note, add_todo
- **Blocked tools:** write_file, bash (no code yet)
- **Input:** Discovery room exit document + RAID log

**Required output:**

```json
{
  "milestones": [{ "name": "...", "criteria": [...], "dependencies": [...] }],
  "tasks": [{ "id": "...", "scope": { "files": [...] }, "assignee": "..." }],
  "dependencyGraph": { ... },
  "techDecisions": [{ "decision": "...", "reasoning": "..." }]
}
```

**Exit document:** Architecture plan is the deliverable. Each tech decision is logged with reasoning so execution agents know *why*, not just *what*.

### Testing Lab — Validation Phase: Cannot Modify Source

**Purpose:** Run tests, report results, log failures. Structurally cannot modify source code.

- **Allowed agents:** Testing Engineer, QA Lead
- **Allowed tools:** qa_run_tests, qa_check_lint, qa_check_types, read_file, list_dir
- **Blocked tools:** write_file, bash, git_* (enforced by framework, not prompt)
- **Table modes:** Focus Desk (individual test runs)

**Required output:**

```json
{
  "testsRun": 42,
  "testsPassed": 38,
  "testsFailed": 4,
  "failures": [{ "test": "...", "expected": "...", "actual": "...", "file": "..." }],
  "coverage": { "lines": 87, "branches": 72 },
  "readyForReview": false
}
```

### Code Lab — Execution Phase: Build & Implement

**Purpose:** Write code, scoped to assigned files only via taskScope.

- **Allowed agents:** Dev agents (frontend, backend, fullstack)
- **Allowed tools:** read_file, write_file, bash, file_tree, list_dir, web_search
- **Rules:** Can only modify files within assigned taskScope
- **Table modes:** Focus Desk (solo), Collab Table (pair), Boardroom (team)

**Required output:** `filesModified`, `testsPassed`, `readyForReview` — structured evidence, not just "done."

### Review Room — Governance: Go/No-Go Decision

**Purpose:** Independent review and sign-off. Risk questionnaire requires independent thought.

- **Allowed agents:** PM, Architect, Orchestrator
- **Rules:** Reviewers must cite specific code (file:line) in assessment. Can't just say "looks good."
- **Exit document:** Review findings, risk assessment, go/no-go decision with reasoning.

---

## 11. Universal I/O Contract

Every module is an API. Strict typed JSON schemas with required fields, defaults, and validation. This is what allows modules to plug into each other — they all have a socket that fits.

**v1:** 83 message shapes. Multiple sources of truth. No contract between modules. Adding a new module required understanding the entire hub.

**v2:** ~20 message types, each with a JSON schema. Every module input/output is validated. Default values for optional fields. Error shapes are standardized too. One source of truth.

```json
{
  "input": {
    "schema": "json",
    "required": ["roomId", "agentId", "content"],
    "defaults": {
      "tableMode": "focus",
      "priority": "normal",
      "maxCycles": 10
    }
  },
  "output": {
    "schema": "json",
    "required": ["status", "deliverable", "exitDoc"],
    "deliverable": "room-type-specific template"
  },
  "error": {
    "schema": "json",
    "required": ["code", "message", "context"],
    "context": { "roomId": "...", "agentId": "...", "phase": "..." }
  }
}
```

This standardization enables pluggability. If every room's input/output conforms to the contract, you can swap rooms, reorder phases, and add custom room types via Lua scripts without breaking anything downstream. The socket fits.

---

## 12. Extensibility: Lua Scripting, Plugins & Modules

Rooms, tables, and floors are Lua-scriptable modules. Plugins are external integrations that connect through the Integration Floor. The core stays thin; everything else is pluggable.

**Modules:** Internal building blocks: floors, rooms, tables. Each is a Lua-scriptable plugin that plugs into the core. A floor is a module. A room is a module that plugs into a floor. A table is a module that plugs into a room. Nested pluggability.

**Plugins:** External connections that go in and out of the building. API integrations, third-party services, data bridges. Only the Integration Floor can talk to the outside world — this keeps the building secure from twenty different exit points.

**Security Modules:** Auditing, access control, encryption, compliance checking. Can be built as Lua modules and plugged in like anything else. Security badging is a built-in module, but custom security policies are user-definable.

### Why Lua Scripts?

When adding new built-in features, they're not hardcoded into the app — they're added as Lua-scripted modules just like an end user would. This means the core never becomes a monolith again. First-party and third-party modules use the same API, the same I/O contracts, the same security model. Strict data typing in the backend ensures that custom pipelines can't break the system even if they do unexpected things.

### Provider-Agnostic AI

v2 supports multiple AI providers — not just MiniMax or Claude. The AI layer is an adapter interface. Swap providers by changing one file. Different models can handle different tasks: one provider for code generation, another for analysis, open-source models for cost-sensitive operations. Provider-specific behavior is contained, never leaked into the rest of the system.

---

## 13. UX Vision: The Tycoon-Game Metaphor

Not a chat screen. A building management tool where you can see floors, rooms, agents at tables, phase progress, and project KPIs at a glance. Think SimTower meets project management.

**Dashboard Lobby:** The first thing you see. All projects listed with their buildings. For each: phase status, tests passed/failed, open issues, PRs, branches, active agents. Not just "previous chats" — a full project management overview. Upgradeable but always the ground floor.

**Building View:** Click into a project and see the building: floors stacked, rooms visible with their tables. Agents have "seats" — visual slots that fill when an agent is working. If a table is full, you might need a boardroom. Like the tycoon game: place rooms, see occupancy, watch the work happen.

**Chat Component:** Embedded within the tool, not the whole interface. Supports slash commands (`/` for actions), `@agent` mentions to summon agents to rooms, `#room` tags for cross-room references. Discord-style tagging built into a building context.

**Phase Progress:** Visual phase tracker: discovery → architecture → execution → testing → review → deploy. Each phase shows its exit document status, RAID log entries, and go/no-go gate result.

**Agent Seats:** Tables have limited seats. When full, agents queue or need a larger room (boardroom). Visual indicator of capacity. If you need more agents than a table fits, the system suggests scaling up. Conference room for staff meetings.

---

## 14. v1 → v2 Module Equivalents

| v1 Module | v2 Equivalent | Action |
|---|---|---|
| hub.js (800+ lines) | core/bus.js (~100 lines) | Rewrite |
| orchestration-core.js | rooms/orchestrator.js (room type) | Rewrite |
| orchestration-module.js (wrapper) | *Eliminated* | Remove |
| conversation-module.js (wrapper) | *Eliminated* | Remove |
| agent-manager + agent-session | agents/registry.js + agents/session.js | Rewrite |
| tools-v5 + tool-executor | tools/registry.js + tools/executor.js | Rewrite |
| tier-registry + approval | *Eliminated* (room = access control) | Remove |
| ai-client + chat-stream | ai/provider.js + ai/stream.js | Rewrite |
| message-builder + tool-parser | ai/prompt-builder.js | Consolidate |
| guardrail + char-normalization | ai/provider.js (adapter only) | Consolidate |
| shell-executor, file-ops, web-fetch, etc. | tools/providers/* (reuse 85%+) | Keep |
| qa-tools, github-tools | tools/providers/* (reuse 85%+) | Keep |
| database, conversation-store | storage/db.js + storage/models/* | Rewrite |
| config-module + settings | core/config.js (single source) | Rewrite |
| mcp-module + mcp-manager | tools/providers/mcp.js | Consolidate |
| chat-room.js | rooms/table.js (focus/collab/review/boardroom) | Rewrite |
| *(none)* | rooms/room-manager.js + room-types/* | **New** |
| *(none)* | rooms/phase-gate.js + raid-log.js | **New** |
| *(none)* | strategy/strategist.js + templates.js | **New** |
| *(none)* | integration/plugin-manager.js + data-bridge.js | **New** |

---

## 15. Migration Strategy: Reuse Assessment

| Component | Reuse % |
|---|---|
| Tool implementations | 85% |
| UI components | 70% |
| AI client / streaming | 60% |
| Socket bridge | 40% |
| Agent system | 30% |
| Orchestration | 15% |
| Room system | New |
| Phase Zero / Strategy | New |
| RAID Log / Exit Docs | New |

### Keep (Reuse)

- Shell executor (bash, powershell)
- File operations (read, write, patch)
- Web fetch / search
- QA tools (tests, lint, types)
- GitHub tools
- MCP protocol layer
- UI Component base class
- Store (state.js)
- CSS design tokens

### Rewrite (Same concept, new implementation)

- Hub → thin event bus
- AI client → provider-agnostic adapter
- Message format → Anthropic-native
- Agent manager → room-aware registry
- Tool executor → room-scoped
- Approval flow → room access control
- Socket bridge → typed protocol
- Conversation store → room-threaded
- DB layer → evaluating Redis/Docker

### Build New

- Room Manager + Lua runtime
- Room Type definitions (6+ types)
- Table system (focus/collab/review/boardroom)
- Phase Gates + Exit Documents
- RAID Log system
- Phase Zero Strategist
- Security Badge system
- Integration Floor + Plugin Manager
- Building overview dashboard UI
- Cross-room references + tagging

---

## 16. Implementation Timeline

### Phase 0 — Stabilize
**Merge Current Fixes & Tag v1 Baseline**
Merge all bug fixes on `feat/context-system-rework` (API error 2013, tier registry, agent-sourced messages). Tag as `v1.0-baseline`. Clean break point.

### Phase 1 — Foundation
**Core + Storage + Config + Contracts**
Build the thin event bus. Database schema (rooms, agents, messages, phase_gates, raid_log) — evaluating Redis + Docker stack vs SQLite. Config service with validation. Universal I/O Contract definitions. No AI yet — just the skeleton.

### Phase 2 — Room System
**Room Manager + First Room Type + Lua Runtime**
Build RoomManager, Room base class, Lua scripting engine for room definitions. First room: **Testing Lab** (simplest, clearest rules). Validate that room constraints actually prevent tool access. Build phase-gate.js and exit document templates.

### Phase 3 — Agents + AI
**Agent Registry + AI Provider + Tool Executor + RAID Log**
Port AI streaming layer (provider-agnostic). Build agent registry with security badges and room access. Build room-scoped tool executor. Implement RAID log for decision persistence. First end-to-end test: user → agent enters room → uses tools → produces output → exit doc.

### Phase 4 — All Rooms + Integration
**Remaining Room Types + Phase Gates + Integration Floor**
Build Discovery, Architecture, Code Lab, Review, Deploy rooms. Implement full phase gates with sign-off templates. Build Integration Floor with plugin manager. Test the full flow: discovery → architecture → execution → review. Validate midstream scope change handling via RAID log.

### Phase 5 — UI Rebuild
**Tycoon-Style Dashboard + Building View**
Full UI redesign. Building overview dashboard with floor/room/table visualization. Agent seat indicators. Phase progress panel. Embedded chat with slash commands, @mentions, #room tags. Phase Zero quick-start flow. Leverage existing design tokens.

### Phase 6 — Phase Zero + Polish
**Strategist Agent + Templates + Advanced Features**
Build the Phase Zero strategist agent and template gallery (Quick Start, Guided, Advanced). Cross-room tagging. Boardroom mode. Multi-building support. Risk questionnaire engine. Building-wide search. Persistent agent sessions. Provider matrix for multi-model support.

---

## 17. Lessons Learned: What v1 Taught Us

### 🔴 Bug: API Error 2013 — Orphaned tool_results
**What happened:** Denied tool calls injected bare assistant messages into conversation history, breaking Anthropic's strict alternation requirement.
**v2 lesson:** Message history is append-only, validated at insert time. Never inject messages as a side effect of tool denial. The storage layer validates alternation constraints on every insert.

### 🔴 Bug: Orchestrator Permission Prompts on Read-Only Tools
**What happened:** `file_tree` and 25+ tools were missing from `TOOL_TIER_REGISTRY`, defaulting to T2/0.50 confidence.
**v2 lesson:** Eliminate tiers entirely. Room-scoped tool access: "is this tool in this room?" No tiers, no confidence scores, no permission prompts.

### 🟡 Pattern: Circular Dependencies Everywhere
**What happened:** `orchestration-core` → `tool-executor` → `agent-session` → `orchestration-core`. Solved with lazy `require()`.
**v2 lesson:** Layered architecture with strict dependency direction. Transport → Rooms → Agents → Tools → AI → Storage. No circular deps by construction.

### 🟡 Pattern: MiniMax-Specific Hacks Throughout
**What happened:** Emoji-to-ASCII mapping, Unicode repair, synthetic tool IDs, guardrail module — scattered across 6+ files.
**v2 lesson:** Provider-agnostic AI layer. All provider-specific behavior in a single adapter file. Switching providers = swapping one adapter.

### 🟡 Pattern: Agent Prompts Are Fragile
**What happened:** Testing agents changed tests to pass. Code agents modified files outside scope.
**v2 lesson:** **Don't change the agent, change the framework.** Room constraints are structural. Testing room doesn't have `write_file` — the agent *cannot* modify code.

### 🟢 Insight: "It Says It's Done But Nothing Works"
**What happened:** AI builds a UI that looks complete but is an empty shell. Tests pass because there are no tests for the missing functionality.
**v2 lesson:** Room output templates require structured evidence. Exit documents require structured deliverables — not just "done."

### 🟢 Insight: Context Management Is the Real Constraint
**What happened:** Everyone wants the AI to "know all the things all the time." But the technology can't deliver that.
**v2 lesson:** Room-scoped context. Exit documents and RAID log provide structured summaries — not raw dumps. One agent, one task, focused context.

### 🟢 Insight: Multiple Sources of Truth = Chaos
**What happened:** Config in 3 places. Mixed message formats. 83 socket event shapes. No single schema.
**v2 lesson:** Universal I/O Contract. One config service. One message format. ~20 typed schemas. One database. Strict typing at every boundary.

---

*Overlord v2 Architecture Report — Codebase analysis of 48+ modules, 26.7K lines + collaborative design sessions*
*Branch: feat/context-system-rework • Updated: 2026-03-10*
