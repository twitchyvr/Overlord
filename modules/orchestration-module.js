// ==================== ORCHESTRATION MODULE ====================
// Coordinates AI, tools, and conversation flow
// Integrates tiered approval system from docs/orchestration/ORDER_OF_OPERATIONS.md
//
// Order of Operations per tool execution:
// 1. Classify approval tier (T1-T4)
// 2. Check if approval is needed
// 3. For T3-T4: emit approval_request to client, wait for response
// 4. Execute tool (if approved)
// 5. AutoQA: run lint/types on written files (code-enforced, not prompt-based)
// 6. Record decision for learning system
// 7. Periodic check-in every ~10 actions

const path = require('path');

let hub = null;
let isProcessing = false;

// ── Error description helper ──────────────────────────────────────────────
// Node.js network errors (ECONNRESET, ETIMEDOUT, socket hang up) carry their
// meaning in `.code` and `.syscall`, NOT in `.message` (which is often "").
// This helper always returns something human-readable regardless of error shape.
function describeError(e) {
    if (!e) return 'Unknown error';
    const parts = [];
    if (e.message && e.message.trim()) parts.push(e.message.trim());
    if (e.code)    parts.push(`[${e.code}]`);
    if (e.syscall) parts.push(`(syscall: ${e.syscall})`);
    if (parts.length === 0) {
        // Last resort — stringify or use constructor name
        const name = e.constructor?.name || 'Error';
        try { return `${name}: ${JSON.stringify(e)}`; } catch { return String(e); }
    }
    return parts.join(' ');
}

// Network error codes that are transient and safe to retry once
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EPIPE', 'ENOTFOUND', 'ENETUNREACH', 'EAI_AGAIN']);
function isNetworkError(e) {
    if (!e) return false;
    if (RETRYABLE_CODES.has(e.code)) return true;
    const msg = (e.message || '').toLowerCase();
    return msg.includes('socket hang up') || msg.includes('connection reset') ||
           msg.includes('network timeout') || msg.includes('econnreset');
}
let pendingApproval = null; // For T3-T4 approval flow
const pendingApprovalResolvers = new Map(); // toolId → { resolve, reject, timer }

// Plan mode state
let awaitingPlanApproval = false;
let pendingPlanResolvers = null;   // { resolve, timer }
let pendingPlanTaskIds = [];
let pendingPlanRawText = ''; // Raw AI response text for variant switching

// Plan execution bypass: when a plan is approved, skip individual tool approvals
// for the duration of the execution cycle so the user isn't re-prompted per tool.
let planExecutionActive = false;

// Safeguards against infinite loops / token waste
// These are runtime defaults; actual values are overridden by config on init.
let MAX_CYCLES = 10; // max recursive AI→tool→AI cycles per user message
let cycleDepth = 0;

let MAX_QA_ATTEMPTS = 3; // max AutoQA inject-and-fix retries per file
const qaAttempts = new Map(); // filePath → attempt count

// Per-delegation retry cap: tracks how many times the same task has been dispatched
// to the same agent within a single orchestration turn. Cleared at the start of each
// new orchestrator user-turn (when session.cycleDepth resets to 0).
const _delegationAttempts = new Map(); // key: `${agentName}::${task.slice(0,80)}` → count

let APPROVAL_TIMEOUT_MS = 0; // 0 = no timeout (wait forever). User must opt-in via settings.

// ── AI Self-Correction: consecutive tool error tracking ──────────────────
let _consecutiveToolErrors = 0;

// ── Agent-to-agent chain depth guard (prevents runaway delegation) ────────
let _agentChainDepth = 0;

// Current orchestration state (visible to clients via 'get_orchestration_state')
const orchestrationState = {
    agent: null,
    task: null,
    tool: null,
    thinking: false,
    startTime: null
};

// ==================== PER-AGENT SESSION STATE ====================
const agentSessions = new Map(); // agentName → session object
let maxParallelAgents = 3;

function broadcastActivity(type, data) {
    try {
        // tool_start and tool_complete update chip elements in the UI — must be reliable.
        // Everything else (thinking, agent status) is high-frequency, volatile is fine.
        const reliable = (type === 'tool_start' || type === 'tool_complete' || type === 'tool_error');
        if (reliable) {
            hub.broadcast('agent_activity', { type, ts: Date.now(), ...data });
        } else {
            hub.broadcastVolatile('agent_activity', { type, ts: Date.now(), ...data });
        }

        // Mirror to orchestration_state so agent card activity lines update in real-time.
        // This is the key link: without it, agent sessions never show anything on the Team panel.
        if (type === 'tool_start') {
            setOrchestratorState({ agent: data.agent || orchestrationState.agent, tool: data.tool || null });
        } else if (type === 'tool_complete' || type === 'tool_error') {
            setOrchestratorState({ tool: null });
        } else if (type === 'agent_thinking_start') {
            setOrchestratorState({ agent: data.agent || orchestrationState.agent, thinking: true, tool: null });
        } else if (type === 'agent_thinking_done') {
            setOrchestratorState({ thinking: false });
        }
    } catch(e) {}
}

function setOrchestratorState(updates) {
    Object.assign(orchestrationState, updates);
    hub.broadcast('orchestration_state', { ...orchestrationState });
}

// Called when the main orchestrator finishes a processing cycle and returns to idle.
// Drains any queued user messages so they get processed next.
function finishMainProcessing(statusText = 'Ready', statusType = 'idle') {
    isProcessing = false;
    hub.status(statusText, statusType);
    // Drain next queued message after a short tick to avoid sync recursion.
    // drainMessageQueue() itself broadcasts the updated queue to clients.
    setTimeout(() => hub.drainMessageQueue(), 80);
}

async function init(h) {
    hub = h;

    // Read behavior limits from config (overrides module-level defaults)
    // Fixed: radix parameter added to parseInt (ESLint rule radix)
    // Fixed: strict equality (== null -> !== null) for lint compliance
    const cfg = hub.getService('config');
    if (cfg) {
        if (cfg.maxAICycles !== null) MAX_CYCLES = cfg.maxAICycles === 0 ? Infinity : cfg.maxAICycles;
        if (cfg.maxQAAttempts) MAX_QA_ATTEMPTS = cfg.maxQAAttempts;
        if (cfg.approvalTimeoutMs) APPROVAL_TIMEOUT_MS = cfg.approvalTimeoutMs;
        if (cfg.maxParallelAgents !== null) maxParallelAgents = Math.max(1, Math.min(8, parseInt(cfg.maxParallelAgents, 10) || 3));
    }

    // Listen to hub events
    hub.on('user_message', handleUserMessage);
    hub.on('cancel_request', handleCancel);
    hub.on('new_conversation', handleNewConversation);
    hub.on('checkpoint_approved', handleCheckpointApproved);
    hub.on('client_connected', handleClientConnected);
    hub.on('approval_response', handleApprovalResponse);
    hub.on('plan_approved',  handlePlanApproved);
    hub.on('plan_cancelled', handlePlanCancelled);
    hub.on('plan_revision',  handlePlanRevision);
    hub.on('switch_plan_variant', handleSwitchPlanVariant);
    // ── Live bypass: auto-approve all blocking approvals immediately when mode switches
    hub.on('bypass_active', () => {
        // Auto-resolve pending individual tool approvals
        if (pendingApprovalResolvers.size > 0) {
            hub.log(`⚡ [BYPASS] Auto-approving ${pendingApprovalResolvers.size} pending tool approval(s) — mode changed to bypass`, 'warning');
            pendingApprovalResolvers.forEach(({ resolve, timer }, toolId) => {
                clearTimeout(timer);
                hub.broadcast('approval_resolved', { toolId, approved: true });
                resolve(true);
            });
            pendingApprovalResolvers.clear();
        }
        // Auto-approve any pending plan approval — user shouldn't be blocked waiting
        // for a plan decision when bypass mode is active
        if (pendingPlanResolvers) {
            hub.log('⚡ [BYPASS] Auto-approving pending plan — mode changed to bypass', 'warning');
            handlePlanApproved();
            hub.broadcastAll('plan_bypass_approved', {});
        }
    });

    hub.registerService('orchestration', {
        isProcessing: () => isProcessing,
        checkpoint: checkpoint,
        getState: () => ({ ...orchestrationState }),
        // _updateLimits: runtime config update (same fixes applied)
        _updateLimits: (cfg) => {
            if (cfg.maxAICycles !== null) MAX_CYCLES = cfg.maxAICycles === 0 ? Infinity : cfg.maxAICycles;
            if (cfg.maxQAAttempts) MAX_QA_ATTEMPTS = cfg.maxQAAttempts;
            if (cfg.approvalTimeoutMs) APPROVAL_TIMEOUT_MS = cfg.approvalTimeoutMs;
            if (cfg.maxParallelAgents !== null) maxParallelAgents = Math.max(1, Math.min(8, parseInt(cfg.maxParallelAgents, 10) || 3));
        },
        runAgentSession,
        pauseAgent,
        resumeAgent,
        getAgentSessionState,
        getAgentHistory,
        getAgentInbox,
        getOrchestratorState: getState,
        getAllAgentStates
    });

    // Allow clients to request current orchestration state
    hub.on('get_orchestration_state', (socket) => {
        hub.emitTo(socket, 'orchestration_state', { ...orchestrationState });
    });

    // ── Register update_task_status tool so the AI can mark tasks done ─────────
    // This is the critical link: when the AI finishes a task it calls this tool,
    // which updates the task in the conversation store and broadcasts tasks_update
    // so the kanban and task panel refresh in real time.
    (function registerTaskStatusTool() {
        const tools = hub.getService('tools');
        if (!tools || !tools.registerTool) {
            hub.log('[orchestration] tools service not ready — retrying task tool registration in 2s', 'warn');
            setTimeout(registerTaskStatusTool, 2000);
            return;
        }
        tools.registerTool({
            name: 'update_task_status',
            description: 'Update the status of a task in the project task list. Call this when you start working on a task (status: in_progress) and again when you complete it (status: completed). This keeps the kanban board accurate in real time.',
            input_schema: {
                type: 'object',
                properties: {
                    taskId: {
                        type: 'string',
                        description: 'The task ID (e.g. task_1234567890). Find it in the task description you were given, or use list_tasks to look it up.'
                    },
                    status: {
                        type: 'string',
                        enum: ['pending', 'in_progress', 'completed', 'blocked', 'skipped'],
                        description: 'New status for the task.'
                    },
                    notes: {
                        type: 'string',
                        description: 'Optional notes about completion, blockers, or next steps.'
                    }
                },
                required: ['taskId', 'status']
            }
        }, (input) => {
            const conv = hub.getService('conversation');
            if (!conv) return 'ERROR: Conversation service not available';
            const taskId = input.taskId;
            const allTasks = conv.getTasks ? conv.getTasks() : [];
            const task = allTasks.find(t => t.id === taskId);
            if (!task) return `ERROR: Task not found with ID "${taskId}". Use list_tasks to find the correct ID.`;

            const updates = { id: taskId, status: input.status };
            if (input.notes) updates.notes = input.notes;
            if (input.status === 'completed') {
                updates.completed = true;
                updates.completedAt = new Date().toISOString();
            } else {
                updates.completed = false;
            }

            // Keep milestoneId intact on completion so progress calculations work.
            // We track progress by filtering completed tasks within a milestone.
            const prevMilestoneId = task.milestoneId;

            conv.updateTask(taskId, updates);

            // Broadcast real-time kanban update to all clients
            hub.broadcastAll('tasks_update', conv.getTasks());
            hub.log(`[update_task_status] "${task.title}" → ${input.status}`, 'info');

            // ── Check if milestone is now complete (all tasks done/skipped) ───
            let milestoneMsg = '';
            if (prevMilestoneId && (input.status === 'completed' || input.status === 'skipped')) {
                const remaining = (conv.getTasks ? conv.getTasks() : [])
                    .filter(t => t.milestoneId === prevMilestoneId &&
                                 t.status !== 'completed' && t.status !== 'skipped' && !t.completed);
                if (remaining.length === 0) {
                    // Look up milestone name for the notification
                    const milestones = conv.getMilestones ? conv.getMilestones() : [];
                    const doneMilestone = milestones.find(m => m.id === prevMilestoneId);
                    hub.broadcast('milestone_all_tasks_done', {
                        milestoneId: prevMilestoneId,
                        name: doneMilestone ? doneMilestone.text : prevMilestoneId
                    });
                    hub.log(`[milestone] All tasks complete for "${doneMilestone ? doneMilestone.text : prevMilestoneId}" — awaiting manual close`, 'success');
                    milestoneMsg = ` Milestone "${doneMilestone ? doneMilestone.text : prevMilestoneId}" has no remaining tasks — it is ready to close (user must manually close it via the Milestones panel).`;
                }
            }

            return `Task "${task.title}" status updated to: ${input.status}${input.notes ? '. Notes: ' + input.notes : ''}${milestoneMsg}`;
        });
        hub.log('✅ update_task_status tool registered', 'info');

        // ── create_milestone: AI creates a new milestone ─────────────────────
        tools.registerTool({
            name: 'create_milestone',
            description: 'Create a new project milestone. Use this to organize related tasks under a named goal. After creating a milestone, use assign_task_to_milestone to link tasks to it.',
            input_schema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Short milestone name, e.g. "Sprint 1 — Auth System"'
                    },
                    description: {
                        type: 'string',
                        description: 'What this milestone covers and its completion criteria.'
                    },
                    color: {
                        type: 'string',
                        description: 'Hex color for the milestone badge, e.g. "#58a6ff". Optional — defaults to blue.'
                    }
                },
                required: ['name']
            }
        }, (input) => {
            const conv = hub.getService('conversation');
            if (!conv) return 'ERROR: Conversation service not available';
            if (!conv.addMilestone) return 'ERROR: addMilestone not available on conversation service';
            const ms = conv.addMilestone({
                name: String(input.name).trim().substring(0, 120),
                description: String(input.description || '').trim().substring(0, 500),
                color: /^#[0-9a-f]{3,6}$/i.test(input.color || '') ? input.color : '#58a6ff'
            });
            hub.broadcast('roadmap_update', conv.getRoadmap());
            hub.log(`[create_milestone] Created: "${ms.text}" (${ms.id})`, 'success');
            return `Milestone created: "${ms.text}" (id: ${ms.id}). Use assign_task_to_milestone to link tasks to it.`;
        });
        hub.log('✅ create_milestone tool registered', 'info');

        // ── assign_task_to_milestone: link a task to a milestone ─────────────
        tools.registerTool({
            name: 'assign_task_to_milestone',
            description: 'Assign an existing task to a milestone. The task will appear in the milestone\'s task list. Use list_milestones to find milestone IDs.',
            input_schema: {
                type: 'object',
                properties: {
                    taskId: {
                        type: 'string',
                        description: 'The task ID to assign.'
                    },
                    milestoneId: {
                        type: 'string',
                        description: 'The milestone ID to assign the task to. Use list_milestones to find IDs.'
                    }
                },
                required: ['taskId', 'milestoneId']
            }
        }, (input) => {
            const conv = hub.getService('conversation');
            if (!conv) return 'ERROR: Conversation service not available';
            const allTasks = conv.getTasks ? conv.getTasks() : [];
            const task = allTasks.find(t => t.id === input.taskId);
            if (!task) return `ERROR: Task "${input.taskId}" not found. Use list_tasks to find task IDs.`;
            const milestones = conv.getMilestones ? conv.getMilestones() : [];
            const ms = milestones.find(m => m.id === input.milestoneId);
            if (!ms) return `ERROR: Milestone "${input.milestoneId}" not found. Use list_milestones to find IDs.`;
            conv.updateTask(input.taskId, { milestoneId: input.milestoneId });
            hub.broadcastAll('tasks_update', conv.getTasks());
            hub.log(`[assign_task_to_milestone] Task "${task.title}" → milestone "${ms.text}"`, 'info');
            return `Task "${task.title}" assigned to milestone "${ms.text}".`;
        });
        hub.log('✅ assign_task_to_milestone tool registered', 'info');

        // ── list_milestones: AI queries current milestones + task counts ──────
        tools.registerTool({
            name: 'list_milestones',
            description: 'List all project milestones with their IDs, status, and task counts. Use this to find milestone IDs for assign_task_to_milestone, or to check progress.',
            input_schema: { type: 'object', properties: {} }
        }, (input) => {
            const conv = hub.getService('conversation');
            if (!conv) return 'ERROR: Conversation service not available';
            const milestones = conv.getMilestones ? conv.getMilestones() : [];
            const allTasks = conv.getTasks ? conv.getTasks() : [];
            if (milestones.length === 0) return 'No milestones exist yet. Use create_milestone to create one.';
            const lines = milestones.map(ms => {
                const msTasks = allTasks.filter(t => t.milestoneId === ms.id);
                const done = msTasks.filter(t => t.completed || t.status === 'completed' || t.status === 'skipped').length;
                return `- [${ms.status || 'pending'}] ${ms.text} (id: ${ms.id}) — ${done}/${msTasks.length} tasks done`;
            });
            return `Milestones:\n${lines.join('\n')}`;
        });
        hub.log('✅ list_milestones tool registered', 'info');

        // ── close_milestone: user-initiated wrap-up ───────────────────────────
        tools.registerTool({
            name: 'close_milestone',
            description: 'Mark a milestone as complete and closed. Only call this when ALL tasks have been completed/skipped and the user (or orchestrator) explicitly confirms the milestone is done. This action is final.',
            input_schema: {
                type: 'object',
                properties: {
                    milestoneId: {
                        type: 'string',
                        description: 'The milestone ID to close. Use list_milestones to find it.'
                    },
                    summary: {
                        type: 'string',
                        description: 'Brief summary of what was accomplished in this milestone.'
                    }
                },
                required: ['milestoneId']
            }
        }, (input) => {
            const conv = hub.getService('conversation');
            if (!conv) return 'ERROR: Conversation service not available';
            const milestones = conv.getMilestones ? conv.getMilestones() : [];
            const ms = milestones.find(m => m.id === input.milestoneId);
            if (!ms) return `ERROR: Milestone "${input.milestoneId}" not found. Use list_milestones to find IDs.`;
            if (conv.updateMilestone) {
                conv.updateMilestone(input.milestoneId, {
                    done: true,
                    status: 'completed',
                    completedAt: new Date().toISOString(),
                    closeSummary: String(input.summary || '').substring(0, 500)
                });
            }
            hub.broadcast('roadmap_update', conv.getRoadmap());
            hub.emit('milestone_completed', ms);  // triggers auto-merge if git configured
            hub.log(`[close_milestone] Closed: "${ms.text}"`, 'success');
            return `Milestone "${ms.text}" has been closed.${input.summary ? ' Summary: ' + input.summary : ''}`;
        });
        hub.log('✅ close_milestone tool registered', 'info');

        // ── create_task: AI creates a new task ───────────────────────────────
        tools.registerTool({
            name: 'create_task',
            description: 'Create a new task on the kanban board. Optionally assign to a milestone and/or agent. Use this whenever you need to track a piece of work.',
            input_schema: {
                type: 'object',
                properties: {
                    title:       { type: 'string', description: 'Task title (concise, action-oriented, max 120 chars)' },
                    description: { type: 'string', description: 'Detailed description of what needs to be done (max 500 chars)' },
                    priority:    { type: 'string', enum: ['low', 'normal', 'high'], description: 'Priority level (default: normal)' },
                    milestoneId: { type: 'string', description: 'Optional milestone ID to assign this task to (use list_milestones to find IDs)' },
                    assignee:    { type: 'string', description: 'Agent to own this task. REQUIRED — always specify who will do this work (e.g. "code-implementer", "testing-engineer", "ui-expert", "git-keeper"). Use list_agents() to see all available agents.' }
                },
                required: ['title']
            }
        }, (input) => {
            const conv = hub.getService('conversation');
            if (!conv) return 'ERROR: Conversation service not available';
            const task = {
                id: 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                title: String(input.title).trim().substring(0, 120),
                description: String(input.description || '').trim().substring(0, 500),
                priority: ['low', 'normal', 'high'].includes(input.priority) ? input.priority : 'normal',
                status: 'pending',
                completed: false,
                milestoneId: input.milestoneId || null,
                assignee: input.assignee
                    ? [String(input.assignee).trim()]
                    : ['code-implementer'], // default if omitted — always has an owner
                actions: { test: false, lint: false, approval: false },
                createdAt: new Date().toISOString()
            };
            conv.addTask(task);
            hub.log(`[create_task] Created: "${task.title}" → ${task.assignee.join(', ')} (${task.id})`, 'info');
            return `Task created: "${task.title}" (id: ${task.id}) — assigned to: ${task.assignee.join(', ')}${input.milestoneId ? ' | milestone attached' : ''}`;
        });
        hub.log('✅ create_task tool registered', 'info');

        // ── delete_task: AI deletes a task ───────────────────────────────────
        tools.registerTool({
            name: 'delete_task',
            description: 'Permanently delete a task from the kanban board. Use with care — this is irreversible.',
            input_schema: {
                type: 'object',
                properties: {
                    taskId: { type: 'string', description: 'The task ID to delete (find with list_tasks)' },
                    reason: { type: 'string', description: 'Optional reason for deletion (logged for audit)' }
                },
                required: ['taskId']
            }
        }, (input) => {
            const conv = hub.getService('conversation');
            if (!conv) return 'ERROR: Conversation service not available';
            const task = (conv.getTasks ? conv.getTasks() : []).find(t => t.id === input.taskId);
            if (!task) return `ERROR: Task not found: "${input.taskId}". Use list_tasks to find the correct ID.`;
            conv.deleteTask(input.taskId);
            hub.log(`[delete_task] Deleted: "${task.title}"${input.reason ? ' — ' + input.reason : ''}`, 'info');
            return `Task deleted: "${task.title}"${input.reason ? ' — reason: ' + input.reason : ''}`;
        });
        hub.log('✅ delete_task tool registered', 'info');

        // ── bulk_delete_tasks: AI deletes multiple tasks at once ─────────────
        tools.registerTool({
            name: 'bulk_delete_tasks',
            description: 'Delete multiple tasks at once. Filter by explicit ID list, status, or milestoneId. Supports dry-run to preview what would be deleted.',
            input_schema: {
                type: 'object',
                properties: {
                    taskIds:     { type: 'array', items: { type: 'string' }, description: 'Explicit task IDs to delete' },
                    status:      { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked', 'skipped', 'plan_pending'], description: 'Delete all tasks with this status' },
                    milestoneId: { type: 'string', description: 'Delete all tasks assigned to this milestone' },
                    dryRun:      { type: 'boolean', description: 'If true, return what would be deleted without actually deleting (default: false)' }
                }
            }
        }, (input) => {
            const conv = hub.getService('conversation');
            if (!conv) return 'ERROR: Conversation service not available';
            let targets = conv.getTasks ? conv.getTasks() : [];
            if (input.taskIds && input.taskIds.length > 0) {
                targets = targets.filter(t => input.taskIds.includes(t.id));
            } else if (input.status) {
                targets = targets.filter(t => t.status === input.status);
            } else if (input.milestoneId) {
                targets = targets.filter(t => t.milestoneId === input.milestoneId);
            } else {
                return 'ERROR: Provide at least one of: taskIds (array), status, or milestoneId';
            }
            if (targets.length === 0) return 'No matching tasks found to delete.';
            if (input.dryRun) {
                return `Dry run — would delete ${targets.length} task(s):\n${targets.map(t => `  - [${t.id}] ${t.title}`).join('\n')}`;
            }
            targets.forEach(t => conv.deleteTask(t.id));
            hub.log(`[bulk_delete_tasks] Deleted ${targets.length} task(s)`, 'info');
            return `Deleted ${targets.length} task(s): ${targets.map(t => '"' + t.title + '"').join(', ')}`;
        });
        hub.log('✅ bulk_delete_tasks tool registered', 'info');

        // ── list_tasks: AI queries current tasks ─────────────────────────────
        tools.registerTool({
            name: 'list_tasks',
            description: 'List tasks with optional filters. Returns compact summaries to minimize token usage. Use this to find task IDs and current status.',
            input_schema: {
                type: 'object',
                properties: {
                    status:      { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked', 'skipped', 'plan_pending'], description: 'Filter by status' },
                    milestoneId: { type: 'string', description: 'Filter by milestone ID' },
                    assignee:    { type: 'string', description: 'Filter by agent name' },
                    limit:       { type: 'number', description: 'Max tasks to return (default 30)' }
                }
            }
        }, (input) => {
            const conv = hub.getService('conversation');
            if (!conv) return 'ERROR: Conversation service not available';
            let tasks = conv.getTasks ? conv.getTasks() : [];
            if (input.status)      tasks = tasks.filter(t => t.status === input.status);
            if (input.milestoneId) tasks = tasks.filter(t => t.milestoneId === input.milestoneId);
            if (input.assignee)    tasks = tasks.filter(t => (t.assignee || []).includes(input.assignee));
            const limit = Math.min(input.limit || 30, 100);
            tasks = tasks.slice(0, limit);
            if (tasks.length === 0) return 'No tasks found matching the filter.';
            return tasks.map(t =>
                `[${t.id}] ${(t.status || 'pending').toUpperCase()} | ${t.priority || 'normal'} | ${t.title}` +
                `${t.milestoneId ? ' (ms:' + t.milestoneId + ')' : ''}` +
                `${t.assignee && t.assignee.length ? ' @' + t.assignee.join(',') : ''}`
            ).join('\n');
        });
        hub.log('✅ list_tasks tool registered', 'info');

        // ── update_task: AI updates any task field ────────────────────────────
        tools.registerTool({
            name: 'update_task',
            description: 'Update any field of a task: title, description, priority, milestoneId, assignee, status, or notes. More flexible than update_task_status.',
            input_schema: {
                type: 'object',
                properties: {
                    taskId:      { type: 'string', description: 'The task ID to update' },
                    title:       { type: 'string', description: 'New title' },
                    description: { type: 'string', description: 'New description' },
                    priority:    { type: 'string', enum: ['low', 'normal', 'high'], description: 'New priority' },
                    milestoneId: { type: 'string', description: 'Milestone to assign to. Pass empty string "" to remove from milestone.' },
                    assignee:    { type: 'array', items: { type: 'string' }, description: 'Array of agent names. Pass [] to unassign.' },
                    status:      { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked', 'skipped'], description: 'New status' },
                    notes:       { type: 'string', description: 'Completion notes or blocker explanation' }
                },
                required: ['taskId']
            }
        }, (input) => {
            const conv = hub.getService('conversation');
            if (!conv) return 'ERROR: Conversation service not available';
            const task = (conv.getTasks ? conv.getTasks() : []).find(t => t.id === input.taskId);
            if (!task) return `ERROR: Task not found: "${input.taskId}". Use list_tasks to find the correct ID.`;
            const updates = {};
            if (input.title !== undefined)       updates.title = String(input.title).trim().substring(0, 120);
            if (input.description !== undefined) updates.description = String(input.description).trim().substring(0, 500);
            if (input.priority !== undefined)    updates.priority = input.priority;
            if (input.milestoneId !== undefined) updates.milestoneId = input.milestoneId === '' ? null : input.milestoneId;
            if (input.assignee !== undefined)    updates.assignee = Array.isArray(input.assignee) ? input.assignee : [input.assignee];
            if (input.status !== undefined) {
                updates.status = input.status;
                if (input.status === 'completed') { updates.completed = true; updates.completedAt = new Date().toISOString(); }
                else updates.completed = false;
            }
            if (input.notes !== undefined) updates.notes = input.notes;
            conv.updateTask(input.taskId, updates);
            hub.broadcastAll('tasks_update', conv.getTasks());
            return `Task "${updates.title || task.title}" updated successfully.`;
        });
        hub.log('✅ update_task tool registered', 'info');

        // ── delete_milestone: AI deletes a milestone (with cascade option) ────
        tools.registerTool({
            name: 'delete_milestone',
            description: 'Delete a milestone. Choose whether to also delete its tasks or just unassign them.',
            input_schema: {
                type: 'object',
                properties: {
                    milestoneId: { type: 'string', description: 'The milestone ID to delete (use list_milestones to find IDs)' },
                    taskAction:  { type: 'string', enum: ['unassign', 'delete'], description: '"unassign" keeps tasks but removes milestone link (default). "delete" permanently removes the tasks too.' }
                },
                required: ['milestoneId']
            }
        }, (input) => {
            const conv = hub.getService('conversation');
            if (!conv) return 'ERROR: Conversation service not available';
            const milestones = conv.getMilestones ? conv.getMilestones() : [];
            const ms = milestones.find(m => m.id === input.milestoneId);
            if (!ms) return `ERROR: Milestone not found: "${input.milestoneId}". Use list_milestones to find IDs.`;
            const taskAction = input.taskAction || 'unassign';
            let taskCount = 0;
            if (taskAction === 'delete') {
                const msTasks = (conv.getTasks ? conv.getTasks() : []).filter(t => t.milestoneId === input.milestoneId);
                taskCount = msTasks.length;
                msTasks.forEach(t => conv.deleteTask(t.id));
            }
            conv.deleteMilestone(input.milestoneId);
            hub.log(`[delete_milestone] Deleted: "${ms.text}" (taskAction: ${taskAction})`, 'info');
            return `Milestone "${ms.text}" deleted. ${taskAction === 'delete' ? taskCount + ' associated task(s) also deleted.' : 'Tasks were unassigned (kept on board).'}`;
        });
        hub.log('✅ delete_milestone tool registered', 'info');

        // ── update_milestone: AI updates milestone fields ─────────────────────
        tools.registerTool({
            name: 'update_milestone',
            description: 'Update a milestone\'s name, description, color, or status.',
            input_schema: {
                type: 'object',
                properties: {
                    milestoneId: { type: 'string', description: 'The milestone ID to update' },
                    name:        { type: 'string', description: 'New milestone name' },
                    description: { type: 'string', description: 'New description' },
                    color:       { type: 'string', description: 'New hex color, e.g. "#58a6ff"' },
                    status:      { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'New status' }
                },
                required: ['milestoneId']
            }
        }, (input) => {
            const conv = hub.getService('conversation');
            if (!conv || !conv.updateMilestone) return 'ERROR: Conversation service not available';
            const milestones = conv.getMilestones ? conv.getMilestones() : [];
            const ms = milestones.find(m => m.id === input.milestoneId);
            if (!ms) return `ERROR: Milestone not found: "${input.milestoneId}". Use list_milestones to find IDs.`;
            const updates = {};
            if (input.name !== undefined)        updates.text = String(input.name).trim().substring(0, 120);
            if (input.description !== undefined) updates.description = String(input.description).trim().substring(0, 500);
            if (input.color !== undefined && /^#[0-9a-f]{3,6}$/i.test(input.color)) updates.color = input.color;
            if (input.status !== undefined)      updates.status = input.status;
            conv.updateMilestone(input.milestoneId, updates);
            hub.broadcast('roadmap_update', conv.getRoadmap ? conv.getRoadmap() : []);
            return `Milestone "${updates.text || ms.text}" updated.`;
        });
        hub.log('✅ update_milestone tool registered', 'info');

        // ── add_agent: AI creates a new team agent ────────────────────────────
        tools.registerTool({
            name: 'add_agent',
            description: 'Add a new agent to the team. The agent will immediately be available for task assignment.',
            input_schema: {
                type: 'object',
                properties: {
                    name:         { type: 'string', description: 'Agent name (kebab-case, e.g. "security-auditor")' },
                    role:         { type: 'string', description: 'Role title, e.g. "Security Auditor"' },
                    description:  { type: 'string', description: 'What this agent does and its expertise' },
                    capabilities: { type: 'array', items: { type: 'string' }, description: 'List of capability strings' },
                    group:        { type: 'string', description: 'Group/team name (e.g. "engineering", "qa")' }
                },
                required: ['name', 'role', 'description']
            }
        }, (input) => {
            const agentMgr = hub.getService('agentManager');
            if (!agentMgr || !agentMgr.addAgent) return 'ERROR: Agent manager service not available';
            const name = String(input.name).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/--+/g, '-').trim('-');
            if (!name) return 'ERROR: Invalid agent name — use lowercase letters, numbers, and hyphens only';
            try {
                const agent = agentMgr.addAgent({
                    name,
                    role: String(input.role).trim(),
                    description: String(input.description).trim(),
                    capabilities: Array.isArray(input.capabilities) ? input.capabilities : [],
                    group: input.group || 'custom'
                });
                hub.broadcastAll('agents_updated', {});
                hub.log(`[add_agent] Created: "${name}"`, 'success');
                return `Agent "${name}" created with role "${input.role}".`;
            } catch (e) {
                return `ERROR creating agent: ${e.message}`;
            }
        });
        hub.log('✅ add_agent tool registered', 'info');

        // ── remove_agent: AI removes a team agent ─────────────────────────────
        tools.registerTool({
            name: 'remove_agent',
            description: 'Remove an agent from the team. Use with care — existing task assignments using this agent will not be auto-removed.',
            input_schema: {
                type: 'object',
                properties: {
                    name:   { type: 'string', description: 'The agent name to remove (use list_agents to find names)' },
                    reason: { type: 'string', description: 'Optional reason for removal' }
                },
                required: ['name']
            }
        }, (input) => {
            const agentMgr = hub.getService('agentManager');
            if (!agentMgr || !agentMgr.removeAgent) return 'ERROR: Agent manager service not available';
            try {
                agentMgr.removeAgent(input.name);
                hub.broadcastAll('agents_updated', {});
                hub.log(`[remove_agent] Removed: "${input.name}"${input.reason ? ' — ' + input.reason : ''}`, 'info');
                return `Agent "${input.name}" removed.${input.reason ? ' Reason: ' + input.reason : ''}`;
            } catch (e) {
                return `ERROR removing agent: ${e.message}`;
            }
        });
        hub.log('✅ remove_agent tool registered', 'info');

        // ── list_agents: AI lists all team agents ─────────────────────────────
        tools.registerTool({
            name: 'list_agents',
            description: 'List all agents on the team with their names, roles, descriptions, and capabilities. Use this to see who is available before delegating or to check what agents exist before adding a new one.',
            input_schema: {
                type: 'object',
                properties: {
                    group: { type: 'string', description: 'Optional: filter by group name (e.g. "engineering", "qa", "custom")' }
                }
            }
        }, (input) => {
            const agentMgr = hub.getService('agentManager');
            if (!agentMgr || !agentMgr.listAgents) return 'ERROR: Agent manager service not available';
            try {
                const agents = agentMgr.listAgents();
                let filtered = agents;
                if (input.group) {
                    filtered = agents.filter(a => (a.group || '').toLowerCase() === input.group.toLowerCase());
                }
                if (!filtered.length) return input.group ? `No agents in group "${input.group}".` : 'No agents found.';
                const lines = filtered.map(a =>
                    `- **${a.name}** (${a.role || 'No role'}) [group: ${a.group || 'none'}]\n  ${a.description || 'No description'}` +
                    (a.capabilities && a.capabilities.length ? `\n  Capabilities: ${a.capabilities.join(', ')}` : '')
                );
                return `## Team Agents (${filtered.length})\n\n${lines.join('\n\n')}`;
            } catch (e) {
                return `ERROR listing agents: ${e.message}`;
            }
        });
        hub.log('✅ list_agents tool registered', 'info');

        // ── get_agent_info: get full details about one agent ───────────────────
        tools.registerTool({
            name: 'get_agent_info',
            description: 'Get detailed information about a specific agent: role, description, capabilities, group, system prompt, and allowed tools. Use list_agents first to find the agent name.',
            input_schema: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Agent name (e.g. "code-implementer", "testing-engineer")' }
                },
                required: ['name']
            }
        }, (input) => {
            const agentMgr = hub.getService('agentManager');
            if (!agentMgr) return 'ERROR: Agent manager not available';
            try {
                const agent = agentMgr.getAgent(input.name);
                if (!agent) return `ERROR: No agent found with name "${input.name}". Use list_agents to see all agents.`;
                const lines = [
                    `## Agent: ${agent.name}`,
                    `**Role:** ${agent.role || 'N/A'}`,
                    `**Group:** ${agent.group || 'none'}`,
                    `**Description:** ${agent.description || 'N/A'}`,
                    `**Capabilities:** ${(agent.capabilities || []).join(', ') || 'N/A'}`,
                    `**Languages:** ${(agent.languages || []).join(', ') || 'N/A'}`,
                    `**Security Role:** ${agent.securityRole || 'N/A'}`,
                ];
                if (agent.systemPrompt) lines.push(`**System Prompt:** ${agent.systemPrompt.substring(0, 300)}${agent.systemPrompt.length > 300 ? '...' : ''}`);
                return lines.join('\n');
            } catch (e) {
                return `ERROR: ${e.message}`;
            }
        });
        hub.log('✅ get_agent_info tool registered', 'info');

        // ── update_agent: AI modifies an existing agent ───────────────────────
        tools.registerTool({
            name: 'update_agent',
            description: 'Update an existing agent\'s properties: name, role, description, capabilities, group, systemPrompt, or languages. Only provide the fields you want to change.',
            input_schema: {
                type: 'object',
                properties: {
                    name:         { type: 'string', description: 'Current agent name (used to look up the agent)' },
                    role:         { type: 'string', description: 'New role title' },
                    description:  { type: 'string', description: 'New description' },
                    capabilities: { type: 'array', items: { type: 'string' }, description: 'Replace capabilities list' },
                    group:        { type: 'string', description: 'Move agent to a different group' },
                    systemPrompt: { type: 'string', description: 'New system prompt for the agent' },
                    languages:    { type: 'array', items: { type: 'string' }, description: 'Programming languages the agent works with' }
                },
                required: ['name']
            }
        }, (input) => {
            const agentMgr = hub.getService('agentManager');
            if (!agentMgr) return 'ERROR: Agent manager not available';
            try {
                const agent = agentMgr.getAgent(input.name);
                if (!agent) return `ERROR: No agent found with name "${input.name}". Use list_agents to see available agents.`;
                const { name: _n, ...updates } = input;
                const result = agentMgr.updateAgent(agent.id || agent.name, updates);
                if (result && result.success === false) return `ERROR: ${result.error || 'Update failed'}`;
                return `Agent "${input.name}" updated successfully.${Object.keys(updates).length ? ' Changed: ' + Object.keys(updates).join(', ') : ''}`;
            } catch (e) {
                return `ERROR: ${e.message}`;
            }
        });
        hub.log('✅ update_agent tool registered', 'info');

        // ── list_agent_groups: list all agent groups ───────────────────────────
        tools.registerTool({
            name: 'list_agent_groups',
            description: 'List all agent groups with their names, descriptions, and agent counts.',
            input_schema: { type: 'object', properties: {} }
        }, () => {
            const agentMgr = hub.getService('agentManager');
            if (!agentMgr) return 'ERROR: Agent manager not available';
            try {
                const groups = agentMgr.listGroups();
                if (!groups || !groups.length) return 'No groups defined yet.';
                const lines = groups.map(g =>
                    `- **${g.name}** (id: ${g.id}): ${g.description || 'No description'} — ${g.agentCount || 0} agent(s)`
                );
                return `## Agent Groups (${groups.length})\n\n${lines.join('\n')}`;
            } catch (e) {
                return `ERROR: ${e.message}`;
            }
        });
        hub.log('✅ list_agent_groups tool registered', 'info');

        // ── create_agent_group: create a new group ─────────────────────────────
        tools.registerTool({
            name: 'create_agent_group',
            description: 'Create a new agent group to organize agents by department or function (e.g. "engineering", "qa", "devops").',
            input_schema: {
                type: 'object',
                properties: {
                    name:        { type: 'string', description: 'Group name (e.g. "security", "data-team")' },
                    description: { type: 'string', description: 'What this group is for' },
                    color:       { type: 'string', description: 'Optional hex color for the group badge (e.g. "#4CAF50")' }
                },
                required: ['name']
            }
        }, (input) => {
            const agentMgr = hub.getService('agentManager');
            if (!agentMgr) return 'ERROR: Agent manager not available';
            try {
                const result = agentMgr.createGroup({ name: input.name, description: input.description || '', color: input.color });
                if (result && result.success === false) return `ERROR: ${result.error || 'Create failed'}`;
                return `Group "${input.name}" created successfully.`;
            } catch (e) {
                return `ERROR: ${e.message}`;
            }
        });
        hub.log('✅ create_agent_group tool registered', 'info');

        // ── update_agent_group: rename or re-describe a group ─────────────────
        tools.registerTool({
            name: 'update_agent_group',
            description: 'Update an existing agent group\'s name, description, or color.',
            input_schema: {
                type: 'object',
                properties: {
                    group_id:    { type: 'string', description: 'Group ID or current name' },
                    name:        { type: 'string', description: 'New name for the group' },
                    description: { type: 'string', description: 'New description' },
                    color:       { type: 'string', description: 'New hex color' }
                },
                required: ['group_id']
            }
        }, (input) => {
            const agentMgr = hub.getService('agentManager');
            if (!agentMgr) return 'ERROR: Agent manager not available';
            try {
                const { group_id, ...updates } = input;
                const result = agentMgr.updateGroup(group_id, updates);
                if (result && result.success === false) return `ERROR: ${result.error || 'Update failed'}`;
                return `Group "${group_id}" updated successfully.`;
            } catch (e) {
                return `ERROR: ${e.message}`;
            }
        });
        hub.log('✅ update_agent_group tool registered', 'info');

        // ── delete_agent_group: remove a group ────────────────────────────────
        tools.registerTool({
            name: 'delete_agent_group',
            description: 'Delete an agent group. Agents in the group will remain but will no longer be associated with it.',
            input_schema: {
                type: 'object',
                properties: {
                    group_id: { type: 'string', description: 'Group ID or name to delete' }
                },
                required: ['group_id']
            }
        }, (input) => {
            const agentMgr = hub.getService('agentManager');
            if (!agentMgr) return 'ERROR: Agent manager not available';
            try {
                const result = agentMgr.deleteGroup(input.group_id);
                if (result && result.success === false) return `ERROR: ${result.error || 'Delete failed'}`;
                return `Group "${input.group_id}" deleted.`;
            } catch (e) {
                return `ERROR: ${e.message}`;
            }
        });
        hub.log('✅ delete_agent_group tool registered', 'info');

        // ── add_agent_to_group: move an agent into a group ────────────────────
        tools.registerTool({
            name: 'add_agent_to_group',
            description: 'Add an existing agent to a group. Use list_agents and list_agent_groups to find the names/IDs.',
            input_schema: {
                type: 'object',
                properties: {
                    agent_name: { type: 'string', description: 'Agent name' },
                    group_id:   { type: 'string', description: 'Group ID or name' }
                },
                required: ['agent_name', 'group_id']
            }
        }, (input) => {
            const agentMgr = hub.getService('agentManager');
            if (!agentMgr) return 'ERROR: Agent manager not available';
            try {
                const agent = agentMgr.getAgent(input.agent_name);
                if (!agent) return `ERROR: Agent "${input.agent_name}" not found.`;
                const result = agentMgr.addAgentToGroup(agent.id || agent.name, input.group_id);
                if (result && result.success === false) return `ERROR: ${result.error || 'Failed'}`;
                return `Agent "${input.agent_name}" added to group "${input.group_id}".`;
            } catch (e) {
                return `ERROR: ${e.message}`;
            }
        });
        hub.log('✅ add_agent_to_group tool registered', 'info');

        // ── remove_agent_from_group: unassign an agent from its group ─────────
        tools.registerTool({
            name: 'remove_agent_from_group',
            description: 'Remove an agent from its current group (the agent is not deleted, just ungrouped).',
            input_schema: {
                type: 'object',
                properties: {
                    agent_name: { type: 'string', description: 'Agent name to remove from its group' }
                },
                required: ['agent_name']
            }
        }, (input) => {
            const agentMgr = hub.getService('agentManager');
            if (!agentMgr) return 'ERROR: Agent manager not available';
            try {
                const agent = agentMgr.getAgent(input.agent_name);
                if (!agent) return `ERROR: Agent "${input.agent_name}" not found.`;
                const result = agentMgr.removeAgentFromGroup(agent.id || agent.name);
                if (result && result.success === false) return `ERROR: ${result.error || 'Failed'}`;
                return `Agent "${input.agent_name}" removed from its group.`;
            } catch (e) {
                return `ERROR: ${e.message}`;
            }
        });
        hub.log('✅ remove_agent_from_group tool registered', 'info');

        // ── list_projects: list all projects ──────────────────────────────────
        tools.registerTool({
            name: 'list_projects',
            description: 'List all projects. Shows each project\'s name, description, working directory, and whether it is currently active.',
            input_schema: { type: 'object', properties: {} }
        }, () => {
            const projects = hub.getService('projects');
            if (!projects) return 'ERROR: Projects service not available';
            try {
                const list = projects.listProjects();
                if (!list || !list.length) return 'No projects yet. Use create_project to start one.';
                const activeId = projects.getActiveProjectId ? projects.getActiveProjectId() : null;
                const lines = list.map(p =>
                    `- **${p.name}** (id: ${p.id})${p.id === activeId ? ' [ACTIVE]' : ''}: ${p.description || 'No description'} — dir: ${p.workingDir || 'default'}`
                );
                return `## Projects (${list.length})\n\n${lines.join('\n')}`;
            } catch (e) {
                return `ERROR: ${e.message}`;
            }
        });
        hub.log('✅ list_projects tool registered', 'info');

        // ── get_project: get full details for one project ─────────────────────
        tools.registerTool({
            name: 'get_project',
            description: 'Get full details about a specific project including its description, working directory, linked agents, and metadata.',
            input_schema: {
                type: 'object',
                properties: {
                    project_id: { type: 'string', description: 'Project ID or name' }
                },
                required: ['project_id']
            }
        }, (input) => {
            const projects = hub.getService('projects');
            if (!projects) return 'ERROR: Projects service not available';
            try {
                const p = projects.getProject(input.project_id);
                if (!p) return `ERROR: No project found with id/name "${input.project_id}". Use list_projects to see all.`;
                const lines = [
                    `## Project: ${p.name}`,
                    `**ID:** ${p.id}`,
                    `**Description:** ${p.description || 'N/A'}`,
                    `**Working Dir:** ${p.workingDir || 'default'}`,
                    `**Created:** ${p.createdAt ? new Date(p.createdAt).toLocaleString() : 'N/A'}`,
                ];
                return lines.join('\n');
            } catch (e) {
                return `ERROR: ${e.message}`;
            }
        });
        hub.log('✅ get_project tool registered', 'info');

        // ── create_project: create a new project ──────────────────────────────
        tools.registerTool({
            name: 'create_project',
            description: 'Create a new project. Projects let you organize work with separate tasks, agents, and working directories.',
            input_schema: {
                type: 'object',
                properties: {
                    name:        { type: 'string', description: 'Project name' },
                    description: { type: 'string', description: 'What this project is for' },
                    workingDir:  { type: 'string', description: 'Absolute path to the project\'s working directory' }
                },
                required: ['name']
            }
        }, async (input) => {
            const projects = hub.getService('projects');
            if (!projects) return 'ERROR: Projects service not available';
            try {
                const p = await projects.createProject({ name: input.name, description: input.description || '', workingDir: input.workingDir });
                if (p && p.error) return `ERROR: ${p.error}`;
                return `Project "${input.name}" created (id: ${p.id || 'unknown'}). Use switch_project to activate it.`;
            } catch (e) {
                return `ERROR: ${e.message}`;
            }
        });
        hub.log('✅ create_project tool registered', 'info');

        // ── update_project: modify an existing project ────────────────────────
        tools.registerTool({
            name: 'update_project',
            description: 'Update a project\'s name, description, or working directory.',
            input_schema: {
                type: 'object',
                properties: {
                    project_id:  { type: 'string', description: 'Project ID or name to update' },
                    name:        { type: 'string', description: 'New name' },
                    description: { type: 'string', description: 'New description' },
                    workingDir:  { type: 'string', description: 'New working directory path' }
                },
                required: ['project_id']
            }
        }, async (input) => {
            const projects = hub.getService('projects');
            if (!projects) return 'ERROR: Projects service not available';
            try {
                const { project_id, ...updates } = input;
                const result = await projects.updateProject(project_id, updates);
                if (result && result.error) return `ERROR: ${result.error}`;
                return `Project "${project_id}" updated.`;
            } catch (e) {
                return `ERROR: ${e.message}`;
            }
        });
        hub.log('✅ update_project tool registered', 'info');

        // ── delete_project: delete a project ──────────────────────────────────
        tools.registerTool({
            name: 'delete_project',
            description: 'Delete a project and all its data. This is irreversible. The project\'s tasks and agents are removed.',
            input_schema: {
                type: 'object',
                properties: {
                    project_id: { type: 'string', description: 'Project ID or name to delete' }
                },
                required: ['project_id']
            }
        }, async (input) => {
            const projects = hub.getService('projects');
            if (!projects) return 'ERROR: Projects service not available';
            try {
                const result = await projects.deleteProject(input.project_id);
                if (result && result.error) return `ERROR: ${result.error}`;
                return `Project "${input.project_id}" deleted.`;
            } catch (e) {
                return `ERROR: ${e.message}`;
            }
        });
        hub.log('✅ delete_project tool registered', 'info');

        // ── switch_project: change the active project ──────────────────────────
        tools.registerTool({
            name: 'switch_project',
            description: 'Switch to a different project, making it the active context. Tasks, agents, and working directory will switch to the selected project.',
            input_schema: {
                type: 'object',
                properties: {
                    project_id: { type: 'string', description: 'Project ID or name to activate' }
                },
                required: ['project_id']
            }
        }, async (input) => {
            const projects = hub.getService('projects');
            if (!projects) return 'ERROR: Projects service not available';
            try {
                const result = await projects.switchProject(input.project_id);
                if (result && result.error) return `ERROR: ${result.error}`;
                return `Switched to project "${input.project_id}". This is now the active project.`;
            } catch (e) {
                return `ERROR: ${e.message}`;
            }
        });
        hub.log('✅ switch_project tool registered', 'info');

        // ── delegate_to_agent: orchestrator hands a task to a specialist agent ─
        tools.registerTool({
            name: 'delegate_to_agent',
            description: [
                'Delegate a subtask to a specialist AI agent and wait for their result.',
                'The agent runs its own full AI + tool cycle independently, then returns the output.',
                'Use this to divide work: code-implementer for coding, testing-engineer for tests,',
                'git-keeper for git operations, ui-expert for UI/CSS work.',
                'The agent\'s activity will appear on the Team panel while they work.',
                'Prefer this over doing everything yourself — your team exists to help you.'
            ].join(' '),
            input_schema: {
                type: 'object',
                properties: {
                    agent:   { type: 'string', description: 'Agent name, e.g. "code-implementer", "testing-engineer", "git-keeper", "ui-expert". Use list_agents to see all available.' },
                    task:    { type: 'string', description: 'Clear, self-contained task description. Include file paths, requirements, and expected output so the agent can work independently.' },
                    context: { type: 'string', description: 'Optional: additional context from this conversation that the agent needs (e.g. relevant code snippets, constraints, prior decisions).' }
                },
                required: ['agent', 'task']
            }
        }, async (input) => {
            const agentName = String(input.agent || '').trim().toLowerCase().replace(/_/g, '-');
            const task      = String(input.task || '').trim();
            if (!agentName) return 'ERROR: agent name is required';
            if (!task)      return 'ERROR: task description is required';

            // Validate agent exists
            const agentMgr = hub.getService('agentManager');
            const validAgents = agentMgr?.listAgents?.()?.map(a => a.name) || [];
            if (validAgents.length && !validAgents.includes(agentName)) {
                return `ERROR: Unknown agent "${agentName}". Available: ${validAgents.join(', ')}`;
            }

            const fullTask = input.context
                ? `${task}\n\n---\nAdditional context:\n${input.context}`
                : task;

            // Build task scope from input if provided
            const taskScope = {};
            if (input.taskId)     taskScope.taskId     = input.taskId;
            if (input.title)      taskScope.title       = input.title || task.substring(0, 80);
            if (input.workingDir) taskScope.workingDir  = input.workingDir;
            if (input.maxCycles)  taskScope.maxCycles   = input.maxCycles;
            if (!taskScope.title && task) taskScope.title = task.substring(0, 80);

            hub.log(`[delegate_to_agent] → ${agentName}: ${task.substring(0, 80)}`, 'info');
            try {
                const result = await dispatchAgentAndAwait(agentName, fullTask, taskScope);
                hub.log(`[delegate_to_agent] ← ${agentName} done`, 'success');
                return `[${agentName} result]\n${result}`;
            } catch (e) {
                hub.log(`[delegate_to_agent] ${agentName} error: ${e.message}`, 'error');
                return `ERROR from ${agentName}: ${e.message}`;
            }
        });
        hub.log('✅ delegate_to_agent tool registered', 'info');

        // ── message_agent: agent-to-agent messaging with depth guard ──────────
        tools.registerTool({
            name: 'message_agent',
            description: [
                'Send a note or task to another agent via the backchannel.',
                'Use when you (an agent) need to hand off work or share findings with a peer.',
                'type="task" = do this work; type="note" = FYI only; type="result" = here is what I found.',
                'Enforces a 2-level chain depth limit — will refuse if depth >= 2 to prevent runaway chains.',
                'DO NOT call this more than once per task.'
            ].join(' '),
            input_schema: {
                type: 'object',
                properties: {
                    agent:   { type: 'string', description: 'Target agent name (e.g. "testing-engineer", "code-implementer")' },
                    message: { type: 'string', description: 'What you need the agent to do or know. Be specific and self-contained.' },
                    type:    { type: 'string', enum: ['task', 'note', 'result'], description: 'task = do this; note = FYI; result = here is what I found' }
                },
                required: ['agent', 'message']
            }
        }, async (input) => {
            const targetAgent = String(input.agent || '').trim().toLowerCase().replace(/_/g, '-');
            const message     = String(input.message || '').trim();
            const msgType     = input.type || 'task';

            if (!targetAgent) return 'ERROR: agent name is required';
            if (!message)     return 'ERROR: message content is required';

            // Chain depth guard — prevent runaway delegation
            if (_agentChainDepth >= 2) {
                hub.log(`⛔ [message_agent] chain depth limit reached (depth:${_agentChainDepth}) — blocked message to ${targetAgent}`, 'warn');
                hub.broadcast('log', { text: `⛔ Agent chain depth limit reached — message to ${targetAgent} blocked`, type: 'warn' });
                return `⛔ Agent chain depth limit reached (depth: ${_agentChainDepth}). Log this as a note for the orchestrator instead of triggering more agents.`;
            }

            // Validate target agent exists
            const agentMgr = hub.getService('agentManager');
            const validAgents = agentMgr?.listAgents?.()?.map(a => a.name) || [];
            if (validAgents.length && !validAgents.includes(targetAgent)) {
                return `ERROR: Unknown agent "${targetAgent}". Available: ${validAgents.join(', ')}`;
            }

            const senderName = orchestrationState.agent || 'orchestrator';
            const ts = Date.now();

            // Push to backchannel for feed visibility (purple chip in Activity)
            const backMsg = {
                from: senderName,
                to: targetAgent,
                content: message,
                type: `agent_to_agent_${msgType}`,
                ts
            };
            hub.emit('backchannel_push', backMsg);

            // Fire-and-forget agent session (non-blocking — don't chain depth further)
            const prefix = msgType === 'task'   ? `[Task from ${senderName}]: ` :
                           msgType === 'result'  ? `[Result from ${senderName}]: ` :
                                                   `[Note from ${senderName}]: `;
            hub.log(`[message_agent] ${senderName} → ${targetAgent} (${msgType}): ${message.substring(0, 80)}`, 'info');

            const orch = hub.getService('orchestration');
            if (orch?.runAgentSession) {
                orch.runAgentSession(targetAgent, prefix + message);
            } else {
                runAgentSession(targetAgent, prefix + message);
            }

            return `✅ Message sent to ${targetAgent} (type: ${msgType}). They will act on it independently.`;
        });
        hub.log('✅ message_agent tool registered', 'info');

        // ── get_config: AI reads current configuration ────────────────────────
        tools.registerTool({
            name: 'get_config',
            description: 'Read one or all current configuration values. Use this to check settings before changing them.',
            input_schema: {
                type: 'object',
                properties: {
                    key: { type: 'string', description: 'Config key to read. Omit to get all persistent config values.' }
                }
            }
        }, (input) => {
            const config = hub.getService('config');
            if (!config) return 'ERROR: Config service not available';
            const PERSISTENT_KEYS = [
                'model', 'customInstructions', 'projectMemory',
                'autoQA', 'autoQALint', 'autoQATypes', 'autoQATests',
                'autoCompact', 'compactKeepRecent',
                'maxAICycles', 'maxQAAttempts', 'approvalTimeoutMs', 'requestTimeoutMs',
                'sessionNotesLines', 'timelineLines',
                'rateLimitTokens', 'rateLimitRefillRate', 'messageQueueSize',
                'chatMode', 'maxParallelAgents', 'autoCreateIssues',
                'referenceDocumentation', 'taskEnforcement'
            ];
            if (input.key) {
                if (!PERSISTENT_KEYS.includes(input.key)) return `Unknown config key: "${input.key}". Valid keys: ${PERSISTENT_KEYS.join(', ')}`;
                return `${input.key} = ${JSON.stringify(config[input.key])}`;
            }
            return PERSISTENT_KEYS.map(k => `${k} = ${JSON.stringify(config[k])}`).join('\n');
        });
        hub.log('✅ get_config tool registered', 'info');

        // ── set_config: AI changes a configuration setting persistently ───────
        tools.registerTool({
            name: 'set_config',
            description: 'Change a configuration setting. Changes persist across server restarts. A 🤖 badge will appear in the settings UI next to AI-configured items.',
            input_schema: {
                type: 'object',
                properties: {
                    key:   { type: 'string', description: 'Config key. Valid: model, customInstructions, projectMemory, autoQA, autoQALint, autoQATypes, autoQATests, autoCompact, compactKeepRecent, maxAICycles, maxQAAttempts, approvalTimeoutMs, requestTimeoutMs, sessionNotesLines, timelineLines, chatMode, maxParallelAgents, taskEnforcement' },
                    value: { type: 'string', description: 'New value as string. Booleans: "true"/"false". Numbers: e.g. "300". Strings: as-is.' }
                },
                required: ['key', 'value']
            }
        }, (input) => {
            const config = hub.getService('config');
            if (!config) return 'ERROR: Config service not available';
            const BOOL_KEYS = ['autoQA', 'autoQALint', 'autoQATypes', 'autoQATests', 'autoCompact', 'autoCreateIssues', 'taskEnforcement', 'strictCompletion', 'noTruncate', 'alwaysSecurity', 'neverStripFeatures'];
            const NUM_KEYS = ['compactKeepRecent', 'maxAICycles', 'maxQAAttempts', 'approvalTimeoutMs', 'requestTimeoutMs', 'sessionNotesLines', 'timelineLines', 'rateLimitTokens', 'rateLimitRefillRate', 'messageQueueSize', 'maxParallelAgents'];
            const SETTABLE = ['model', 'customInstructions', 'projectMemory', 'chatMode', 'referenceDocumentation', ...BOOL_KEYS, ...NUM_KEYS];
            if (!SETTABLE.includes(input.key)) return `ERROR: Cannot set "${input.key}". Settable keys: ${SETTABLE.join(', ')}`;

            let value = input.value;
            if (BOOL_KEYS.includes(input.key)) value = (value === 'true' || value === '1');
            else if (NUM_KEYS.includes(input.key)) {
                value = parseFloat(value);
                if (isNaN(value)) return `ERROR: "${input.value}" is not a valid number for key "${input.key}"`;
            }
            const oldValue = config[input.key];
            config[input.key] = value;

            // Track AI-set keys for UI indicator
            if (!Array.isArray(config._aiSet)) config._aiSet = [];
            if (!config._aiSet.includes(input.key)) config._aiSet.push(input.key);

            if (typeof config.save === 'function') config.save();

            // Notify orchestration of updated limits
            const orch = hub.getService('orchestration');
            if (orch && orch._updateLimits) orch._updateLimits(config);

            // Broadcast to all clients so settings UI updates
            hub.broadcastAll('config_updated_by_ai', { key: input.key, value, oldValue, aiSet: config._aiSet });

            hub.log(`[set_config] ${input.key}: ${JSON.stringify(oldValue)} → ${JSON.stringify(value)} (by AI)`, 'info');
            return `Config updated: ${input.key} = ${JSON.stringify(value)} (persisted, was: ${JSON.stringify(oldValue)})`;
        });
        hub.log('✅ set_config tool registered', 'info');

        // ── add_reminder: AI sets a timed reminder ────────────────────────────
        tools.registerTool({
            name: 'add_reminder',
            description: 'Set a reminder that fires at a specific time. Supports natural language: "in 30 minutes", "in 2 hours", "in 1 day". The reminder will appear as a toast notification and in the reminders list.',
            input_schema: {
                type: 'object',
                properties: {
                    text:   { type: 'string', description: 'What to remind about' },
                    when:   { type: 'string', description: 'When to fire: "in 30 minutes", "in 2 hours", "in 1 day", "in 1 week", or ISO 8601 datetime string' },
                    repeat: { type: 'string', enum: ['none', 'hourly', 'daily', 'weekly'], description: 'Repeat interval (default: none — one-shot)' }
                },
                required: ['text', 'when']
            }
        }, (input) => {
            const fs = require('fs');
            const remPath = require('path').join(require('os').homedir(), '.overlord', 'reminders.json');
            fs.mkdirSync(require('path').dirname(remPath), { recursive: true });
            let reminders = [];
            try { reminders = JSON.parse(fs.readFileSync(remPath, 'utf8')); } catch (_) {}

            // Parse "when" string → dueAt timestamp
            const when = String(input.when).toLowerCase().trim();
            let dueAt;
            const now = Date.now();
            const matchIn = when.match(/^in\s+(\d+(?:\.\d+)?)\s+(minute|minutes|hour|hours|day|days|week|weeks?)$/);
            if (matchIn) {
                const n = parseFloat(matchIn[1]);
                const unit = matchIn[2].replace(/s$/, '');
                const ms = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000 }[unit] || 60000;
                dueAt = now + Math.round(n * ms);
            } else {
                const d = new Date(input.when);
                if (isNaN(d.getTime())) return `ERROR: Cannot parse time "${input.when}". Use "in 30 minutes", "in 2 hours", "in 1 day", or ISO 8601 format.`;
                dueAt = d.getTime();
            }

            const id = 'rem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
            reminders.push({
                id, text: String(input.text).trim(),
                dueAt, repeat: input.repeat && input.repeat !== 'none' ? input.repeat : null,
                dismissed: false, createdAt: new Date().toISOString()
            });
            fs.writeFileSync(remPath, JSON.stringify(reminders, null, 2));
            const dueDate = new Date(dueAt).toLocaleString();
            hub.log(`[add_reminder] Set: "${input.text}" at ${dueDate}`, 'info');
            return `Reminder set: "${input.text}" — fires at ${dueDate}${input.repeat && input.repeat !== 'none' ? ' (repeats ' + input.repeat + ')' : ''}`;
        });
        hub.log('✅ add_reminder tool registered', 'info');

        // ── list_reminders: AI lists upcoming reminders ───────────────────────
        tools.registerTool({
            name: 'list_reminders',
            description: 'List all upcoming (non-dismissed) reminders.',
            input_schema: { type: 'object', properties: {} }
        }, () => {
            const fs = require('fs');
            const remPath = require('path').join(require('os').homedir(), '.overlord', 'reminders.json');
            let reminders = [];
            try { reminders = JSON.parse(fs.readFileSync(remPath, 'utf8')); } catch (_) {}
            const upcoming = reminders.filter(r => !r.dismissed);
            if (!upcoming.length) return 'No reminders set.';
            return upcoming.map(r =>
                `[${r.id}] ${r.text} — due ${new Date(r.dueAt).toLocaleString()}${r.repeat ? ' (repeats ' + r.repeat + ')' : ''}`
            ).join('\n');
        });
        hub.log('✅ list_reminders tool registered', 'info');

        // ── dismiss_reminder: AI dismisses a reminder ─────────────────────────
        tools.registerTool({
            name: 'dismiss_reminder',
            description: 'Dismiss a reminder so it no longer fires.',
            input_schema: {
                type: 'object',
                properties: { id: { type: 'string', description: 'Reminder ID (from list_reminders)' } },
                required: ['id']
            }
        }, (input) => {
            const fs = require('fs');
            const remPath = require('path').join(require('os').homedir(), '.overlord', 'reminders.json');
            let reminders = [];
            try { reminders = JSON.parse(fs.readFileSync(remPath, 'utf8')); } catch (_) {}
            const rem = reminders.find(r => r.id === input.id);
            if (!rem) return `ERROR: Reminder "${input.id}" not found.`;
            rem.dismissed = true;
            fs.writeFileSync(remPath, JSON.stringify(reminders, null, 2));
            return `Reminder dismissed: "${rem.text}"`;
        });
        hub.log('✅ dismiss_reminder tool registered', 'info');

        // ── handoff_to_orchestrator: PM hands off work to AUTO mode ──────────
        tools.registerTool({
            name: 'handoff_to_orchestrator',
            description: 'As Project Manager: hand off work to the Orchestrator. Switches the AI to AUTO mode, logs the handoff in session notes, and optionally creates tasks for the work.',
            input_schema: {
                type: 'object',
                properties: {
                    summary: {
                        type: 'string',
                        description: 'Summary of what is being handed off and any relevant context for the Orchestrator'
                    },
                    tasks: {
                        type: 'array',
                        description: 'Optional: tasks to create for the Orchestrator',
                        items: {
                            type: 'object',
                            properties: {
                                title:       { type: 'string' },
                                description: { type: 'string' },
                                priority:    { type: 'string', enum: ['low', 'normal', 'high'] }
                            },
                            required: ['title']
                        }
                    }
                },
                required: ['summary']
            }
        }, (input) => {
            const fs = require('fs');
            const notesPath = require('path').join(hub.getService('config')?.baseDir || process.cwd(), '.overlord', 'session-notes.md');
            fs.mkdirSync(require('path').dirname(notesPath), { recursive: true });
            const handoffEntry = `\n## PM HANDOFF [${new Date().toISOString()}]\n${input.summary}\n`;
            try { fs.appendFileSync(notesPath, handoffEntry); } catch (_) {}

            // Create any specified tasks
            let created = 0;
            if (Array.isArray(input.tasks) && input.tasks.length > 0) {
                const conv = hub.getService('conversation');
                if (conv && conv.addTask) {
                    input.tasks.forEach(def => {
                        const task = {
                            id: 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                            title: String(def.title).trim().substring(0, 120),
                            description: String(def.description || '').trim().substring(0, 500),
                            priority: ['low', 'normal', 'high'].includes(def.priority) ? def.priority : 'normal',
                            status: 'pending', completed: false,
                            milestoneId: null, assignee: [],
                            actions: { test: false, lint: false, approval: false },
                            createdAt: new Date().toISOString()
                        };
                        conv.addTask(task);
                        created++;
                    });
                }
            }

            // Switch to AUTO mode
            const config = hub.getService('config');
            if (config) config.chatMode = 'auto';
            hub.broadcastAll('mode_changed', { mode: 'auto' });
            hub.log('[handoff_to_orchestrator] PM handed off to Orchestrator', 'info');

            return `Handoff recorded. ${created > 0 ? created + ' task(s) created. ' : ''}Switched to AUTO (Orchestrator) mode. Session notes updated.`;
        });
        hub.log('✅ handoff_to_orchestrator tool registered', 'info');
    })();

    // ── Reminder check loop ───────────────────────────────────────────────────
    (function startReminderLoop() {
        const fs = require('fs');
        const remPath = require('path').join(require('os').homedir(), '.overlord', 'reminders.json');
        const REPEAT_MS = { hourly: 3600000, daily: 86400000, weekly: 604800000 };
        setInterval(() => {
            let reminders;
            try { reminders = JSON.parse(fs.readFileSync(remPath, 'utf8')); } catch (_) { return; }
            const now = Date.now();
            let changed = false;
            reminders.filter(r => !r.dismissed && r.dueAt <= now).forEach(r => {
                hub.broadcastAll('reminder_due', { id: r.id, text: r.text });
                if (r.repeat && REPEAT_MS[r.repeat]) {
                    r.dueAt = now + REPEAT_MS[r.repeat];
                } else {
                    r.dismissed = true;
                }
                changed = true;
            });
            if (changed) try { fs.writeFileSync(remPath, JSON.stringify(reminders, null, 2)); } catch (_) {}
        }, 60000);
    })();

    hub.log('⚙️ Orchestration module loaded', 'success');
}

function handleClientConnected(socket) {
    // Send initial state to new client
    const conv = hub.getService('conversation');
    const agents = hub.getService('agents');

    // CRITICAL: Get the actual working directory from conversation service
    const workingDirectory = conv.getWorkingDirectory ? conv.getWorkingDirectory() : process.cwd();

    // Safely get agent list — prefer DB (agentManager) so team panel matches Agent Manager UI
    let team = [];
    try {
        const agentMgr = hub.getService('agentManager');
        if (agentMgr && agentMgr.listAgents) {
            const dbAgents = agentMgr.listAgents();
            team = dbAgents.map(a => ({
                name: a.name,
                role: a.role,
                description: a.description || '',
                capabilities: a.capabilities || [],
                status: a.status || 'IDLE'
            }));
        } else {
            team = agents ? agents.getAgentList() : [];
        }
    } catch (e) {
        hub.log('Could not get agent list: ' + e.message, 'warn');
        try { team = agents ? agents.getAgentList() : []; } catch (_) {}
    }

    const state = {
        conversationId: conv.getId(),
        messages: conv.getHistory().map(m => ({ role: m.role, content: m.content })),
        roadmap: conv.getRoadmap(),
        team: team,
        workingDir: workingDirectory,
        tasks: conv.getTasks ? conv.getTasks() : [],
        config: { apiKeyLoaded: (hub.getService('config').apiKey || '').length > 10 }
    };

    hub.emitTo(socket, 'init', state);

    // Send "Ready" status so status bar clears "Connecting..."
    hub.emitTo(socket, 'status_update', { text: 'Ready', status: 'normal' });

    // Immediately send context stats so status bar shows real values on connect
    try {
        const contextUsage = conv.getContextUsage ? conv.getContextUsage() : null;
        if (contextUsage) {
            const tracker = hub.getService('contextTracker');
            const compactionCount = tracker?.getCompactionStats?.()?.totalCompactions || 0;
            hub.emitTo(socket, 'context_warning', { ...contextUsage, compactionCount });
        }
    } catch (e) {}

    hub.log('Client initialized with working dir: ' + workingDirectory, 'info');
}

async function handleUserMessage(text, socket) {
    if (isProcessing) {
        // Queue the message instead of dropping it silently
        hub.queueUserMessage(text);
        // Broadcast full queue so clients can render the management panel
        hub.broadcastQueue();
        return;
    }

    // Block new messages while awaiting plan approval
    if (awaitingPlanApproval) {
        hub.broadcast('approval_request_notice', {
            message: 'A plan is awaiting approval. Use the plan bar to Approve, Cancel, or Revise before sending a new message.'
        });
        return;
    }

    cycleDepth = 0; // Reset cycle counter for each new user message

    // Check for direct agent commands
    // Patterns: "agent: task", "ask agent to task", "agent do task"
    let agentCommandMatch = text.match(/^(\w+[-_]?\w*):\s*(.+)$/i);

    if (!agentCommandMatch) {
        agentCommandMatch = text.match(/^(?:ask|tell|have|get)\s+(\w+[-_]?\w*)\s+to\s+(.+)$/i);
    }

    if (!agentCommandMatch) {
        agentCommandMatch = text.match(/^(\w+[-_]?\w*)\s+(?:do|run|execute|check|show|get|list)\s+(.+)$/i);
    }

    if (agentCommandMatch) {
        const [, agentName, task] = agentCommandMatch;
        const normalizedAgent = agentName.toLowerCase().replace(/_/g, '-');

        const agentSystem = hub.getService('agentSystem');
        if (agentSystem && agentSystem.assignTask) {
            isProcessing = true;
            hub.status('⚡ Running agent...', 'tool');
            hub.log(`Direct agent command: ${normalizedAgent} -> ${task}`, 'info');

            try {
                const result = await agentSystem.assignTask(normalizedAgent, task);
                hub.addMessage('assistant', result);
                finishMainProcessing();
                return;
            } catch (e) {
                hub.addMessage('assistant', `❌ ERROR: ${e.message}`);
                isProcessing = false;
                hub.status('Error', 'error');
                setTimeout(() => hub.drainMessageQueue(), 80);
                return;
            }
        }
    }

    isProcessing = true;
    hub.status('🧠 Thinking...', 'thinking');

    const conv = hub.getService('conversation');
    const tools = hub.getService('tools');
    const ai = hub.getService('ai');
    const tokenMgr = hub.getService('tokenManager');

    // Add user message
    conv.addUserMessage(text);
    hub.addMessage('user', text);

    // Get history and apply token management
    let history = conv.getHistory();

    // CRITICAL FIX: Sanitize history and SAVE BACK to conversation
    // This prevents "tool_result references unknown id" errors
    if (tokenMgr && tokenMgr.sanitizeHistory) {
        const beforeCount = history.length;
        history = tokenMgr.sanitizeHistory(history);
        const removed = beforeCount - history.length;
        if (removed > 0) {
            hub.log(`[Orchestration] Cleaned ${removed} orphaned tool entries from history`, 'warning');
            // Save sanitized history back to conversation
            if (conv.replaceHistory) {
                conv.replaceHistory(history);
            }
        }
    }
    
    // Debug: validate history before API call
    if (tokenMgr && tokenMgr.validateHistory) {
        const validation = tokenMgr.validateHistory(history);
        if (!validation.valid) {
            hub.log('⚠️ History validation errors: ' + validation.errors.join('; '), 'error');
            // Attempt to fix by re-sanitizing
            history = tokenMgr.sanitizeHistory(history);
            // Save back again
            if (conv.replaceHistory) {
                conv.replaceHistory(history);
            }
            const revalidate = tokenMgr.validateHistory(history);
            if (!revalidate.valid) {
                hub.log('⚠️ Still invalid after re-sanitize: ' + revalidate.errors.join('; '), 'error');
            }
        }
    }

    // ── Pre-flight screenshot strip ────────────────────────────────────────
    // Screenshots (take_screenshot base64 payloads) are enormous — a 141 KB PNG
    // becomes ~48,000 token-equivalents in the message history.  Once the AI has
    // analyzed the image it has zero value in future turns, so we strip old ones
    // proactively.  We always keep the most-recent screenshot intact so the AI
    // can still reference it if needed.
    if (tokenMgr?.stripScreenshots && tokenMgr?.hasStrippableScreenshots) {
        const statsBeforeStrip = tokenMgr.getStats(history);
        if (statsBeforeStrip.usagePercent >= 55 && tokenMgr.hasStrippableScreenshots(history, 1)) {
            history = tokenMgr.stripScreenshots(history, 1); // keep last 1
            const statsAfter = tokenMgr.getStats(history);
            if (statsAfter.estimatedTokens < statsBeforeStrip.estimatedTokens) {
                hub.log(`📸 Screenshot base64 stripped: ${statsBeforeStrip.estimatedTokens} → ${statsAfter.estimatedTokens} tokens`, 'info');
                const convSvc = hub.getService('conversation');
                if (convSvc?.replaceHistory) convSvc.replaceHistory(history);
            }
        }
    }

    // Check token usage — try AI summarization first, fall back to hard truncation
    if (tokenMgr && tokenMgr.needsTruncation && tokenMgr.needsTruncation(history)) {
        const stats = tokenMgr.getStats(history);
        const cfg = hub.getService('config');
        const summarizer = hub.getService('summarizer');

        if (cfg?.autoCompact !== false && summarizer?.canCompact(history)) {
            hub.log(`🗜️ Auto-compacting context (at ${stats.usagePercent}% capacity)...`, 'warning');
            try {
                const conv = hub.getService('conversation');
                const compacted = await summarizer.compactHistory(history);
                history = compacted;
                if (conv?.replaceHistory) conv.replaceHistory(compacted);
            } catch (e) {
                hub.log(`⚠️ Auto-compact failed (${e.message}), falling back to truncation`, 'warn');
                history = tokenMgr.truncateHistory(history);
            }
        } else {
            hub.log(`⚠️ Truncating history (at ${stats.usagePercent}% capacity)`, 'warning');
            history = tokenMgr.truncateHistory(history);
        }
    }

    // Log token stats
    if (tokenMgr) {
        const stats = tokenMgr.getStats(history);
        hub.log(`📊 Context: ${stats.messages} msgs, ~${stats.estimatedTokens} tokens (${stats.usagePercent}%)`, 'info');
    }

    // ── Plan Mode: inject instruction to generate JSON task plan with milestone + assignees ──
    const cfg = hub.getService('config');
    if (cfg?.chatMode === 'plan') {
        const agentMgr = hub.getService('agentManager');
        const availableAgents = agentMgr?.listAgents?.()
            ?.map(a => a.name).join(', ') || 'orchestrator, code-implementer, testing-engineer, git-keeper';
        const planLength = cfg.planLength || 'regular';
        const lengthConstraints = {
            short:     'SHORT: 3–5 tasks maximum. Critical path only.',
            regular:   'REGULAR: 6–12 tasks. Balanced breadth and detail.',
            long:      'LONG: 10–20 tasks. Comprehensive, every sub-step explicit.',
            unlimited: 'UNLIMITED: No task count limit. Be as thorough as the work demands.'
        };
        const planInstruction =
            `[PLAN MODE] Output ONLY a JSON block with THREE plan variants — short, regular, and long — then stop.\n` +
            `The user's preferred length is "${planLength}".\n` +
            `\`\`\`json\n` +
            `{\n` +
            `  "preferred": "${planLength}",\n` +
            `  "milestone": "Short milestone name summarising this phase of work",\n` +
            `  "short":   { "tasks": [ {"title":"...", "description":"...", "priority":"normal","assignee":"agent","dependencies":[]} ] },\n` +
            `  "regular": { "tasks": [ {"title":"...", "description":"...", "priority":"normal","assignee":"agent","dependencies":[]} ] },\n` +
            `  "long":    { "tasks": [ {"title":"...", "description":"...", "priority":"normal","assignee":"agent","dependencies":[]} ] }\n` +
            `}\n` +
            `\`\`\`\n` +
            `Each task: title, description, priority (low/normal/high), assignee (exact agent name), dependencies (array of prior task titles that must be done first).\n` +
            `Available agents: ${availableAgents}\n` +
            `${lengthConstraints[planLength] || lengthConstraints.regular}\n` +
            `Do NOT use tools. Do NOT write code. Output ONLY the JSON block.`;
        history = [...history, { role: 'user', content: planInstruction }];
    }

    let currentContent = '';
    let toolCalls = [];
    let assistantMessage = { role: 'assistant', content: [] };
    let textBlock = { type: 'text', text: '' };
    let toolIndex = -1;
    let streamBuffer = '';
    let thinkingBuffer = '';
    let streamStartBroadcast = false;
    let _apiInputTokens = null;
    let _apiOutputTokens = null;

    try {
        await new Promise((resolve, reject) => {
            ai.chatStream(history, (event) => {
                if (event.type === 'content_block_start') {
                    if (event.content_block) {
                        // Signal client to create a new streaming assistant element
                        if (!streamStartBroadcast &&
                            (event.content_block.type === 'text' || event.content_block.type === 'thinking')) {
                            streamStartBroadcast = true;
                            hub.broadcast('stream_start', {});
                        }
                        if (event.content_block.type === 'tool_use') {
                            const tool = {
                                id: event.content_block.id,
                                name: event.content_block.name,
                                input: {}
                            };
                            toolCalls.push(tool);
                            toolIndex = toolCalls.length - 1;
                            hub.neural('\x00CHIP:' + JSON.stringify({ name: tool.name, id: tool.id }) + '\x00');
                            hub.log(`Preparing tool: ${tool.name} (id: ${tool.id})`, 'info');
                        }
                    }
                }
                else if (event.type === 'content_block_delta') {
                    if (event.delta.type === 'text_delta') {
                        textBlock.text += event.delta.text;
                        streamBuffer += event.delta.text;
                        hub.streamUpdate(streamBuffer);
                    }
                    else if (event.delta.type === 'thinking_delta') {
                        if (event.delta.thinking) {
                            thinkingBuffer += event.delta.thinking;
                            hub.neural(event.delta.thinking);
                        }
                    }
                    else if (event.delta.type === 'input_json_delta') {
                        currentContent += event.delta.partial_json;
                    }
                }
                else if (event.type === 'content_block_stop') {
                    if (toolIndex >= 0 && currentContent) {
                        try {
                            toolCalls[toolIndex].input = JSON.parse(currentContent);
                            hub.log('Tool ' + toolCalls[toolIndex].name + ' input parsed OK', 'info');
                        } catch (e) {
                            try {
                                let fixed = currentContent;
                                const opens = (fixed.match(/{/g) || []).length;
                                const closes = (fixed.match(/}/g) || []).length;
                                let c = closes;
                                while (c < opens) { fixed += '}'; c++; }
                                toolCalls[toolIndex].input = JSON.parse(fixed);
                                hub.log('Tool ' + toolCalls[toolIndex].name + ' input fixed and parsed', 'info');
                            } catch (e2) {
                                hub.log('JSON parse error: ' + e.message + ' - input: ' + currentContent.substring(0, 200), 'error');
                                toolCalls[toolIndex].input = {};
                            }
                        }
                        currentContent = '';
                    }
                    toolIndex = -1;
                }
                else if (event.type === 'message_start') {
                    // Capture input token count from the API response header
                    if (event.message?.usage?.input_tokens != null) {
                        _apiInputTokens = event.message.usage.input_tokens;
                    }
                }
                else if (event.type === 'message_delta') {
                    if (event.delta && event.delta.stop_reason) {
                        hub.log(`Response complete: ${event.delta.stop_reason}`, 'info');
                    }
                    // Capture output token count from the API response footer
                    if (event.usage?.output_tokens != null) {
                        _apiOutputTokens = event.usage.output_tokens;
                    }
                }
            },
            () => {
                if (textBlock.text.trim()) assistantMessage.content.push(textBlock);
                toolCalls.forEach(t => assistantMessage.content.push({
                    type: 'tool_use',
                    id: t.id,
                    name: t.name,
                    input: t.input
                }));
                if (thinkingBuffer) {
                    const words = thinkingBuffer.trim().split(/\s+/).filter(Boolean).length;
                    hub.broadcast('thinking_done', { words, chars: thinkingBuffer.length });
                }
                // Record actual API token usage for display in context window stats
                try {
                    const tracker = hub.getService('contextTracker');
                    if (tracker?.recordApiTokens) {
                        tracker.recordApiTokens(_apiInputTokens, _apiOutputTokens);
                    }
                } catch(e) {}
                // Push updated context stats to all clients immediately after each request
                try { hub.broadcastContextInfo?.(); } catch(e) {}
                resolve();
            },
            (err) => {
                hub.log(`API Error: ${describeError(err)}`, 'error');
                reject(err);
            });
        });

        // Add assistant message to conversation
        if (assistantMessage.content.length > 0) {
            conv.addAssistantMessage(assistantMessage);

            let textContent = assistantMessage.content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n\n');

            // ── Plan Mode: strip raw JSON block before displaying, show clean card ──
            if (cfg?.chatMode === 'plan' && !awaitingPlanApproval && !planExecutionActive) {
                const planResult = extractAndCreatePlanTasks(textContent);
                if (planResult.success) {
                    // Remove ```json ... ``` block from the displayed text
                    textContent = textContent.replace(/```json[\s\S]*?```/gi, '').trim();
                    // Remove bare JSON array if it was matched without fences
                    textContent = textContent.replace(/\[\s*\{[\s\S]*?\}\s*\]/g, '').trim();

                    // Append a clean plan table
                    const planRows = planResult.tasks.map((t, i) => {
                        const title = (t.title || '').trim().replace(/\|/g, '\\|');
                        const desc  = (t.description || '').trim().substring(0, 120).replace(/\|/g, '\\|') || '—';
                        const pri   = (t.priority && t.priority !== 'normal') ? t.priority : '—';
                        return `| ${i + 1} | ${title} | ${desc} | ${pri} |`;
                    }).join('\n');
                    const planHeader = '| # | Task | Description | Priority |\n|---|------|-------------|----------|';
                    textContent += (textContent ? '\n\n' : '') +
                        `📋 **Plan ready — ${planResult.tasks.length} task${planResult.tasks.length !== 1 ? 's' : ''}:**\n\n${planHeader}\n${planRows}\n\n*Use the approval bar above to approve, revise, or cancel.*`;

                    if (textContent.trim()) hub.addMessage('assistant', textContent);

                    awaitingPlanApproval = true;
                    pendingPlanTaskIds = planResult.taskIds;
                    // Store raw response text so clients can switch variants
                    pendingPlanRawText = assistantMessage.content.filter(c => c.type === 'text').map(c => c.text).join('\n\n');
                    hub.broadcastAll('plan_ready', {
                        taskCount: planResult.tasks.length,
                        multiVariant: !!(planResult.multiVariantData),
                        variants: planResult.multiVariantData ? Object.keys(planResult.multiVariantData).filter(k => ['short','regular','long'].includes(k)) : null,
                        preferred: planResult.multiVariantData?.preferred || cfg?.planLength || 'regular'
                    });
                    hub.status('Awaiting plan approval…', 'thinking');
                    hub.log(`[Plan] ${planResult.tasks.length} tasks created — awaiting approval`, 'info');
                    hub.sendPush('📋 Plan Ready',
                        `${planResult.tasks.length} task${planResult.tasks.length !== 1 ? 's' : ''} — tap to review and approve`,
                        { tag: 'overlord-plan' }
                    );

                    const decision = await waitForPlanDecision();
                    awaitingPlanApproval = false;

                    if (decision.action === 'approved') {
                        pendingPlanTaskIds = [];
                        // Add plan-approved message so plan table stays visible and a new
                        // assistant element exists for the execution streaming to write into
                        const planMd = planResult.tasks.map((t, i) =>
                            `${i + 1}. **${t.title}**${t.description ? ' — ' + t.description.substring(0, 80) : ''}`
                        ).join('\n');
                        hub.addMessage('assistant', `✅ **Plan Approved** — executing ${planResult.tasks.length} task${planResult.tasks.length !== 1 ? 's' : ''}…\n\n${planMd}`);
                        conv.addUserMessage('[PLAN APPROVED] Execute each step in sequence using tools. Begin immediately.');
                        isProcessing = true;
                        // Skip individual tool approval prompts during plan execution —
                        // the user already approved at the plan level.
                        planExecutionActive = true;
                        try {
                            await runAICycle();
                        } finally {
                            planExecutionActive = false;
                        }
                        return;
                    } else if (decision.action === 'cancelled') {
                        deletePendingPlanTasks(pendingPlanTaskIds);
                        pendingPlanTaskIds = [];
                        hub.broadcastAll('plan_cancelled_ack', {});
                        hub.addMessage('assistant', '**Plan cancelled.** Tasks cleared. What would you like to do?');
                        finishMainProcessing(); return;
                    } else if (decision.action === 'revised') {
                        deletePendingPlanTasks(pendingPlanTaskIds);
                        pendingPlanTaskIds = [];
                        hub.broadcastAll('plan_cancelled_ack', {});
                        conv.addUserMessage(`[PLAN REVISION] User feedback: "${decision.feedback}"\nRevise your plan and output a new JSON block only.`);
                        hub.addMessage('user', `Revision request: ${decision.feedback}`);
                        await runAICycle();
                        return;
                    }
                } else if (planResult.malformed) {
                    hub.addMessage('assistant', '⚠️ **Plan parsing failed** — could not parse JSON. Please try again.');
                    finishMainProcessing(); return;
                } else {
                    // No JSON found → show normal text, fall through
                    if (textContent.trim()) hub.addMessage('assistant', textContent);
                }
            } else {
                // Non-plan mode: display text as-is
                if (textContent.trim()) hub.addMessage('assistant', textContent);
            }
        }

        // Process tools with approval system
        if (toolCalls.length > 0) {
            hub.log('Processing ' + toolCalls.length + ' tool(s): ' + toolCalls.map(t => t.name + '(' + t.id + ')').join(', '), 'info');
            await executeToolsWithApproval(toolCalls);
        } else {
            finishMainProcessing();
        }

    } catch (e) {
        if (e.message === 'RATE_LIMITED') {
            // One automatic retry after rate limit pause (already waited 2s in ai-module)
            hub.log('⚠️ Rate limited — retrying once...', 'warning');
            hub.status('⏳ Rate limited — retrying...', 'thinking');
            try {
                await runAICycle();
            } catch (e2) {
                const desc2 = describeError(e2);
                hub.log(`❌ Retry failed: ${desc2}`, 'error');
                hub.addMessage('assistant', `❌ **Request failed after retry:** ${desc2}`);
                isProcessing = false;
                hub.status('Error', 'error');
                setTimeout(() => hub.drainMessageQueue(), 80);
            }
        } else if (isNetworkError(e)) {
            // ── Network error (ECONNRESET, socket hang up, etc.) — retry once ─
            const desc = describeError(e);
            hub.log(`⚠️ Network error — retrying in 3s: ${desc}`, 'warning');
            hub.status('⏳ Network error — retrying...', 'thinking');
            hub.addMessage('assistant', `⚠️ **Network hiccup** (${desc}) — retrying automatically in 3s…`);
            await new Promise(r => setTimeout(r, 3000));
            try {
                await runAICycle();
            } catch (e2) {
                const desc2 = describeError(e2);
                hub.log(`❌ Network retry failed: ${desc2}`, 'error');
                hub.addMessage('assistant', `❌ **Network retry failed:** ${desc2}\n\nCheck your connection and try sending again.`);
                isProcessing = false;
                hub.status('Network error — check connection', 'error');
                setTimeout(() => hub.drainMessageQueue(), 80);
            }
        } else if (
            (e.message || '').includes('400') &&
            (e.message.includes('context window') || e.message.includes('context_length') || e.message.includes('context_window'))
        ) {
            // ── Context window overflow recovery ─────────────────────────────
            // The API rejected the request because total tokens (history + system
            // prompt + tool defs) exceeded the model's context limit.  We recover
            // by stripping ALL screenshot base64 payloads, then aggressively
            // truncating history, then retrying exactly once.
            hub.log('⚠️ Context overflow (400) — stripping screenshots + compacting...', 'warning');
            hub.status('⚙️ Context recovery…', 'thinking');
            broadcastActivity('agent_activity', {
                type: 'context_recovery',
                tool: 'system',
                inputSummary: 'Context overflow — stripping screenshots and compacting history before retry'
            });

            try {
                const recConv    = hub.getService('conversation');
                const recTokMgr  = hub.getService('tokenManager');
                let recHistory   = recConv?.getHistory() || [];

                // 1. Strip ALL screenshot base64 (keepLast = 0 during emergency)
                if (recTokMgr?.stripScreenshots) {
                    recHistory = recTokMgr.stripScreenshots(recHistory, 0);
                    hub.log('📸 All screenshot base64 payloads stripped', 'info');
                }

                // 2. Aggressively truncate to 50% of normal history limit
                if (recTokMgr?.truncateHistory) {
                    const hardLimit = Math.floor((recTokMgr.CONFIG?.MAX_HISTORY_TOKENS || 83800) * 0.5);
                    recHistory = recTokMgr.truncateHistory(recHistory, hardLimit);
                    hub.log(`📉 History compacted to ≤${hardLimit} tokens`, 'info');
                }

                // 3. Save compacted history
                if (recConv?.replaceHistory) recConv.replaceHistory(recHistory);

                const recStats = recTokMgr?.getStats(recHistory);
                hub.log(`📊 Post-recovery context: ~${recStats?.estimatedTokens || '?'} tokens (${recStats?.usagePercent || '?'}%). Retrying...`, 'info');

                await runAICycle();
            } catch (e2) {
                hub.log(`❌ Context recovery failed: ${describeError(e2)}`, 'error');
                hub.addMessage('assistant',
                    '⚠️ **Context overflow** — I ran out of context space even after recovery. ' +
                    'The screenshot data was too large. Please start a new conversation to continue.');
                isProcessing = false;
                hub.status('Context overflow — start new chat', 'error');
                setTimeout(() => hub.drainMessageQueue(), 80);
            }
        } else {
            const desc = describeError(e);
            hub.log(`❌ Error: ${desc}`, 'error');
            hub.addMessage('assistant', `❌ **Error:** ${desc}`);
            isProcessing = false;
            hub.status(`Error: ${desc.substring(0, 60)}`, 'error');
            setTimeout(() => hub.drainMessageQueue(), 80);
        }
    }
}

// ==================== TOOL EXECUTION WITH APPROVAL ====================
// Follows ORDER_OF_OPERATIONS.md:
// 1. Classify tier  2. Check approval  3. Execute  4. Record  5. Check-in

async function executeToolsWithApproval(toolCalls) {
    const conv = hub.getService('conversation');
    const tools = hub.getService('tools');
    const agentSystem = hub.getService('agentSystem');

    // ── ORCHESTRATOR GUARDRAIL: block direct implementation tools ──────────
    // The orchestrator is the conductor — it MUST delegate to agents.
    // These tools are hard-blocked regardless of mode (bypass only disables
    // approval gates, not structural role constraints).
    const ORCH_BLOCKED_TOOLS = new Set([
        'write_file', 'patch_file', 'edit_file', 'apply_diff',
        'run_command', 'bash', 'execute_code', 'execute_shell'
    ]);
    // Suggested agent by tool — gives the AI a direct correction path
    const ORCH_TOOL_AGENT_MAP = {
        write_file: 'code-implementer', patch_file: 'code-implementer',
        edit_file: 'code-implementer',  apply_diff: 'code-implementer',
        run_command: 'testing-engineer', bash: 'testing-engineer',
        execute_code: 'testing-engineer', execute_shell: 'testing-engineer'
    };

    for (const tool of toolCalls) {
        // Hard-block implementation tools — must delegate
        if (ORCH_BLOCKED_TOOLS.has(tool.name)) {
            const suggestedAgent = ORCH_TOOL_AGENT_MAP[tool.name] || 'code-implementer';
            hub.log(`⛔ [ORCHESTRATOR] Blocked ${tool.name} — must delegate to ${suggestedAgent}`, 'warning');
            conv.addToolResult(tool.id,
                `⛔ ORCHESTRATOR ROLE VIOLATION: You called \`${tool.name}\` directly.\n` +
                `You are the conductor — you plan and delegate, never implement.\n\n` +
                `REQUIRED: delegate_to_agent(agent: "${suggestedAgent}", task: "<describe exactly what to do>")\n` +
                `Run list_agents() first if you need to see who is available.`
            );
            setOrchestratorState({ tool: null });
            continue;
        }

        hub.status(`🔧 Running: ${tool.name}`, 'tool');

        // Broadcast tool start activity — include full input for the live inspector
        const toolStartTime = Date.now();
        const inputSummary = JSON.stringify(tool.input || {}).substring(0, 120);
        broadcastActivity('tool_start', {
            tool:         tool.name,
            toolId:       tool.id,
            input:        tool.input || {},
            inputSummary,
            agent:        orchestrationState.agent || 'orchestrator',
            task:         orchestrationState.task,
            startedAt:    toolStartTime
        });
        setOrchestratorState({ tool: tool.name });

        // ── Ask Permissions mode: force user approval for every tool ──
        const activeCfg = hub.getService('config');
        let outputContent = '';

        // ── BYPASS mode: skip ALL approval gates, execute immediately ──
        if (activeCfg?.chatMode === 'bypass' || planExecutionActive) {
            if (activeCfg?.chatMode === 'bypass') {
                hub.log(`⚡ [BYPASS] Auto-approving ${tool.name} (bypass mode active)`, 'warning');
            }
            const bypassOutput = await tools.execute(tool);
            outputContent = (typeof bypassOutput === 'object' && bypassOutput.content) ? bypassOutput.content : String(bypassOutput);
        } else if (activeCfg?.chatMode === 'ask') {
            hub.broadcast('approval_request', {
                toolName: tool.name, toolId: tool.id, input: tool.input,
                tier: 3, confidence: 1.0,
                reasoning: 'Ask Permissions mode — all tools require approval',
                inputSummary: JSON.stringify(tool.input || {}).substring(0, 300)
            });
            hub.sendPush('⚠ Approval Required',
                `${tool.name} is waiting for your approval`,
                { requireInteraction: true, tag: 'overlord-approval' }
            );
            const askApproved = await waitForApproval(tool.id, APPROVAL_TIMEOUT_MS);
            if (!askApproved) {
                conv.addToolResult(tool.id, `[DENIED] ${tool.name}`);
                hub.addMessage('assistant', `❌ \`${tool.name}\` denied. Skipping.`);
                setOrchestratorState({ tool: null });
                continue;
            }
            const askOutput = await tools.execute(tool);
            outputContent = (typeof askOutput === 'object' && askOutput.content) ? askOutput.content : String(askOutput);
        } else {
            // Step 1: Classify approval tier
            let recommendation = null;
            let approvalResult = { approved: true, reason: 'No approval system' };

            if (agentSystem && agentSystem.classifyApprovalTier) {
                recommendation = agentSystem.classifyApprovalTier(tool.name, tool.input);
                hub.log(`🔒 [${tool.name}] Tier ${recommendation.tier} (confidence: ${recommendation.confidence.toFixed(2)}) - ${recommendation.reasoning}`, 'info');

                // Step 2: Check if approval is needed
                approvalResult = agentSystem.shouldProceed(recommendation);
            }

            if (approvalResult.approved) {
                // Step 3: Execute the tool
                hub.log(`✅ [${tool.name}] ${approvalResult.reason}`, 'info');
                const output = await tools.execute(tool);

                if (typeof output === 'object' && output.content) {
                    outputContent = output.content;
                } else {
                    outputContent = String(output);
                }

                hub.log(`[${tool.name}] completed`, 'success');

                // Step 4: Record decision
                if (agentSystem && agentSystem.recordDecision) {
                    agentSystem.recordDecision(
                        recommendation?.action || { type: tool.name },
                        recommendation || { tier: 1 },
                        recommendation?.tier || 1,
                        approvalResult.reason
                    );
                }
            } else if (approvalResult.escalate && approvalResult.tier >= 3) {
                // T3-T4: Need user approval — blocking wait with 5-minute timeout
                hub.log(`⚠️ [${tool.name}] Tier ${recommendation.tier} — awaiting user approval`, 'warning');

                // Emit approval request to all clients
                hub.broadcast('approval_request', {
                    toolName:    tool.name,
                    toolId:      tool.id,
                    input:       tool.input,
                    tier:        recommendation.tier,
                    confidence:  recommendation.confidence,
                    reasoning:   recommendation.reasoning,
                    inputSummary: JSON.stringify(tool.input || {}).substring(0, 300)
                });
                hub.sendPush('⚠ Approval Required',
                    `${tool.name} (Tier ${recommendation.tier}) is waiting for your approval`,
                    { requireInteraction: true, tag: 'overlord-approval' }
                );

                // Block until approval arrives or configurable timeout
                const userApproved = await waitForApproval(tool.id, APPROVAL_TIMEOUT_MS);

                if (!userApproved) {
                    outputContent = `[TOOL DENIED] ${tool.name} was denied by user. Stopping this tool execution.`;
                    hub.log(`❌ [${tool.name}] Denied by user`, 'warning');
                    hub.addMessage('assistant', `❌ **Denied**: \`${tool.name}\` was rejected by user approval. Skipping this action.`);
                    conv.addToolResult(tool.id, outputContent);
                    setOrchestratorState({ tool: null });
                    continue;
                }

                hub.log(`✅ [${tool.name}] Approved by user`, 'success');
                const output = await tools.execute(tool);
                if (typeof output === 'object' && output.content) {
                    outputContent = output.content;
                } else {
                    outputContent = String(output);
                }

                if (agentSystem && agentSystem.recordDecision) {
                    agentSystem.recordDecision(
                        recommendation.action,
                        recommendation,
                        recommendation.tier,
                        'Executed with warning - full blocking approval pending UI'
                    );
                }
            } else {
                // Escalated T2 with low confidence - still execute but note it
                hub.log(`⚠️ [${tool.name}] Low confidence, executing with note`, 'warning');
                const output = await tools.execute(tool);
                if (typeof output === 'object' && output.content) {
                    outputContent = output.content;
                } else {
                    outputContent = String(output);
                }

                if (agentSystem && agentSystem.recordDecision) {
                    agentSystem.recordDecision(
                        recommendation?.action || { type: tool.name },
                        recommendation || { tier: 2 },
                        2,
                        'Low confidence execution'
                    );
                }
            }
        }

        // Show in Tools panel
        hub.toolResult({
            tool: tool.name,
            input: tool.input,
            output: outputContent,
            timestamp: Date.now()
        });

        // ── AI Self-Correction: track consecutive errors ──────────────────
        const toolSucceeded = !outputContent.startsWith('ERROR') && !outputContent.startsWith('[TOOL DENIED]');
        if (toolSucceeded) {
            _consecutiveToolErrors = 0;
        } else {
            _consecutiveToolErrors++;
            const cfg = hub.getService('config');
            if (_consecutiveToolErrors >= 2 && cfg && cfg.autoCreateIssues) {
                const git = hub.getService('git');
                if (git && git.createIssue) {
                    const issueTitle = `[AI Self-Correction] ${tool.name} failed repeatedly`;
                    const issueBody = `## Error\n\`\`\`\n${outputContent.substring(0, 800)}\n\`\`\`\n\nTool: ${tool.name}\nContext: ${new Date().toISOString()}`;
                    git.createIssue(issueTitle, issueBody).then(issue => {
                        hub.broadcast('agent_activity', { type: 'issue_created', data: { title: issueTitle } });
                        hub.log('[AI Self-Correction] Issue created for repeated ' + tool.name + ' failure', 'warning');
                    }).catch(() => {});
                    _consecutiveToolErrors = 0; // Reset after filing issue
                }
            }
        }

        // Broadcast tool complete activity — include full output for the live inspector
        broadcastActivity('tool_complete', {
            tool:      tool.name,
            toolId:    tool.id,
            success:   toolSucceeded,
            output:    outputContent,
            durationMs: Date.now() - toolStartTime,
            agent:     orchestrationState.agent || 'orchestrator'
        });
        setOrchestratorState({ tool: null });

        // AutoQA: code-enforced quality gates after file writes
        // This is NOT a prompt instruction — it runs in code and injects errors into
        // the conversation history so the AI is forced to fix them.
        const fileWriteTools = ['write_file', 'patch_file', 'append_file'];
        if (fileWriteTools.includes(tool.name) && !outputContent.startsWith('ERROR')) {
            const filePath = tool.input?.path || tool.input?.file || '';
            broadcastActivity('qa_suggested', { file: filePath, tool: tool.name });
            const cfg = hub.getService('config');
            if (cfg?.autoQA !== false) {
                await runAutoQA(filePath, conv, tools);
            }
        }

        // Add tool result to history - MUST include matching tool_use_id
        conv.addToolResult(tool.id, outputContent);

        // Step 5: Periodic check-in
        if (agentSystem && agentSystem.maybeCheckIn) {
            agentSystem.maybeCheckIn();
        }
    }

    setOrchestratorState({ tool: null });

    // After ALL tools are executed and results added, continue conversation
    const tokenMgr = hub.getService('tokenManager');
    let history = conv.getHistory();
    if (tokenMgr && tokenMgr.sanitizeHistory) {
        history = tokenMgr.sanitizeHistory(history);
    }

    // Strip old screenshot base64 payloads immediately after any tool batch that
    // includes take_screenshot, to prevent ballooning context before the next cycle.
    if (tokenMgr?.stripScreenshots && tokenMgr?.hasStrippableScreenshots) {
        const preStats = tokenMgr.getStats(history);
        if (tokenMgr.hasStrippableScreenshots(history, 1)) {
            history = tokenMgr.stripScreenshots(history, 1);
            if (conv?.replaceHistory) conv.replaceHistory(history);
            const postStats = tokenMgr.getStats(history);
            hub.log(`📸 Post-tool screenshot strip: ${preStats.estimatedTokens} → ${postStats.estimatedTokens} tokens`, 'info');
        }
    }

    if (tokenMgr && tokenMgr.needsTruncation && tokenMgr.needsTruncation(history)) {
        const cfg = hub.getService('config');
        const summarizer = hub.getService('summarizer');
        if (cfg?.autoCompact !== false && summarizer?.canCompact(history)) {
            try {
                history = await summarizer.compactHistory(history);
                if (conv?.replaceHistory) conv.replaceHistory(history);
            } catch (e) {
                history = tokenMgr.truncateHistory(history);
            }
        } else {
            history = tokenMgr.truncateHistory(history);
        }
    }

    // Continue AI cycle
    await runAICycle();
}

// ==================== AUTO QA (code-enforced quality gates) ====================
// Runs automatically after file writes — cannot be skipped by the AI.
// If checks fail, errors are injected into conversation history as user messages,
// forcing the AI to address them before it can proceed.

const CODE_EXTENSIONS = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'cs', 'php', 'vue', 'svelte']);

async function runAutoQA(filePath, conv, toolsService) {
    if (!filePath || !toolsService) return;

    const cfg = hub.getService('config');
    const ext = (filePath.split('.').pop() || '').toLowerCase();

    // Only lint/type-check code files
    if (!CODE_EXTENSIONS.has(ext)) {
        hub.log(`[AutoQA] Skip (non-code): ${path.basename(filePath)}`, 'info');
        return;
    }

    const qaErrors = [];
    const baseName = path.basename(filePath);

    // ── JS/TS Syntax check: node --check (always runs regardless of lint config) ──
    // spawnSync with args array — injection-safe (no shell interpolation)
    const isJsLike = ['js', 'cjs', 'mjs', 'ts', 'tsx', 'jsx'].includes(ext);
    if (isJsLike) {
        try {
            hub.log(`[AutoQA] Syntax → ${baseName}`, 'info');
            broadcastActivity('tool_start', { tool: 'node_syntax [auto]', inputSummary: baseName, agent: 'autoqa' });
            const { spawnSync } = require('child_process');
            const proc = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8', timeout: 10000 });
            const syntaxOk = proc.status === 0;
            const syntaxOutput = syntaxOk
                ? `✓ Syntax OK: ${baseName}`
                : ((proc.stderr || proc.stdout || 'Parse error').trim());
            hub.toolResult({ tool: 'node_syntax [auto]', input: { path: filePath }, output: syntaxOutput, timestamp: Date.now() });
            broadcastActivity('tool_complete', { tool: 'node_syntax [auto]', success: syntaxOk, durationMs: 0 });
            if (!syntaxOk) {
                qaErrors.push(`## SYNTAX ERROR in ${baseName}:\n${syntaxOutput.substring(0, 1200)}`);
                hub.log(`[AutoQA] ✗ SYNTAX FAILED: ${baseName}`, 'warning');
            } else {
                hub.log(`[AutoQA] ✓ Syntax OK: ${baseName}`, 'success');
            }
        } catch (e) {
            hub.log(`[AutoQA] Syntax check error: ${e.message}`, 'warning');
        }
    }

    // ── JSON syntax check ────────────────────────────────────────────────────
    if (ext === 'json') {
        try {
            const jsonFs = require('fs');
            JSON.parse(jsonFs.readFileSync(filePath, 'utf8'));
            hub.log(`[AutoQA] ✓ JSON valid: ${baseName}`, 'success');
        } catch (e) {
            qaErrors.push(`## JSON PARSE ERROR in ${baseName}:\n${e.message}`);
            hub.log(`[AutoQA] ✗ JSON invalid: ${baseName} — ${e.message}`, 'warning');
        }
    }

    // ── Lint check ──────────────────────────────────────────────────────────
    if (cfg?.autoQALint !== false) {
        try {
            hub.log(`[AutoQA] Lint → ${baseName}`, 'info');
            broadcastActivity('tool_start', { tool: 'qa_check_lint [auto]', inputSummary: baseName, agent: 'autoqa' });

            const lintResult = await toolsService.execute({
                name: 'qa_check_lint',
                id: 'autoqa_lint_' + Date.now(),
                input: { path: filePath }
            });
            const lintOutput = (typeof lintResult === 'object' && lintResult.content)
                ? lintResult.content : String(lintResult);

            hub.toolResult({ tool: 'qa_check_lint [auto]', input: { path: filePath }, output: lintOutput, timestamp: Date.now() });
            broadcastActivity('tool_complete', { tool: 'qa_check_lint [auto]', success: true, durationMs: 0 });

            // Detect real errors (ignore "no lint configured" placeholders)
            const isPlaceholder = /no lint configured|not found|command not found/i.test(lintOutput);
            const hasErrors = !isPlaceholder && /\berror\b|✗|failed|unexpected token|syntax error|parsing error/i.test(lintOutput);

            if (hasErrors) {
                qaErrors.push(`## LINT ERRORS in ${baseName}:\n${lintOutput.substring(0, 1200)}`);
                hub.log(`[AutoQA] ✗ Lint FAILED: ${baseName}`, 'warning');
            } else {
                hub.log(`[AutoQA] ✓ Lint OK: ${baseName}`, 'success');
            }
        } catch (e) {
            hub.log(`[AutoQA] Lint tool error: ${e.message}`, 'warning');
        }
    }

    // ── TypeScript type check ─────────────────────────────────────────────
    if (cfg?.autoQATypes !== false && (ext === 'ts' || ext === 'tsx')) {
        try {
            hub.log(`[AutoQA] TypeCheck → ${baseName}`, 'info');
            broadcastActivity('tool_start', { tool: 'qa_check_types [auto]', inputSummary: baseName, agent: 'autoqa' });

            const typesResult = await toolsService.execute({
                name: 'qa_check_types',
                id: 'autoqa_types_' + Date.now(),
                input: { path: filePath }
            });
            const typesOutput = (typeof typesResult === 'object' && typesResult.content)
                ? typesResult.content : String(typesResult);

            hub.toolResult({ tool: 'qa_check_types [auto]', input: { path: filePath }, output: typesOutput, timestamp: Date.now() });
            broadcastActivity('tool_complete', { tool: 'qa_check_types [auto]', success: true, durationMs: 0 });

            const isPlaceholder = /no typescript configured|command not found/i.test(typesOutput);
            const hasErrors = !isPlaceholder && /error ts\d+|type error|✗/i.test(typesOutput);

            if (hasErrors) {
                qaErrors.push(`## TYPE ERRORS in ${baseName}:\n${typesOutput.substring(0, 1200)}`);
                hub.log(`[AutoQA] ✗ Type errors: ${baseName}`, 'warning');
            } else {
                hub.log(`[AutoQA] ✓ Types OK: ${baseName}`, 'success');
            }
        } catch (e) {
            hub.log(`[AutoQA] Type check error: ${e.message}`, 'warning');
        }
    }

    // ── Tests (optional, disabled by default — can be slow) ──────────────
    if (cfg?.autoQATests === true) {
        try {
            hub.log(`[AutoQA] Tests → ${baseName}`, 'info');
            const testResult = await toolsService.execute({
                name: 'qa_run_tests',
                id: 'autoqa_tests_' + Date.now(),
                input: { type: 'unit' }
            });
            const testOutput = (typeof testResult === 'object' && testResult.content)
                ? testResult.content : String(testResult);

            hub.toolResult({ tool: 'qa_run_tests [auto]', input: { path: filePath }, output: testOutput, timestamp: Date.now() });

            const isPlaceholder = /no test|not found|test script/i.test(testOutput);
            const hasFailures = !isPlaceholder && /\bfail(ed|ing)?\b|✗|\d+ failing/i.test(testOutput);

            if (hasFailures) {
                qaErrors.push(`## TEST FAILURES:\n${testOutput.substring(0, 1200)}`);
                hub.log(`[AutoQA] ✗ Tests FAILED after writing ${baseName}`, 'warning');
            } else {
                hub.log(`[AutoQA] ✓ Tests pass: ${baseName}`, 'success');
            }
        } catch (e) {
            hub.log(`[AutoQA] Test run error: ${e.message}`, 'warning');
        }
    }

    // ── Inject errors into conversation history ───────────────────────────
    // This is the key enforcement: errors become a mandatory user message.
    // The AI MUST respond to it — it cannot skip or ignore injected messages.
    // Cap at MAX_QA_ATTEMPTS to prevent infinite fix loops.
    if (qaErrors.length > 0) {
        const attempts = (qaAttempts.get(filePath) || 0) + 1;
        qaAttempts.set(filePath, attempts);

        if (attempts > MAX_QA_ATTEMPTS) {
            hub.log(`[AutoQA] ⚠️ ${MAX_QA_ATTEMPTS} fix attempts exhausted for ${baseName} — marking as needs-review`, 'warning');
            hub.addMessage('user', `🔍 **AutoQA**: ${MAX_QA_ATTEMPTS} fix attempts exhausted for \`${baseName}\`. Marking as **needs-review** — move on and address later.`);
            conv.addUserMessage(
                `[AutoQA] ${MAX_QA_ATTEMPTS} fix attempts exceeded for ${filePath}. ` +
                `Do NOT retry this file further. Note it as needs-review and move on to the next task.`
            );
        } else {
            const errorBlock = qaErrors.join('\n\n');
            const injectedMsg =
                `[AutoQA] Quality check FAILED for ${filePath} (attempt ${attempts}/${MAX_QA_ATTEMPTS}).\n\n` +
                errorBlock +
                `\n\nYou MUST fix ALL errors listed above before proceeding to any other task. ` +
                `Use write_file or patch_file to fix the issues, then verify the fixes are correct.`;

            conv.addUserMessage(injectedMsg);
            hub.addMessage('user', `🔍 **AutoQA** (attempt ${attempts}/${MAX_QA_ATTEMPTS}): ${qaErrors.length} check(s) FAILED in \`${baseName}\` — fix required.`);
            hub.log(`[AutoQA] ↑ Injected ${qaErrors.length} failure(s) into history — AI must fix (attempt ${attempts})`, 'warning');
        }
        broadcastActivity('qa_suggested', {
            file: filePath,
            tool: 'autoqa',
            detail: `${qaErrors.length} error(s): attempt ${attempts}/${MAX_QA_ATTEMPTS}`
        });
    } else if (qaAttempts.has(filePath)) {
        // QA passed — clear the attempt counter for this file
        qaAttempts.delete(filePath);
        hub.log(`[AutoQA] ✓ ${baseName} passing — attempt counter cleared`, 'info');
    }
}

// ==================== AI CYCLE (recursive tool handling) ====================

async function runAICycle() {
    cycleDepth++;
    if (cycleDepth > MAX_CYCLES) {
        hub.log(`⚠️ Max AI cycles (${MAX_CYCLES}) reached — stopping to prevent token waste`, 'warning');
        hub.addMessage('assistant', `⚠️ **Cycle limit reached** (${MAX_CYCLES} cycles). Stopping to preserve tokens. Review the work done and continue manually if needed.`);
        finishMainProcessing();
        return;
    }
    const conv = hub.getService('conversation');
    const tools = hub.getService('tools');
    const ai = hub.getService('ai');
    const agentSystem = hub.getService('agentSystem');
    const tokenMgr = hub.getService('tokenManager');

    let history = conv.sanitize(conv.getHistory());
    
    // CRITICAL FIX: Additional sanitize with tokenManager and SAVE BACK
    // This ensures runAICycle also fixes any broken tool chains
    if (tokenMgr && tokenMgr.sanitizeHistory) {
        const beforeCount = history.length;
        history = tokenMgr.sanitizeHistory(history);
        const removed = beforeCount - history.length;
        if (removed > 0) {
            hub.log(`[runAICycle] Cleaned ${removed} orphaned tool entries from history`, 'warning');
            if (conv.replaceHistory) {
                conv.replaceHistory(history);
            }
        }
    }
    
    // Validate history before API call
    if (tokenMgr && tokenMgr.validateHistory) {
        const validation = tokenMgr.validateHistory(history);
        if (!validation.valid) {
            hub.log('⚠️ runAICycle validation errors: ' + validation.errors.join('; '), 'error');
            history = tokenMgr.sanitizeHistory(history);
        }
    }

    let currentContent = '';
    let toolCalls = [];
    let assistantMessage = { role: 'assistant', content: [] };
    let textBlock = { type: 'text', text: '' };
    let toolIndex = -1;
    let streamBuffer = '';
    let thinkingBuffer = '';

    // Signal that AI is now thinking/streaming
    setOrchestratorState({ thinking: true, startTime: Date.now() });
    broadcastActivity('agent_thinking_start', { agent: orchestrationState.agent, task: orchestrationState.task });

    let agentStreamStartBroadcast = false;
    await new Promise((resolve, reject) => {
        ai.chatStream(history, (event) => {
            if (event.type === 'content_block_start') {
                if (event.content_block) {
                    if (!agentStreamStartBroadcast &&
                        (event.content_block.type === 'text' || event.content_block.type === 'thinking')) {
                        agentStreamStartBroadcast = true;
                        hub.broadcast('stream_start', {});
                    }
                    if (event.content_block.type === 'tool_use') {
                        const tool = { id: event.content_block.id, name: event.content_block.name, input: {} };
                        toolCalls.push(tool);
                        toolIndex = toolCalls.length - 1;
                        hub.neural('\x00CHIP:' + JSON.stringify({ name: tool.name, id: tool.id }) + '\x00');
                        hub.log(`Tool: ${tool.name}`, 'info');
                    }
                }
            }
            else if (event.type === 'content_block_delta') {
                if (event.delta.type === 'text_delta') {
                    textBlock.text += event.delta.text;
                    streamBuffer += event.delta.text;
                    hub.streamUpdate(streamBuffer);
                }
                else if (event.delta.type === 'thinking_delta') {
                    if (event.delta.thinking) {
                        thinkingBuffer += event.delta.thinking;
                        hub.neural(event.delta.thinking);
                        // Broadcast a short snippet of thinking to the activity feed
                        const snippet = event.delta.thinking.trim().substring(0, 150);
                        if (snippet) {
                            broadcastActivity('agent_thinking', {
                                agent: orchestrationState.agent,
                                task: orchestrationState.task,
                                snippet
                            });
                        }
                    }
                }
                else if (event.delta.type === 'input_json_delta') {
                    currentContent += event.delta.partial_json;
                }
            }
            else if (event.type === 'content_block_stop') {
                if (toolIndex >= 0 && currentContent) {
                    try {
                        toolCalls[toolIndex].input = JSON.parse(currentContent);
                        hub.log(`Tool input: ${JSON.stringify(toolCalls[toolIndex].input).substring(0, 100)}`, 'info');
                    } catch (e) {
                        try {
                            let fixed = currentContent;
                            const opens = (fixed.match(/{/g) || []).length;
                            const closes = (fixed.match(/}/g) || []).length;
                            let c = closes;
                            while (c < opens) { fixed += '}'; c++; }
                            toolCalls[toolIndex].input = JSON.parse(fixed);
                            hub.log('Tool input fixed and parsed', 'info');
                        } catch (e2) {
                            hub.log(`JSON error: ${e.message}`, 'error');
                            toolCalls[toolIndex].input = {};
                        }
                    }
                    currentContent = '';
                }
                toolIndex = -1;
            }
        },
        () => {
            if (textBlock.text.trim()) assistantMessage.content.push(textBlock);
            toolCalls.forEach(t => assistantMessage.content.push({ type: 'tool_use', id: t.id, name: t.name, input: t.input }));
            if (thinkingBuffer) {
                const words = thinkingBuffer.trim().split(/\s+/).filter(Boolean).length;
                hub.broadcast('thinking_done', { words, chars: thinkingBuffer.length });
            }
            // Clear thinking state once stream is done
            setOrchestratorState({ thinking: false });
            resolve();
        },
        (err) => {
            setOrchestratorState({ thinking: false });
            reject(err);
        });
    });

    if (assistantMessage.content.length > 0) {
        conv.addAssistantMessage(assistantMessage);

        const displayContent = assistantMessage.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n\n');

        if (displayContent.trim()) {
            hub.addMessage('assistant', displayContent);
        }
    }

    // ── Task Enforcement Hook ──
    // If taskEnforcement is enabled and the AI is about to run implementation tools
    // without having created tasks first, inject a reminder and re-run.
    if (toolCalls.length > 0) {
        const cfg = hub.getService('config');
        if (cfg?.taskEnforcement) {
            const IMPL_TOOLS = new Set(['write_file', 'patch_file', 'edit_file', 'run_command', 'bash', 'execute_code']);
            const hasImplementation = toolCalls.some(t => IMPL_TOOLS.has(t.name));
            const hasCreateTask = toolCalls.some(t => t.name === 'create_task');
            if (hasImplementation && !hasCreateTask) {
                // Check if there are already active tasks (pending or in_progress)
                const convSvc = hub.getService('conversation');
                const existingTasks = convSvc?.getTasks?.() || [];
                const hasActiveTasks = existingTasks.some(t =>
                    t.status === 'pending' || t.status === 'in_progress' || t.status === 'plan_pending');
                if (!hasActiveTasks) {
                    hub.log('[TaskEnforcement] AI attempted implementation without tasks — injecting reminder', 'warning');
                    conv.addUserMessage('[TASK ENFORCEMENT] You attempted to run implementation tools without creating tasks first. STOP. Create tasks using create_task for each piece of work you plan to do, then proceed.');
                    // Re-run the AI cycle so it can create tasks first
                    return runAICycle();
                }
            }
        }
    }

    if (toolCalls.length > 0) {
        // Use the same approval-gated execution
        await executeToolsWithApproval(toolCalls);
        // ── Hot Injection Check ──────────────────────────────────────────────
        // After all tool results are in history, before the next AI call —
        // this is the safe cycle boundary where we can inject user messages.
        await checkAndApplyHotInject();
        // ────────────────────────────────────────────────────────────────────
    } else {
        finishMainProcessing();
    }
}

// ==================== HOT CHAT INJECTION ====================

/**
 * Checks if any hot-inject messages are buffered and, if so, injects the
 * next one into the conversation history as a user message.  Called at
 * the safe cycle boundary — after tool results land, before the next AI
 * call starts — so the AI sees the injection organically on the next turn.
 */
async function checkAndApplyHotInject() {
    try {
        const injection = hub.consumeHotInject?.();
        if (!injection) return;

        const conv = hub.getService('conversation');
        if (!conv) return;

        hub.log(`[HotInject] ⚡ Injecting: "${injection.text.substring(0, 80)}"`, 'info');

        // Add the injected message to conversation history
        conv.addUserMessage(injection.text);

        // Broadcast to UI with a hot_injected flag so the frontend can style it
        hub.broadcast('message_add', {
            role: 'user',
            content: injection.text,
            hot_injected: true,
            ts: injection.injectedAt
        });

        // Announce in activity feed
        hub.broadcast('backchannel_msg', {
            role: 'system',
            content: `⚡ Hot injection applied: "${injection.text.substring(0, 60)}"`,
            ts: Date.now()
        });

        hub.broadcastHotInjectApplied?.(injection);
        hub.status('⚡ Hot inject received — processing…', 'thinking');

    } catch (e) {
        hub.log(`[HotInject] Error during injection: ${e.message}`, 'warning');
    }
}

// ==================== APPROVAL HELPERS ====================

/**
 * Returns a Promise that resolves to true (approved) or false (denied/timeout).
 * Stores the resolver in pendingApprovalResolvers so handleApprovalResponse can trigger it.
 */
function waitForApproval(toolId, timeoutMs) {
    return new Promise((resolve) => {
        // timeoutMs === 0 means wait forever — no auto-deny timer is set.
        // Only set a timer when the user has explicitly enabled timeouts (timeoutMs > 0).
        let timer = null;
        if (timeoutMs > 0) {
            timer = setTimeout(() => {
                if (pendingApprovalResolvers.has(toolId)) {
                    pendingApprovalResolvers.delete(toolId);
                    hub.log(`⏱️ Approval timeout for ${toolId} — auto-denying`, 'warning');
                    hub.broadcast('approval_timeout', { toolId });
                    resolve(false);
                }
            }, timeoutMs);
        }

        pendingApprovalResolvers.set(toolId, { resolve, timer });
    });
}

// ==================== APPROVAL RESPONSE HANDLER ====================

function handleApprovalResponse(data) {
    if (!data || !data.toolId) return;

    hub.log(`📋 Approval response for ${data.toolId}: ${data.approved ? 'APPROVED' : 'DENIED'}`, 'info');

    // Resolve the blocking Promise in waitForApproval
    if (pendingApprovalResolvers.has(data.toolId)) {
        const { resolve, timer } = pendingApprovalResolvers.get(data.toolId);
        clearTimeout(timer);
        pendingApprovalResolvers.delete(data.toolId);
        resolve(data.approved === true);
    }

    // Record decision for learning system
    const agentSystem = hub.getService('agentSystem');
    if (agentSystem && agentSystem.recordDecision) {
        agentSystem.recordDecision(
            { type: data.toolName || 'unknown', target: data.toolId },
            { tier: data.tier || 3 },
            data.approved ? data.tier : (data.tier + 1),
            data.reason || (data.approved ? 'User approved' : 'User denied')
        );
    }
}

// ==================== OTHER HANDLERS ====================

function handleCancel() {
    // Cancel any pending plan approval first
    if (awaitingPlanApproval && pendingPlanResolvers) {
        clearTimeout(pendingPlanResolvers.timer);
        pendingPlanResolvers.resolve({ action: 'cancelled' });
        pendingPlanResolvers = null;
        awaitingPlanApproval = false;
        deletePendingPlanTasks(pendingPlanTaskIds);
        pendingPlanTaskIds = [];
    }
    if (isProcessing) {
        const ai = hub.getService('ai');
        ai.abort();
        isProcessing = false;
        pendingApproval = null;
        // Reject all pending approval requests
        for (const [toolId, { resolve, timer }] of pendingApprovalResolvers) {
            clearTimeout(timer);
            resolve(false);
        }
        pendingApprovalResolvers.clear();
        hub.log('⚠️ Generation cancelled', 'warning');
        hub.status('Cancelled', 'idle');
    }
}

function handleNewConversation() {
    const conv = hub.getService('conversation');
    conv.new();
    hub.addMessage('user', '--- New Conversation Started ---');
}

function handleCheckpointApproved() {
    hub.log('✅ Checkpoint approved - continuing', 'success');
    hub.status('Ready', 'idle');
}

function checkpoint(summary) {
    const conv = hub.getService('conversation');
    conv.checkpoint(summary);
    return '⛃ CHECKPOINT REACHED\n\n' + summary;
}

// ==================== PLAN MODE HELPERS ====================

/**
 * Parse a JSON task plan from the AI's response text and create tasks (+ optional milestone)
 * in the conversation.  Accepts two formats:
 *   - New: { "milestone": "...", "tasks": [...] }
 *   - Legacy: [{ "title": "...", ... }]
 * Returns { success, malformed, tasks, taskIds }
 */
function extractAndCreatePlanTasks(responseText, variantOverride) {
    const m = responseText.match(/```json\s*([\s\S]*?)```/i) ||
              responseText.match(/(\{[\s\S]*\}|\[\s*\{[\s\S]*?\}\s*\])/);
    if (!m) return { success: false, malformed: false, tasks: [], taskIds: [] };

    let parsed;
    try { parsed = JSON.parse(m[1].trim()); }
    catch (e) { return { success: false, malformed: true, tasks: [], taskIds: [] }; }

    // Support multi-variant format { preferred, milestone, short, regular, long }
    let milestoneName = null;
    let rawTasks;
    let multiVariantData = null;

    if (Array.isArray(parsed)) {
        rawTasks = parsed;
    } else if (parsed && typeof parsed === 'object' && (parsed.short || parsed.regular || parsed.long)) {
        // Multi-variant plan format
        multiVariantData = parsed;
        milestoneName = typeof parsed.milestone === 'string' ? parsed.milestone.trim() : null;
        const cfg = hub.getService('config');
        const chosenVariant = variantOverride || parsed.preferred || cfg?.planLength || 'regular';
        const variantData = parsed[chosenVariant] || parsed.regular || parsed.short || parsed.long;
        rawTasks = Array.isArray(variantData?.tasks) ? variantData.tasks : [];
    } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.tasks)) {
        milestoneName = typeof parsed.milestone === 'string' ? parsed.milestone.trim() : null;
        rawTasks = parsed.tasks;
    } else {
        return { success: false, malformed: true, tasks: [], taskIds: [] };
    }

    if (!rawTasks.length) return { success: false, malformed: true, tasks: [], taskIds: [] };

    const valid = rawTasks.filter(t => t && typeof t.title === 'string' && t.title.trim());
    if (!valid.length) return { success: false, malformed: true, tasks: [], taskIds: [] };

    const conv = hub.getService('conversation');

    // Create milestone first so we have its id to stamp on tasks
    let milestoneId = null;
    if (milestoneName && conv?.addMilestone) {
        try {
            const ms = conv.addMilestone({ name: milestoneName, description: '', color: '#6366f1' });
            milestoneId = ms?.id || null;
        } catch (e) {
            hub.log('⚠️ Could not create plan milestone: ' + e.message, 'warning');
        }
    }

    const taskIds = [];
    for (const def of valid) {
        const id = 'plan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

        // Normalize assignee: string → [string], array → filter strings, absent → []
        let assignee = [];
        if (typeof def.assignee === 'string' && def.assignee.trim()) {
            assignee = [def.assignee.trim()];
        } else if (Array.isArray(def.assignee)) {
            assignee = def.assignee.filter(a => typeof a === 'string' && a.trim());
        }

        // Normalize dependencies: array of prior task titles
        let dependencies = [];
        if (Array.isArray(def.dependencies)) {
            dependencies = def.dependencies.filter(d => typeof d === 'string' && d.trim()).map(d => d.trim());
        }

        const task = {
            id,
            title:        String(def.title).trim().substring(0, 120),
            description:  String(def.description || '').trim().substring(0, 500),
            priority:     ['low', 'normal', 'high'].includes(def.priority) ? def.priority : 'normal',
            completed:    false,
            status:       'plan_pending',
            createdAt:    new Date().toISOString(),
            assignee,
            dependencies,
            actions:      { test: false, lint: false, approval: false }
        };
        if (milestoneId) task.milestoneId = milestoneId;
        if (conv?.addTask) conv.addTask(task); // automatically broadcasts tasks_update
        taskIds.push(id);
    }
    return { success: true, malformed: false, tasks: valid, taskIds, multiVariantData, milestoneName };
}

function deletePendingPlanTasks(taskIds) {
    const conv = hub.getService('conversation');
    taskIds.forEach(id => { if (conv?.deleteTask) conv.deleteTask(id); });
}

/**
 * Returns a Promise that resolves to { action: 'approved'|'cancelled'|'revised', feedback? }.
 * Times out after 30 minutes with auto-cancel.
 */
function waitForPlanDecision() {
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            if (!pendingPlanResolvers) return;
            pendingPlanResolvers = null;
            awaitingPlanApproval = false;
            hub.broadcastAll('plan_timeout', {});
            hub.log('[Plan] Timed out — auto-cancelled', 'warning');
            resolve({ action: 'cancelled' });
        }, 30 * 60 * 1000);
        pendingPlanResolvers = { resolve, timer };
    });
}

function handlePlanApproved() {
    if (!pendingPlanResolvers) return;
    clearTimeout(pendingPlanResolvers.timer);
    const r = pendingPlanResolvers.resolve;
    pendingPlanResolvers = null;
    r({ action: 'approved' });
}

function handlePlanCancelled() {
    if (!pendingPlanResolvers) return;
    clearTimeout(pendingPlanResolvers.timer);
    const r = pendingPlanResolvers.resolve;
    pendingPlanResolvers = null;
    r({ action: 'cancelled' });
}

function handlePlanRevision(feedback) {
    if (!pendingPlanResolvers) return;
    clearTimeout(pendingPlanResolvers.timer);
    const r = pendingPlanResolvers.resolve;
    pendingPlanResolvers = null;
    r({ action: 'revised', feedback });
}

function handleSwitchPlanVariant({ variant } = {}) {
    if (!awaitingPlanApproval || !pendingPlanRawText) return;
    if (!['short', 'regular', 'long'].includes(variant)) return;
    // Delete current plan tasks and recreate for chosen variant
    deletePendingPlanTasks(pendingPlanTaskIds);
    const result = extractAndCreatePlanTasks(pendingPlanRawText, variant);
    if (!result.success) {
        hub.log(`[Plan] Could not switch to variant "${variant}"`, 'warning');
        return;
    }
    pendingPlanTaskIds = result.taskIds;
    hub.broadcastAll('plan_variant_switched', { variant, taskCount: result.tasks.length });
    hub.log(`[Plan] Switched to ${variant} variant — ${result.tasks.length} tasks`, 'info');
}

// ==================== PER-AGENT SESSION ENGINE ====================

function getOrCreateSession(agentName) {
    if (agentSessions.has(agentName)) return agentSessions.get(agentName);

    // Fetch agent definition
    let def = null;
    try {
        const agentMgr = hub.getService('agentManager');
        if (agentMgr && agentMgr.getAgent) def = agentMgr.getAgent(agentName);
    } catch (e) {}
    if (!def) {
        try {
            const agents = hub.getService('agents');
            if (agents && agents.getAgentList) {
                def = agents.getAgentList().find(a => a.name === agentName);
            }
        } catch (e) {}
    }
    if (!def) def = { name: agentName, role: 'assistant', description: '', instructions: '' };

    const session = {
        name: agentName,
        def,
        history: [],
        isProcessing: false,
        cycleDepth: 0,
        paused: false,
        inbox: [],
        startTime: null
    };
    agentSessions.set(agentName, session);
    return session;
}

function buildAgentSystemPrompt(session) {
    const conv = hub.getService('conversation');
    const workDir = conv && conv.getWorkingDirectory ? conv.getWorkingDirectory() : process.cwd();
    const def = session.def || {};
    const tools = hub.getService('tools');
    const toolList = tools ? tools.getDefinitions().map(t => `- ${t.name}: ${t.description || ''}`).join('\n') : '';

    const parts = [
        `You are ${def.name || session.name}, a specialized AI subagent operating under Orchestrator control.`,
        def.role ? `Role: ${def.role}` : '',
        def.description ? `Description: ${def.description}` : '',
        def.instructions ? `\nInstructions:\n${def.instructions}` : '',
        `\nWorking directory: ${workDir}`,
        toolList ? `\nAvailable tools:\n${toolList}` : '',
        '\n## MANDATORY AGENT CONDUCT RULES (non-negotiable)',
        '1. You are a SUBAGENT. The orchestrator is your commanding authority. Follow delegated tasks exactly.',
        '2. Do NOT call `delegate_to_agent`. You cannot spawn other agents. Only the orchestrator delegates.',
        '3. Do NOT use `message_agent` more than once per task cycle to avoid runaway agent chains.',
        '4. SCOPE LOCK: Complete ONLY what is in the task description. Never refactor, add features, or install packages beyond what was asked.',
        '5. When done, report your result clearly. Do not loop or continue working after task completion.',
        '6. If you identify improvements outside scope, mention them in your response — do NOT implement them.',
    ];

    // ── Code Quality Enforcement (injected for all agents — cannot be waived) ──
    const agentName = (def.name || session.name || '').toLowerCase();
    const isCodeAgent = /code|implement|engineer|develop|build|fix|patch|architect|backend|frontend|ui|fullstack|stack/.test(agentName);
    const isTestAgent = /test|qa|quality|spec|lint|audit/.test(agentName);
    const isGitAgent  = /git|commit|merge|branch|deploy|release|keeper/.test(agentName);

    if (isCodeAgent || isTestAgent) {
        const cfg = hub.getService('config');
        parts.push(`
## CODE QUALITY PROTOCOL — ABSOLUTE, NON-NEGOTIABLE

You are a code-writing agent. These rules apply to EVERY file you write or modify.

### Before touching any file:
1. ALWAYS call read_file (or read_file_lines for large files) on the target file FIRST.
2. Never write a file you haven't read — you will miss context and introduce regressions.

### While writing code:
3. Write COMPLETE implementations. ZERO stubs, ZERO "TODO: add rest here", ZERO placeholder comments.
4. Never truncate a function, class, or block mid-way. If it's too large, split it properly.
5. One file write per clear intent. Don't mix unrelated changes in a single write_file call.

### After writing any .js / .cjs / .mjs / .ts / .tsx file:
6. The AutoQA will automatically run node --check on your file. If it fails, YOU must fix it.
7. If qa_check_lint reports errors, fix ALL of them before marking the task done. Zero tolerance.
8. If you used a variable or function name in one part of a file, be consistent — check spelling across the entire file.

### Code grammar rules (enforced — not suggestions):
- Variable/function names: camelCase for variables/functions, PascalCase for classes. Never mix.
- No trailing whitespace, no missing semicolons where the codebase uses them.
- String consistency: use the quote style already present in the file (single or double — don't mix).
- No unreachable code (dead else after return, code after throw, etc.).
- No shadowed variables — don't reuse a name that already exists in the parent scope.
- No implicit globals — every require/import must be at the top.
- Array/object literals: trailing comma on the LAST item if multi-line (matches Node.js convention).
- Never abbreviate variable names to single letters except for loop counters (i, j, k).

### After editing:
9. Re-read the file (or the changed section) to verify correctness before reporting done.
10. After creating NEW files with write_file: immediately call list_dir on the parent directory to confirm the new file appears in the listing. If it does NOT appear, the write silently failed — retry write_file before reporting done.
11. NEVER report a file as created or modified without confirming its existence via list_dir. Reporting phantom completions wastes orchestrator retry cycles and burns tokens.
12. If a node --check or lint error appears in the QA result feedback, fix it IMMEDIATELY.
13. NEVER mark a task "complete" or "done" while syntax or lint errors exist.
${cfg?.autoQATests ? '14. Run qa_run_tests after implementing features. ALL tests must pass 100%.' : ''}`);
    }

    if (isTestAgent) {
        parts.push(`
## TESTING AGENT RULES:
- Write REAL tests — no trivial asserts, no always-passing stubs.
- Cover: happy path, boundary conditions, error cases, and at least one edge case per function.
- If a test fails because the source code is wrong, report the bug — do NOT weaken the test.
- Test files must be complete. Never write "// tests for X — to be added".`);
    }

    if (isGitAgent) {
        parts.push(`
## GIT AGENT RULES:
- Verify working tree is clean before branching or merging.
- Commit messages follow Conventional Commits: type(scope): subject (50 chars max).
- Always run git status before and after operations to confirm expected state.
- NEVER force-push to main/master. Refuse and report instead.`);
    }

    // Inject per-task scope constraints when dispatched via delegate_to_agent
    const scope = session.taskScope;
    if (scope && scope.title) {
        const scopeDir = scope.workingDir || workDir;
        const maxCycles = scope.maxCycles || 8;
        parts.push([
            '\n## ASSIGNED TASK SCOPE',
            `Task: "${scope.title}"`,
            `Working directory: ${scopeDir}`,
            `Max tool cycles: ${maxCycles}`,
            'Complete this task and nothing else.'
        ].join('\n'));
    }

    return parts.filter(Boolean).join('\n');
}

/**
 * Dispatch a task to a named agent and AWAIT the full AI cycle, returning the agent's text output.
 * Used by the delegate_to_agent tool so the orchestrator can block on agent results.
 * Also drives the Team panel activity line by temporarily setting orchestration_state.agent.
 */
async function dispatchAgentAndAwait(agentName, task, taskScope = {}) {
    // ── Per-delegation retry cap ─────────────────────────────────────────────
    // Count how many times this exact task has been sent to this agent in the
    // current orchestration turn. After 3 attempts we return a hard-stop signal
    // so the orchestrator knows to stop burning tokens on a broken delegation.
    const _delegKey = `${agentName}::${task.slice(0, 80)}`;
    const _attempts = (_delegationAttempts.get(_delegKey) || 0) + 1;
    _delegationAttempts.set(_delegKey, _attempts);
    if (_attempts > 3) {
        return `[DELEGATION_CAPPED:${agentName}] This task has been delegated ${_attempts - 1} times with no verified output. STOP retrying. Diagnose the root cause (wrong language capability? missing tool access? task too vague?) and report failure to the user instead of retrying.`;
    }
    // ────────────────────────────────────────────────────────────────────────

    const session = getOrCreateSession(agentName);

    // If the agent is already busy, wait up to 30s for it to free up
    if (session.isProcessing) {
        const waitStart = Date.now();
        while (session.isProcessing && Date.now() - waitStart < 30000) {
            await new Promise(r => setTimeout(r, 500));
        }
        if (session.isProcessing) {
            return `Agent ${agentName} is still busy — task queued for next available slot.`;
        }
    }

    // Attach task scope so buildAgentSystemPrompt can inject constraints
    session.taskScope = Object.keys(taskScope).length ? taskScope : null;

    // Push task into the agent's history so it has context
    session.history.push({ role: 'user', content: task });
    hub.broadcast('agent_message', { agentName, role: 'user', content: task, ts: Date.now() });

    // Save the previous orchestrator state and point it at this agent.
    // This is what lights up the agent card activity line in the Team panel.
    const prevAgent    = orchestrationState.agent;
    const prevTask     = orchestrationState.task;
    const prevTool     = orchestrationState.tool;
    const prevThinking = orchestrationState.thinking;
    setOrchestratorState({ agent: agentName, task: task.substring(0, 80), thinking: true, tool: null });

    // Track chain depth so message_agent can enforce the 2-level limit
    _agentChainDepth++;

    const historyLenBefore = session.history.length;
    try {
        // runAgentCycle is fully awaitable — it resolves when all AI + tool cycles complete
        await runAgentCycle(session);
    } finally {
        _agentChainDepth--;
        session.taskScope = null;
        // Always restore orchestrator state so the main agent card goes back to idle
        setOrchestratorState({ agent: prevAgent, task: prevTask, tool: prevTool, thinking: prevThinking });
    }

    // Collect text output from all new assistant messages added to session history
    const added = session.history.slice(historyLenBefore);
    const text = added
        .filter(m => m.role === 'assistant')
        .flatMap(m => Array.isArray(m.content)
            ? m.content.filter(c => c.type === 'text').map(c => c.text)
            : [String(m.content)])
        .filter(Boolean)
        .join('\n\n');

    return text || `[NO_OUTPUT:${agentName}] Agent ran but produced no text response. The agent likely could not perform the task (unsupported language, missing tool access, or task too vague). Verify expected files exist with list_dir/read_file before retrying. Do NOT retry without changing delegation strategy.`;
}

function runAgentSession(agentName, userMessage) {
    const session = getOrCreateSession(agentName);

    // Count active sessions (not counting paused ones at capacity)
    const activeCount = [...agentSessions.values()].filter(s => s.isProcessing).length;

    // Queue if at capacity or paused
    if (activeCount >= maxParallelAgents || session.paused) {
        session.inbox.push({ message: userMessage, ts: Date.now() });
        hub.broadcast('agent_inbox_update', { agentName, count: session.inbox.length });
        hub.broadcast('agent_session_state', {
            agentName,
            isProcessing: session.isProcessing,
            paused: session.paused,
            inboxCount: session.inbox.length
        });
        hub.log(`[agent:${agentName}] Queued (active:${activeCount}/${maxParallelAgents}, paused:${session.paused})`, 'info');
        return;
    }

    // Push user message to session history
    session.history.push({ role: 'user', content: userMessage });
    hub.broadcast('agent_message', { agentName, role: 'user', content: userMessage, ts: Date.now() });

    // Fire and forget — true parallelism
    runAgentCycle(session).catch(err => {
        hub.log(`[agent:${agentName}] Cycle error: ${err.message}`, 'error');
    });
}

async function runAgentCycle(session) {
    if (session.isProcessing) {
        session.inbox.push({ message: null, ts: Date.now() }); // guard re-entry
        return;
    }

    session.isProcessing = true;
    session.cycleDepth = 0;
    session.startTime = Date.now();

    // Reset per-delegation retry counters for orchestrator sessions at the start of each turn
    if (session.name === 'orchestrator') {
        _delegationAttempts.clear();
    }

    hub.broadcast('agent_session_state', {
        agentName: session.name,
        isProcessing: true,
        paused: false,
        inboxCount: session.inbox.length
    });

    try {
        await runAgentAICycle(session);
    } catch (err) {
        const agentErrDesc = describeError(err);
        hub.log(`[agent:${session.name}] Error: ${agentErrDesc}`, 'error');
        const isNet = isNetworkError(err);
        hub.broadcast('agent_message', {
            agentName: session.name,
            role: 'assistant',
            content: isNet
                ? `[Network error: ${agentErrDesc} — check connection]`
                : `[Error: ${agentErrDesc}]`,
            ts: Date.now()
        });
    } finally {
        session.isProcessing = false;
        session.startTime = null;
        hub.broadcast('agent_session_state', {
            agentName: session.name,
            isProcessing: false,
            paused: session.paused,
            inboxCount: session.inbox.length
        });

        if (session.paused) {
            hub.broadcast('agent_paused', { agentName: session.name });
            return;
        }

        // Drain inbox
        if (session.inbox.length > 0) {
            const next = session.inbox.shift();
            hub.broadcast('agent_inbox_update', { agentName: session.name, count: session.inbox.length });
            if (next && next.message) {
                runAgentSession(session.name, next.message);
            }
        }
    }
}

async function runAgentAICycle(session) {
    session.cycleDepth++;
    if (session.cycleDepth > MAX_CYCLES) {
        hub.log(`[agent:${session.name}] Max cycles reached`, 'warning');
        hub.broadcast('agent_message', {
            agentName: session.name,
            role: 'assistant',
            content: `⚠️ Cycle limit (${MAX_CYCLES}) reached. Stopping.`,
            ts: Date.now()
        });
        return;
    }

    const ai = hub.getService('ai');
    const tools = hub.getService('tools');
    const agentSystem = hub.getService('agentSystem');
    const systemPrompt = buildAgentSystemPrompt(session);

    let currentContent = '';
    let toolCalls = [];
    let assistantMessage = { role: 'assistant', content: [] };
    let textBlock = { type: 'text', text: '' };
    let toolIndex = -1;

    broadcastActivity('agent_thinking_start', { agent: session.name, task: 'direct session' });

    // Build per-agent thinking override if agent has a custom thinking setting
    const agentDef = session.def || {};
    let agentConfigOverrides = null;
    if (agentDef.thinkingEnabled !== undefined) {
        agentConfigOverrides = {
            thinkingEnabled: agentDef.thinkingEnabled,
            thinkingBudget: agentDef.thinkingBudget || hub.getService('config')?.thinkingBudget || 2048
        };
    }

    await new Promise((resolve, reject) => {
        ai.chatStream(session.history, (event) => {
            if (event.type === 'content_block_start') {
                if (event.content_block && event.content_block.type === 'tool_use') {
                    const tool = { id: event.content_block.id, name: event.content_block.name, input: {} };
                    toolCalls.push(tool);
                    toolIndex = toolCalls.length - 1;
                }
            } else if (event.type === 'content_block_delta') {
                if (event.delta.type === 'text_delta') {
                    textBlock.text += event.delta.text;
                } else if (event.delta.type === 'input_json_delta') {
                    currentContent += event.delta.partial_json;
                }
            } else if (event.type === 'content_block_stop') {
                if (toolIndex >= 0 && currentContent) {
                    try {
                        toolCalls[toolIndex].input = JSON.parse(currentContent);
                    } catch (e) {
                        try {
                            let fixed = currentContent;
                            const opens = (fixed.match(/{/g) || []).length;
                            const closes = (fixed.match(/}/g) || []).length;
                            let c = closes;
                            while (c < opens) { fixed += '}'; c++; }
                            toolCalls[toolIndex].input = JSON.parse(fixed);
                        } catch (e2) {
                            toolCalls[toolIndex].input = {};
                        }
                    }
                    currentContent = '';
                }
                toolIndex = -1;
            }
        },
        () => {
            if (textBlock.text.trim()) assistantMessage.content.push(textBlock);
            toolCalls.forEach(t => assistantMessage.content.push({ type: 'tool_use', id: t.id, name: t.name, input: t.input }));
            broadcastActivity('agent_thinking_done', { agent: session.name });
            resolve();
        },
        (err) => {
            broadcastActivity('agent_thinking_done', { agent: session.name });
            reject(err);
        },
        systemPrompt,
        agentConfigOverrides);
    });

    // Record assistant message in session history
    if (assistantMessage.content.length > 0) {
        session.history.push(assistantMessage);

        const displayText = assistantMessage.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n\n');

        if (displayText.trim()) {
            hub.broadcast('agent_message', {
                agentName: session.name,
                role: 'assistant',
                content: displayText,
                ts: Date.now()
            });
            // Push to agent comms backchannel so orchestrator/user can see all agent responses
            hub.emit('backchannel_push', {
                from: session.name,
                to: 'orchestrator',
                content: displayText,
                ts: Date.now(),
                type: 'agent_to_orchestrator'
            });
        }
    }

    if (toolCalls.length > 0) {
        await executeAgentTools(session, toolCalls, agentSystem, tools);
        // Continue cycle after tools
        await runAgentAICycle(session);
    }
}

async function executeAgentTools(session, toolCalls, agentSystem, tools) {
    const activeCfg = hub.getService('config');
    const bypassApprovals = activeCfg?.chatMode === 'bypass' || planExecutionActive;

    // Build permitted tool set from agent definition (empty = no restriction)
    const agentDef = session.def || {};
    const permittedTools = Array.isArray(agentDef.tools) && agentDef.tools.length > 0
        ? new Set(agentDef.tools) : null;

    for (const tool of toolCalls) {
        const toolStartTime = Date.now();

        // ── GUARDRAIL: block recursive delegate_to_agent from subagents ──────
        // Only the top-level orchestrator (chain depth 0) may delegate.
        // Subagents must use message_agent to communicate, not spawn more agents.
        if (tool.name === 'delegate_to_agent') {
            hub.log(`⛔ [GUARDRAIL] ${session.name} attempted delegate_to_agent — blocked. Only the orchestrator may delegate.`, 'warning');
            session.history.push({
                role: 'tool',
                content: [{ type: 'tool_result', tool_use_id: tool.id,
                    content: '⛔ GUARDRAIL: delegate_to_agent is reserved for the orchestrator. You are a subagent — use message_agent to report results instead.' }]
            });
            continue;
        }

        // ── GUARDRAIL: enforce permitted tool list from agent definition ──────
        if (permittedTools && !permittedTools.has(tool.name)) {
            hub.log(`⛔ [GUARDRAIL] ${session.name} attempted ${tool.name} — not in agent's permitted tools`, 'warning');
            session.history.push({
                role: 'tool',
                content: [{ type: 'tool_result', tool_use_id: tool.id,
                    content: `⛔ GUARDRAIL: Tool "${tool.name}" is not in your permitted tool list. Stick to your authorized tools: ${[...permittedTools].join(', ')}` }]
            });
            continue;
        }

        broadcastActivity('tool_start', {
            tool: tool.name,
            inputSummary: JSON.stringify(tool.input || {}).substring(0, 120),
            agent: session.name,
            task: 'direct session'
        });

        let outputContent = '';
        let recommendation = null;

        // ── BYPASS / plan-execution: skip approval entirely ──────────────────
        if (bypassApprovals) {
            if (activeCfg?.chatMode === 'bypass') {
                hub.log(`⚡ [BYPASS] Auto-approving ${tool.name} for ${session.name}`, 'warning');
            }
            const output = await tools.execute(tool);
            outputContent = (typeof output === 'object' && output.content) ? output.content : String(output);
        } else if (agentSystem && agentSystem.classifyApprovalTier) {
            recommendation = agentSystem.classifyApprovalTier(tool.name, tool.input);
            const approvalResult = agentSystem.shouldProceed(recommendation);

            if (approvalResult.approved) {
                const output = await tools.execute(tool);
                outputContent = (typeof output === 'object' && output.content) ? output.content : String(output);
            } else if (approvalResult.escalate && approvalResult.tier >= 3) {
                // Emit approval request — agent tools also go through the standard approval UI
                hub.broadcast('approval_request', {
                    toolName: tool.name,
                    toolId: tool.id,
                    input: tool.input,
                    tier: recommendation.tier,
                    confidence: recommendation.confidence,
                    reasoning: `[Agent: ${session.name}] ${recommendation.reasoning}`,
                    inputSummary: JSON.stringify(tool.input || {}).substring(0, 300)
                });
                const userApproved = await waitForApproval(tool.id, APPROVAL_TIMEOUT_MS);
                if (!userApproved) {
                    outputContent = `[TOOL DENIED] ${tool.name} was denied.`;
                } else {
                    const output = await tools.execute(tool);
                    outputContent = (typeof output === 'object' && output.content) ? output.content : String(output);
                }
            } else {
                const output = await tools.execute(tool);
                outputContent = (typeof output === 'object' && output.content) ? output.content : String(output);
            }
        } else {
            const output = await tools.execute(tool);
            outputContent = (typeof output === 'object' && output.content) ? output.content : String(output);
        }

        broadcastActivity('tool_complete', {
            tool: tool.name,
            success: !outputContent.startsWith('ERROR') && !outputContent.startsWith('[TOOL DENIED]'),
            durationMs: Date.now() - toolStartTime,
            agent: session.name
        });

        // Append tool result to session history (NOT main conv history)
        session.history.push({
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: tool.id, content: outputContent }]
        });
    }
}

function pauseAgent(agentName) {
    const session = getOrCreateSession(agentName);
    session.paused = true;
    hub.broadcast('agent_session_state', {
        agentName,
        isProcessing: session.isProcessing,
        paused: true,
        inboxCount: session.inbox.length
    });
    if (!session.isProcessing) {
        hub.broadcast('agent_paused', { agentName });
    }
    hub.log(`[agent:${agentName}] Paused`, 'info');
}

function resumeAgent(agentName) {
    const session = getOrCreateSession(agentName);
    session.paused = false;
    hub.broadcast('agent_resumed', { agentName });
    hub.broadcast('agent_session_state', {
        agentName,
        isProcessing: session.isProcessing,
        paused: false,
        inboxCount: session.inbox.length
    });
    hub.log(`[agent:${agentName}] Resumed`, 'info');

    // Process next inbox message if available
    if (session.inbox.length > 0 && !session.isProcessing) {
        const next = session.inbox.shift();
        hub.broadcast('agent_inbox_update', { agentName, count: session.inbox.length });
        if (next && next.message) {
            runAgentSession(agentName, next.message);
        }
    }
}

function getAgentSessionState(agentName) {
    const session = agentSessions.get(agentName);
    if (!session) return { name: agentName, isProcessing: false, paused: false, inboxCount: 0, historyLength: 0, startTime: null };
    return {
        name: session.name,
        isProcessing: session.isProcessing,
        paused: session.paused,
        inboxCount: session.inbox.length,
        historyLength: session.history.length,
        startTime: session.startTime
    };
}

function getAgentHistory(agentName) {
    const session = agentSessions.get(agentName);
    if (!session) return [];
    // Return only user/assistant text messages (not raw tool_result entries)
    return session.history
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => {
            let content = '';
            if (typeof m.content === 'string') {
                content = m.content;
            } else if (Array.isArray(m.content)) {
                content = m.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
            }
            return content ? { role: m.role, content } : null;
        })
        .filter(Boolean);
}

function getAgentInbox(agentName) {
    const session = agentSessions.get(agentName);
    return session ? [...session.inbox] : [];
}

/** Returns current orchestrator processing state (for resync on reconnect) */
function getState() {
    const cfg = hub?.getService?.('config');
    return {
        isProcessing,
        chatMode: cfg?.chatMode || 'auto',
        cycleDepth
    };
}

/** Returns all active agent session states (for resync on reconnect) */
function getAllAgentStates() {
    const result = {};
    for (const [name, session] of agentSessions) {
        result[name] = {
            agentName: name,
            isProcessing: session.isProcessing,
            paused: session.paused,
            inboxCount: session.inbox.length,
            historyLength: session.history.length,
            startTime: session.startTime
        };
    }
    return result;
}

module.exports = { init };
