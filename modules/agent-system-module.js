// ==================== AGENT SYSTEM MODULE ====================
// Complete agent execution system with tiered approval
// Based on docs/orchestration/APPROVAL_SYSTEM.md
//
// Features:
// - Agents loaded from .overlord/team/ and built-in definitions
// - Sequential task queue (one agent at a time)
// - 4-tier approval system with confidence scoring
// - Learned patterns that improve over time
// - Periodic check-ins every ~10 actions

const fs = require('fs');
const path = require('path');
const { AgentManager } = require('./agents/index');

let hub = null;
let config = null;
let agentManager = null;

// ==================== APPROVAL SYSTEM ====================
// Per docs/orchestration/APPROVAL_SYSTEM.md

const APPROVAL_TIERS = {
    SELF_APPROVE: 1,    // Agent proceeds immediately
    ORCHESTRATOR: 2,    // Orchestrator reviews
    HUMAN_REQUIRED: 3,  // User must approve
    FULL_REVIEW: 4      // User + explicit sign-off
};

// ==================== TOOL TIER REGISTRY ====================
// Inspired by Mini-Agent's declarative tool metadata.
// Maps tool names to their declared tier, category, and risk level.
// classifyApprovalTier() checks this registry BEFORE the runtime switch/case,
// making tier assignment explicit and extensible.

const TOOL_TIER_REGISTRY = {
    // ── Tier 1 — Self-approve (read-only, safe, no side effects) ──
    'read_file':            { tier: 1, category: 'read',      risk: 'none',     description: 'Read file contents' },
    'read_file_lines':      { tier: 1, category: 'read',      risk: 'none',     description: 'Read file lines' },
    'list_dir':             { tier: 1, category: 'read',      risk: 'none',     description: 'List directory entries' },
    'list_directory':       { tier: 1, category: 'read',      risk: 'none',     description: 'List directory entries' },
    'search_files':         { tier: 1, category: 'read',      risk: 'none',     description: 'Search file contents' },
    'get_working_dir':      { tier: 1, category: 'read',      risk: 'none',     description: 'Get working directory' },
    'system_info':          { tier: 1, category: 'read',      risk: 'none',     description: 'Get system information' },
    'list_agents':          { tier: 1, category: 'read',      risk: 'none',     description: 'List available agents' },
    'get_agent_info':       { tier: 1, category: 'read',      risk: 'none',     description: 'Get agent details' },
    'web_search':           { tier: 1, category: 'read',      risk: 'none',     description: 'Search the web' },
    'fetch_webpage':        { tier: 1, category: 'read',      risk: 'none',     description: 'Fetch webpage content (HTTPS only; HTTP requires human approval)' },
    'understand_image':     { tier: 1, category: 'read',      risk: 'none',     description: 'Analyze image content' },
    'fetch_webpage':        { tier: 1, category: 'read',      risk: 'none',     description: 'Fetch webpage text content' },
    'fetch_url':            { tier: 1, category: 'read',      risk: 'none',     description: 'Alias: fetch_webpage' },
    'get_url':              { tier: 1, category: 'read',      risk: 'none',     description: 'Alias: fetch_webpage' },
    'read_url':             { tier: 1, category: 'read',      risk: 'none',     description: 'Alias: fetch_webpage' },
    'read_webpage':         { tier: 1, category: 'read',      risk: 'none',     description: 'Alias: fetch_webpage' },
    'get_webpage':          { tier: 1, category: 'read',      risk: 'none',     description: 'Alias: fetch_webpage' },
    'curl':                 { tier: 1, category: 'read',      risk: 'none',     description: 'Alias: fetch_webpage' },
    'save_webpage_to_vault': { tier: 1, category: 'write',    risk: 'low',      description: 'Fetch webpage and save as Obsidian Markdown note' },
    'save_to_vault':         { tier: 1, category: 'write',    risk: 'low',      description: 'Alias: save_webpage_to_vault' },
    'webpage_to_vault':      { tier: 1, category: 'write',    risk: 'low',      description: 'Alias: save_webpage_to_vault' },
    'clip_to_vault':         { tier: 1, category: 'write',    risk: 'low',      description: 'Alias: save_webpage_to_vault' },
    'qa_check_lint':        { tier: 1, category: 'diagnostic', risk: 'none',    description: 'Run lint check' },
    'qa_check_types':       { tier: 1, category: 'diagnostic', risk: 'none',    description: 'Run type check' },
    'qa_check_coverage':    { tier: 1, category: 'diagnostic', risk: 'none',    description: 'Check test coverage' },
    'qa_audit_deps':        { tier: 1, category: 'diagnostic', risk: 'none',    description: 'Audit dependencies' },
    'save_session_note':    { tier: 1, category: 'memory',    risk: 'none',     description: 'Save persistent note' },
    'recall_session_notes': { tier: 1, category: 'memory',    risk: 'none',     description: 'Recall persistent notes' },

    // Dynamic tools (file-tools-module, tools-registry) — read-only / safe
    'file_tree':            { tier: 1, category: 'read',      risk: 'none',     description: 'Recursive directory tree' },
    'git_diff':             { tier: 1, category: 'read',      risk: 'none',     description: 'Git status/diff/log (read-only)' },
    'project_info':         { tier: 1, category: 'read',      risk: 'none',     description: 'Project metadata and structure' },
    'agent_remember':       { tier: 1, category: 'memory',    risk: 'none',     description: 'Agent persistent note save' },
    'agent_recall':         { tier: 1, category: 'memory',    risk: 'none',     description: 'Agent persistent note recall' },
    'record_note':          { tier: 1, category: 'memory',    risk: 'none',     description: 'Record a note' },
    'recall_notes':         { tier: 1, category: 'memory',    risk: 'none',     description: 'Recall notes' },
    'session_note':         { tier: 1, category: 'memory',    risk: 'none',     description: 'Save session note' },
    'list_skills':          { tier: 1, category: 'read',      risk: 'none',     description: 'List available skills' },
    'get_skill':            { tier: 1, category: 'read',      risk: 'none',     description: 'Get skill details' },
    'kv_get':               { tier: 1, category: 'read',      risk: 'none',     description: 'Read key-value store' },
    'kv_list':              { tier: 1, category: 'read',      risk: 'none',     description: 'List key-value entries' },
    'ask_user':             { tier: 1, category: 'interact',   risk: 'none',     description: 'Prompt user for input' },
    'show_chart':           { tier: 1, category: 'display',    risk: 'none',     description: 'Display chart in UI' },
    'ui_action':            { tier: 1, category: 'display',    risk: 'none',     description: 'Trigger UI action' },

    // ── Tier 2 — Orchestrator-approve (writes, confidence-gated) ──
    'add_todo':             { tier: 2, category: 'task',      risk: 'low',      description: 'Add a todo/task item' },
    'toggle_todo':          { tier: 2, category: 'task',      risk: 'low',      description: 'Toggle todo completion' },
    'kv_set':               { tier: 2, category: 'write',     risk: 'low',      description: 'Write key-value store' },
    'kv_delete':            { tier: 2, category: 'write',     risk: 'low',      description: 'Delete key-value entry' },
    'activate_skill':       { tier: 2, category: 'config',    risk: 'low',      description: 'Activate a skill' },
    'deactivate_skill':     { tier: 2, category: 'config',    risk: 'low',      description: 'Deactivate a skill' },
    'socket_push':          { tier: 2, category: 'communicate', risk: 'low',    description: 'Push notification via socket' },
    'github':               { tier: 2, category: 'vcs',       risk: 'low',      description: 'GitHub CLI operations' },
    'write_file':           { tier: 2, category: 'write',     risk: 'medium',   description: 'Write/create file' },
    'patch_file':           { tier: 2, category: 'write',     risk: 'medium',   description: 'Patch file contents' },
    'append_file':          { tier: 2, category: 'write',     risk: 'medium',   description: 'Append to file' },
    'edit_file':            { tier: 2, category: 'write',     risk: 'medium',   description: 'Edit existing file' },
    'qa_run_tests':         { tier: 2, category: 'execute',   risk: 'low',      description: 'Run test suite' },
    'set_working_dir':      { tier: 2, category: 'config',    risk: 'low',      description: 'Change working directory' },
    'set_thinking_level':   { tier: 2, category: 'config',    risk: 'low',      description: 'Adjust thinking budget' },
    'delegate_to_agent':    { tier: 2, category: 'delegate',  risk: 'low',      description: 'Delegate to sub-agent' },
    'assign_task':          { tier: 2, category: 'delegate',  risk: 'low',      description: 'Assign task to agent' },
    'message_agent':        { tier: 2, category: 'delegate',  risk: 'low',      description: 'Send message to agent' },
    'execute_command':      { tier: 2, category: 'execute',   risk: 'medium',   description: 'Run shell command' },

    // ── Tier 3 — Human required (destructive, external, package changes) ──
    'delete_file':          { tier: 3, category: 'destructive', risk: 'high',   description: 'Delete file' },
    'git_commit':           { tier: 3, category: 'vcs',       risk: 'high',     description: 'Git commit' },
    'git_push':             { tier: 3, category: 'vcs',       risk: 'high',     description: 'Git push to remote' },
    'handoff_to_orchestrator': { tier: 2, category: 'workflow', risk: 'low',    description: 'PM handoff to orchestrator' },

    // ── Tier 4 — Full review (critical/irreversible) ──
    'delete_directory':     { tier: 4, category: 'destructive', risk: 'critical', description: 'Delete directory recursively' },
    'deploy':               { tier: 4, category: 'deploy',    risk: 'critical',   description: 'Deploy to production' },
};

// Track actions for periodic check-ins
let actionCount = 0;
const CHECK_IN_INTERVAL = 10;

// Learned patterns storage
let learnedPatterns = {};
let decisionHistory = [];

function loadLearnedPatterns() {
    const patternsPath = path.join(config.projectRoot || config.baseDir, '.overlord', 'learned_patterns.json');
    try {
        if (fs.existsSync(patternsPath)) {
            learnedPatterns = JSON.parse(fs.readFileSync(patternsPath, 'utf8'));
            hub.log(`📚 Loaded ${Object.keys(learnedPatterns).length} learned patterns`, 'info');
        }
    } catch (e) {
        hub.log('Could not load learned patterns: ' + e.message, 'warn');
        learnedPatterns = {};
    }
}

function saveLearnedPatterns() {
    const overlordDir = path.join(config.projectRoot || config.baseDir, '.overlord');
    if (!fs.existsSync(overlordDir)) {
        fs.mkdirSync(overlordDir, { recursive: true });
    }
    const patternsPath = path.join(overlordDir, 'learned_patterns.json');
    try {
        fs.writeFileSync(patternsPath, JSON.stringify(learnedPatterns, null, 2));
    } catch (e) {
        hub.log('Could not save learned patterns: ' + e.message, 'warn');
    }
}

function recordDecision(action, recommendation, actualDecision, reason) {
    const entry = {
        timestamp: new Date().toISOString(),
        action: action,
        recommendation: recommendation,
        actual_decision: actualDecision,
        reason: reason || ''
    };

    decisionHistory.push(entry);

    // Write to history file (append JSONL)
    const historyPath = path.join(config.projectRoot || config.baseDir, '.overlord', 'recommendation_history.jsonl');
    try {
        fs.appendFileSync(historyPath, JSON.stringify(entry) + '\n');
    } catch (e) {
        // Non-critical
    }

    // Learn from overrides
    const patternKey = `${action.type}_${action.target || 'general'}`;

    if (!learnedPatterns[patternKey]) {
        learnedPatterns[patternKey] = { escalations: 0, approvals: 0, lastDecision: null };
    }

    if (actualDecision > recommendation.tier) {
        learnedPatterns[patternKey].escalations++;
        // Auto-escalate after 3 overrides
        if (learnedPatterns[patternKey].escalations >= 3) {
            learnedPatterns[patternKey].autoEscalate = true;
            hub.log(`📈 Learned: auto-escalate ${patternKey} (user escalated 3+ times)`, 'info');
        }
    } else if (actualDecision <= recommendation.tier) {
        learnedPatterns[patternKey].approvals++;
        // Auto-approve after 5 approvals
        if (learnedPatterns[patternKey].approvals >= 5) {
            learnedPatterns[patternKey].autoApprove = true;
            hub.log(`📉 Learned: auto-approve ${patternKey} (user approved 5+ times)`, 'info');
        }
    }

    learnedPatterns[patternKey].lastDecision = actualDecision;
    saveLearnedPatterns();
}

// Classify what approval tier an action needs
function classifyApprovalTier(toolName, input) {
    const action = {
        type: toolName,
        target: input?.path || input?.command || 'unknown'
    };

    // Check learned patterns first
    const patternKey = `${action.type}_${action.target}`;
    const generalKey = `${action.type}_general`;
    const pattern = learnedPatterns[patternKey] || learnedPatterns[generalKey];

    if (pattern?.autoEscalate) {
        return {
            tier: APPROVAL_TIERS.HUMAN_REQUIRED,
            confidence: 0.95,
            reasoning: 'Learned pattern: user previously escalated this action type',
            action
        };
    }
    if (pattern?.autoApprove) {
        return {
            tier: APPROVAL_TIERS.SELF_APPROVE,
            confidence: 0.90,
            reasoning: 'Learned pattern: user previously auto-approved this action type',
            action
        };
    }

    // Check declarative tool registry (Mini-Agent pattern) BEFORE runtime inference
    const registered = TOOL_TIER_REGISTRY[toolName];
    if (registered) {
        return {
            tier: registered.tier,
            confidence: 0.90,  // High confidence for declaratively registered tools
            reasoning: `Declarative tier ${registered.tier} (${registered.category}, risk: ${registered.risk})`,
            action,
            category: registered.category,
            risk: registered.risk
        };
    }

    // Fallthrough: runtime tier classification per APPROVAL_SYSTEM.md
    // (Handles dynamic tools like bash/powershell that need input inspection)
    switch (toolName) {
        // Tier 1: Self-Approve (read-only, docs, formatting)
        case 'read_file':
        case 'read_file_lines':
        case 'list_dir':
        case 'get_working_dir':
        case 'system_info':
        case 'list_agents':
        case 'get_agent_info':
        case 'web_search':
        case 'understand_image':
        case 'qa_check_lint':
        case 'qa_check_types':
        case 'qa_check_coverage':
        case 'qa_audit_deps':
            return {
                tier: APPROVAL_TIERS.SELF_APPROVE,
                confidence: 0.95,
                reasoning: 'Read-only or diagnostic operation',
                action
            };

        // Tier 2: Orchestrator (code changes, new files, bug fixes, tests)
        case 'write_file':
        case 'patch_file':
        case 'append_file':
        case 'qa_run_tests':
        case 'set_working_dir':
        case 'set_thinking_level':
            return {
                tier: APPROVAL_TIERS.ORCHESTRATOR,
                confidence: 0.80,
                reasoning: 'Code modification or configuration change',
                action
            };

        // Tier 2-3: Shell commands (depends on content)
        case 'bash':
        case 'powershell':
        case 'cmd': {
            const cmd = (input?.command || '').toLowerCase();
            // Read-only commands -> Tier 1
            if (cmd.match(/^(ls|dir|cat|head|tail|grep|find|which|where|echo|pwd|whoami|git\s+(status|log|diff|branch|remote|show))/)) {
                return { tier: APPROVAL_TIERS.SELF_APPROVE, confidence: 0.90, reasoning: 'Read-only shell command', action };
            }
            // Git write operations -> Tier 2
            if (cmd.match(/^git\s+(add|commit|push|pull|fetch|checkout|merge|stash|tag)/)) {
                return { tier: APPROVAL_TIERS.ORCHESTRATOR, confidence: 0.80, reasoning: 'Git write operation', action };
            }
            // Dangerous commands -> Tier 4
            if (cmd.match(/rm\s+-rf|drop\s+table|truncate|delete\s+from|format|shutdown|reboot/i)) {
                return { tier: APPROVAL_TIERS.FULL_REVIEW, confidence: 0.95, reasoning: 'Potentially destructive command', action };
            }
            // npm/package operations -> Tier 3
            if (cmd.match(/npm\s+(install|uninstall|update)|pip\s+install|brew\s+install/)) {
                return { tier: APPROVAL_TIERS.HUMAN_REQUIRED, confidence: 0.85, reasoning: 'Package/dependency change', action };
            }
            // Default shell -> Tier 2
            return { tier: APPROVAL_TIERS.ORCHESTRATOR, confidence: 0.70, reasoning: 'Shell command execution', action };
        }

        // Tier 1-2: GitHub operations
        case 'github': {
            const ghAction = (input?.action || '').toLowerCase();
            if (ghAction.includes('list') || ghAction.includes('get')) {
                return { tier: APPROVAL_TIERS.SELF_APPROVE, confidence: 0.90, reasoning: 'Read-only GitHub operation', action };
            }
            return { tier: APPROVAL_TIERS.ORCHESTRATOR, confidence: 0.75, reasoning: 'GitHub write operation', action };
        }

        // Tier 2: Agent delegation
        case 'assign_task':
            return {
                tier: APPROVAL_TIERS.ORCHESTRATOR,
                confidence: 0.85,
                reasoning: 'Agent task delegation',
                action
            };

        default:
            return {
                tier: APPROVAL_TIERS.ORCHESTRATOR,
                confidence: 0.50,
                reasoning: 'Unknown tool - defaulting to orchestrator review',
                action
            };
    }
}

// Check if approval is needed and whether to proceed
function shouldProceed(recommendation) {
    // Tier 1: Always proceed
    if (recommendation.tier === APPROVAL_TIERS.SELF_APPROVE) {
        return { approved: true, reason: 'T1: Self-approved' };
    }

    // Tier 2: Orchestrator decides (auto-approve if confidence >= 0.7)
    if (recommendation.tier === APPROVAL_TIERS.ORCHESTRATOR) {
        if (recommendation.confidence >= 0.7) {
            return { approved: true, reason: `T2: Orchestrator approved (confidence: ${recommendation.confidence})` };
        }
        return { approved: false, reason: `T2: Low confidence (${recommendation.confidence}), escalating`, escalate: true };
    }

    // Tier 3-4: Needs human approval (emit to client)
    return {
        approved: false,
        reason: `T${recommendation.tier}: Requires user approval`,
        escalate: true,
        tier: recommendation.tier
    };
}

// Periodic check-in
function maybeCheckIn() {
    actionCount++;
    if (actionCount % CHECK_IN_INTERVAL === 0) {
        const recentDecisions = decisionHistory.slice(-CHECK_IN_INTERVAL);
        const summary = {
            totalActions: actionCount,
            recentCount: recentDecisions.length,
            tierBreakdown: {
                t1: recentDecisions.filter(d => d.recommendation?.tier === 1).length,
                t2: recentDecisions.filter(d => d.recommendation?.tier === 2).length,
                t3: recentDecisions.filter(d => d.recommendation?.tier === 3).length,
                t4: recentDecisions.filter(d => d.recommendation?.tier === 4).length,
            },
            overrides: recentDecisions.filter(d => d.actual_decision !== d.recommendation?.tier).length,
            patternsLearned: Object.keys(learnedPatterns).length
        };

        hub.broadcast('approval_checkin', summary);
        hub.log(`📋 Check-in: ${actionCount} actions, ${summary.overrides} overrides, ${summary.patternsLearned} patterns learned`, 'info');
    }
}

// ==================== INITIALIZATION ====================

function findProjectRoot(startDir) {
    let current = startDir;
    const maxDepth = 10;
    let depth = 0;
    while (depth < maxDepth) {
        if (fs.existsSync(path.join(current, 'package.json'))) return current;
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
        depth++;
    }
    return startDir;
}

async function init(h) {
    hub = h;

    // Wait for config
    let attempts = 0;
    while (!hub.getService('config') && attempts < 10) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
    }

    config = hub.getService('config') || { baseDir: '.' };
    config.projectRoot = findProjectRoot(config.baseDir);

    hub.log(`🤖 Agent System: Project root: ${config.projectRoot}`, 'info');

    // Initialize AgentManager (from agents/index.js)
    agentManager = new AgentManager(hub);

    // Load learned approval patterns
    loadLearnedPatterns();

    // Register as BOTH service names (eliminates agents-module.js wrapper)
    const service = {
        getAgents: () => agentManager.agents,
        getAgentList: () => agentManager.getAgentList(),
        formatAgentList: () => agentManager.formatAgentList(),
        formatAgentInfo: (name) => agentManager.formatAgentInfo(name),
        assignTask: (name, task) => agentManager.assignTask(name, task),
        getStatus: () => ({
            current: agentManager.currentAgent,
            queueLength: agentManager.queue.length,
            isRunning: agentManager.isRunning,
            agents: Object.keys(agentManager.agents)
        }),
        getCurrent: () => agentManager.currentAgent,
        getQueue: () => agentManager.queue,
        cancel: () => {
            if (agentManager.currentAgent) {
                agentManager.currentAgent = null;
                agentManager.isRunning = false;
                hub.log('⚠️ Agent cancelled', 'warn');
                hub.teamUpdate(agentManager.getAgentList());
                return { success: true, message: 'Agent cancelled' };
            }
            return { success: false, message: 'No agent running' };
        },
        reloadAgents: () => agentManager.loadTeamAgents(),
        getProjectRoot: () => config.projectRoot,
        // Approval system exports
        classifyApprovalTier,
        shouldProceed,
        recordDecision,
        getLearnedPatterns: () => learnedPatterns,
        getActionCount: () => actionCount,
        maybeCheckIn,
        APPROVAL_TIERS,
        // Mini-Agent pattern: declarative tool registry metadata
        getToolRegistry: () => ({ ...TOOL_TIER_REGISTRY }),
        TOOL_TIER_REGISTRY
    };

    hub.registerService('agentSystem', service);
    hub.registerService('agents', service);

    hub.log(`🤖 Agent System loaded (${Object.keys(agentManager.agents).length} agents, ${Object.keys(learnedPatterns).length} patterns)`, 'success');

    // Initial broadcast
    hub.teamUpdate(agentManager.getAgentList());
}

module.exports = { init };
