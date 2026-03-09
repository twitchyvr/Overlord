// ==================== TOOL EXECUTOR MODULE ====================
// Handles tool execution, parsing tool calls from AI responses,
// building results, and error handling.
//
// Required by: orchestration-core

const orchestrationState = require('./orchestration-state');

const {
    getHub,
    getOrchestrationState,
    getConsecutiveToolErrors,
    setConsecutiveToolErrors,
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

// Orchestrator blocked tools - these must be delegated to agents
const ORCH_BLOCKED_TOOLS = new Set([
    'write_file', 'patch_file', 'edit_file', 'apply_diff',
    'run_command', 'bash', 'execute_code', 'execute_shell'
]);

// Map of blocked tools to suggested agents
const ORCH_TOOL_AGENT_MAP = {
    write_file: 'code-implementer',
    patch_file: 'code-implementer',
    edit_file: 'code-implementer',
    apply_diff: 'code-implementer',
    run_command: 'testing-engineer',
    bash: 'testing-engineer',
    execute_code: 'testing-engineer',
    execute_shell: 'testing-engineer'
};

// Execute a single tool call with error handling
async function executeToolCall(tool, conv) {
    const hub = getHub();
    const tools = hub.getService('tools');
    
    const toolStartTime = Date.now();
    const inputSummary = JSON.stringify(tool.input || {}).substring(0, 120);
    
    // Broadcast tool start
    const state = getOrchestrationState();
    broadcastActivity('tool_start', {
        tool: tool.name,
        toolId: tool.id,
        input: tool.input || {},
        inputSummary,
        agent: state.agent || 'orchestrator',
        task: state.task,
        startedAt: toolStartTime
    });
    setOrchestratorState({ tool: tool.name, status: 'tool_executing' });
    
    try {
        const output = await tools.execute(tool);
        
        const duration = Date.now() - toolStartTime;
        
        // Broadcast completion
        broadcastActivity('tool_complete', {
            tool: tool.name,
            toolId: tool.id,
            duration,
            startedAt: toolStartTime,
            agent: state.agent || 'orchestrator'
        });
        
        // Reset consecutive error counter on success
        setConsecutiveToolErrors(0);
        
        return {
            success: true,
            output: output,
            duration
        };
    } catch (error) {
        const duration = Date.now() - toolStartTime;
        
        // Broadcast error
        broadcastActivity('tool_error', {
            tool: tool.name,
            toolId: tool.id,
            error: describeError(error),
            duration,
            startedAt: toolStartTime,
            agent: state.agent || 'orchestrator'
        });
        
        // Increment consecutive error counter
        const errors = getConsecutiveToolErrors();
        setConsecutiveToolErrors(errors + 1);
        
        return {
            success: false,
            error: error,
            errorMessage: describeError(error),
            duration
        };
    }
}

// Parse tool calls from AI response
function parseToolCalls(aiResponse) {
    const hub = getHub();
    
    // Handle array of tool calls
    if (Array.isArray(aiResponse.tool_calls)) {
        return aiResponse.tool_calls;
    }
    
    // Handle object with tool_calls property
    if (aiResponse.tool_calls) {
        return aiResponse.tool_calls;
    }
    
    // Handle legacy format - try to extract from content
    if (aiResponse.content) {
        // Some AI responses include tool calls in content as JSON
        // This is a fallback for older AI models
        try {
            const parsed = JSON.parse(aiResponse.content);
            if (parsed.tool_calls) {
                return parsed.tool_calls;
            }
        } catch (e) {
            // Not JSON, ignore
        }
    }
    
    return [];
}

// Build tool result message for conversation
function buildToolResult(toolId, toolName, output) {
    const hub = getHub();
    
    let content;
    if (typeof output === 'object' && output.content) {
        content = output.content;
    } else {
        content = String(output);
    }
    
    return {
        tool_call_id: toolId,
        role: 'tool',
        content: content
    };
}

// Handle tool execution error
async function handleToolError(tool, error, conv) {
    const hub = getHub();
    const state = getOrchestrationState();
    
    const errorMsg = describeError(error);
    
    hub.log(`[TOOL ERROR] ${tool.name}: ${errorMsg}`, 'error');
    
    // Add error result to conversation
    const errorResult = buildToolResult(
        tool.id,
        tool.name,
        `Error executing ${tool.name}: ${errorMsg}`
    );
    
    if (conv && conv.addToolResult) {
        conv.addToolResult(tool.id, errorResult.content);
    }
    
    // Check for consecutive errors - might indicate a loop
    const errors = getConsecutiveToolErrors();
    if (errors >= 3) {
        hub.log(`⚠️ [ORCHESTRATION] ${errors} consecutive tool errors - possible loop detected`, 'warning');
        
        // Could add more sophisticated loop detection here
        // For now, just log a warning
    }
    
    return errorResult;
}

// Check if tool is blocked for orchestrator
function isToolBlocked(toolName) {
    return ORCH_BLOCKED_TOOLS.has(toolName);
}

// Get suggested agent for blocked tool
function getSuggestedAgent(toolName) {
    return ORCH_TOOL_AGENT_MAP[toolName] || 'code-implementer';
}

// Execute multiple tools with approval flow
// This is the main entry point called from orchestration-core
async function executeToolsWithApproval(toolCalls) {
    const hub = getHub();
    const conv = hub.getService('conversation');
    const tools = hub.getService('tools');
    const agentSystem = hub.getService('agentSystem');
    const activeCfg = hub.getService('config');
    
    const results = [];
    const state = getOrchestrationState();
    
    for (const tool of toolCalls) {
        // Check if tool is blocked for orchestrator
        if (isToolBlocked(tool.name)) {
            const suggestedAgent = getSuggestedAgent(tool.name);
            hub.log(`⛔ [ORCHESTRATOR] Blocked ${tool.name} — must delegate to ${suggestedAgent}`, 'warning');
            
            if (conv && conv.addToolResult) {
                conv.addToolResult(tool.id,
                    `⛔ ORCHESTRATOR ROLE VIOLATION: You called \`${tool.name}\` directly.\n` +
                    `You are the conductor — you plan and delegate, never implement.\n\n` +
                    `REQUIRED: delegate_to_agent(agent: "${suggestedAgent}", task: "<describe exactly what to do>")\n` +
                    `Run list_agents() first if you need to see who is available.`
                );
            }
            
            setOrchestratorState({ tool: null });
            continue;
        }
        
        // SECURITY ROLE ENFORCEMENT
        const agentMgrForRole = hub.getService('agentManager');
        if (agentMgrForRole && agentMgrForRole.isToolAllowedForRole) {
            const orchRole = state.securityRole || 'full-access';
            if (!agentMgrForRole.isToolAllowedForRole(tool.name, orchRole)) {
                const capable = agentMgrForRole.findCapableAgent ? agentMgrForRole.findCapableAgent(tool.name, 'orchestrator') : null;
                const delegateHint = capable
                    ? `\nSuggested delegate: "${capable.name}" (role: ${capable.securityRole}) can execute this tool.`
                    : '';
                
                hub.log(`⛔ [ROLE] Orchestrator role "${orchRole}" blocked ${tool.name}`, 'warning');
                
                if (conv && conv.addToolResult) {
                    conv.addToolResult(tool.id,
                        `⛔ ROLE RESTRICTION: Tool "${tool.name}" is not allowed for role "${orchRole}".${delegateHint}\n` +
                        `Use delegate_to_agent to assign this work to a capable agent.`
                    );
                }
                
                setOrchestratorState({ tool: null });
                continue;
            }
        }
        
        hub.status(`�� Running: ${tool.name}`, 'tool');
        
        // BYPASS mode: skip all approval gates
        if (activeCfg?.chatMode === 'bypass' || require('./orchestration-state').getPlanExecutionActive()) {
            if (activeCfg?.chatMode === 'bypass') {
                hub.log(`⚡ [BYPASS] Auto-approving ${tool.name} (bypass mode active)`, 'warning');
            }
            
            const result = await executeToolCall(tool, conv);
            
            if (result.success) {
                const outputContent = typeof result.output === 'object' && result.output.content
                    ? result.output.content
                    : String(result.output);
                
                if (conv && conv.addToolResult) {
                    conv.addToolResult(tool.id, outputContent);
                }
                
                results.push({ toolId: tool.id, success: true, output: outputContent });
            } else {
                const errorResult = await handleToolError(tool, result.error, conv);
                results.push({ toolId: tool.id, success: false, error: result.errorMessage });
            }
            
            continue;
        }
        
        // ASK mode: force user approval for every tool
        if (activeCfg?.chatMode === 'ask') {
            const askPayload = {
                toolName: tool.name,
                toolId: tool.id,
                input: tool.input,
                tier: 3,
                confidence: 1.0,
                reasoning: 'Ask Permissions mode — all tools require approval',
                inputSummary: JSON.stringify(tool.input || {}).substring(0, 300)
            };
            
            require('./orchestration-state').getPendingApprovalData().set(tool.id, askPayload);
            hub.broadcast('approval_request', askPayload);
            hub.sendPush('⚠ Approval Required',
                `${tool.name} is waiting for your approval`,
                { requireInteraction: true, tag: 'overlord-approval' }
            );
            
            // Wait for approval
            const approvalFlow = require('./approval-flow');
            const askApproved = await approvalFlow.waitForApproval(tool.id, require('./orchestration-state').getApprovalTimeout());
            
            if (!askApproved) {
                if (conv && conv.addToolResult) {
                    conv.addToolResult(tool.id, `[DENIED] ${tool.name}`);
                }
                hub.addMessage('assistant', `❌ \`${tool.name}\` denied. Skipping.`);
                setOrchestratorState({ tool: null });
                continue;
            }
            
            const result = await executeToolCall(tool, conv);
            
            if (result.success) {
                const outputContent = typeof result.output === 'object' && result.output.content
                    ? result.output.content
                    : String(result.output);
                
                if (conv && conv.addToolResult) {
                    conv.addToolResult(tool.id, outputContent);
                }
                
                results.push({ toolId: tool.id, success: true, output: outputContent });
            } else {
                const errorResult = await handleToolError(tool, result.error, conv);
                results.push({ toolId: tool.id, success: false, error: result.errorMessage });
            }
            
            continue;
        }
        
        // AUTO mode: classify and approve based on tier
        const approvalFlow = require('./approval-flow');
        let recommendation = null;
        let approvalResult = { approved: true, reason: 'No approval system' };
        
        if (agentSystem && agentSystem.classifyApprovalTier) {
            recommendation = agentSystem.classifyApprovalTier(tool.name, tool.input);
            hub.log(`�� [${tool.name}] Tier ${recommendation.tier} (confidence: ${recommendation.confidence.toFixed(2)}) - ${recommendation.reasoning}`, 'info');
            
            approvalResult = approvalFlow.shouldProceed(recommendation);
        }
        
        if (approvalResult.approved) {
            hub.log(`✅ [${tool.name}] ${approvalResult.reason}`, 'info');
            
            const result = await executeToolCall(tool, conv);
            
            let outputContent;
            if (result.success) {
                outputContent = typeof result.output === 'object' && result.output.content
                    ? result.output.content
                    : String(result.output);
                
                hub.log(`[${tool.name}] completed`, 'success');
                
                // Record decision
                if (agentSystem && agentSystem.recordDecision) {
                    agentSystem.recordDecision(
                        recommendation?.action || { type: tool.name },
                        recommendation || { tier: 1 },
                        recommendation?.tier || 1,
                        approvalResult.reason
                    );
                }
                
                if (conv && conv.addToolResult) {
                    conv.addToolResult(tool.id, outputContent);
                }
                
                results.push({ toolId: tool.id, success: true, output: outputContent });
                
                // Track auto-approved
                state.autoApprovedCount++;
                setOrchestratorState({ autoApprovedCount: state.autoApprovedCount });
            } else {
                const errorResult = await handleToolError(tool, result.error, conv);
                results.push({ toolId: tool.id, success: false, error: result.errorMessage });
            }
        } else if (approvalResult.escalate && approvalResult.tier >= 3) {
            // T3-T4: Need user approval
            hub.log(`⚠️ [${tool.name}] Tier ${recommendation.tier} — awaiting user approval`, 'warning');
            
            const t3Payload = {
                toolName: tool.name,
                toolId: tool.id,
                input: tool.input,
                tier: recommendation.tier,
                confidence: recommendation.confidence,
                reasoning: recommendation.reasoning,
                inputSummary: JSON.stringify(tool.input || {}).substring(0, 300)
            };
            
            require('./orchestration-state').getPendingApprovalData().set(tool.id, t3Payload);
            hub.broadcast('approval_request', t3Payload);
            hub.sendPush('⚠ Approval Required',
                `Tier ${recommendation.tier} tool "${tool.name}" requires approval`,
                { requireInteraction: true, tag: 'overlord-approval' }
            );
            
            const tierApproved = await approvalFlow.waitForApproval(tool.id, require('./orchestration-state').getApprovalTimeout());
            
            if (!tierApproved) {
                if (conv && conv.addToolResult) {
                    conv.addToolResult(tool.id, `[DENIED] ${tool.name} (Tier ${recommendation.tier})`);
                }
                hub.addMessage('assistant', `❌ \`${tool.name}\` denied. Skipping.`);
                setOrchestratorState({ tool: null });
                continue;
            }
            
            const result = await executeToolCall(tool, conv);
            
            if (result.success) {
                const outputContent = typeof result.output === 'object' && result.output.content
                    ? result.output.content
                    : String(result.output);
                
                if (conv && conv.addToolResult) {
                    conv.addToolResult(tool.id, outputContent);
                }
                
                results.push({ toolId: tool.id, success: true, output: outputContent });
            } else {
                const errorResult = await handleToolError(tool, result.error, conv);
                results.push({ toolId: tool.id, success: false, error: result.errorMessage });
            }
        } else {
            // Denied
            if (conv && conv.addToolResult) {
                conv.addToolResult(tool.id, `[DENIED] ${tool.name}: ${approvalResult.reason}`);
            }
            
            hub.addMessage('assistant', `❌ \`${tool.name}\` denied: ${approvalResult.reason}`);
            results.push({ toolId: tool.id, success: false, denied: true, reason: approvalResult.reason });
        }
        
        setOrchestratorState({ tool: null, status: 'thinking' });
    }
    
    return results;
}

module.exports = {
    executeToolCall,
    parseToolCalls,
    buildToolResult,
    handleToolError,
    isToolBlocked,
    getSuggestedAgent,
    executeToolsWithApproval
};
