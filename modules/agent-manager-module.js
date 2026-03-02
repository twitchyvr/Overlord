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
    ai: ['web_search', 'understand_image'],
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

// Security roles hierarchy
const SECURITY_ROLES = {
    'ciso': {
        name: 'CISO',
        description: 'Chief Information Security Officer - Full system access, all security operations',
        permissions: ['*']
    },
    'security-lead': {
        name: 'Security Lead',
        description: 'Security team lead - Vulnerability assessment, security reviews',
        permissions: ['security:audit', 'security:review', 'security:scan', 'qa:full']
    },
    'security-analyst': {
        name: 'Security Analyst',
        description: 'Security operations - Monitoring, incident response',
        permissions: ['security:monitor', 'security:logs', 'qa:run']
    },
    'security-aware': {
        name: 'Security Aware',
        description: 'Security-conscious developer - Follows security best practices',
        permissions: ['code:read', 'code:write', 'security:best-practices']
    },
    'developer': {
        name: 'Developer',
        description: 'Standard developer - Code implementation',
        permissions: ['code:read', 'code:write', 'qa:run']
    },
    'readonly': {
        name: 'Read Only',
        description: 'View-only access - Read files, view logs',
        permissions: ['code:read', 'read-only']
    }
};

// Default agent templates
const DEFAULT_AGENTS = {
    // ==================== ENGINEERING - DEVELOPMENT ====================
    'frontend-developer': {
        name: 'frontend-developer',
        role: 'Frontend Developer',
        description: 'Specializes in building user-facing applications and interfaces using modern frontend frameworks. Implements responsive, accessible, and performant web components following best practices and design patterns.',
        group: 'Engineering',
        languages: ['JavaScript', 'TypeScript', 'HTML', 'CSS', 'React', 'Vue', 'Angular'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'understand_image'],
        autoAddTools: true,
        securityRole: 'developer',
        capabilities: ['html', 'css', 'javascript', 'typescript', 'react', 'vue', 'angular', 'responsive-design', 'frontend-optimization', 'cross-browser', 'accessibility', 'web-performance', 'progressive-web-apps']
    },
    'backend-developer': {
        name: 'backend-developer',
        role: 'Backend Developer',
        description: 'Focuses on server-side logic, APIs, database management, and system integration. Builds robust, scalable, and secure backend services using appropriate frameworks and technologies.',
        group: 'Engineering',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'SQL'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash'],
        autoAddTools: true,
        securityRole: 'developer',
        capabilities: ['nodejs', 'python', 'java', 'go', 'rust', 'sql', 'nosql', 'api-design', 'microservices', 'server-optimization', 'security', 'caching']
    },
    'principal-engineer': {
        name: 'principal-engineer',
        role: 'Principal Engineer',
        description: 'Senior technical leader responsible for architectural decisions, mentoring engineers, and driving technical strategy across multiple teams and projects.',
        group: 'Engineering',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Go', 'Rust'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'git_diff'],
        autoAddTools: false,
        securityRole: 'developer',
        capabilities: ['architecture', 'system-design', 'technical-leadership', 'mentoring', 'code-review', 'standards', 'innovation', 'strategic-planning']
    },
    'development-coordinator': {
        name: 'development-coordinator',
        role: 'Development Coordinator',
        description: 'Coordinates development activities across teams, manages technical dependencies, and ensures smooth execution of development tasks and sprints.',
        group: 'Engineering',
        languages: ['English'],
        tools: ['read_file', 'write_file', 'list_dir', 'bash'],
        autoAddTools: false,
        securityRole: 'readonly',
        capabilities: ['project-coordination', 'resource-management', 'dependency-tracking', 'communication', 'timeline-management', 'risk-management', 'stakeholder-management']
    },

    // ==================== ENGINEERING - LEADERSHIP ====================
    'frontend-lead': {
        name: 'frontend-lead',
        role: 'Frontend Lead',
        description: 'Leads frontend development teams, establishes coding standards, ensures quality code delivery, and mentors junior frontend developers.',
        group: 'Engineering',
        languages: ['JavaScript', 'TypeScript', 'HTML', 'CSS', 'React', 'Vue'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'git_diff', 'understand_image'],
        autoAddTools: false,
        securityRole: 'developer',
        capabilities: ['frontend-architecture', 'team-leadership', 'code-quality', 'performance-optimization', 'design-systems', 'accessibility', 'cross-functional-collaboration']
    },
    'backend-lead': {
        name: 'backend-lead',
        role: 'Backend Lead',
        description: 'Leads backend development efforts, designs scalable server architectures, and ensures robust API design and database optimization.',
        group: 'Engineering',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Go', 'Rust', 'SQL'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'git_diff'],
        autoAddTools: false,
        securityRole: 'developer',
        capabilities: ['backend-architecture', 'api-design', 'database-optimization', 'team-leadership', 'security', 'scalability', 'microservices']
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
        securityRole: 'developer',
        capabilities: ['test-planning', 'test-automation', 'manual-testing', 'regression-testing', 'performance-testing', 'security-testing', 'bug-tracking', 'quality-assurance']
    },
    'qa-lead': {
        name: 'qa-lead',
        role: 'QA Lead',
        description: 'Leads QA team, develops testing strategies, implements quality processes, and ensures overall product quality across all releases.',
        group: 'QA',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Java'],
        tools: ['qa_run_tests', 'qa_check_lint', 'qa_check_types', 'qa_check_coverage', 'read_file', 'write_file', 'list_dir', 'bash'],
        autoAddTools: false,
        securityRole: 'developer',
        capabilities: ['test-strategy', 'team-leadership', 'quality-management', 'process-improvement', 'test-automation', 'risk-assessment', 'stakeholder-coordination']
    },
    'test-strategy-architect': {
        name: 'test-strategy-architect',
        role: 'Test Strategy Architect',
        description: 'Designs comprehensive testing strategies and frameworks. Defines testing methodologies, tools, and best practices across the organization.',
        group: 'QA',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Java'],
        tools: ['qa_run_tests', 'qa_check_lint', 'qa_check_types', 'qa_check_coverage', 'read_file', 'write_file', 'list_dir', 'bash'],
        autoAddTools: false,
        securityRole: 'developer',
        capabilities: ['test-architecture', 'strategy-design', 'test-automation-frameworks', 'ci-cd-integration', 'quality-metrics', 'risk-based-testing', 'tool-evaluation']
    },
    'deployment-verification-agent': {
        name: 'deployment-verification-agent',
        role: 'Deployment Verification Agent',
        description: 'Verifies deployments across environments, runs smoke tests, validates configurations, and ensures smooth production releases.',
        group: 'QA',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Bash'],
        tools: ['qa_run_tests', 'read_file', 'write_file', 'list_dir', 'bash'],
        autoAddTools: true,
        securityRole: 'developer',
        capabilities: ['deployment-validation', 'smoke-testing', 'environment-verification', 'rollback-procedures', 'monitoring', 'incident-response']
    },

    // ==================== DEVOPS & INFRASTRUCTURE ====================
    'devops-engineer': {
        name: 'devops-engineer',
        role: 'DevOps Engineer',
        description: 'Implements and maintains CI/CD pipelines, manages infrastructure as code, and ensures reliable deployment and operations.',
        group: 'DevOps',
        languages: ['Bash', 'Python', 'JavaScript', 'TypeScript', 'YAML'],
        tools: ['bash', 'read_file', 'write_file', 'list_dir', 'git_diff'],
        autoAddTools: true,
        securityRole: 'developer',
        capabilities: ['ci-cd', 'infrastructure-as-code', 'containerization', 'orchestration', 'monitoring', 'logging', 'automation', 'cloud-infrastructure']
    },
    'devops-lead': {
        name: 'devops-lead',
        role: 'DevOps Lead',
        description: 'Leads DevOps initiatives, establishes best practices, manages infrastructure strategy, and drives automation across the organization.',
        group: 'DevOps',
        languages: ['Bash', 'Python', 'JavaScript', 'TypeScript', 'YAML'],
        tools: ['bash', 'read_file', 'write_file', 'list_dir', 'git_diff'],
        autoAddTools: false,
        securityRole: 'developer',
        capabilities: ['devops-strategy', 'team-leadership', 'cloud-architecture', 'cost-optimization', 'security-compliance', 'tooling', 'process-improvement']
    },
    'gitops-specialist': {
        name: 'gitops-specialist',
        role: 'GitOps Specialist',
        description: 'Implements GitOps workflows, manages declarative infrastructure, and ensures version-controlled deployment processes.',
        group: 'DevOps',
        languages: ['Bash', 'YAML', 'Python', 'Go'],
        tools: ['bash', 'read_file', 'write_file', 'list_dir', 'git_diff', 'github'],
        autoAddTools: true,
        securityRole: 'developer',
        capabilities: ['gitops', 'argocd', 'flux', 'helm', 'kubernetes', 'git-workflows', 'infrastructure-as-code', 'drift-detection']
    },
    'deployment-orchestrator': {
        name: 'deployment-orchestrator',
        role: 'Deployment Orchestrator',
        description: 'Coordinates complex deployments across multiple environments, manages release schedules, and ensures zero-downtime releases.',
        group: 'DevOps',
        languages: ['Bash', 'Python', 'YAML', 'JavaScript'],
        tools: ['bash', 'read_file', 'write_file', 'list_dir', 'git_diff'],
        autoAddTools: false,
        securityRole: 'developer',
        capabilities: ['deployment-strategy', 'release-management', 'rollback-automation', 'feature-flags', 'environment-management', 'coordination']
    },
    'system-maintenance-coordinator': {
        name: 'system-maintenance-coordinator',
        role: 'System Maintenance Coordinator',
        description: 'Schedules and coordinates system maintenance windows, manages patches, updates, and ensures system health and compliance.',
        group: 'DevOps',
        languages: ['Bash', 'Python', 'YAML'],
        tools: ['bash', 'read_file', 'write_file', 'list_dir'],
        autoAddTools: false,
        securityRole: 'developer',
        capabilities: ['maintenance-planning', 'patch-management', 'system-monitoring', 'incident-coordination', 'compliance', 'documentation']
    },

    // ==================== ARCHITECTURE & DESIGN ====================
    'system-architect': {
        name: 'system-architect',
        role: 'System Architect',
        description: 'Designs overall system architecture, defines technical standards, and ensures scalability, performance, and reliability of solutions.',
        group: 'Architecture',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Go', 'Rust', 'SQL'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'git_diff'],
        autoAddTools: false,
        securityRole: 'developer',
        capabilities: ['system-design', 'architecture-patterns', 'scalability', 'performance', 'security', 'technology-selection', 'integration-design']
    },
    'enterprise-solutions-architect': {
        name: 'enterprise-solutions-architect',
        role: 'Enterprise Solutions Architect',
        description: 'Designs enterprise-level solutions, creates architectural blueprints, and ensures alignment with business objectives and technical standards.',
        group: 'Architecture',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Java', 'Go'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash', 'git_diff'],
        autoAddTools: false,
        securityRole: 'developer',
        capabilities: ['enterprise-architecture', 'solution-design', 'business-alignment', 'technology-roadmapping', 'architecture-governance', 'risk-assessment']
    },
    'enterprise-solutions-engineer': {
        name: 'enterprise-solutions-engineer',
        role: 'Enterprise Solutions Engineer',
        description: 'Implements and maintains enterprise-level systems, integrates disparate systems, and ensures seamless data flow across the organization.',
        group: 'Architecture',
        languages: ['Java', 'Python', 'JavaScript', 'TypeScript', 'SQL'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash'],
        autoAddTools: false,
        securityRole: 'developer',
        capabilities: ['enterprise-integration', 'system-integration', 'api-gateway', 'data-pipelines', 'workflow-automation', 'enterprise-security']
    },
    'architecture-coordinator': {
        name: 'architecture-coordinator',
        role: 'Architecture Coordinator',
        description: 'Coordinates architectural activities across teams, manages architectural debt, and ensures consistent implementation of architectural decisions.',
        group: 'Architecture',
        languages: ['English'],
        tools: ['read_file', 'write_file', 'list_dir', 'bash'],
        autoAddTools: false,
        securityRole: 'readonly',
        capabilities: ['architecture-governance', 'coordination', 'documentation', 'standards-enforcement', 'technical-debt-management', 'stakeholder-communication']
    },

    // ==================== UI/UX DESIGN ====================
    'ui-designer': {
        name: 'ui-designer',
        role: 'UI Designer',
        description: 'Creates visually appealing user interfaces, designs layouts, components, and ensures consistency with brand guidelines and design systems.',
        group: 'Design',
        languages: ['HTML', 'CSS', 'JavaScript', 'SCSS'],
        tools: ['read_file', 'write_file', 'patch_file', 'understand_image', 'list_dir'],
        autoAddTools: true,
        securityRole: 'developer',
        capabilities: ['ui-design', 'visual-design', 'prototyping', 'design-systems', 'responsive-design', 'typography', 'color-theory', 'iconography']
    },
    'ux-interface-designer': {
        name: 'ux-interface-designer',
        role: 'UX Interface Designer',
        description: 'Designs intuitive user interfaces with focus on user experience, creates wireframes, prototypes, and conducts user research.',
        group: 'Design',
        languages: ['HTML', 'CSS', 'JavaScript'],
        tools: ['read_file', 'write_file', 'patch_file', 'understand_image', 'list_dir'],
        autoAddTools: true,
        securityRole: 'developer',
        capabilities: ['ux-design', 'user-research', 'wireframing', 'prototyping', 'usability-testing', 'information-architecture', 'interaction-design']
    },

    // ==================== DATA & ANALYTICS ====================
    'data-engineer': {
        name: 'data-engineer',
        role: 'Data Engineer',
        description: 'Builds and maintains data pipelines, manages data infrastructure, and ensures data quality and accessibility for analytics.',
        group: 'Data',
        languages: ['Python', 'SQL', 'Java', 'Scala', 'Bash'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash'],
        autoAddTools: true,
        securityRole: 'developer',
        capabilities: ['data-pipelines', 'etl', 'data-warehousing', 'big-data', 'sql', 'python', 'spark', 'data-quality', 'data-modeling']
    },
    'data-scientist': {
        name: 'data-scientist',
        role: 'Data Scientist',
        description: 'Analyzes complex datasets, builds predictive models, and derives insights to drive data-informed decision making.',
        group: 'Data',
        languages: ['Python', 'R', 'SQL', 'Julia'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash'],
        autoAddTools: true,
        securityRole: 'developer',
        capabilities: ['machine-learning', 'statistical-analysis', 'data-visualization', 'python', 'r', 'deep-learning', 'nlp', 'predictive-modeling']
    },

    // ==================== PRODUCT & PROJECT MANAGEMENT ====================
    'product-manager': {
        name: 'product-manager',
        role: 'Product Manager',
        description: 'Defines product vision, manages roadmap, prioritizes features, and works with stakeholders to deliver successful products.',
        group: 'Product',
        languages: ['English'],
        tools: ['read_file', 'write_file', 'list_dir'],
        autoAddTools: false,
        securityRole: 'readonly',
        capabilities: ['product-strategy', 'roadmap-management', 'stakeholder-management', 'user-research', 'prioritization', 'agile', 'market-analysis']
    },
    'business-analyst': {
        name: 'business-analyst',
        role: 'Business Analyst',
        description: 'Analyzes business requirements, bridges gap between business and technical teams, and ensures solutions meet business objectives.',
        group: 'Product',
        languages: ['English'],
        tools: ['read_file', 'write_file', 'list_dir'],
        autoAddTools: false,
        securityRole: 'readonly',
        capabilities: ['requirements-analysis', 'business-process-modeling', 'data-analysis', 'stakeholder-communication', 'use-cases', 'functional-specs']
    },
    'project-manager': {
        name: 'project-manager',
        role: 'Project Manager',
        description: 'Manages projects from initiation to completion, coordinates resources, manages timelines, and ensures successful delivery.',
        group: 'Product',
        languages: ['English'],
        tools: ['read_file', 'write_file', 'list_dir', 'bash'],
        autoAddTools: false,
        securityRole: 'readonly',
        capabilities: ['project-planning', 'resource-management', 'risk-management', 'stakeholder-management', 'budget-tracking', 'timeline-management', 'reporting']
    },
    'project-initializer': {
        name: 'project-initializer',
        role: 'Project Initializer',
        description: 'Sets up new projects, defines initial structure, establishes workflows, and creates foundation for successful project execution.',
        group: 'Product',
        languages: ['English', 'JavaScript', 'TypeScript'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash'],
        autoAddTools: false,
        securityRole: 'developer',
        capabilities: ['project-setup', 'template-creation', 'workflow-definition', 'tooling-setup', 'team-onboarding', 'governance-setup']
    },

    // ==================== AGILE & PROCESS ====================
    'scrum-master': {
        name: 'scrum-master',
        role: 'Scrum Master',
        description: 'Facilitates Scrum ceremonies, removes impediments, coaches team on Agile practices, and ensures process adherence.',
        group: 'Agile',
        languages: ['English'],
        tools: ['read_file', 'write_file', 'list_dir'],
        autoAddTools: false,
        securityRole: 'readonly',
        capabilities: ['scrum', 'facilitation', 'coaching', 'impediment-removal', 'ceremony-facilitation', 'continuous-improvement', 'conflict-resolution']
    },
    'sprint-planner': {
        name: 'sprint-planner',
        role: 'Sprint Planner',
        description: 'Plans sprint activities, estimates work, defines sprint goals, and ensures realistic sprint commitments.',
        group: 'Agile',
        languages: ['English'],
        tools: ['read_file', 'write_file', 'list_dir'],
        autoAddTools: false,
        securityRole: 'readonly',
        capabilities: ['sprint-planning', 'estimation', 'velocity-tracking', 'capacity-planning', 'goal-setting', 'prioritization']
    },
    'sprint-retrospective-facilitator': {
        name: 'sprint-retrospective-facilitator',
        role: 'Sprint Retrospective Facilitator',
        description: 'Leads sprint retrospectives, identifies improvements, and drives continuous process enhancement within teams.',
        group: 'Agile',
        languages: ['English'],
        tools: ['read_file', 'write_file', 'list_dir'],
        autoAddTools: false,
        securityRole: 'readonly',
        capabilities: ['retrospective-facilitation', 'process-improvement', 'team-coaching', 'feedback-analysis', 'action-tracking', 'change-management']
    },
    'agile-workflow-orchestrator': {
        name: 'agile-workflow-orchestrator',
        role: 'Agile Workflow Orchestrator',
        description: 'Orchestrates Agile workflows across multiple teams, ensures alignment, and optimizes delivery processes.',
        group: 'Agile',
        languages: ['English'],
        tools: ['read_file', 'write_file', 'list_dir', 'bash'],
        autoAddTools: false,
        securityRole: 'readonly',
        capabilities: ['workflow-orchestration', 'cross-team-coordination', 'agile-coaching', 'process-optimization', 'dependency-management', 'delivery-tracking']
    },

    // ==================== SECURITY & COMPLIANCE ====================
    'security-compliance-officer': {
        name: 'security-compliance-officer',
        role: 'Security Compliance Officer',
        description: 'Ensures compliance with security standards and regulations, conducts audits, and implements security policies.',
        group: 'Security',
        languages: ['English'],
        tools: ['read_file', 'write_file', 'list_dir', 'bash'],
        autoAddTools: false,
        securityRole: 'developer',
        capabilities: ['security-compliance', 'audit', 'risk-assessment', 'policy-development', 'regulatory-compliance', 'security-frameworks', 'incident-response']
    },
    'workflow-termination-coordinator': {
        name: 'workflow-termination-coordinator',
        role: 'Workflow Termination Coordinator',
        description: 'Manages graceful termination of workflows and processes, ensures clean shutdowns, and handles cleanup operations.',
        group: 'Security',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Bash'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash'],
        autoAddTools: false,
        securityRole: 'developer',
        capabilities: ['workflow-management', 'process-termination', 'cleanup-automation', 'resource-release', 'state-management', 'error-handling']
    },

    // ==================== DOCUMENTATION ====================
    'documentation-strategist': {
        name: 'documentation-strategist',
        role: 'Documentation Strategist',
        description: 'Develops documentation strategy, establishes standards, and ensures comprehensive and maintainable documentation.',
        group: 'Documentation',
        languages: ['English', 'Markdown'],
        tools: ['read_file', 'write_file', 'list_dir'],
        autoAddTools: false,
        securityRole: 'readonly',
        capabilities: ['documentation-strategy', 'content-architecture', 'knowledge-management', 'technical-writing', 'api-documentation', 'style-guides']
    },
    'documentation-technician': {
        name: 'documentation-technician',
        role: 'Documentation Technician',
        description: 'Creates and maintains technical documentation, API docs, user guides, and ensures documentation stays up to date.',
        group: 'Documentation',
        languages: ['English', 'Markdown'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir'],
        autoAddTools: true,
        securityRole: 'developer',
        capabilities: ['technical-writing', 'api-documentation', 'user-guides', 'markdown', 'documentation-tools', 'content-updates']
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
        securityRole: 'developer',
        capabilities: ['git', 'github', 'version-control']
    },
    'testing-engineer': {
        name: 'testing-engineer',
        role: 'QA & Testing Specialist',
        description: 'Runs tests, linting, type checking, and code quality checks.',
        group: 'quality-assurance',
        languages: ['JavaScript', 'TypeScript', 'Python'],
        tools: ['qa_run_tests', 'qa_check_lint', 'qa_check_types', 'qa_check_coverage', 'qa_audit_deps'],
        autoAddTools: true,
        securityRole: 'developer',
        capabilities: ['testing', 'linting', 'quality-assurance', 'coverage']
    },
    'code-implementer': {
        name: 'code-implementer',
        role: 'Code Implementation Specialist',
        description: 'Implements features, creates files, and modifies code based on requirements.',
        group: 'development',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Go', 'Rust'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'bash'],
        autoAddTools: true,
        securityRole: 'developer',
        capabilities: ['coding', 'file-operations', 'implementation']
    },
    'ui-expert': {
        name: 'ui-expert',
        role: 'UI/UX Design Specialist',
        description: 'Expert at developing high quality working polished UI and UX. Creates beautiful, functional, accessible interfaces with modern design principles.',
        group: 'development',
        languages: ['JavaScript', 'TypeScript', 'HTML', 'CSS', 'SCSS'],
        tools: ['read_file', 'write_file', 'patch_file', 'list_dir', 'understand_image'],
        autoAddTools: true,
        securityRole: 'developer',
        capabilities: ['ui-design', 'ux-design', 'css', 'html', 'accessibility', 'responsive-design', 'animation', 'visual-design']
    },
    'ui-tester': {
        name: 'ui-tester',
        role: 'UI Testing Specialist',
        description: 'Specializes in testing UI components, visual regression testing, accessibility testing, and ensuring pixel-perfect implementations.',
        group: 'quality-assurance',
        languages: ['JavaScript', 'TypeScript', 'Python'],
        tools: ['qa_run_tests', 'qa_check_lint', 'understand_image', 'read_file'],
        autoAddTools: true,
        securityRole: 'developer',
        capabilities: ['ui-testing', 'visual-testing', 'accessibility-testing', 'e2e-testing', 'regression-testing']
    },
    'regex-expert': {
        name: 'regex-expert',
        role: 'Regular Expression Specialist',
        description: 'Expert at creating, testing, and debugging regular expressions. Handles complex pattern matching, text processing, and validation.',
        group: 'development',
        languages: ['JavaScript', 'TypeScript', 'Python', 'Bash'],
        tools: ['read_file', 'write_file', 'bash'],
        autoAddTools: true,
        securityRole: 'developer',
        capabilities: ['regex', 'pattern-matching', 'text-processing', 'validation', 'parsing']
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
        
        // Constants
        TOOL_CATEGORIES: TOOL_CATEGORIES,
        PROGRAMMING_LANGUAGES: PROGRAMMING_LANGUAGES,
        SECURITY_ROLES: SECURITY_ROLES,
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
                security_role TEXT DEFAULT 'developer',
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
        
        // Agent groups table
        db.run(`
            CREATE TABLE IF NOT EXISTS agent_groups (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                description TEXT,
                color TEXT,
                collaboration_mode TEXT DEFAULT 'sequential',
                metadata TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
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
        
        HUB?.log('📊 Agent Manager tables initialized', 'info');
    } catch (e) {
        HUB?.log('⚠️ Agent table init error: ' + e.message, 'warn');
    }
}

function initializeDefaultAgents() {
    if (!db) return;

    try {
        const existing = db.query('SELECT COUNT(*) as count FROM agents');
        if (existing.success && existing.results[0].count === 0) {
            // Insert default agents
            for (const [name, agent] of Object.entries(DEFAULT_AGENTS)) {
                createAgent({
                    name: name,
                    role: agent.role,
                    description: agent.description,
                    group: agent.group,
                    languages: agent.languages,
                    tools: agent.tools,
                    autoAddTools: agent.autoAddTools,
                    securityRole: agent.securityRole,
                    capabilities: agent.capabilities
                });
            }
            HUB?.log('✅ Default agents initialized', 'info');
        }
    } catch (e) {
        HUB?.log('⚠️ Default agents init error: ' + e.message, 'warn');
    }

    // Seed default groups if none exist
    try {
        const existing = db.query('SELECT COUNT(*) as count FROM agent_groups');
        if (existing.success && existing.results[0].count === 0) {
            for (const g of getDefaultGroups()) {
                db.run(
                    'INSERT OR IGNORE INTO agent_groups (id, name, description, color, collaboration_mode, metadata) VALUES (?, ?, ?, ?, ?, ?)',
                    [g.id, g.name, g.description, g.color, g.collaborationMode, '{}']
                );
            }
            HUB?.log('✅ Default groups initialized', 'info');
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
                INSERT INTO agents (id, name, role, description, instructions, group_id, languages, tools, tool_policy, auto_add_tools, security_role, capabilities, metadata, status, scope, thinking_enabled, thinking_budget, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                agentData.securityRole || 'developer',
                JSON.stringify(agentData.capabilities || []),
                JSON.stringify(agentData.metadata || {}),
                'active',
                'global',
                agentData.thinkingEnabled ? 1 : 0,
                // radix parameter added for strict lint compliance (ESLint rule radix)
                parseInt(agentData.thinkingBudget, 10) || 0,
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
        if (!db) return { success: true }; // No DB — graceful no-op

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
            db.run(`
                INSERT INTO agents
                    (id, name, role, description, instructions, group_id, languages, tools, tool_policy,
                     auto_add_tools, security_role, capabilities, metadata, status, scope,
                     thinking_enabled, thinking_budget, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                newId, safeName,
                merged.role        || '',
                merged.description || '',
                merged.instructions || '',
                merged.group       || null,
                JSON.stringify(merged.languages   || []),
                JSON.stringify(merged.tools       || []),
                merged.toolPolicy  || 'allowlist',
                merged.autoAddTools !== false ? 1 : 0,
                merged.securityRole || 'developer',
                JSON.stringify(merged.capabilities || []),
                JSON.stringify(merged.metadata    || {}),
                'active', 'global',
                merged.thinkingEnabled ? 1 : 0,
                parseInt(merged.thinkingBudget, 10) || 0,
                now, now
            ]);
            return { success: true, id: newId, created: true };
        }

        // ── Agent exists — UPDATE using the real DB id (passed-in agentId may be a name)
        const actualId = existingResult.results[0].id;
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
        if (db) {
            db.run('UPDATE agents SET status = ? WHERE id = ?', ['deleted', agentId]);
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
        isDefault: false
    };
}

// ==================== GROUPS ====================

function createGroup(groupData) {
    if (!groupData.name) {
        return { success: false, error: 'Group name is required' };
    }
    
    const id = 'group_' + Date.now().toString(36);
    
    try {
        if (db) {
            db.run(`
                INSERT INTO agent_groups (id, name, description, color, collaboration_mode, metadata)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                id,
                groupData.name,
                groupData.description || '',
                groupData.color || '#58a6ff',
                groupData.collaborationMode || 'sequential',
                JSON.stringify(groupData.metadata || {})
            ]);
        }
        
        return { success: true, group: { id, ...groupData } };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function updateGroup(groupId, updates) {
    try {
        if (db) {
            const fields = [];
            const values = [];
            
            if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
            if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
            if (updates.color !== undefined) { fields.push('color = ?'); values.push(updates.color); }
            if (updates.collaborationMode !== undefined) { fields.push('collaboration_mode = ?'); values.push(updates.collaborationMode); }
            
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
            // Remove group from agents first
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
        
        const result = db.query('SELECT * FROM agent_groups ORDER BY name');
        if (!result.success) return getDefaultGroups();
        
        return result.results.map(row => ({
            id: row.id,
            name: row.name,
            description: row.description,
            color: row.color,
            collaborationMode: row.collaboration_mode,
            metadata: JSON.parse(row.metadata || '{}')
        }));
    } catch (e) {
        return getDefaultGroups();
    }
}

function getDefaultGroups() {
    return [
        { id: 'development', name: 'Development', description: 'Code development team', color: '#3fb950', collaborationMode: 'sequential' },
        { id: 'quality-assurance', name: 'Quality Assurance', description: 'Testing and QA team', color: '#58a6ff', collaborationMode: 'parallel' },
        { id: 'version-control', name: 'Version Control', description: 'Git operations team', color: '#f85149', collaborationMode: 'sequential' },
        { id: 'security', name: 'Security', description: 'Security operations', color: '#d29922', collaborationMode: 'parallel' }
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
    // Constants
    TOOL_CATEGORIES,
    PROGRAMMING_LANGUAGES,
    SECURITY_ROLES,
    DEFAULT_AGENTS
};
