# Architectural Review and Refactoring Strategy for a Modular AI Agent Framework



## V1 Architecture Deficiencies and V2 Proposal
The discussion begins with Matt Rogers describing a thorough codebase analysis and an AI-generated report he requested as an interactive HTML page with a navigation menu. The current V1 “hub-and-spoke” system is centered on a massive, unwieldy hub file that orchestrates everything. Even after prior refactoring, the hub manages so many responsibilities that downstream components only receive the data they need if the orchestration core, chat stream, message builder, and tool parser are wired precisely. This architecture has led to circular dependencies that can crash the system (e.g., GitHub tools referencing web fetch), and the lack of a framework to break and safely rejoin dependency cycles is a persistent pain point.

The V1 codebase comprises 30+ modules, potentially “something like 67” at peak, all coupled around the central hub—visually likened to a “COVID virus” hub-and-spoke. In contrast, the V2 proposal embraces a “layered domain” architecture: modular, cleaner, with the ability to add or remove layers. Matt notes the proposed V2 is roughly 20 modules, a reduction from V1’s sprawl. Speaker 2 emphasizes that the new approach is the right fit for the versatility sought, and that it scales the team’s earlier ideas in a beneficial way.

A key conceptual shift accompanies the refactor: moving from an “agent-centric” pattern (where each agent’s system prompt carries rules, instructions, and behavioral constraints) toward “framework-centric” constraints that are enforced via the environment (e.g., rooms, floors). This promises code cleanliness, clearer data flow, and a different, more manageable dependency tree.

## Conceptualizing the "Skyscraper" Architectural Metaphor
The AI report outlines a “skyscraper” metaphor for the V2 application: multiple floors (e.g., Collaboration Floor; Governance Floor; Execution Floor) and domain-specific rooms (e.g., Architecture Room, Code Lab, Integration Room, Testing Lab, Review Room, Audit Room, Release Lounge) with tables. Each room type is a first-class object with rules, tools, templates, and access controls. The model resembles a 2D tycoon-style builder game where floors and rooms can be slotted between or stacked, enabling flexibility. The “lobby” serves as a grounding point and cannot be repurposed, though it can be upgraded. Security badging is conceptualized as room access; badges can be assigned by a user or, if needed, by the orchestrator.

Examples are concrete and role-bound. A Discovery Room’s allowed agents include the orchestrator, SMEs, PM, and architect; allowed tools include “read web” and “list file.” Room rules tightly scope activities: a Testing Lab cannot modify source code and can only run tests; “no write file” means the tables present in that room disallow writing. Agents’ capabilities are constrained by room contracts, including the ability to restrict outputs (e.g., “can’t print anything out” or “only print non-confidential” content). This room-scoped permissions model directly defines what operations are possible and by whom.

The metaphor extends to plugins: each floor can be a plugin; rooms plug into floors; tables can be plugins. Matt prefers true pluggability so built-in features themselves could be added as Lua-scripted modules, just like end-user extensions, to avoid growing into a “massive monolith.” Speaker 2 suggests concentrating plugin, data, and integration concerns on specific floors to centralize and secure external communications.

## Standardizing System Communication and Workflow
To enable modularity, the team emphasizes replacing the current flat, point-to-point pipeline with room-routed message flow. The orchestrator receives AI outputs, parses for tool calls, and routes messages to the appropriate room, where the room assigns a table and enforces rules. The architecture pivots on a universal I/O contract—a strongly typed contract akin to a strictly typed code interface—that standardizes inputs, outputs, and errors via JSON schemas. Inputs define required fields and defaults. Every module is treated as an API, and room outputs use defined output templates and schemas.

This standardization aims to collapse the current proliferation of message variants: Matt cites “eighty three different shapes” today, driven in part by “anthropic native only conversational messages,” plus “different sources of the truth.” With a typed, schema-driven contract, inter-module connections should operate like a socket that reliably fits. Communication occurs through socket messages, and the orchestrator’s duties include validating whether an action is a tool call and whether it should be attached to a project context.

The layered domain structure improves dependency management and limits circular references; it also makes code cleaner and more maintainable. Security and governance are embedded at the room level with tiered, room-scoped tool access and approvals. If an action triggers a security threshold, the system can warn users of an insecure operation. The team favors a provider-agnostic hub so different AI models (e.g., MiniMax, Claude, open-source) can be used for tasks where they excel.

A potential rigidity is noted in phase logic. For example, a rule like “Phase equals discovery? Yes: add to discovery; No: enter execution room rules” could fail when a mid-test-phase change requires new feature work. Speaker 2 recommends proactively designing a solution for midstream scope changes.

## User Experience and Extensibility Framework
User experience is envisioned around a “Phase Zero” kickoff. Speaker 2 proposes a “Strategist” or “senior consultant” agent that asks consultative, templated questions to identify project type, success criteria, SMEs, agent types needed, and dependencies. This yields a structured input/output artifact that feeds the first formal phase. For returning users, the lobby could be a dashboard showing project health (e.g., passed/failed tests, open items). For new users, a startup prompt could launch a project kickoff, offering “quick start” or “advanced start.” A “quick start toolbar” could allow users to click-to-define agent tasks or drag-and-drop rooms and floors; super users could override recommendations and custom design their “building.”

Extensibility is a core principle. Matt wants a mechanism for custom needs without rebuilding the app—Lua scripting is central to this: rooms, tables, and even internal features could be implemented as Lua modules using strictly typed back-end definitions. Users should be able to “spin things up” and “spin things down,” building three-level or twenty-level configurations as needed; even multiple buildings can interoperate via an integration layer. Security modules and auditing are included, and strict type settings protect data boundaries, especially if a dedicated “plugin floor” centralizes external I/O.

The UI may be reimagined to reflect the metaphor: panel-based views for floors/rooms, visual cues like chairs at tables or slots for agents, different room types with different capacity constraints (e.g., a conference hall for large staff meetings). The system remains provider-agnostic, enabling different AI models per task.

## The Phased Rebuild and Implementation Plan
The AI-generated plan proposes a staged rebuild that starts with stabilizing the current system and then constructing a non-AI skeleton before layering AI components.

- Stabilize V1 and baseline: Merge all bug fixes, tag the stabilized codebase as a baseline, and begin a fresh application for V2 development rather than continuing to build on the current app.
- Non-AI skeleton: Build a thin event bus; establish a database schema (the plan suggests SQLite; Matt prefers a full database for scalability but wants to preserve schema fidelity if swapping engines). Add a config service with validation. Construct the room manager and implement the first room type.
- AI layers and execution: Port the AI streaming layer; then build the agent registry and room-scoped execution. Next, implement the “discovery” component.
- Polish: Add Discord-style cross-room tagging (e.g., tagging people, agents, rooms, topics), and slash-style commands for efficient interactions.

This approach preserves provider agnosticism, supports swapping AI providers per use case, and encourages a stack that can be peeled back or rebuilt layer-by-layer without hardcoding cross-layer dependencies. Lua-scriptable modules are envisioned both inside and outside the app, facilitating external plugin ecosystems.

## Identified Gaps and Future Considerations
The team identifies critical areas needing definition beyond the AI report:

- Collaboration mechanics at higher levels: How teams share deliverables and pass work between rooms, not just low-level mechanics.
- Midstream scope changes: Robust handling when priorities or requirements change after earlier phases (e.g., adding a feature during testing). This implies logic to update downstream dependencies, reconsider prior inputs, and safely re-route work.
- Formal sign-offs and exit documents: Each room should have a prescriptive “exit document” describing recommended decisions, final decisions, rationale, impacts, and what they affect. Exiting a room requires completing a template that becomes part of a project log and supports go/no-go decisions at each phase.
- RAID/project log: A database-backed, searchable RAID-like log to track phases, planned and finished items, critical decisions, and their provenance. This ensures the bot can reference past decisions reliably.
- Phase Zero inputs/outputs: A templated kickoff phase that gathers project type, SMEs, agent types, and dependencies. Templates should define inputs and outputs so subsequent phases can read prior artifacts, even as content iterates. The structure and hierarchy remain consistent while allowing flexible content changes.

Collectively, these considerations aim to maintain context integrity as projects move across rooms and phases, ensure accountability and traceability, and preserve agility when projects evolve.

## Action Items

- @Matt Rogers
  - [ ] Ask the AI what it thinks are the top three changes that will make the largest difference in the architecture - [TBD]
  - [ ] Merge all bug fixes to stabilize the current codebase - [TBD]
  - [ ] Tag the stabilized codebase as a baseline and start building the new app from that baseline - [TBD]
  - [ ] Build the thin event bus - [TBD]
  - [ ] Build the database schema (initially SQLite per plan; evaluate and plan for a full, scalable database while preserving schema) - [TBD]
  - [ ] Implement a config service with validation as part of the non-AI skeleton - [TBD]
  - [ ] Build the room manager and implement the first room type - [TBD]
  - [ ] Port the AI streaming layer - [TBD]
  - [ ] Build the agent registry - [TBD]
  - [ ] Implement room-scoped execution - [TBD]
  - [ ] Build the discovery component - [TBD]
  - [ ] Implement polish features, including Discord-style cross-room tagging and command functionalities - [TBD]

- @Speaker 2
  - [ ] Propose a concrete mechanism (requirements and acceptance criteria) for handling mid-project scope changes within the phase/room model for AI review (“Overlord”) - [TBD]