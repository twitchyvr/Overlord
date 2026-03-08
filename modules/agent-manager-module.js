// ==================== AGENT MANAGER MODULE ====================
// Comprehensive agent management system
// Features:
// - CRUD operations for agents
// - Tool permissions per agent (allowlist/denylist)
// - Agent groups for collaboration
// - Programming language specialization
// - Security role hierarchy
// - Agent collaboration sessions

const fs = require('fs');
const path = require('path');

let HUB = null;
let CONFIG = null;
let db = null;

// Default tool categories
const TOOL_CATEGORIES = {
    shell: ['bash', 'powershell', 'cmd'],
    files: ['read_file', 'read_file_lines', 'write_file', 'patch_file', 'append_file', 'list_dir'],
    ai: ['web_search', 'understand_image', 'fetch_webpage', 'save_webpage_to_vault'],
    system: ['system_info', 'get_working_dir', 'set_working_dir', 'set_thinking_level'],
    agents: ['list_agents', 'get_agent_info', 'assign_task'],
    qa: ['qa_run_tests', 'qa_check_lint', 'qa_check_types', 'qa_check_coverage', 'qa_audit_deps'],
    github: ['github'],
    notes: ['record_note', 'recall_notes'],
    skills: ['list_skills', 'get_skill', 'activate_skill', 'deactivate_skill']
};

// Programming languages
const PROGRAMMING_LANGUAGES = [
    'JavaScript', 'TypeScript', 'Python', 'Java', 'C#', 'C++', 'Go', 'Rust',
    'Ruby', 'PHP', 'Swift', 'Kotlin', 'Scala', 'R', 'SQL', 'Bash', 'PowerShell',
    'HTML', 'CSS', 'SCSS', 'JSON', 'YAML', 'XML', 'Markdown', 'Dockerfile'
];

// Security roles — scoped to actual agent capability needs.
// allowedCategories maps to TOOL_TIER_REGISTRY.category values.
// blockedTools is an explicit deny-list that overrides categories.
// canOverride: if true, a per-agent toggle can relax role restrictions.
const SECURITY_ROLES = {
    'full-access': {
        name: 'full-access',
        label: 'Full Access',
        description: 'Unrestricted system agent. For orchestrators and system-level coordinators that need every tool.',
        allowedCategories: ['*'],   // wildcard — all categories permitted
        blockedTools: [],
        canOverride: false
    },
    'implementer': {
        name: 'implementer',
        label: 'Implementer',
        description: 'Can read, write files, and execute commands. Cannot orchestrate other agents directly.',
        allowedCategories: ['read', 'write', 'execute', 'diagnostic', 'memory', 'ai', 'notes'],
        blockedTools: ['delegate_to_agent', 'delegate_to_team', 'close_milestone'],
        canOverride: true
    },
    'contributor': {
        name: 'contributor',
        label: 'Contributor',
        description: 'Can read and write files but cannot execute shell commands or orchestrate agents.',
        allowedCategories: ['read', 'write', 'diagnostic', 'memory', 'ai', 'notes'],
        blockedTools: ['bash', 'powershell', 'cmd', 'delegate_to_agent', 'delegate_to_team', 'close_milestone'],
        canOverride: true
    },
    'reviewer': {
        name: 'reviewer',
        label: 'Reviewer',
        description: 'Read and analyze only. Cannot write files or execute commands.',
        allowedCategories: ['read', 'diagnostic', 'memory', 'ai', 'notes'],
        blockedTools: ['write_file', 'patch_file', 'edit_file', 'append_file', 'bash', 'powershell', 'cmd'],
        canOverride: true
    },
    'coordinator': {
        name: 'coordinator',
        label: 'Coordinator',
        description: 'Can read files and use orchestration tools but cannot implement code directly.',
        allowedCategories: ['read', 'orchestration', 'memory', 'ai', 'notes'],
        blockedTools: ['write_file', 'patch_file', 'edit_file', 'append_file', 'bash', 'powershell', 'cmd'],
        canOverride: true
    },
    'observer': {
        name: 'observer',
        label: 'Observer',
        description: 'Read-only access. Can view files and system info but cannot modify anything.',
        allowedCategories: ['read'],
        blockedTools: [],       // category filter handles it — only 'read' category allowed
        canOverride: false
    }
};

// Migration map: old InfoSec roles → new capability-scoped roles
const ROLE_MIGRATION_MAP = {
    'ciso':              'full-access',
    'security-lead':     'coordinator',
    'security-analyst':  'reviewer',
    'security-aware':    'contributor',
    'developer':         'implementer',
    'readonly':          'observer'
};

// Default agent templates
const DEFAULT_AGENTS = {
    // ==================== BUILT-IN SYSTEM AGENTS ====================
    // builtIn:true → deletion blocked at all layers
    // forcedTools  → always present; user cannot uncheck
    // blockedTools → never present; user cannot add
    'orchestrator': {
        name: 'orchestrator',
        role: 'Orchestrator',
        description: 'Master coordinator for all multi-agent workflows. Decomposes goals into tasks, delegates work to specialist agents, tracks progress, and closes milestones. Never implements code directly — always delegates to the right specialist.',
        group: 'System',
        languages: ['English'],
        tools: [
            'delegate_to_agent', 'delegate_to_team', 'create_task', 'message_agent',
            'recommend_task', 'close_milestone', 'request_tool_exception',
            'read_file', 'list_dir', 'list_agents', 'get_agent_info',
            'web_search', 'fetch_webpage', 'save_webpage_to_vault', 'system_info', 'record_note', 'recall_notes'
        ],
        autoAddTools: false,
        securityRole: 'full-access',
        builtIn: true,
        forcedTools: ['delegate_to_agent', 'delegate_to_team', 'create_task', 'message_agent', 'recommend_task', 'close_milestone', 'request_tool_exception'],
        blockedTools: ['bash', 'powershell', 'cmd', 'write_file', 'patch_file', 'edit_file'],
        capabilities: ['orchestration', 'task-delegation', 'multi-agent-coordination', 'milestone-management', 'workflow-design'],
        instructions: `You are the conductor, not a performer. Decompose goals and route work — never implement yourself.
Step 1: Identify ALL distinct task types (code, docs, tests, git, research, design, infra).
Step 2: Consult your AGENT ROUTING MATRIX for each task type.
Step 3: Delegate each via delegate_to_agent with a self-contained task description.
Step 4: Verify results using the VERIFICATION MANDATE before reporting to the user.
NEVER write files, run bash, or implement anything — always delegate.`
    },
    'project-manager': {
        name: 'project-manager',
        role: 'Project Manager',
        description: 'Plans projects, creates milestones, and hands execution plans to the orchestrator. Coordinates scope, timelines, and requirements. Must coordinate and plan rather than implement directly.',
        group: 'System',
        languages: ['English'],
        tools: [
            'handoff_to_orchestrator', 'recommend_task', 'create_task',
            'read_file', 'list_dir', 'list_agents',
            'web_search', 'fetch_webpage', 'save_webpage_to_vault', 'system_info', 'record_note', 'recall_notes'
        ],
        autoAddTools: false,
        securityRole: 'full-access',
        builtIn: true,
        forcedTools: ['handoff_to_orchestrator', 'recommend_task', 'create_task'],
        blockedTools: ['bash', 'powershell', 'cmd', 'write_file', 'patch_file', 'edit_file'],
        capabilities: ['project-planning', 'milestone-creation', 'scope-management', 'stakeholder-communication', 'roadmap-design'],
        instructions: `Your output is plans, not implementations. Translate goals into milestones and task assignments.
Key specialists to route to: documentation-technician (docs), code-implementer (code), git-keeper (git), qa-engineer (tests), devops-engineer (CI/CD).
Use create_task / recommend_task to build the plan, then hand off via handoff_to_orchestrator.`
    },

    // ==================== ENGINEERING - DEVELOPMENT ====================
    'frontend-developer': {
        name: 'frontend-developer',
        role: 'Frontend Developer',
        description: 'Specializes in building user-facing applications and interfaces using modern frontend frameworks. Implements responsive, accessible, and performant web components following best practices and design patterns.',
        group: 'Engineering',
        languages: ['JavaScript', 'TypeScript', 'HTML', 'CSS', 'React', 'Vue', 'Angular'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'understand_image', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: true,
        securityRole: 'implementer',
        capabilities: ['html', 'css', 'javascript', 'typescript', 'react', 'vue', 'angular', 'responsive-design', 'frontend-optimization', 'cross-browser', 'accessibility', 'web-performance', 'progressive-web-apps'],
        instructions: `Implement frontend features using the repo's existing framework and patterns.
Always read_file before modifying. Check existing components before creating new ones.
Extend existing CSS classes rather than adding new ones.`
    },
    'backend-developer': {
        name: 'backend-developer',
        role: 'Backend Developer',
        description: 'Focuses on server-side logic, APIs, database management, and system integration. Builds robust, scalable, and secure backend services using appropriate frameworks and technologies.',
        group: 'Engineering',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'SQL'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: true,
        securityRole: 'implementer',
        capabilities: ['nodejs', 'python', 'java', 'go', 'rust', 'sql', 'nosql', 'api-design', 'microservices', 'server-optimization', 'security', 'caching'],
        instructions: `Implement server-side logic, APIs, and database code.
Always read_file on any file you intend to modify. Follow existing routing/middleware patterns.
Validate inputs, handle errors explicitly, never leave console.log in production paths.`
    },
    'principal-engineer': {
        name: 'principal-engineer',
        role: 'Principal Engineer',
        description: 'Senior technical leader responsible for architectural decisions, mentoring engineers, and driving technical strategy across multiple teams and projects.',
        group: 'Engineering',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Go', 'Rust'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'git_diff', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: false,
        securityRole: 'implementer',
        capabilities: ['architecture', 'system-design', 'technical-leadership', 'mentoring', 'code-review', 'standards', 'innovation', 'strategic-planning'],
        instructions: `Lead large-scale architectural refactors and technical decisions.
Read ALL relevant module files before proposing changes. Document WHY alongside WHAT.
For cross-cutting concerns, identify all affected files via list_dir before acting.`
    },
    'development-coordinator': {
        name: 'development-coordinator',
        role: 'Development Coordinator',
        description: 'Coordinates development activities across teams, manages technical dependencies, and ensures smooth execution of development tasks and sprints.',
        group: 'Engineering',
        languages: ['English'],
        tools: ['read_file', 'write_file', 'list_dir', 'bash', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: false,
        securityRole: 'coordinator',
        capabilities: ['project-coordination', 'resource-management', 'dependency-tracking', 'communication', 'timeline-management', 'risk-management', 'stakeholder-management'],
        instructions: `Coordinate dev activities — your output is plans and assignments, not code.
Identify blockers, dependencies, and handoff points between specialists.`
    },

    // ==================== ENGINEERING - LEADERSHIP ====================
    'frontend-lead': {
        name: 'frontend-lead',
        role: 'Frontend Lead',
        description: 'Leads frontend development teams, establishes coding standards, ensures quality code delivery, and mentors junior frontend developers.',
        group: 'Engineering',
        languages: ['JavaScript', 'TypeScript', 'HTML', 'CSS', 'React', 'Vue'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'git_diff', 'understand_image', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: false,
        securityRole: 'implementer',
        capabilities: ['frontend-architecture', 'team-leadership', 'code-quality', 'performance-optimization', 'design-systems', 'accessibility', 'cross-functional-collaboration'],
        instructions: `Establish and enforce frontend standards. Review for accessibility, performance, and maintainability.
Read the full component file before modifying. Prefer composition over inheritance.`
    },
    'backend-lead': {
        name: 'backend-lead',
        role: 'Backend Lead',
        description: 'Leads backend development efforts, designs scalable server architectures, and ensures robust API design and database optimization.',
        group: 'Engineering',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Go', 'Rust', 'SQL'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'git_diff', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: false,
        securityRole: 'implementer',
        capabilities: ['backend-architecture', 'api-design', 'database-optimization', 'team-leadership', 'security', 'scalability', 'microservices'],
        instructions: `Design and enforce backend API contracts and DB schemas.
Read all related service and route files before implementing. Ensure proper error handling, validation, and HTTP status codes.`
    },

    // ==================== QA & TESTING ====================
    'qa-engineer': {
        name: 'qa-engineer',
        role: 'QA Engineer',
        description: 'Designs and implements testing strategies, writes test cases, performs various testing types, and ensures software quality meets standards.',
        group: 'QA',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Java'],
        tools: ['qa_run_tests', 'qa_check_lint', 'qa_check_types', 'qa_check_coverage', 'read_file', 'write_file', 'list_dir'],
        autoAddTools: true,
        securityRole: 'implementer',
        capabilities: ['test-planning', 'test-automation', 'manual-testing', 'regression-testing', 'performance-testing', 'security-testing', 'bug-tracking', 'quality-assurance'],
        instructions: `Write real, meaningful tests — never placeholder asserts or TODO stubs.
Read the source file thoroughly before writing tests. Cover: happy path, boundaries, error cases, unexpected input.`
    },
    'qa-lead': {
        name: 'qa-lead',
        role: 'QA Lead',
        description: 'Leads QA team, develops testing strategies, implements quality processes, and ensures overall product quality across all releases.',
        group: 'QA',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Java'],
        tools: ['qa_run_tests', 'qa_check_lint', 'qa_check_types', 'qa_check_coverage', 'read_file', 'write_file', 'list_dir', 'bash'],
        autoAddTools: false,
        securityRole: 'implementer',
        capabilities: ['test-strategy', 'team-leadership', 'quality-management', 'process-improvement', 'test-automation', 'risk-assessment', 'stakeholder-coordination'],
        instructions: `Define and enforce the testing strategy. Identify coverage gaps before assigning work.
Always report exact counts: X passed, Y failed, Z skipped — never say "tests pass" without numbers.`
    },
    'test-strategy-architect': {
        name: 'test-strategy-architect',
        role: 'Test Strategy Architect',
        description: 'Designs comprehensive testing strategies and frameworks. Defines testing methodologies, tools, and best practices across the organization.',
        group: 'QA',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Java'],
        tools: ['qa_run_tests', 'qa_check_lint', 'qa_check_types', 'qa_check_coverage', 'read_file', 'write_file', 'list_dir', 'bash'],
        autoAddTools: false,
        securityRole: 'implementer',
        capabilities: ['test-architecture', 'strategy-design', 'test-automation-frameworks', 'ci-cd-integration', 'quality-metrics', 'risk-based-testing', 'tool-evaluation'],
        instructions: `Design the overall testing framework and methodology.
Your output is strategy documents and framework scaffolding — not individual test cases.`
    },
    'deployment-verification-agent': {
        name: 'deployment-verification-agent',
        role: 'Deployment Verification Agent',
        description: 'Verifies deployments across environments, runs smoke tests, validates configurations, and ensures smooth production releases.',
        group: 'QA',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Bash'],
        tools: ['qa_run_tests', 'read_file', 'write_file', 'list_dir', 'bash'],
        autoAddTools: true,
        securityRole: 'implementer',
        capabilities: ['deployment-validation', 'smoke-testing', 'environment-verification', 'rollback-procedures', 'monitoring', 'incident-response'],
        instructions: `Verify deployments via smoke tests and health checks.
Report exact status: which checks passed, which failed, response times, error messages verbatim.
Never mark a deployment verified unless ALL checks pass.`
    },

    // ==================== DEVOPS & INFRASTRUCTURE ====================
    'devops-engineer': {
        name: 'devops-engineer',
        role: 'DevOps Engineer',
        description: 'Implements and maintains CI/CD pipelines, manages infrastructure as code, and ensures reliable deployment and operations.',
        group: 'DevOps',
        languages: ['Bash', 'Python', 'JavaScript', 'TypeScript', 'YAML'],
        tools: ['bash', 'read_file', 'write_file', 'list_dir', 'git_diff', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: true,
        securityRole: 'implementer',
        capabilities: ['ci-cd', 'infrastructure-as-code', 'containerization', 'orchestration', 'monitoring', 'logging', 'automation', 'cloud-infrastructure'],
        instructions: `Implement CI/CD pipelines, Dockerfiles, and infrastructure-as-code.
Read existing pipeline files before modifying. Follow naming and secret-management conventions.
Never hard-code credentials. Test changes in a non-main branch.`
    },
    'devops-lead': {
        name: 'devops-lead',
        role: 'DevOps Lead',
        description: 'Leads DevOps initiatives, establishes best practices, manages infrastructure strategy, and drives automation across the organization.',
        group: 'DevOps',
        languages: ['Bash', 'Python', 'JavaScript', 'TypeScript', 'YAML'],
        tools: ['bash', 'read_file', 'write_file', 'list_dir', 'git_diff', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: false,
        securityRole: 'implementer',
        capabilities: ['devops-strategy', 'team-leadership', 'cloud-architecture', 'cost-optimization', 'security-compliance', 'tooling', 'process-improvement'],
        instructions: `Lead DevOps strategy and infrastructure architecture.
Your outputs are architecture decisions, runbooks, and CI standards — route implementation to devops-engineer.`
    },
    'gitops-specialist': {
        name: 'gitops-specialist',
        role: 'GitOps Specialist',
        description: 'Implements GitOps workflows, manages declarative infrastructure, and ensures version-controlled deployment processes.',
        group: 'DevOps',
        languages: ['Bash', 'YAML', 'Python', 'Go'],
        tools: ['bash', 'read_file', 'write_file', 'list_dir', 'git_diff', 'github', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: true,
        securityRole: 'implementer',
        capabilities: ['gitops', 'argocd', 'flux', 'helm', 'kubernetes', 'git-workflows', 'infrastructure-as-code', 'drift-detection'],
        instructions: `Implement GitOps workflows and declarative infrastructure. All state changes must go through Git.
Read current manifests before modifying. Use dry-run / plan flags before applying destructive changes.`
    },
    'deployment-orchestrator': {
        name: 'deployment-orchestrator',
        role: 'Deployment Orchestrator',
        description: 'Coordinates complex deployments across multiple environments, manages release schedules, and ensures zero-downtime releases.',
        group: 'DevOps',
        languages: ['Bash', 'Python', 'YAML', 'JavaScript'],
        tools: ['bash', 'read_file', 'write_file', 'list_dir', 'git_diff'],
        autoAddTools: false,
        securityRole: 'implementer',
        capabilities: ['deployment-strategy', 'release-management', 'rollback-automation', 'feature-flags', 'environment-management', 'coordination'],
        instructions: `Coordinate multi-environment deployments. Read the release runbook before starting.
Track which environments are at which version. On failure, execute rollback immediately and report.`
    },
    'system-maintenance-coordinator': {
        name: 'system-maintenance-coordinator',
        role: 'System Maintenance Coordinator',
        description: 'Schedules and coordinates system maintenance windows, manages patches, updates, and ensures system health and compliance.',
        group: 'DevOps',
        languages: ['Bash', 'Python', 'YAML'],
        tools: ['bash', 'read_file', 'write_file', 'list_dir'],
        autoAddTools: false,
        securityRole: 'implementer',
        capabilities: ['maintenance-planning', 'patch-management', 'system-monitoring', 'incident-coordination', 'compliance', 'documentation'],
        instructions: `Plan and coordinate maintenance windows. Document all changes in each window.
Verify system health before and after. Keep a log of all actions taken.`
    },

    // ==================== ARCHITECTURE & DESIGN ====================
    'system-architect': {
        name: 'system-architect',
        role: 'System Architect',
        description: 'Designs overall system architecture, defines technical standards, and ensures scalability, performance, and reliability of solutions.',
        group: 'Architecture',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Go', 'Rust', 'SQL'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'git_diff', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: false,
        securityRole: 'implementer',
        capabilities: ['system-design', 'architecture-patterns', 'scalability', 'performance', 'security', 'technology-selection', 'integration-design'],
        instructions: `Design system architecture with ADRs, diagrams, and interface contracts.
Read all relevant module files before proposing changes. Primary output is design docs — not code.`
    },
    'enterprise-solutions-architect': {
        name: 'enterprise-solutions-architect',
        role: 'Enterprise Solutions Architect',
        description: 'Designs enterprise-level solutions, creates architectural blueprints, and ensures alignment with business objectives and technical standards.',
        group: 'Architecture',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Java', 'Go'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'git_diff', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: false,
        securityRole: 'implementer',
        capabilities: ['enterprise-architecture', 'solution-design', 'business-alignment', 'technology-roadmapping', 'architecture-governance', 'risk-assessment'],
        instructions: `Design enterprise-scale solutions. Map business requirements to technical architecture.
Produce blueprint documents, integration maps, and technology selection rationales.`
    },
    'enterprise-solutions-engineer': {
        name: 'enterprise-solutions-engineer',
        role: 'Enterprise Solutions Engineer',
        description: 'Implements and maintains enterprise-level systems, integrates disparate systems, and ensures seamless data flow across the organization.',
        group: 'Architecture',
        languages: ['Java', 'Python', 'JavaScript', 'TypeScript', 'SQL'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: false,
        securityRole: 'implementer',
        capabilities: ['enterprise-integration', 'system-integration', 'api-gateway', 'data-pipelines', 'workflow-automation', 'enterprise-security'],
        instructions: `Implement enterprise integrations and system connectors.
Read existing integration layer and API contracts before adding new connectors.
Ensure idempotency, retry logic, and proper error propagation.`
    },
    'architecture-coordinator': {
        name: 'architecture-coordinator',
        role: 'Architecture Coordinator',
        description: 'Coordinates architectural activities across teams, manages architectural debt, and ensures consistent implementation of architectural decisions.',
        group: 'Architecture',
        languages: ['English'],
        tools: ['read_file', 'write_file', 'list_dir', 'bash', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: false,
        securityRole: 'coordinator',
        capabilities: ['architecture-governance', 'coordination', 'documentation', 'standards-enforcement', 'technical-debt-management', 'stakeholder-communication'],
        instructions: `Track architectural decisions and ensure consistent implementation.
Document architectural debt. Raise blockers when implementation diverges from approved architecture.`
    },

    // ==================== UI/UX DESIGN ====================
    'ui-designer': {
        name: 'ui-designer',
        role: 'UI Designer',
        description: 'Creates visually appealing user interfaces, designs layouts, components, and ensures consistency with brand guidelines and design systems.',
        group: 'Design',
        languages: ['HTML', 'CSS', 'JavaScript', 'SCSS'],
        tools: ['read_file', 'write_file', 'patch_file', 'understand_image', 'list_dir', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: true,
        securityRole: 'implementer',
        capabilities: ['ui-design', 'visual-design', 'prototyping', 'design-systems', 'responsive-design', 'typography', 'color-theory', 'iconography'],
        instructions: `Create UI that follows the existing design system. Read tokens.css and components.css first.
Use understand_image to verify rendered output. Match the project's existing visual language.`
    },
    'ux-interface-designer': {
        name: 'ux-interface-designer',
        role: 'UX Interface Designer',
        description: 'Designs intuitive user interfaces with focus on user experience, creates wireframes, prototypes, and conducts user research.',
        group: 'Design',
        languages: ['HTML', 'CSS', 'JavaScript'],
        tools: ['read_file', 'write_file', 'patch_file', 'understand_image', 'list_dir', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: true,
        securityRole: 'implementer',
        capabilities: ['ux-design', 'user-research', 'wireframing', 'prototyping', 'usability-testing', 'information-architecture', 'interaction-design'],
        instructions: `Design user flows before writing implementation code. Validate against WCAG 2.1 AA.
Your output is wireframes, flows, and UX specs — route implementation to ui-expert or frontend-developer.`
    },

    // ==================== DATA & ANALYTICS ====================
    'data-engineer': {
        name: 'data-engineer',
        role: 'Data Engineer',
        description: 'Builds and maintains data pipelines, manages data infrastructure, and ensures data quality and accessibility for analytics.',
        group: 'Data',
        languages: ['Python', 'SQL', 'Java', 'Scala', 'Bash'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: true,
        securityRole: 'implementer',
        capabilities: ['data-pipelines', 'etl', 'data-warehousing', 'big-data', 'sql', 'python', 'spark', 'data-quality', 'data-modeling'],
        instructions: `Build data pipelines and ETL. Read existing schema definitions before creating new ones.
Document all transformations with input/output schemas. Validate data quality at each stage.`
    },
    'data-scientist': {
        name: 'data-scientist',
        role: 'Data Scientist',
        description: 'Analyzes complex datasets, builds predictive models, and derives insights to drive data-informed decision making.',
        group: 'Data',
        languages: ['Python', 'R', 'SQL', 'Julia'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: true,
        securityRole: 'implementer',
        capabilities: ['machine-learning', 'statistical-analysis', 'data-visualization', 'python', 'r', 'deep-learning', 'nlp', 'predictive-modeling'],
        instructions: `Analyse data and build models. Start with exploratory analysis before modelling.
Document assumptions, feature selection, and model limitations. Report metrics with confidence intervals.`
    },

    // ==================== PRODUCT & PROJECT MANAGEMENT ====================
    'product-manager': {
        name: 'product-manager',
        role: 'Product Manager',
        description: 'Defines product vision, manages roadmap, prioritizes features, and works with stakeholders to deliver successful products.',
        group: 'Product',
        languages: ['English'],
        tools: ['read_file', 'write_file', 'list_dir', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: false,
        securityRole: 'reviewer',
        capabilities: ['product-strategy', 'roadmap-management', 'stakeholder-management', 'user-research', 'prioritization', 'agile', 'market-analysis'],
        instructions: `Define product direction and prioritise the backlog. Your output is user stories, acceptance criteria, and success metrics — not code.`
    },
    'business-analyst': {
        name: 'business-analyst',
        role: 'Business Analyst',
        description: 'Analyzes business requirements, bridges gap between business and technical teams, and ensures solutions meet business objectives.',
        group: 'Product',
        languages: ['English'],
        tools: ['read_file', 'write_file', 'list_dir', 'fetch_webpage', 'save_webpage_to_vault'],
        instructions: `Elicit and document business requirements. Read existing system docs before starting.
Produce use cases, process flows, and functional specs that engineering can act on directly.`,
        autoAddTools: false,
        securityRole: 'reviewer',
        capabilities: ['requirements-analysis', 'business-process-modeling', 'data-analysis', 'stakeholder-communication', 'use-cases', 'functional-specs']
    },
    'project-initializer': {
        name: 'project-initializer',
        role: 'Project Initializer',
        description: 'Sets up new projects, defines initial structure, establishes workflows, and creates foundation for successful project execution.',
        group: 'Product',
        languages: ['English', 'JavaScript', 'TypeScript'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: false,
        securityRole: 'implementer',
        capabilities: ['project-setup', 'template-creation', 'workflow-definition', 'tooling-setup', 'team-onboarding', 'governance-setup'],
        instructions: `Set up new projects with correct directory structure, tooling, and initial configuration.
Read existing project templates first. Document what was created and why.`
    },

    // ==================== AGILE & PROCESS ====================
    'scrum-master': {
        name: 'scrum-master',
        role: 'Scrum Master',
        description: 'Facilitates Scrum ceremonies, removes impediments, coaches team on Agile practices, and ensures process adherence.',
        group: 'Agile',
        languages: ['English'],
        tools: ['read_file', 'write_file', 'list_dir', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: false,
        securityRole: 'coordinator',
        capabilities: ['scrum', 'facilitation', 'coaching', 'impediment-removal', 'ceremony-facilitation', 'continuous-improvement', 'conflict-resolution'],
        instructions: `Facilitate Scrum ceremonies and remove impediments. Keep outputs concise and action-oriented.
Document blockers with their owner and expected resolution date.`
    },
    'sprint-planner': {
        name: 'sprint-planner',
        role: 'Sprint Planner',
        description: 'Plans sprint activities, estimates work, defines sprint goals, and ensures realistic sprint commitments.',
        group: 'Agile',
        languages: ['English'],
        tools: ['read_file', 'write_file', 'list_dir'],
        autoAddTools: false,
        securityRole: 'coordinator',
        capabilities: ['sprint-planning', 'estimation', 'velocity-tracking', 'capacity-planning', 'goal-setting', 'prioritization'],
        instructions: `Plan sprints by matching backlog items to team capacity.
Output: sprint plan with assignments, estimates, and sprint goal statement.`
    },
    'sprint-retrospective-facilitator': {
        name: 'sprint-retrospective-facilitator',
        role: 'Sprint Retrospective Facilitator',
        description: 'Leads sprint retrospectives, identifies improvements, and drives continuous process enhancement within teams.',
        group: 'Agile',
        languages: ['English'],
        tools: ['read_file', 'write_file', 'list_dir'],
        autoAddTools: false,
        securityRole: 'coordinator',
        capabilities: ['retrospective-facilitation', 'process-improvement', 'team-coaching', 'feedback-analysis', 'action-tracking', 'change-management'],
        instructions: `Lead retros that produce actionable improvements. Structure: What went well / What to improve / Action items with owners.
Follow up on previous retro action items before starting new ones.`
    },
    'agile-workflow-orchestrator': {
        name: 'agile-workflow-orchestrator',
        role: 'Agile Workflow Orchestrator',
        description: 'Orchestrates Agile workflows across multiple teams, ensures alignment, and optimizes delivery processes.',
        group: 'Agile',
        languages: ['English'],
        tools: ['read_file', 'write_file', 'list_dir', 'bash', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: false,
        securityRole: 'coordinator',
        capabilities: ['workflow-orchestration', 'cross-team-coordination', 'agile-coaching', 'process-optimization', 'dependency-management', 'delivery-tracking'],
        instructions: `Coordinate Agile workflows across teams. Track inter-team dependencies and escalate blockers promptly.
Output: coordination plans, dependency maps, and delivery forecasts.`
    },

    // ==================== SECURITY & COMPLIANCE ====================
    'security-compliance-officer': {
        name: 'security-compliance-officer',
        role: 'Security Compliance Officer',
        description: 'Ensures compliance with security standards and regulations, conducts audits, and implements security policies.',
        group: 'Security',
        languages: ['English'],
        tools: ['read_file', 'write_file', 'list_dir', 'bash', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: false,
        securityRole: 'implementer',
        capabilities: ['security-compliance', 'audit', 'risk-assessment', 'policy-development', 'regulatory-compliance', 'security-frameworks', 'incident-response'],
        instructions: `Audit for security and compliance. Read the security policy before starting.
Report findings with severity (Critical/High/Medium/Low), affected component, and recommended remediation.
Never remediate yourself — report to orchestrator for delegation.`
    },
    'workflow-termination-coordinator': {
        name: 'workflow-termination-coordinator',
        role: 'Workflow Termination Coordinator',
        description: 'Manages graceful termination of workflows and processes, ensures clean shutdowns, and handles cleanup operations.',
        group: 'Security',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Bash'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash'],
        autoAddTools: false,
        securityRole: 'implementer',
        capabilities: ['workflow-management', 'process-termination', 'cleanup-automation', 'resource-release', 'state-management', 'error-handling'],
        instructions: `Manage graceful workflow shutdowns. Identify all active processes and dependencies before terminating.
Follow: drain → stop → verify → cleanup. Report the final state of each terminated process.`
    },

    // ==================== DOCUMENTATION ====================
    'documentation-strategist': {
        name: 'documentation-strategist',
        role: 'Documentation Strategist',
        description: 'Develops documentation strategy, establishes standards, and ensures comprehensive and maintainable documentation.',
        group: 'Documentation',
        languages: ['English', 'Markdown'],
        tools: ['read_file', 'write_file', 'list_dir', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: false,
        securityRole: 'reviewer',
        capabilities: ['documentation-strategy', 'content-architecture', 'knowledge-management', 'technical-writing', 'api-documentation', 'style-guides'],
        instructions: `Design documentation architecture. Audit existing docs before proposing new structure.
Define what docs exist, what is missing, and the audience for each doc type.
Your output is a documentation PLAN — route actual writing to documentation-technician.`
    },
    'documentation-technician': {
        name: 'documentation-technician',
        role: 'Documentation Technician',
        description: 'Creates and maintains technical documentation, API docs, user guides, and ensures documentation stays up to date.',
        group: 'Documentation',
        languages: ['English', 'Markdown'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: true,
        securityRole: 'implementer',
        capabilities: ['technical-writing', 'api-documentation', 'user-guides', 'markdown', 'documentation-tools', 'content-updates'],
        instructions: `Write and maintain technical documentation, API docs, user guides, and Obsidian vault notes.
Before writing: read the source code OR fetch_webpage the external reference you are documenting.
For Obsidian vault notes: use YAML frontmatter (---) with source, fetched, and tags fields.
For API docs: include endpoint, method, params, response schema, and an example.
Never write placeholder sections — every heading must have real content.`
    },

    // ==================== EXISTING DEFAULT AGENTS ====================
    'git-keeper': {
        name: 'git-keeper',
        role: 'Git Operations Specialist',
        description: 'Manages all git operations including commits, pushes, pulls, branches, and merging. Handles GitHub integration.',
        group: 'version-control',
        languages: ['Bash'],
        tools: ['github', 'bash'],
        autoAddTools: false,
        securityRole: 'implementer',
        capabilities: ['git', 'github', 'version-control'],
        instructions: `Handle ALL git operations. Run git status before and after every operation.
Commit messages must follow Conventional Commits: type(scope): subject.
Never force-push to main/master — refuse and report to the orchestrator instead.`
    },
    'testing-engineer': {
        name: 'testing-engineer',
        role: 'QA & Testing Specialist',
        description: 'Runs tests, linting, type checking, and code quality checks.',
        group: 'quality-assurance',
        languages: ['JavaScript', 'TypeScript', 'Python'],
        tools: ['qa_run_tests', 'qa_check_lint', 'qa_check_types', 'qa_check_coverage', 'qa_audit_deps'],
        autoAddTools: true,
        securityRole: 'implementer',
        capabilities: ['testing', 'linting', 'quality-assurance', 'coverage'],
        instructions: `Run the project's test suite and report results with exact counts: X passed, Y failed, Z skipped.
To WRITE new tests, use qa-engineer — your role is execution and reporting only.`
    },
    'code-implementer': {
        name: 'code-implementer',
        role: 'Code Implementation Specialist',
        description: 'Implements features, creates files, and modifies code based on requirements.',
        group: 'development',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Go', 'Rust', 'C++', 'C'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: true,
        securityRole: 'implementer',
        capabilities: ['coding', 'file-operations', 'implementation'],
        instructions: `General-purpose code implementer — use ONLY when no specialist agent better fits.
Documentation tasks → documentation-technician. Git ops → git-keeper. Tests → qa-engineer. UI → ui-expert.
SCOPE: implement ONLY what was asked. After writing, verify the file exists via list_dir.`
    },
    'ui-expert': {
        name: 'ui-expert',
        role: 'UI/UX Design Specialist',
        description: 'Expert at developing high quality working polished UI and UX. Creates beautiful, functional, accessible interfaces with modern design principles.',
        group: 'development',
        languages: ['JavaScript', 'TypeScript', 'HTML', 'CSS', 'SCSS'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'understand_image', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: true,
        securityRole: 'implementer',
        capabilities: ['ui-design', 'ux-design', 'css', 'html', 'accessibility', 'responsive-design', 'animation', 'visual-design'],
        instructions: `Implement polished, accessible UI. Read existing CSS tokens and component files before adding styles.
Match the visual language already present. Test with understand_image after major layout changes.
Prefer modifying existing CSS classes over adding new ones.`
    },
    'ui-tester': {
        name: 'ui-tester',
        role: 'UI Testing Specialist',
        description: 'Specializes in testing UI components, visual regression testing, accessibility testing, and ensuring pixel-perfect implementations.',
        group: 'quality-assurance',
        languages: ['JavaScript', 'TypeScript', 'Python'],
        tools: ['qa_run_tests', 'qa_check_lint', 'understand_image', 'read_file', 'fetch_webpage', 'save_webpage_to_vault'],
        autoAddTools: true,
        securityRole: 'implementer',
        capabilities: ['ui-testing', 'visual-testing', 'accessibility-testing', 'e2e-testing', 'regression-testing'],
        instructions: `Test UI for visual correctness and accessibility using understand_image and qa_check tools.
Check WCAG 2.1 AA compliance for all interactive elements. Report visual regressions with descriptions.`
    },
    'regex-expert': {
        name: 'regex-expert',
        role: 'Regular Expression Specialist',
        description: 'Expert at creating, testing, and debugging regular expressions. Handles complex pattern matching, text processing, and validation.',
        group: 'development',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Bash'],
        tools: ['read_file', 'write_file', 'bash'],
        autoAddTools: true,
        securityRole: 'implementer',
        capabilities: ['regex', 'pattern-matching', 'text-processing', 'validation', 'parsing'],
        instructions: `Create and test regular expressions. Always test against provided examples AND edge cases (empty, Unicode, very long input).
Document each regex with a plain-English explanation of what each group matches.`
    }
};

// ==================== INITIALIZATION ====================

function init(hub) {
    HUB = hub;
    
    // Wait for config and database
    let attempts = 0;
    while (!HUB.getService('config') && attempts < 10) {
        new Promise(r => setTimeout(r, 100));
        attempts++;
    }
    
    CONFIG = HUB.getService('config') || {};
    db = HUB.getService('database');
    
    // Initialize database tables
    initializeAgentTables();
    
    // Register service
    const service = {
        // CRUD
        createAgent: createAgent,
        updateAgent: updateAgent,
        deleteAgent: deleteAgent,
        getAgent: getAgent,
        listAgents: listAgents,
        
        // Groups
        createGroup: createGroup,
        updateGroup: updateGroup,
        deleteGroup: deleteGroup,
        listGroups: listGroups,
        addAgentToGroup: addAgentToGroup,
        removeAgentFromGroup: removeAgentFromGroup,
        
        // Tool permissions
        setToolPermissions: setToolPermissions,
        getToolPermissions: getToolPermissions,
        getAllowedTools: getAllowedTools,
        
        // Collaboration
        startCollaboration: startCollaboration,
        endCollaboration: endCollaboration,
        getActiveCollaborations: getActiveCollaborations,

        // Role enforcement
        isToolAllowedForRole: isToolAllowedForRole,
        findCapableAgent: findCapableAgent,

        // Constants
        TOOL_CATEGORIES: TOOL_CATEGORIES,
        PROGRAMMING_LANGUAGES: PROGRAMMING_LANGUAGES,
        SECURITY_ROLES: SECURITY_ROLES,
        ROLE_MIGRATION_MAP: ROLE_MIGRATION_MAP,
        DEFAULT_AGENTS: DEFAULT_AGENTS
    };
    
    HUB.registerService('agentManager', service);
    
    // Initialize default agents if none exist
    initializeDefaultAgents();
    
    HUB.log('🎫 Agent Manager loaded', 'success');
}

// ==================== DATABASE TABLES ====================

function initializeAgentTables() {
    if (!db) {
        HUB?.log('⚠️ Database not available for agent manager', 'warn');
        return;
    }
    
    try {
        // Agents table
        db.run(`
            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                role TEXT,
                description TEXT,
                instructions TEXT,
                group_id TEXT,
                languages TEXT,
                tools TEXT,
                tool_policy TEXT DEFAULT 'allowlist',
                auto_add_tools INTEGER DEFAULT 1,
                security_role TEXT DEFAULT 'implementer',
                capabilities TEXT,
                metadata TEXT,
                status TEXT DEFAULT 'active',
                scope TEXT DEFAULT 'global',
                thinking_enabled INTEGER DEFAULT 0,
                thinking_budget INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Migrations: add columns if missing (for existing DBs)
        try { db.run(`ALTER TABLE agents ADD COLUMN scope TEXT DEFAULT 'global'`); } catch (_) {}
        try { db.run(`ALTER TABLE agents ADD COLUMN thinking_enabled INTEGER DEFAULT 0`); } catch (_) {}
        try { db.run(`ALTER TABLE agents ADD COLUMN thinking_budget INTEGER DEFAULT 0`); } catch (_) {}
        try { db.run(`ALTER TABLE agents ADD COLUMN built_in INTEGER DEFAULT 0`); } catch (_) {}
        try { db.run(`ALTER TABLE agents ADD COLUMN forced_tools TEXT DEFAULT '[]'`); } catch (_) {}
        try { db.run(`ALTER TABLE agents ADD COLUMN blocked_tools TEXT DEFAULT '[]'`); } catch (_) {}
        try { db.run(`ALTER TABLE agents ADD COLUMN override_role_restrictions INTEGER DEFAULT 0`); } catch (_) {}

        // Migrate old InfoSec security roles → new capability-scoped roles
        for (const [oldRole, newRole] of Object.entries(ROLE_MIGRATION_MAP)) {
            try { db.run(`UPDATE agents SET security_role = ? WHERE security_role = ?`, [newRole, oldRole]); } catch (_) {}
        }

        // Agent groups table
        db.run(`
            CREATE TABLE IF NOT EXISTS agent_groups (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                description TEXT,
                color TEXT,
                collaboration_mode TEXT DEFAULT 'sequential',
                parent_id TEXT DEFAULT NULL,
                metadata TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Migration: add parent_id column for hierarchical groups (2-level max)
        try { db.run(`ALTER TABLE agent_groups ADD COLUMN parent_id TEXT DEFAULT NULL`); } catch (_) {}

        // Agent collaborations table (for multi-agent sessions)
        db.run(`
            CREATE TABLE IF NOT EXISTS agent_collaborations (
                id TEXT PRIMARY KEY,
                name TEXT,
                participants TEXT,
                status TEXT DEFAULT 'active',
                started_at TEXT DEFAULT CURRENT_TIMESTAMP,
                ended_at TEXT,
                metadata TEXT
            )
        `);
        
        // Agent tool permissions (explicit allow/deny)
        db.run(`
            CREATE TABLE IF NOT EXISTS agent_tool_permissions (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                action TEXT DEFAULT 'allow',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (agent_id) REFERENCES agents(id)
            )
        `);
        
        // Meeting notes table (persists meeting notes generated from chat room transcripts)
        db.run(`
            CREATE TABLE IF NOT EXISTS meeting_notes (
                id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL,
                title TEXT,
                date TEXT,
                duration TEXT,
                participants TEXT,
                summary TEXT,
                key_decisions TEXT,
                raid TEXT,
                action_items TEXT,
                next_steps TEXT,
                transcript TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        HUB?.log('📊 Agent Manager tables initialized', 'info');
    } catch (e) {
        HUB?.log('⚠️ Agent table init error: ' + e.message, 'warn');
    }
}

function initializeDefaultAgents() {
    if (!db) return;

    // Always upsert built-in agents so they exist even on existing DBs
    try {
        for (const [name, agent] of Object.entries(DEFAULT_AGENTS)) {
            if (!agent.builtIn) continue;
            const check = db.query('SELECT id FROM agents WHERE name = ?', [name]);
            if (check.success && check.results && check.results.length > 0) {
                // Already exists — update flags + tools to match definition
                db.run(
                    `UPDATE agents SET built_in=1, forced_tools=?, blocked_tools=?, role=?, description=?, instructions=?, tools=?, updated_at=? WHERE name=?`,
                    [
                        JSON.stringify(agent.forcedTools || []),
                        JSON.stringify(agent.blockedTools || []),
                        agent.role,
                        agent.description || '',
                        agent.instructions || '',
                        JSON.stringify(agent.tools || []),
                        new Date().toISOString(),
                        name
                    ]
                );
            } else {
                createAgent({
                    name,
                    role: agent.role,
                    description: agent.description,
                    instructions: agent.instructions || '',
                    group: agent.group,
                    languages: agent.languages,
                    tools: agent.tools,
                    autoAddTools: agent.autoAddTools,
                    securityRole: agent.securityRole,
                    capabilities: agent.capabilities,
                    builtIn: true,
                    forcedTools: agent.forcedTools || [],
                    blockedTools: agent.blockedTools || []
                });
            }
        }
        HUB?.log('✅ Built-in agents synced', 'info');
    } catch (e) {
        HUB?.log('⚠️ Built-in agents sync error: ' + e.message, 'warn');
    }

    // Seed all default agents only on a fresh DB (no agents yet)
    try {
        const existing = db.query('SELECT COUNT(*) as count FROM agents');
        if (existing.success && existing.results[0].count === 0) {
            for (const [name, agent] of Object.entries(DEFAULT_AGENTS)) {
                createAgent({
                    name: name,
                    role: agent.role,
                    description: agent.description,
                    instructions: agent.instructions || '',
                    group: agent.group,
                    languages: agent.languages,
                    tools: agent.tools,
                    autoAddTools: agent.autoAddTools,
                    securityRole: agent.securityRole,
                    capabilities: agent.capabilities,
                    builtIn: agent.builtIn || false,
                    forcedTools: agent.forcedTools || [],
                    blockedTools: agent.blockedTools || []
                });
            }
            HUB?.log('✅ Default agents initialized', 'info');
        }
    } catch (e) {
        HUB?.log('⚠️ Default agents init error: ' + e.message, 'warn');
    }

    // One-time backfill: write instructions for non-builtIn default agents on existing DBs
    // Only updates rows where instructions is currently empty — user customisations are safe
    try {
        for (const [name, agent] of Object.entries(DEFAULT_AGENTS)) {
            if (agent.builtIn) continue; // already handled above
            if (!agent.instructions) continue;
            db.run(
                `UPDATE agents SET instructions=?, updated_at=? WHERE name=? AND (instructions IS NULL OR instructions='')`,
                [agent.instructions, new Date().toISOString(), name]
            );
        }
        HUB?.log('✅ Agent instructions backfilled', 'info');
    } catch (e) {
        HUB?.log('⚠️ Agent instructions backfill error: ' + e.message, 'warn');
    }

    // Seed default groups if none exist
    try {
        const existing = db.query('SELECT COUNT(*) as count FROM agent_groups');
        if (existing.success && existing.results[0].count === 0) {
            // Insert root groups first, then subgroups (parent_id references root)
            const defaults = getDefaultGroups();
            const roots = defaults.filter(g => !g.parentId);
            const subs = defaults.filter(g => g.parentId);
            for (const g of [...roots, ...subs]) {
                db.run(
                    'INSERT OR IGNORE INTO agent_groups (id, name, description, color, collaboration_mode, parent_id, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [g.id, g.name, g.description, g.color, g.collaborationMode, g.parentId || null, '{}']
                );
            }
            HUB?.log('✅ Default hierarchical groups initialized', 'info');
        } else {
            // Migration: remap old flat groups to new hierarchy
            const FLAT_GROUP_MIGRATION = {
                'development': 'engineering',      // development → Engineering (root)
                'quality-assurance': 'quality-review', // quality-assurance → Quality & Review (root)
                'version-control': 'devops',       // version-control → Engineering > DevOps
                // 'security' stays as 'security' but now under Operations
            };
            for (const [oldId, newId] of Object.entries(FLAT_GROUP_MIGRATION)) {
                try {
                    // Update agents pointing to old group IDs
                    db.run('UPDATE agents SET group_id = ? WHERE group_id = ?', [newId, oldId]);
                } catch (_) {}
            }
            // Ensure security group gets parent_id = 'operations' if it exists without one
            try {
                db.run(`UPDATE agent_groups SET parent_id = 'operations' WHERE id = 'security' AND parent_id IS NULL`);
            } catch (_) {}
        }
    } catch (e) {
        HUB?.log('⚠️ Default groups init error: ' + e.message, 'warn');
    }
}

// ==================== AGENT CRUD ====================

function generateId() {
    return 'agent_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
}

function createAgent(agentData) {
    if (!agentData.name) {
        return { success: false, error: 'Agent name is required' };
    }

    // Project-scoped agents are not stored in SQLite — caller must persist via project-module
    if (agentData.scope === 'project') {
        const id = generateId();
        HUB?.log(`🎫 Created project-scoped agent: ${agentData.name}`, 'info');
        return { success: true, agent: { id, ...agentData, scope: 'project' } };
    }

    const id = generateId();
    const now = new Date().toISOString();

    try {
        if (db) {
            db.run(`
                INSERT INTO agents (id, name, role, description, instructions, group_id, languages, tools, tool_policy, auto_add_tools, security_role, capabilities, metadata, status, scope, thinking_enabled, thinking_budget, built_in, forced_tools, blocked_tools, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                id,
                agentData.name,
                agentData.role || 'Custom Agent',
                agentData.description || '',
                agentData.instructions || '',
                agentData.group || null,
                JSON.stringify(agentData.languages || []),
                JSON.stringify(agentData.tools || []),
                agentData.toolPolicy || 'allowlist',
                agentData.autoAddTools !== false ? 1 : 0,
                agentData.securityRole || 'implementer',
                JSON.stringify(agentData.capabilities || []),
                JSON.stringify(agentData.metadata || {}),
                'active',
                'global',
                agentData.thinkingEnabled ? 1 : 0,
                // radix parameter added for strict lint compliance (ESLint rule radix)
                parseInt(agentData.thinkingBudget, 10) || 0,
                agentData.builtIn ? 1 : 0,
                JSON.stringify(agentData.forcedTools || []),
                JSON.stringify(agentData.blockedTools || []),
                now,
                now
            ]);
        }

        HUB?.log(`🎫 Created agent: ${agentData.name}`, 'info');

        return {
            success: true,
            agent: { id, ...agentData, scope: 'global' }
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function updateAgent(agentId, updates) {
    try {
        if (!db) return { success: false, error: 'Database not available' };

        // ── Upsert: check if agent exists in DB (default agents may not be stored yet)
        const existingResult = db.query(
            'SELECT id FROM agents WHERE id = ? OR name = ? LIMIT 1',
            [agentId, agentId]
        );

        if (!existingResult.success || existingResult.results.length === 0) {
            // Agent not in DB — this is a default agent being customised for the first time.
            // Merge its DEFAULT_AGENTS definition with the incoming updates and INSERT it.
            const defName    = (updates.name || agentId || '').toString();
            const defAgent   = DEFAULT_AGENTS[defName] || DEFAULT_AGENTS[agentId] || {};
            const merged     = { ...defAgent, ...updates };
            const newId      = generateId();
            const now        = new Date().toISOString();
            const safeName   = defName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
            // Enforce built-in tool constraints on first upsert too
            let mergedTools = merged.tools || [];
            if (defAgent.builtIn) {
                const forced  = defAgent.forcedTools  || [];
                const blocked = defAgent.blockedTools || [];
                for (const t of forced) { if (!mergedTools.includes(t)) mergedTools.push(t); }
                mergedTools = mergedTools.filter(t => !blocked.includes(t));
            }
            db.run(`
                INSERT INTO agents
                    (id, name, role, description, instructions, group_id, languages, tools, tool_policy,
                     auto_add_tools, security_role, capabilities, metadata, status, scope,
                     thinking_enabled, thinking_budget, built_in, forced_tools, blocked_tools,
                     created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                newId, safeName,
                merged.role        || '',
                merged.description || '',
                merged.instructions || '',
                merged.group       || null,
                JSON.stringify(merged.languages   || []),
                JSON.stringify(mergedTools),
                merged.toolPolicy  || 'allowlist',
                merged.autoAddTools !== false ? 1 : 0,
                merged.securityRole || 'implementer',
                JSON.stringify(merged.capabilities || []),
                JSON.stringify(merged.metadata    || {}),
                'active', 'global',
                merged.thinkingEnabled ? 1 : 0,
                parseInt(merged.thinkingBudget, 10) || 0,
                defAgent.builtIn ? 1 : 0,
                JSON.stringify(defAgent.forcedTools  || []),
                JSON.stringify(defAgent.blockedTools || []),
                now, now
            ]);
            return { success: true, id: newId, created: true };
        }

        // ── Agent exists — UPDATE using the real DB id (passed-in agentId may be a name)
        const actualId = existingResult.results[0].id;

        // Enforce built-in tool constraints before building the UPDATE
        if (updates.tools !== undefined) {
            const builtInRow = db.query('SELECT built_in, forced_tools, blocked_tools FROM agents WHERE id = ?', [actualId]);
            if (builtInRow.success && builtInRow.results.length > 0 && builtInRow.results[0].built_in) {
                const forced  = JSON.parse(builtInRow.results[0].forced_tools  || '[]');
                const blocked = JSON.parse(builtInRow.results[0].blocked_tools || '[]');
                let sanitized = [...updates.tools];
                for (const t of forced) { if (!sanitized.includes(t)) sanitized.push(t); }
                sanitized = sanitized.filter(t => !blocked.includes(t));
                updates = { ...updates, tools: sanitized };
            }
        }

        const fields = [];
        const values = [];

        if (updates.name         !== undefined) { fields.push('name = ?');          values.push(updates.name); }
        if (updates.role         !== undefined) { fields.push('role = ?');          values.push(updates.role); }
        if (updates.description  !== undefined) { fields.push('description = ?');   values.push(updates.description); }
        if (updates.instructions !== undefined) { fields.push('instructions = ?');  values.push(updates.instructions); }
        if (updates.group        !== undefined) { fields.push('group_id = ?');      values.push(updates.group); }
        if (updates.languages    !== undefined) { fields.push('languages = ?');     values.push(JSON.stringify(updates.languages)); }
        if (updates.tools        !== undefined) { fields.push('tools = ?');         values.push(JSON.stringify(updates.tools)); }
        if (updates.toolPolicy   !== undefined) { fields.push('tool_policy = ?');   values.push(updates.toolPolicy); }
        if (updates.autoAddTools !== undefined) { fields.push('auto_add_tools = ?'); values.push(updates.autoAddTools ? 1 : 0); }
        if (updates.securityRole !== undefined) { fields.push('security_role = ?'); values.push(updates.securityRole); }
        if (updates.capabilities !== undefined) { fields.push('capabilities = ?'); values.push(JSON.stringify(updates.capabilities)); }
        if (updates.status       !== undefined) { fields.push('status = ?');        values.push(updates.status); }
        if (updates.overrideRoleRestrictions !== undefined) { fields.push('override_role_restrictions = ?'); values.push(updates.overrideRoleRestrictions ? 1 : 0); }

        if (fields.length > 0) {
            fields.push('updated_at = ?');
            values.push(new Date().toISOString());
            values.push(actualId); // use actual DB id — not the passed-in name string
            db.run('UPDATE agents SET ' + fields.join(', ') + ' WHERE id = ?', values);
        }

        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function deleteAgent(agentId) {
    try {
        // Guard: built-in agents cannot be deleted
        const nameKey = (agentId || '').toString();
        if (DEFAULT_AGENTS[nameKey] && DEFAULT_AGENTS[nameKey].builtIn) {
            return { success: false, error: 'Built-in agents cannot be deleted' };
        }
        if (db) {
            const check = db.query('SELECT id, built_in FROM agents WHERE id = ? OR name = ? LIMIT 1', [agentId, agentId]);
            if (check.success && check.results.length > 0 && check.results[0].built_in) {
                return { success: false, error: 'Built-in agents cannot be deleted' };
            }
            // Resolve the actual row id so the delete matches whether caller passed name or id
            const actualId = (check.success && check.results.length > 0) ? check.results[0].id : agentId;
            db.run('UPDATE agents SET status = ? WHERE id = ?', ['deleted', actualId]);
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function getAgent(agentId) {
    try {
        if (!db) return getDefaultAgent(agentId);
        
        const result = db.query('SELECT * FROM agents WHERE id = ? OR name = ?', [agentId, agentId]);
        if (!result.success || result.results.length === 0) {
            return getDefaultAgent(agentId);
        }
        
        return parseAgentRow(result.results[0]);
    } catch (e) {
        return getDefaultAgent(agentId);
    }
}

function getDefaultAgent(name) {
    return DEFAULT_AGENTS[name] || null;
}

function listAgents(includeProjectAgents = []) {
    try {
        let agents;
        if (!db) {
            // Return default agents if no database
            agents = Object.entries(DEFAULT_AGENTS).map(([name, agent]) => ({
                name,
                role: agent.role,
                description: agent.description,
                group: agent.group,
                languages: agent.languages,
                tools: agent.tools,
                autoAddTools: agent.autoAddTools,
                securityRole: agent.securityRole,
                capabilities: agent.capabilities,
                scope: 'global',
                builtIn: agent.builtIn || false,
                forcedTools: agent.forcedTools || [],
                blockedTools: agent.blockedTools || [],
                overrideRoleRestrictions: false,
                isDefault: true
            }));
        } else {
            const result = db.query('SELECT * FROM agents WHERE status != ? ORDER BY name', ['deleted']);
            agents = result.success ? result.results.map(parseAgentRow) : [];
        }

        // Merge project-scoped agents (deduplicate by name — project wins)
        if (includeProjectAgents && includeProjectAgents.length) {
            const projectNames = new Set(includeProjectAgents.map(a => a.name));
            agents = agents.filter(a => !projectNames.has(a.name));
            agents = agents.concat(includeProjectAgents.map(a => ({ ...a, scope: 'project' })));
        }

        return agents;
    } catch (e) {
        return [];
    }
}

function parseAgentRow(row) {
    return {
        id: row.id,
        name: row.name,
        role: row.role,
        description: row.description,
        instructions: row.instructions,
        group: row.group_id,
        languages: JSON.parse(row.languages || '[]'),
        tools: JSON.parse(row.tools || '[]'),
        toolPolicy: row.tool_policy,
        autoAddTools: !!row.auto_add_tools,
        securityRole: row.security_role,
        capabilities: JSON.parse(row.capabilities || '[]'),
        metadata: JSON.parse(row.metadata || '{}'),
        status: row.status,
        scope: row.scope || 'global',
        thinkingEnabled: !!row.thinking_enabled,
        thinkingBudget: row.thinking_budget || 0,
        builtIn: !!row.built_in,
        forcedTools: JSON.parse(row.forced_tools  || '[]'),
        blockedTools: JSON.parse(row.blocked_tools || '[]'),
        overrideRoleRestrictions: !!row.override_role_restrictions,
        isDefault: false
    };
}

// ==================== ROLE ENFORCEMENT ====================

/**
 * Check whether a tool is allowed for a given security role.
 * Uses the role's allowedCategories (matched against TOOL_TIER_REGISTRY)
 * and explicit blockedTools list.
 *
 * @param {string} toolName   - The tool being invoked
 * @param {string} role       - The agent's securityRole value
 * @param {object} agentConfig - The full agent config (may include overrideRoleRestrictions)
 * @returns {boolean} true if allowed
 */
function isToolAllowedForRole(toolName, role, agentConfig = {}) {
    const roleDef = SECURITY_ROLES[role];
    if (!roleDef) return true;  // unknown role → allow (fail-open during migration)

    // Per-agent override: if agent has override toggle enabled AND role allows it
    if (agentConfig.overrideRoleRestrictions && roleDef.canOverride) return true;

    // Explicit block list — always checked first
    if (roleDef.blockedTools.includes(toolName)) return false;

    // Wildcard: full-access (or any role with allowedCategories: ['*']) bypasses category check
    if (roleDef.allowedCategories.includes('*')) return true;

    // Category check: look up tool's category from TOOL_TIER_REGISTRY
    // The registry is loaded from agent-system-module at runtime via HUB
    const agentSystem = HUB ? HUB.getService('agentSystem') : null;
    const tierRegistry = agentSystem && agentSystem.TOOL_TIER_REGISTRY;
    if (tierRegistry) {
        const toolInfo = tierRegistry[toolName];
        if (toolInfo && toolInfo.category && !roleDef.allowedCategories.includes(toolInfo.category)) {
            return false;
        }
    }

    return true;
}

/**
 * Find an existing agent that is permitted to execute a given tool.
 * Used for delegation-on-block: when an agent's role blocks a tool,
 * we suggest an agent that CAN handle it.
 *
 * @param {string} toolName       - The tool to find a capable agent for
 * @param {string} excludeAgentId - Agent to exclude (the one that was blocked)
 * @returns {object|null} The first capable agent, or null
 */
function findCapableAgent(toolName, excludeAgentId) {
    const agents = listAgents();
    return agents.find(a =>
        a.name !== excludeAgentId &&
        Array.isArray(a.tools) && a.tools.includes(toolName) &&
        isToolAllowedForRole(toolName, a.securityRole, a)
    ) || null;
}

// ==================== GROUPS ====================

function createGroup(groupData) {
    if (!groupData.name) {
        return { success: false, error: 'Group name is required' };
    }

    // Enforce 2-level max hierarchy: subgroups cannot have children
    const parentId = groupData.parentId || null;
    if (parentId && db) {
        const parentRow = db.query('SELECT parent_id FROM agent_groups WHERE id = ?', [parentId]);
        if (parentRow.success && parentRow.results.length > 0 && parentRow.results[0].parent_id) {
            return { success: false, error: 'Maximum group depth is 2 levels. Cannot create a sub-sub-group.' };
        }
    }

    const id = groupData.id || ('group_' + Date.now().toString(36));

    try {
        if (db) {
            db.run(`
                INSERT INTO agent_groups (id, name, description, color, collaboration_mode, parent_id, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                id,
                groupData.name,
                groupData.description || '',
                groupData.color || '#58a6ff',
                groupData.collaborationMode || 'sequential',
                parentId,
                JSON.stringify(groupData.metadata || {})
            ]);
        }

        return { success: true, group: { id, parentId, ...groupData } };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function updateGroup(groupId, updates) {
    try {
        if (db) {
            // Enforce 2-level max if changing parentId
            if (updates.parentId !== undefined && updates.parentId !== null) {
                const parentRow = db.query('SELECT parent_id FROM agent_groups WHERE id = ?', [updates.parentId]);
                if (parentRow.success && parentRow.results.length > 0 && parentRow.results[0].parent_id) {
                    return { success: false, error: 'Maximum group depth is 2 levels. Cannot nest under a subgroup.' };
                }
                // Also check if this group has children — if so, it can't become a subgroup
                const children = db.query('SELECT COUNT(*) as count FROM agent_groups WHERE parent_id = ?', [groupId]);
                if (children.success && children.results[0].count > 0) {
                    return { success: false, error: 'This group has subgroups. Move or remove them first before nesting this group.' };
                }
            }

            const fields = [];
            const values = [];

            if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
            if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
            if (updates.color !== undefined) { fields.push('color = ?'); values.push(updates.color); }
            if (updates.collaborationMode !== undefined) { fields.push('collaboration_mode = ?'); values.push(updates.collaborationMode); }
            if (updates.parentId !== undefined) { fields.push('parent_id = ?'); values.push(updates.parentId); }

            if (fields.length > 0) {
                fields.push('updated_at = ?');
                values.push(new Date().toISOString());
                values.push(groupId);

                db.run('UPDATE agent_groups SET ' + fields.join(', ') + ' WHERE id = ?', values);
            }
        }

        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function deleteGroup(groupId) {
    try {
        if (db) {
            // If this is a root group with children, orphan the children (set parent_id = NULL)
            db.run('UPDATE agent_groups SET parent_id = NULL WHERE parent_id = ?', [groupId]);
            // Remove group assignment from agents
            db.run('UPDATE agents SET group_id = NULL WHERE group_id = ?', [groupId]);
            db.run('DELETE FROM agent_groups WHERE id = ?', [groupId]);
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function listGroups() {
    try {
        if (!db) return getDefaultGroups();

        // Order: roots first (parent_id IS NULL), then subgroups, alphabetical within each level
        const result = db.query('SELECT * FROM agent_groups ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, parent_id, name');
        if (!result.success) return getDefaultGroups();

        return result.results.map(row => ({
            id: row.id,
            name: row.name,
            description: row.description,
            color: row.color,
            collaborationMode: row.collaboration_mode,
            parentId: row.parent_id || null,
            metadata: JSON.parse(row.metadata || '{}')
        }));
    } catch (e) {
        return getDefaultGroups();
    }
}

function getDefaultGroups() {
    return [
        // Root groups
        { id: 'engineering', name: 'Engineering', description: 'Engineering teams', color: '#3fb950', collaborationMode: 'sequential', parentId: null },
        { id: 'quality-review', name: 'Quality & Review', description: 'Testing and review teams', color: '#58a6ff', collaborationMode: 'parallel', parentId: null },
        { id: 'operations', name: 'Operations', description: 'Operations and infrastructure', color: '#d29922', collaborationMode: 'parallel', parentId: null },
        { id: 'system', name: 'System', description: 'Core system agents (orchestrator, PM)', color: '#8b949e', collaborationMode: 'sequential', parentId: null },
        // Subgroups under Engineering
        { id: 'frontend', name: 'Frontend', description: 'Frontend development', color: '#3fb950', collaborationMode: 'sequential', parentId: 'engineering' },
        { id: 'backend', name: 'Backend', description: 'Backend development', color: '#3fb950', collaborationMode: 'sequential', parentId: 'engineering' },
        { id: 'devops', name: 'DevOps', description: 'DevOps and version control', color: '#f85149', collaborationMode: 'sequential', parentId: 'engineering' },
        // Subgroups under Quality & Review
        { id: 'testing', name: 'Testing', description: 'QA and testing team', color: '#58a6ff', collaborationMode: 'parallel', parentId: 'quality-review' },
        { id: 'code-review', name: 'Code Review', description: 'Code review team', color: '#58a6ff', collaborationMode: 'sequential', parentId: 'quality-review' },
        // Subgroups under Operations
        { id: 'security', name: 'Security', description: 'Security operations', color: '#d29922', collaborationMode: 'parallel', parentId: 'operations' },
        { id: 'infrastructure', name: 'Infrastructure', description: 'Infrastructure management', color: '#d29922', collaborationMode: 'sequential', parentId: 'operations' }
    ];
}

function addAgentToGroup(agentId, groupId) {
    try {
        if (db) {
            // Match by id OR name — default agents may not have a UUID,
            // so the client sends the agent name as the identifier.
            db.run('UPDATE agents SET group_id = ? WHERE id = ? OR name = ?', [groupId, agentId, agentId]);
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function removeAgentFromGroup(agentId) {
    try {
        if (db) {
            // Match by id OR name for the same reason as addAgentToGroup
            db.run('UPDATE agents SET group_id = NULL WHERE id = ? OR name = ?', [agentId, agentId]);
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ==================== TOOL PERMISSIONS ====================

function setToolPermissions(agentId, toolPermissions) {
    try {
        if (!db) return { success: false, error: 'Database not available' };
        
        // Clear existing permissions
        db.run('DELETE FROM agent_tool_permissions WHERE agent_id = ?', [agentId]);
        
        // Add new permissions
        for (const [tool, action] of Object.entries(toolPermissions)) {
            db.run(`
                INSERT INTO agent_tool_permissions (id, agent_id, tool_name, action)
                VALUES (?, ?, ?, ?)
            `, [generateId(), agentId, tool, action]);
        }
        
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function getToolPermissions(agentId) {
    try {
        if (!db) return {};
        
        const result = db.query('SELECT tool_name, action FROM agent_tool_permissions WHERE agent_id = ?', [agentId]);
        if (!result.success) return {};
        
        const perms = {};
        for (const row of result.results) {
            perms[row.tool_name] = row.action;
        }
        return perms;
    } catch (e) {
        return {};
    }
}

function getAllowedTools(agentId) {
    const agent = getAgent(agentId);
    if (!agent) return [];
    
    // If agent has explicit tools list, return those
    if (agent.tools && agent.tools.length > 0) {
        return agent.tools;
    }
    
    // If auto-add is enabled, return all tools
    if (agent.autoAddTools) {
        return getAllTools();
    }
    
    // Return default safe tools
    return ['read_file', 'list_dir', 'system_info', 'web_search'];
}

function getAllTools() {
    // Dynamic: pull from the live tools service (static + dynamic tools)
    if (HUB) {
        const svc = HUB.getService('tools');
        if (svc && svc.getDefinitions) {
            return svc.getDefinitions().map(t => t.name);
        }
    }
    // Fallback to hardcoded categories if tools service unavailable
    const tools = [];
    for (const category of Object.values(TOOL_CATEGORIES)) {
        tools.push(...category);
    }
    return [...new Set(tools)];
}

// ==================== COLLABORATION ====================

const activeCollaborations = new Map();

function startCollaboration(participants, options = {}) {
    const id = 'collab_' + Date.now().toString(36);
    
    const collaboration = {
        id,
        name: options.name || 'Collaboration Session',
        participants: participants, // Array of agent names
        status: 'active',
        startedAt: new Date().toISOString(),
        mode: options.mode || 'sequential', // sequential or parallel
        currentIndex: 0
    };
    
    activeCollaborations.set(id, collaboration);
    
    try {
        if (db) {
            db.run(`
                INSERT INTO agent_collaborations (id, name, participants, status, metadata)
                VALUES (?, ?, ?, ?, ?)
            `, [
                id,
                collaboration.name,
                JSON.stringify(participants),
                'active',
                JSON.stringify(options)
            ]);
        }
    } catch (e) {}
    
    return { success: true, collaboration };
}

function endCollaboration(collabId) {
    const collab = activeCollaborations.get(collabId);
    if (collab) {
        collab.status = 'ended';
        collab.endedAt = new Date().toISOString();
    }
    
    try {
        if (db) {
            db.run('UPDATE agent_collaborations SET status = ?, ended_at = ? WHERE id = ?', 
                ['ended', new Date().toISOString(), collabId]);
        }
    } catch (e) {}
    
    return { success: true };
}

function getActiveCollaborations() {
    return Array.from(activeCollaborations.values()).filter(c => c.status === 'active');
}

// ==================== MEETING NOTES ====================

function saveMeetingNotes(roomId, notes) {
    if (!db) return { success: false, error: 'Database not available' };
    try {
        const id = `meeting_${roomId}_${Date.now()}`;
        db.run(`
            INSERT OR REPLACE INTO meeting_notes (id, room_id, title, date, duration, participants, summary, key_decisions, raid, action_items, next_steps, transcript)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id, roomId,
            notes.title || '',
            notes.date || new Date().toISOString(),
            notes.duration || '',
            JSON.stringify(notes.participants || []),
            notes.summary || '',
            JSON.stringify(notes.keyDecisions || []),
            JSON.stringify(notes.raid || {}),
            JSON.stringify(notes.actionItems || []),
            JSON.stringify(notes.nextSteps || []),
            notes.transcript || ''
        ]);
        HUB?.log(`📋 Meeting notes saved for room ${roomId}`, 'info');
        return { success: true, id };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function listMeetingNotes(limit = 50) {
    if (!db) return [];
    try {
        const result = db.query(
            `SELECT id, room_id, title, date, duration, participants, summary, key_decisions, raid, action_items, next_steps, created_at
             FROM meeting_notes ORDER BY created_at DESC LIMIT ?`, [limit]
        );
        if (!result.success) return [];
        return (result.results || []).map(row => ({
            ...row,
            participants: JSON.parse(row.participants || '[]'),
            keyDecisions: JSON.parse(row.key_decisions || '[]'),
            raid: JSON.parse(row.raid || '{}'),
            actionItems: JSON.parse(row.action_items || '[]'),
            nextSteps: JSON.parse(row.next_steps || '[]')
        }));
    } catch (_) {
        return [];
    }
}

function getMeetingNotes(noteId) {
    if (!db) return null;
    try {
        const result = db.query(`SELECT * FROM meeting_notes WHERE id = ?`, [noteId]);
        if (!result.success || !result.results?.length) return null;
        const row = result.results[0];
        return {
            ...row,
            participants: JSON.parse(row.participants || '[]'),
            keyDecisions: JSON.parse(row.key_decisions || '[]'),
            raid: JSON.parse(row.raid || '{}'),
            actionItems: JSON.parse(row.action_items || '[]'),
            nextSteps: JSON.parse(row.next_steps || '[]')
        };
    } catch (_) {
        return null;
    }
}

// ==================== EXPORTS ====================

module.exports = {
    init,
    // CRUD
    createAgent,
    updateAgent,
    deleteAgent,
    getAgent,
    listAgents,
    // Groups
    createGroup,
    updateGroup,
    deleteGroup,
    listGroups,
    addAgentToGroup,
    removeAgentFromGroup,
    // Tool permissions
    setToolPermissions,
    getToolPermissions,
    getAllowedTools,
    // Collaboration
    startCollaboration,
    endCollaboration,
    getActiveCollaborations,
    // Meeting notes
    saveMeetingNotes,
    listMeetingNotes,
    getMeetingNotes,
    // Constants
    TOOL_CATEGORIES,
    PROGRAMMING_LANGUAGES,
    SECURITY_ROLES,
    DEFAULT_AGENTS
};
