// ==================== AGENT SESSION MODULE ====================
// Handles agent sessions, agent inbox, pause/resume, thinking mode,
// and agent-to-agent delegation.
//
// Required by: orchestration-core

const os = require('os');
const orchestrationState = require('./orchestration-state');

const {
    getHub,
    getAgentSessions,
    getOrchestrationState,
    getCycleDepth,
    setCycleDepth,
    getMaxCycles,
    getAgentChainDepth,
    setAgentChainDepth,
    getDelegationAttempts,
    describeError
} = orchestrationState;

// Lazy-loaded functions from orchestration-core (to avoid circular dependency)
let _broadcastActivity = null;
let _setOrchestratorState = null;

function broadcastActivity(type, data) {
    if (!_broadcastActivity) {
        try {
            _broadcastActivity = require('./orchestration-core').broadcastActivity;
        } catch (e) {
            return;
        }
    }
    _broadcastActivity(type, data);
}

function setOrchestratorState(updates) {
    if (!_setOrchestratorState) {
        try {
            _setOrchestratorState = require('./orchestration-core').setOrchestratorState;
        } catch (e) {
            return;
        }
    }
    _setOrchestratorState(updates);
}

// Get or create an agent session
function getOrCreateSession(agentName) {
    const sessions = getAgentSessions();
    let session = sessions.get(agentName);

    if (!session) {
        session = {
            name: agentName,
            status: 'idle',
            isProcessing: false,
            paused: false,
            aborted: false,
            currentTask: null,
            startTime: null,
            cycleCount: 0,
            toolsUsed: 0,
            history: [],
            inbox: [],
            persistentContext: null,
            lastActiveAt: Date.now()
        };
        sessions.set(agentName, session);
    }

    session.lastActiveAt = Date.now();
    return session;
}

// Build agent system prompt with context (role-based: lean, task-focused)
function buildAgentSystemPrompt(session) {
    const hub = getHub();
    const conv = hub.getService('conversation');

    let systemPrompt = '';

    // ── Agent identity ───────────────────────────────────────────────
    const agentMgr = hub.getService('agentManager');
    let agentInfo = null;
    if (agentMgr && agentMgr.getAgentInfo) {
        agentInfo = agentMgr.getAgentInfo(session.name);
        if (agentInfo && agentInfo.systemPrompt) {
            systemPrompt = agentInfo.systemPrompt;
        }
    }

    // ── Platform, OS, working directory, date/time ───────────────────
    const platformName = process.platform === 'darwin' ? 'macOS'
        : process.platform === 'win32' ? 'Windows' : 'Linux';
    const workingDir = conv?.getWorkingDirectory?.() || process.cwd();

    systemPrompt += `\n\n[ENVIRONMENT]
- Platform: ${platformName}
- OS Version: ${os.version()} (${os.release()})
- Node.js: ${process.version}
- Working Directory: ${workingDir}
- Date/Time: ${new Date().toISOString()}
- Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;

    // ── Available tools (name + brief description) ───────────────────
    const toolsService = hub.getService('tools');
    if (toolsService && toolsService.getDefinitions) {
        const defs = toolsService.getDefinitions();
        if (defs && defs.length > 0) {
            systemPrompt += '\n\n[AVAILABLE TOOLS]\n';
            defs.forEach(t => {
                const brief = (t.description || '').split('.')[0];
                systemPrompt += `- ${t.name}: ${brief}\n`;
            });
        }
    }

    // ── Task scope constraints (if delegated with scope) ─────────────
    if (session.taskScope) {
        systemPrompt += '\n\n[TASK SCOPE]\n';
        if (session.taskScope.files) systemPrompt += `Allowed files: ${session.taskScope.files.join(', ')}\n`;
        if (session.taskScope.directories) systemPrompt += `Allowed directories: ${session.taskScope.directories.join(', ')}\n`;
        if (session.taskScope.constraints) systemPrompt += `Constraints: ${session.taskScope.constraints}\n`;
    }

    // ── Session notes (Mini-Agent pattern) ───────────────────────────
    if (session.persistentContext) {
        systemPrompt += '\n\n[SESSION CONTEXT]\n' + session.persistentContext;
    }

    // ── Inbox messages ───────────────────────────────────────────────
    if (session.inbox && session.inbox.length > 0) {
        const inboxPreview = session.inbox.slice(0, 5).map(m =>
            `- ${m.from}: ${m.message.substring(0, 100)}`
        ).join('\n');
        systemPrompt += '\n\n[INBOX]\n' + inboxPreview;
        if (session.inbox.length > 5) {
            systemPrompt += `\n... and ${session.inbox.length - 5} more messages`;
        }
    }

    return systemPrompt;
}

// Dispatch task to an agent and wait for completion
async function dispatchAgentAndAwait(agentName, task, taskScope = {}) {
    const hub = getHub();
    const state = getOrchestrationState();
    const maxCycles = getMaxCycles();
    const currentDepth = getAgentChainDepth();

    // Check chain depth
    if (currentDepth >= 5) {
        hub.log(`[DELEGATION] Max agent chain depth (5) reached`, 'error');
        return {
            success: false,
            error: 'Maximum agent delegation depth reached (5). Cannot delegate further.'
        };
    }

    // Check delegation attempts
    const delegationAttempts = getDelegationAttempts();
    const taskKey = `${agentName}::${task.slice(0, 80)}`;
    const attempts = delegationAttempts.get(taskKey) || 0;

    if (attempts >= 3) {
        hub.log(`[DELEGATION] Max retry attempts (3) for task to ${agentName}`, 'error');
        return {
            success: false,
            error: `Maximum delegation attempts (3) to ${agentName} reached for this task.`
        };
    }

    delegationAttempts.set(taskKey, attempts + 1);
    setAgentChainDepth(currentDepth + 1);

    setOrchestratorState({
        status: 'delegating',
        agent: agentName,
        task: task
    });

    hub.log(`[DELEGATION] Dispatching to ${agentName}: ${task.substring(0, 100)}...`, 'info');

    try {
        const result = await runAgentSession(agentName, task, taskScope);

        setAgentChainDepth(currentDepth);

        if (result.success) {
            hub.log(`[DELEGATION] ${agentName} completed task`, 'success');
        } else {
            hub.log(`[DELEGATION] ${agentName} failed: ${result.error}`, 'warning');
        }

        return result;
    } catch (error) {
        setAgentChainDepth(currentDepth);

        hub.log(`[DELEGATION] ${agentName} error: ${describeError(error)}`, 'error');

        return {
            success: false,
            error: describeError(error)
        };
    }
}

// Run agent in a room context
function runAgentSessionInRoom(agentName, userMessage, roomId, onComplete) {
    const hub = getHub();
    const session = getOrCreateSession(agentName);

    session.isProcessing = true;
    session.status = 'running';
    session.roomId = roomId;
    session.onComplete = onComplete;

    setOrchestratorState({
        status: 'agent_running',
        agent: agentName,
        task: userMessage
    });

    // Run the agent cycle
    runAgentCycle(session, userMessage).then(result => {
        session.isProcessing = false;
        session.status = 'idle';

        if (session.onComplete) {
            session.onComplete(result);
            session.onComplete = null;
        }

        broadcastOrchestratorDashboard();
    }).catch(error => {
        session.isProcessing = false;
        session.status = 'error';

        if (session.onComplete) {
            session.onComplete({ success: false, error: describeError(error) });
            session.onComplete = null;
        }

        broadcastOrchestratorDashboard();
    });
}

// Clear room agent callbacks
function clearRoomAgentCallbacks(roomId) {
    const sessions = getAgentSessions();

    sessions.forEach(session => {
        if (session.roomId === roomId) {
            session.roomId = null;
            session.onComplete = null;
        }
    });
}

// Main agent session runner
function runAgentSession(agentName, userMessage) {
    const hub = getHub();
    const session = getOrCreateSession(agentName);

    return new Promise((resolve, reject) => {
        session.isProcessing = true;
        session.status = 'running';
        session.currentTask = userMessage;
        session.startTime = Date.now();

        setOrchestratorState({
            status: 'agent_running',
            agent: agentName,
            task: userMessage
        });

        runAgentCycle(session, userMessage).then(result => {
            session.isProcessing = false;
            session.status = 'idle';
            session.cycleCount++;

            broadcastOrchestratorDashboard();

            resolve(result);
        }).catch(error => {
            session.isProcessing = false;
            session.status = 'error';

            broadcastOrchestratorDashboard();

            reject(error);
        });
    });
}

// Run a single agent cycle (AI → tools → AI)
async function runAgentCycle(session, userMessage) {
    const hub = getHub();
    const ai = hub.getService('ai');
    const tools = hub.getService('tools');

    if (!ai || !ai.sendMessage) {
        return { success: false, error: 'AI service not available' };
    }

    const maxCycles = getMaxCycles();
    let cycleCount = 0;

    // Build system prompt
    const systemPrompt = buildAgentSystemPrompt(session);

    // Add agent task to conversation context (role:'user' for API compatibility)
    // but broadcast with source metadata so the UI shows it's from the agent, not the human
    const conv = hub.getService('conversation');
    if (conv && conv.addMessage) conv.addMessage('user', userMessage);
    hub.broadcast('message_add', {
        role: 'user',
        content: userMessage,
        source: session.agentName || 'orchestrator'
    });

    while (cycleCount < maxCycles) {
        setCycleDepth(cycleCount);

        const result = await runAgentAICycle(session, systemPrompt, ai, tools);

        if (result.done) {
            return { success: true, response: result.response };
        }

        cycleCount++;
    }

    return {
        success: false,
        error: `Max cycles (${maxCycles}) reached`
    };
}

// Run a single AI call for an agent
async function runAgentAICycle(session, systemPrompt, ai, tools) {
    const hub = getHub();

    broadcastActivity('agent_thinking_start', { agent: session.name });

    try {
        const response = await ai.sendMessage(null, {
            system: systemPrompt,
            temperature: 0.7
        });

        broadcastActivity('agent_thinking_done', { agent: session.name });

        // Check for tool calls
        if (response.tool_calls && response.tool_calls.length > 0) {
            // Execute tools
            const toolExecutor = require('./tool-executor');
            const results = await toolExecutor.executeToolsWithApproval(response.tool_calls);

            session.toolsUsed += results.length;

            return { done: false, results };
        }

        // No tools, we're done
        return { done: true, response: response.content };
    } catch (error) {
        broadcastActivity('agent_thinking_done', { agent: session.name });

        throw error;
    }
}

// Execute tools for an agent session
async function executeAgentTools(session, toolCalls, agentSystem, tools) {
    const hub = getHub();
    const conv = hub.getService('conversation');

    const results = [];

    for (const toolCall of toolCalls) {
        const tool = {
            name: toolCall.function.name,
            id: toolCall.id,
            input: toolCall.function.arguments
        };

        try {
            const output = await tools.execute(tool);
            session.toolsUsed++;

            const toolResult = {
                tool_call_id: tool.id,
                role: 'tool',
                content: typeof output === 'object' && output.content ? output.content : String(output)
            };

            if (conv && conv.addToolResult) {
                conv.addToolResult(tool.id, toolResult.content);
            }

            results.push({ success: true, output: toolResult });
        } catch (error) {
            results.push({
                success: false,
                error: describeError(error)
            });
        }
    }

    return results;
}

// Pause an agent
function pauseAgent(agentName) {
    const hub = getHub();
    const session = getOrCreateSession(agentName);

    session.paused = true;
    session.status = 'paused';

    hub.log(`[AGENT] ${agentName} paused`, 'info');
    broadcastOrchestratorDashboard();

    return { success: true, status: 'paused' };
}

// Resume an agent
function resumeAgent(agentName) {
    const hub = getHub();
    const session = getAgentSessions().get(agentName);

    if (!session) {
        return { success: false, error: 'Agent session not found' };
    }

    session.paused = false;
    session.status = session.isProcessing ? 'running' : 'idle';

    hub.log(`[AGENT] ${agentName} resumed`, 'info');
    broadcastOrchestratorDashboard();

    return { success: true, status: session.status };
}

// Get agent session state
function getAgentSessionState(agentName) {
    const session = getAgentSessions().get(agentName);

    if (!session) {
        return null;
    }

    return {
        name: session.name,
        status: session.status,
        isProcessing: session.isProcessing,
        paused: session.paused,
        currentTask: session.currentTask,
        startTime: session.startTime,
        cycleCount: session.cycleCount,
        toolsUsed: session.toolsUsed,
        hasPersistentContext: !!session.persistentContext,
        inboxCount: session.inbox ? session.inbox.length : 0
    };
}

// Get agent history
function getAgentHistory(agentName) {
    const session = getAgentSessions().get(agentName);

    if (!session) {
        return [];
    }

    return session.history || [];
}

// Get agent inbox
function getAgentInbox(agentName) {
    const session = getAgentSessions().get(agentName);

    if (!session) {
        return [];
    }

    return session.inbox || [];
}

// Get all agent states
function getAllAgentStates() {
    const sessions = getAgentSessions();
    const states = [];

    sessions.forEach((session, name) => {
        const derivedStatus = session.isProcessing ? 'running'
            : session.paused ? 'paused'
            : 'idle';

        states.push({
            name,
            status: derivedStatus,
            task: session.currentTask || null,
            startTime: session.startTime || null,
            cycleCount: session.cycleCount || 0,
            toolsUsed: session.toolsUsed || 0,
            hasPersistentContext: !!session.persistentContext
        });
    });

    return states;
}

// Handle tool exception in agent session
async function handleToolException(session, input, tools) {
    const hub = getHub();

    const toolName = input.name;
    const toolInput = input.input || {};

    hub.log(`[AGENT TOOL ERROR] ${session.name} - ${toolName}: ${input.error}`, 'error');

    // Could add retry logic or fallback behavior here

    return {
        success: false,
        error: input.error
    };
}

// Helper for dashboard broadcast
let _broadcastOrchestratorDashboard = null;
function broadcastOrchestratorDashboard() {
    if (!_broadcastOrchestratorDashboard) {
        try {
            _broadcastOrchestratorDashboard = require('./orchestration-core').broadcastOrchestratorDashboard;
        } catch (e) {
            return;
        }
    }
    _broadcastOrchestratorDashboard();
}

module.exports = {
    getOrCreateSession,
    buildAgentSystemPrompt,
    dispatchAgentAndAwait,
    runAgentSessionInRoom,
    clearRoomAgentCallbacks,
    runAgentSession,
    runAgentCycle,
    runAgentAICycle,
    executeAgentTools,
    pauseAgent,
    resumeAgent,
    getAgentSessionState,
    getAgentHistory,
    getAgentInbox,
    getAllAgentStates,
    handleToolException
};
