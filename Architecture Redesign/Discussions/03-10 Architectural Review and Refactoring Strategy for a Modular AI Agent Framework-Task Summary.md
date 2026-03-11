# 03-10 Workshop: Agent-Centric Modular Architecture—Governance, Routing, and Extensibility

## Conversation Summary:
The discussion centers on designing and refining an agent-centric, modular architecture using a “building” metaphor (floors, rooms, tables, agents, orchestrator). Participants evaluate message routing, tool access, strict data schemas, phase-aware workflows (discovery, validation/testing, governance), and extensibility (plugins/modules, agent types). They emphasize one agent per task, context constraints, reducing circular dependencies, standardized exit documents per phase, a project/RAID log for decisions and sign-offs, governance gates, and handling midstream scope changes (e.g., adding features during testing). The team also explores user onboarding (strategist-led quick vs. advanced start), security badging, dashboards (“lobby”), and provider-agnostic AI support. Overall, the architecture is promising but needs clearer collaboration artifacts, room-role mappings, module consolidation, and documented routing pipelines.
## Action Items / Tasks:
- [ ] Add collaboration elements defining how agents share deliverables and hand off work — [ISSUE]
- [ ] Design standardized exit document templates for each room (discovery, execution, testing, governance) capturing decisions, rationale, outcomes — [ISSUE]
- [ ] Implement a project log/RAID log (searchable, referenceable) for phase checkpoints, critical decisions, and sign-offs — [ISSUE]
- [ ] Define phase-aware logic for adding features mid-project (e.g., during testing), with rules to reference prior decisions and route back to discovery when needed — [ISSUE]
- [ ] Clarify extensibility model for “agent types” to add categories and rules without refactoring core orchestration — [ISSUE]
- [ ] Map room functions vs. agent roles more cleanly (distinguish tables/desks like “focus desk” vs. actual agent types) — [ISSUE]
- [ ] Refactor to reduce circular dependencies (e.g., GitHub tools referencing web fetch), possibly via intermediary modules — [ISSUE]
- [ ] Validate and document the message routing pipeline (flat pipeline, room-directed routing, tool call parsing) with examples — [ISSUE]
- [ ] Review and refine governance floor: define sign-off criteria, go/no-go gates, audit requirements for phase transitions — [ISSUE]
- [ ] Evaluate and adjust module count and layering to keep codebase manageable (target ~20 modules vs. 50–67) — [ISSUE]
- [ ] Ask the system to identify top three architecture changes with largest impact — [FOLLOW-UP]
- [ ] Design initial user onboarding flow with “strategist” consultation (quick start vs. advanced start) — [SCHEDULING]
- [ ] Define structured data schema (strict typing) for rooms, floors, tables, agents, tools, and access controls — [ISSUE]
- [ ] Implement Lua scripting for rooms/tables to allow custom pipelines and tool access logic — [ISSUE]
- [ ] Create security badging and room-level access policies (agent-specific permissions, print/export restrictions) — [ISSUE]
- [ ] Build a “lobby” dashboard for multi-project management (tests passed/failed, issues, PRs, branches, open items) — [ISSUE]
- [ ] Separate plugin vs. module architecture; define an “integration floor” for external I/O — [ISSUE]
- [ ] Design phased workflow support (design, validation, execution gates), including room contracts and allowed tools — [ISSUE]
- [ ] Establish orchestrator behaviors (routing to rooms, table assignment, sign-offs, escalation rules) — [ISSUE]
- [ ] Develop templates for common project types (documentation-only, app build, research, risk management) — [ISSUE]
- [ ] Implement quick-start toolbar to select agent capabilities and auto-suggest building layout — [ISSUE]
- [ ] Define table modes and how tables change behavior within rooms — [ISSUE]
- [ ] Define “Phase Zero” template: identify SMEs, project type, dependencies, agent types, and standardized inputs/outputs — [ISSUE]
- [ ] Establish go/no-go exit criteria for each phase and teach subsequent phases to read prior outputs — [FOLLOW-UP]
- [ ] Finalize universal I/O contract (strict typed JSON schemas with required fields, defaults) for in/out/error across modules — [ISSUE]
- [ ] Stabilize current codebase: merge bug fixes and tag baseline before rebuild — [ISSUE] [COMPLETED] (status disputed: “It says done, but nothing works”)
- [ ] Decide on event bus and database stack (prefer Redis and a full DB over SQLite; consider Docker) — [ISSUE]
- [ ] Implement config service with validation (no AI yet; skeleton) — [ISSUE]
- [ ] Build Room Manager and first room type (scoped execution, discovery) — [ISSUE]
- [ ] Create agent registry and AI streaming layer; support slash commands, tags, and cross-room mentions — [ISSUE]
- [ ] Redesign UI with room/table/boardroom metaphor, seats/slots for agents, cross-room tagging, commands — [ISSUE]
- [ ] Ensure provider-agnostic support (Anthropic/Claude, MinimMax, open-source models) — [ISSUE]
- [ ] Document and handle midstream scope/priority changes; update downstream dependencies and inputs automatically — [ISSUE]
- [ ] Compile “lessons learned” into actionable fixes for fragile prompts and multi-source-of-truth problems — [ISSUE]
- [ ] Get a cost/feature comparison estimate for upgrading Claude plan — [QUOTE] [FOLLOW-UP]
## Follow-Ups Required:
- Follow up with the “Overlord” agent/system to propose and implement solutions for phase transitions when adding features after discovery (e.g., during testing), ensuring prior decisions are referenced by 2026-03-12 — [FOLLOW-UP]
- Follow up to define Phase Zero template and exit criteria for all phases by 2026-03-12 — [FOLLOW-UP]
- Follow up on selecting event bus and database technologies (Redis vs alternatives; DB choice) by 2026-03-12 — [FOLLOW-UP]
- Follow up with the team on top three impactful architecture changes by 2026-03-12 — [FOLLOW-UP]
- Follow up to draft plugin/extensibility spec by 2026-03-13 — [FOLLOW-UP]
- Follow up to document midstream scope-change handling logic by 2026-03-13 — [FOLLOW-UP]
- Follow up to review collaboration/sharing deliverables model and room-role mappings by 2026-03-13 — [FOLLOW-UP]
- Follow up to finalize the design of exit templates and governance sign-off workflow by 2026-03-14 — [FOLLOW-UP]
- Follow up on plugin vs. module definitions and finalize the “integration floor” concept by 2026-03-14 — [FOLLOW-UP]
- Follow up to clarify table modes and their implications for room behavior by 2026-03-14 — [FOLLOW-UP]
- Follow up on UI redesign requirements (rooms/tables/boardrooms, tagging/commands) by 2026-03-14 — [FOLLOW-UP]
- Follow up on provider-agnostic integration plan (model/provider matrix) by 2026-03-14 — [FOLLOW-UP]
- Get a cost/feature comparison estimate for upgrading Claude plan by 2026-03-15 — [QUOTE] [FOLLOW-UP]
## Key Details Extracted:
- Names:
  - Matt Rogers
  - Tommy
  - Speaker 2 (unnamed; collaborator)
- Phone Numbers:
  - None mentioned
- Unit Numbers:
  - None mentioned
- Addresses:
  - None mentioned
- Pets Mentioned:
  - Bandit
  - Kiwi
## Flagged Keywords & Tags:
- [ISSUE]: “One of the things that it isn’t talking about yet is the collaboration element”
- [ISSUE]: “Circular dependencies… becomes a crash… need to break it out”
- [ISSUE]: “Testing lab cannot modify source code; can only run tests”
- [FOLLOW-UP]: “I would ask Overlord to like consider and create a solution for… add a new feature while in test phase”
- [COMPLETED]: “It did a good job of scaling it more”
- [ISSUE]: “Mixed labels (e.g., ‘principal’ vs. ‘no write file’)—functions vs. agent types need clarity”
- [ISSUE]: “what are plugins?… Plugins should be things that you can use with modules… ambiguity on plugin vs. module roles.”
- [ISSUE]: “Table modes is an interesting thing… not something we need to talk about [now].”
- [FOLLOW-UP]: “Ask it what it thinks is the top three things that will make the largest difference in your architecture…”
- [ISSUE]: “It says done, but nothing works. Agent prompts are fragile. Different sources of the truth is also problems.”
- [QUOTE]: “I’m gonna probably end up paying for the bumped up version of Claude.”
- [ISSUE]: “What happens if midstream you have to change scope… build that logic in there somewhere.”
- [ISSUE]: “Eighty three different shapes… message types… different sources of the truth.”
- [ISSUE]: “Provider agnostic… want it open to any of them.”
Content creation date: 2026-03-10 18:54:32.