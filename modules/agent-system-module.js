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

    // Default tier classification per APPROVAL_SYSTEM.md
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
        APPROVAL_TIERS
    };

    hub.registerService('agentSystem', service);
    hub.registerService('agents', service);

    hub.log(`🤖 Agent System loaded (${Object.keys(agentManager.agents).length} agents, ${Object.keys(learnedPatterns).length} patterns)`, 'success');

    // Initial broadcast
    hub.teamUpdate(agentManager.getAgentList());
}

module.exports = { init };
