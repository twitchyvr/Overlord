// ==================== ORCHESTRATION MODULE (BACKWARD COMPATIBILITY) ====================
// This file re-exports all orchestration modules for backward compatibility.
// New code should import directly from the specific modules:
//
// - orchestration-state.js: Shared state management
// - orchestration-core.js: Main AI loop orchestration
// - approval-flow.js: Approval system
// - tool-executor.js: Tool execution
// - agent-session.js: Agent session management
// - chat-room.js: Chat rooms and meetings

const orchestrationCore = require('./orchestration-core');
const orchestrationState = require('./orchestration-state');
const approvalFlow = require('./approval-flow');
const toolExecutor = require('./tool-executor');
const agentSession = require('./agent-session');
const chatRoom = require('./chat-room');

// Re-export all functions for backward compatibility
module.exports = {
    // Core orchestration
    init: orchestrationCore.init,
    handleUserMessage: orchestrationCore.handleUserMessage,
    runAICycle: orchestrationCore.runAICycle,
    runAutoQA: orchestrationCore.runAutoQA,
    broadcastActivity: orchestrationCore.broadcastActivity,
    setOrchestratorState: orchestrationCore.setOrchestratorState,
    finishMainProcessing: orchestrationCore.finishMainProcessing,
    broadcastOrchestratorDashboard: orchestrationCore.broadcastOrchestratorDashboard,
    checkpoint: orchestrationCore.checkpoint,
    handleSetStrategy: orchestrationCore.handleSetStrategy,
    handleSetOverlay: orchestrationCore.handleSetOverlay,
    handleKillAgent: orchestrationCore.handleKillAgent,
    handleNewConversation: orchestrationCore.handleNewConversation,
    handleClientConnected: orchestrationCore.handleClientConnected,
    getState: orchestrationCore.getState,
    
    // State getters
    getOrchestrationState: orchestrationState.getOrchestrationState,
    getAgentSessions: orchestrationState.getAgentSessions,
    getAgentChatRooms: orchestrationState.getAgentChatRooms,
    getIsProcessing: orchestrationState.getIsProcessing,
    getMaxCycles: orchestrationState.getMaxCycles,
    getCycleDepth: orchestrationState.getCycleDepth,
    getMaxQaAttempts: orchestrationState.getMaxQaAttempts,
    getApprovalTimeout: orchestrationState.getApprovalTimeout,
    getMaxParallelAgents: orchestrationState.getMaxParallelAgents,
    getConsecutiveToolErrors: orchestrationState.getConsecutiveToolErrors,
    getAgentChainDepth: orchestrationState.getAgentChainDepth,
    describeError: orchestrationState.describeError,
    isNetworkError: orchestrationState.isNetworkError,
    
    // Approval flow
    waitForApproval: approvalFlow.waitForApproval,
    handleApprovalResponse: approvalFlow.handleApprovalResponse,
    handleCancel: approvalFlow.handleCancel,
    waitForPlanDecision: approvalFlow.waitForPlanDecision,
    handlePlanApproved: approvalFlow.handlePlanApproved,
    handlePlanCancelled: approvalFlow.handlePlanCancelled,
    handlePlanRevision: approvalFlow.handlePlanRevision,
    handleSwitchPlanVariant: approvalFlow.handleSwitchPlanVariant,
    deletePendingPlanTasks: approvalFlow.deletePendingPlanTasks,
    checkIn: approvalFlow.checkIn,
    classifyApprovalTier: approvalFlow.classifyApprovalTier,
    shouldProceed: approvalFlow.shouldProceed,
    
    // Tool executor
    executeToolCall: toolExecutor.executeToolCall,
    parseToolCalls: toolExecutor.parseToolCalls,
    buildToolResult: toolExecutor.buildToolResult,
    handleToolError: toolExecutor.handleToolError,
    isToolBlocked: toolExecutor.isToolBlocked,
    getSuggestedAgent: toolExecutor.getSuggestedAgent,
    executeToolsWithApproval: toolExecutor.executeToolsWithApproval,
    
    // Agent session
    getOrCreateSession: agentSession.getOrCreateSession,
    buildAgentSystemPrompt: agentSession.buildAgentSystemPrompt,
    dispatchAgentAndAwait: agentSession.dispatchAgentAndAwait,
    runAgentSessionInRoom: agentSession.runAgentSessionInRoom,
    clearRoomAgentCallbacks: agentSession.clearRoomAgentCallbacks,
    runAgentSession: agentSession.runAgentSession,
    runAgentCycle: agentSession.runAgentCycle,
    runAgentAICycle: agentSession.runAgentAICycle,
    executeAgentTools: agentSession.executeAgentTools,
    pauseAgent: agentSession.pauseAgent,
    resumeAgent: agentSession.resumeAgent,
    getAgentSessionState: agentSession.getAgentSessionState,
    getAgentHistory: agentSession.getAgentHistory,
    getAgentInbox: agentSession.getAgentInbox,
    getAllAgentStates: agentSession.getAllAgentStates,
    handleToolException: agentSession.handleToolException,
    
    // Chat room
    createChatRoom: chatRoom.createChatRoom,
    addRoomMessage: chatRoom.addRoomMessage,
    endChatRoom: chatRoom.endChatRoom,
    listChatRooms: chatRoom.listChatRooms,
    getChatRoom: chatRoom.getChatRoom,
    pullAgentIntoRoom: chatRoom.pullAgentIntoRoom,
    userLeaveRoom: chatRoom.userLeaveRoom,
    userJoinRoom: chatRoom.userJoinRoom,
    generateMeetingNotes: chatRoom.generateMeetingNotes,
    endMeeting: chatRoom.endMeeting,
    MAX_ROOM_AGENTS: chatRoom.MAX_ROOM_AGENTS
};
