// ==================== APPROVAL FLOW MODULE ====================
// Handles tool approval classification, user approval requests,
// and escalation logic for T1-T4 approval tiers.
//
// Required by: orchestration-core

const orchestrationState = require('./orchestration-state');

const {
    getHub,
    getPendingApprovalResolvers,
    getPendingApprovalData,
    getApprovalTimeout,
    setPendingApproval,
    getPlanExecutionActive,
    getAwaitingPlanApproval,
    setAwaitingPlanApproval,
    getPendingPlanResolvers,
    setPendingPlanResolvers,
    getPendingPlanTaskIds,
    setPendingPlanTaskIds,
    getPendingPlanRawText,
    setPendingPlanRawText,
    getOrchestrationState,
    getIsProcessing,
    setIsProcessing
} = orchestrationState;

// Lazy-loaded functions from orchestration-core (to avoid circular dependency)
let _setOrchestratorState = null;
let _finishMainProcessing = null;

function setOrchestratorState(updates) {
    if (!_setOrchestratorState) {
        try {
            _setOrchestratorState = require('./orchestration-core').setOrchestratorState;
        } catch (e) {
            // Core not loaded yet, skip
            return;
        }
    }
    _setOrchestratorState(updates);
}

function finishMainProcessing(statusText, statusType) {
    if (!_finishMainProcessing) {
        try {
            _finishMainProcessing = require('./orchestration-core').finishMainProcessing;
        } catch (e) {
            // Core not loaded yet, skip
            return;
        }
    }
    _finishMainProcessing(statusText, statusType);
}

let approvalTimeoutTimer = null;

// Wait for user approval on a tool (T3-T4 tiers)
function waitForApproval(toolId, timeoutMs) {
    const hub = getHub();
    const timeout = timeoutMs || getApprovalTimeout();
    
    return new Promise((resolve, reject) => {
        const resolvers = getPendingApprovalResolvers();
        
        const timer = setTimeout(() => {
            resolvers.delete(toolId);
            hub.log(`⏱️ [APPROVAL] Timeout waiting for approval on ${toolId}`, 'warning');
            resolve(false);
        }, timeout || 3600000); // Default 1 hour timeout if none specified
        
        resolvers.set(toolId, { resolve, reject, timer });
        
        // Update state
        setPendingApproval(toolId);
        const state = getOrchestrationState();
        state.pendingApprovals = resolvers.size;
        setOrchestratorState({ pendingApprovals: resolvers.size });
        
        hub.log(`⏳ [APPROVAL] Waiting for user approval: ${toolId}`, 'info');
    });
}

// Handle user's response to an approval request
function handleApprovalResponse(data) {
    const hub = getHub();
    const resolvers = getPendingApprovalResolvers();
    const approvalData = getPendingApprovalData();
    
    const { toolId, approved, feedback } = data;
    const pending = resolvers.get(toolId);
    
    if (!pending) {
        hub.log(`[APPROVAL] No pending approval for ${toolId}`, 'warn');
        return;
    }
    
    clearTimeout(pending.timer);
    resolvers.delete(toolId);
    approvalData.delete(toolId);
    
    // Update state
    const state = getOrchestrationState();
    state.pendingApprovals = resolvers.size;
    setOrchestratorState({ pendingApprovals: resolvers.size });
    
    if (approved) {
        state.humanApprovedCount++;
        setOrchestratorState({ humanApprovedCount: state.humanApprovedCount });
        hub.log(`✅ [APPROVAL] Approved: ${toolId}`, 'success');
    } else {
        hub.log(`❌ [APPROVAL] Denied: ${toolId}`, 'warning');
    }
    
    // Resolve the promise
    pending.resolve(approved);
    setPendingApproval(null);
    
    // Broadcast resolution
    hub.broadcast('approval_resolved', { toolId, approved, feedback });
}

// Handle user cancel request
function handleCancel() {
    const hub = getHub();
    const resolvers = getPendingApprovalResolvers();
    
    hub.log('[CANCEL] Cancel requested by user', 'warning');
    
    // Deny all pending approvals
    if (resolvers.size > 0) {
        resolvers.forEach(({ resolve, timer }, toolId) => {
            clearTimeout(timer);
            resolve(false);
            hub.broadcast('approval_resolved', { toolId, approved: false, cancelled: true });
        });
        resolvers.clear();
        getPendingApprovalData().clear();
        setPendingApproval(null);
        
        const state = getOrchestrationState();
        state.pendingApprovals = 0;
        setOrchestratorState({ pendingApprovals: 0 });
    }
    
    // Reset plan approval state
    if (getPendingPlanResolvers()) {
        clearTimeout(getPendingPlanResolvers().timer);
        setPendingPlanResolvers(null);
    }
    setAwaitingPlanApproval(false);
    
    // Stop any in-progress processing
    if (getIsProcessing()) {
        hub.getService('ai')?.abort();
        setIsProcessing(false);
        finishMainProcessing('Cancelled', 'idle');
    }
}

// Wait for plan decision (plan mode)
function waitForPlanDecision() {
    const hub = getHub();
    
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            hub.log('[PLAN] Plan decision timeout', 'warning');
            resolve(false);
        }, 300000); // 5 minute timeout
        
        setPendingPlanResolvers({ resolve, timer });
        setAwaitingPlanApproval(true);
    });
}

// Handle plan approved
function handlePlanApproved() {
    const hub = getHub();
    const resolvers = getPendingPlanResolvers();
    
    if (!resolvers) return;
    
    clearTimeout(resolvers.timer);
    resolvers.resolve(true);
    setPendingPlanResolvers(null);
    setAwaitingPlanApproval(false);
    
    // Mark plan execution as active - skip individual tool approvals
    const state = getOrchestrationState();
    state.status = 'plan_executing';
    setOrchestratorState({ status: 'plan_executing' });
    
    hub.log('[PLAN] Plan approved - executing', 'success');
}

// Handle plan cancelled
function handlePlanCancelled() {
    const hub = getHub();
    const resolvers = getPendingPlanResolvers();
    
    if (resolvers) {
        clearTimeout(resolvers.timer);
        resolvers.resolve(false);
        setPendingPlanResolvers(null);
    }
    
    setAwaitingPlanApproval(false);
    setPendingPlanRawText('');
    
    hub.log('[PLAN] Plan cancelled', 'warning');
    finishMainProcessing('Plan cancelled', 'idle');
}

// Handle plan revision request
function handlePlanRevision(feedback) {
    const hub = getHub();
    
    hub.log('[PLAN] Plan revision requested: ' + feedback, 'info');
    
    // Clear the pending plan state
    if (getPendingPlanResolvers()) {
        clearTimeout(getPendingPlanResolvers().timer);
        setPendingPlanResolvers(null);
    }
    setAwaitingPlanApproval(false);
    
    // TODO: Trigger AI to revise the plan based on feedback
    // This would typically involve calling the AI with the feedback
}

// Handle plan variant switch
function handleSwitchPlanVariant({ variant } = {}) {
    const hub = getHub();
    const rawText = getPendingPlanRawText();
    
    if (!rawText) {
        hub.log('[PLAN] No pending plan to switch variant', 'warn');
        return;
    }
    
    hub.log(`[PLAN] Switching to variant: ${variant}`, 'info');
    
    // TODO: Implement variant switching logic
    // This would typically involve re-parsing the raw response for the variant
}

// Delete pending plan tasks
function deletePendingPlanTasks(taskIds) {
    const current = getPendingPlanTaskIds();
    const filtered = current.filter(id => !taskIds.includes(id));
    setPendingPlanTaskIds(filtered);
}

// Check-in function - periodic status update every ~10 actions
function checkIn(cycleCount) {
    const hub = getHub();
    const state = getOrchestrationState();
    
    if (cycleCount % 10 === 0) {
        hub.log(`�� [CHECK-IN] Cycle ${cycleCount} - Status: ${state.status}, Agent: ${state.agent || 'orchestrator'}`, 'info');
        
        // Emit checkpoint event for potential save
        hub.emit('orchestration_checkpoint', {
            cycleCount,
            state: { ...state },
            timestamp: Date.now()
        });
    }
}

// Classify approval tier for a tool (delegates to agentSystem service)
function classifyApprovalTier(toolName, toolInput) {
    const hub = getHub();
    const agentSystem = hub.getService('agentSystem');
    
    if (agentSystem && agentSystem.classifyApprovalTier) {
        return agentSystem.classifyApprovalTier(toolName, toolInput);
    }
    
    // Default: tier 1 (auto-approve) if service not available
    return {
        tier: 1,
        confidence: 1.0,
        reasoning: 'Default tier - approval service unavailable'
    };
}

// Check if we should proceed based on tier classification
function shouldProceed(recommendation) {
    const hub = getHub();
    const agentSystem = hub.getService('agentSystem');
    
    if (agentSystem && agentSystem.shouldProceed) {
        return agentSystem.shouldProceed(recommendation);
    }
    
    // Default: approve everything
    return { approved: true, reason: 'Default approval - service unavailable' };
}

module.exports = {
    waitForApproval,
    handleApprovalResponse,
    handleCancel,
    waitForPlanDecision,
    handlePlanApproved,
    handlePlanCancelled,
    handlePlanRevision,
    handleSwitchPlanVariant,
    deletePendingPlanTasks,
    checkIn,
    classifyApprovalTier,
    shouldProceed
};
