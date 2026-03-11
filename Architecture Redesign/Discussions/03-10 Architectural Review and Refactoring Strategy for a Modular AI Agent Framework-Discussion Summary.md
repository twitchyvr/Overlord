# 03-10 Meeting: AI System Architecture Refactoring and Workflow

## 1. Structured AI System Architecture and Refactoring
### Conclusion
The team has decided to rebuild the current codebase, moving away from its monolithic, unwieldy "hub and spoke" architecture which suffers from circular dependencies and an excessive number of modules (~67). The new system will be based on a layered, domain-driven "Rooms and Floors" model, conceptualized as a customizable building. This highly modular architecture will use a scripting capability (like Lua) to allow end-users to define and customize components such as "rooms," "floors," and "tables," each with their own rules, tools, templates, and access controls. The core application will remain a lightweight framework. Security will be a built-in feature, with the potential for dedicated security and auditing modules on specific "floors." This new structure is seen as cleaner, more versatile, and better aligned with the project's goals for scalability and modularity, reducing the module count to approximately 20.
### Discussion Points
- **Current System Flaws:** The existing "hub and spoke" architecture is overly complex, difficult to manage, and suffers from circular dependencies. Information flow is constrained, requiring data to pass through multiple unnecessary layers.
- **Proposed "Rooms and Floors" Model:** The AI-proposed architecture introduces a more sophisticated and scalable structure with concepts like an Architecture Room, Execution Floor, and Governance Floor. This layered, domain-driven design is cleaner, more flexible, and allows for modules to be added or removed without breaking the system.
- **Modular, Scriptable Framework:** The system will be highly modular, allowing users to create their own rooms and pipelines via a scripting capability (e.g., Lua). Components are a nested hierarchy of plugins (floors, rooms, tables), preventing the creation of a monolith. This also enhances security by isolating functions, such as centralizing external communication to a single "integrations floor."
- **Agent Collaboration and Context:** Within this model, the best practice for agents is "one agent, one task," with tasks being simple "to-dos." A mechanism is needed for agents to share deliverables and manage collaboration across rooms. Effective context management is critical, as LLMs have context limitations.
## 2. Agent Workflow and Project Phase Management
### Conclusion
The team concluded that a rigid, linear project workflow (e.g., Discovery -&gt; Execution -&gt; Testing) is inadequate as it doesn't handle iterative development cycles, such as adding a new feature during the testing phase. A more flexible system is required that allows for returning to earlier phases while retaining existing project context. To support this, a robust logging and sign-off process will be implemented. This will involve a "Phase Zero" for initial project scoping, go/no-go decision points between phases, and a universal I/O contract to ensure all components communicate effectively. A critical missing element is the logic to handle mid-project changes to scope or priorities, which must be designed to ensure all downstream dependencies are updated.
### Discussion Points
- **Iterative Cycles vs. Linear Flow:** A sequential workflow is flawed because it cannot accommodate changes or new features introduced late in the project lifecycle. The system must allow a project to revert to an earlier phase (e.g., from "Testing" back to "Discovery") while retaining all relevant context.
- **Formal Sign-Off and Logging:** A formal sign-off process with standardized "exit documents" (like a change log or form) is necessary for agents when completing a phase. This documentation will be stored in a backend database (RAID log) to track project decisions, plans, finished items, and the current project phase.
- **Multi-Phase Structure:** The project will be structured in distinct phases, starting with a "Phase Zero" to define scope and identify necessary Subject Matter Experts (SMEs). Each phase will have a standardized input/output template, creating a clear go/no-go decision point before proceeding to the next.
- **Handling Mid-Project Changes:** The system must be designed to manage what happens when project scope or priorities change midstream. This logic needs to ensure all downstream dependencies are updated and previously decided inputs are re-evaluated for the relevant agents.
## 3. System Roles, Standardization, and User Experience
### Conclusion
The system will feature distinct roles, including a "Strategist" AI for user onboarding, an "Orchestrator" AI to act as a project manager, and specialized agents for tasks. To ensure scalability and interoperability, the entire system will be built around a universal I/O (Input/Output) contract, where every module functions as an API with a strict JSON schema. The user experience will cater to both new users, who will be guided through a consultative "kickoff" process to define their project structure, and experienced users, who will have a main "lobby" dashboard to manage multiple projects and view key metrics. The system must also be provider-agnostic, allowing for the integration of various AI models.
### Discussion Points
- **System Roles:**
  - **Orchestrator:** An intelligent "boss" or "PA system" that handles sign-offs, routes tasks, and summons agents to the correct "rooms."
  - **Strategist:** An AI that guides new users through a consultative process to define project goals and suggest an initial structure.
  - **Agents:** Granted access and capabilities based on the room they are in, using a "security badging" concept.
- **Universal I/O Contract:** To standardize the system, every module will be an API with a strict, typed contract for inputs, outputs, and errors defined by a JSON schema. This ensures all components can connect seamlessly.
- **User Experience (UX):**
  - **Onboarding:** New users will be guided by the "Strategist" AI with "quick start" and "advanced start" options to build their initial project structure.
  - **Experienced Users:** A main "lobby" will serve as a dashboard, summarizing KPIs (e.g., test status, open issues) across all projects.
- **UI and Interaction:** The UI will be completely redone, potentially using a panel-based design to visually represent the building/room/table metaphor. It will incorporate features like Discord-style slash (`/`) commands and at-mentions (`@`) for interacting with agents and rooms.
## 4. Phased Rebuilding and Development Plan
### Conclusion
The project will be rebuilt from the ground up in a phased approach. The process will begin by stabilizing and tagging the current version as a baseline. The rebuild will then proceed through building a skeleton application with an event bus, creating the room manager and basic room types, porting the AI layer, implementing agent functionalities, and finally, a "polish" phase to add advanced UI features.
### Plan
- [ ] Merge current bug fixes and tag the existing version as the baseline before starting the new build. -- *Matt Rogers*
- [ ] **Phase 1:** Build a thin event bus and a skeleton application, considering a robust database like Redis. -- *Matt Rogers*
- [ ] **Phase 2:** Build the room manager and the first room type. -- *Matt Rogers*
- [ ] **Phase 3:** Port the AI streaming layer. -- *Matt Rogers*
- [ ] **Phase 4:** Build the agent registry and implement room-scoped execution. -- *Matt Rogers*
- [ ] **Phase 5-6 (Polish):** Implement features like Discord-style cross-room tagging (`#`) and slash commands (`/`) for interacting with agents and rooms. -- *Matt Rogers*
- [ ] Implement a full UI redo with a panel-based design. -- *[Insert Executor Name]*
- [ ] Ensure the new system is provider-agnostic (supporting Claude, MiniMax, etc.). -- *[Insert Executor Name]*
- [ ] Design the onboarding flow featuring a "strategist" AI. -- *[Insert Executors]* *[Insert Key Date]*
- [ ] Design the main "lobby" dashboard for experienced users. -- *[Insert Executors]* *[Insert Key Date]*
- [ ] Explore using Lua for the scripting capability. -- *[Insert Executors]* *[Insert Key Date]*
- [ ] Implement a database (RAID log) for project tracking. -- *[Matt Rogers]*
- [ ] Design a prescriptive sign-off protocol and "exit document" template for agents. -- *[Speaker 2]*
> **AI Suggestions: Unresolved Issues and Action Items**
> 
> 1. **Mechanism for Mid-Project Scope Changes:** The critical need to handle mid-project scope changes was identified, but the implementation logic was not defined. A plan is needed to design how the system will propagate changes, update dependencies, and re-evaluate completed steps.
> 2. **Agent Collaboration & Deliverable Sharing:** The specific mechanism for how agents will collaborate and share deliverables within and across the "Rooms and Floors" model remains undefined.
> 3. **RAID Log and Sign-Off Process Implementation:** While the need for a RAID log and a formal sign-off process was agreed upon, the specific database structure, exit template content, and protocol details were not finalized and need to be designed.
> 4. **Defining the Orchestrator's Role:** The Orchestrator's exact responsibilities, level of autonomy, and interaction logic with human users and other AI components (like the "Strategist") need to be clearly specified.
> 5. **Plugin/Customization Framework:** The team acknowledged the need for a "plugin" system for custom functionality beyond the standard I/O contract, but an architecture for this extensibility was not planned.
> 6. **Database Technology Choice:** A decision is needed on the database technology (e.g., Redis vs. SQLite) to finalize the architecture for the rebuild.
> 7. **Terminology Clarification:** Consistent definitions for terms like "plugin" and "module" are needed to avoid confusion in design and documentation.
> 8. **UI/UX Feature Design:** The specific syntax and functionality for slash commands and the tagging system (`@`/`#`) need to be finalized before the "polish" phase.