// ==================== ORCHESTRATION STATE ====================
// Shared state module - contains all variables that need to be
// shared across orchestration-core, agent-session, chat-room,
// tool-executor, and approval-flow modules.
//
// This module is required by all other orchestration modules.

let hub = null;
let isProcessing = false;

// Error handling
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EPIPE', 'ENOTFOUND', 'ENETUNREACH', 'EAI_AGAIN']);

function describeError(e) {
    if (!e) return 'Unknown error';
    const parts = [];
    if (e.message && e.message.trim()) parts.push(e.message.trim());
    if (e.code) parts.push(`[${e.code}]`);
    if (e.syscall) parts.push(`(syscall: ${e.syscall})`);
    if (parts.length === 0) {
        const name = e.constructor?.name || 'Error';
        try { return `${name}: ${JSON.stringify(e)}`; } catch { return String(e); }
    }
    return parts.join(' ');
}

function isNetworkError(e) {
    if (!e) return false;
    if (RETRYABLE_CODES.has(e.code)) return true;
    const msg = (e.message || '').toLowerCase();
    return msg.includes('socket hang up') || msg.includes('connection reset') ||
           msg.includes('network timeout') || msg.includes('econnreset');
}

// Approval system state
let pendingApproval = null;
const pendingApprovalResolvers = new Map();
const pendingApprovalData = new Map();

// Plan mode state
let awaitingPlanApproval = false;
let pendingPlanResolvers = null;
let pendingPlanTaskIds = [];
let pendingPlanRawText = '';
let planExecutionActive = false;

// Runtime limits
let MAX_CYCLES = 10;
let cycleDepth = 0;
let MAX_QA_ATTEMPTS = 3;
const qaAttempts = new Map();
const _delegationAttempts = new Map();
let APPROVAL_TIMEOUT_MS = 0;

// Error tracking
let _consecutiveToolErrors = 0;
let _agentChainDepth = 0;

// Chat rooms
const agentChatRooms = new Map();
let _nextRoomId = 1;
const MAX_ROOM_AGENTS = 5;

// Agent sessions
const agentSessions = new Map();
let maxParallelAgents = 3;

// Orchestration state
const orchestrationState = {
    status: 'idle',
    agent: null,
    task: null,
    tool: null,
    thinking: false,
    startTime: null,
    cycleDepth: 0,
    maxCycles: 10,
    totalCyclesThisSession: 0,
    strategy: 'auto',
    activeOverlay: null,
    overlayAutoRevert: true,
    activeAgents: [],
    maxParallelAgents: 3,
    toolHistory: [],
    tokensUsed: 0,
    tokenBudget: 0,
    contextUsage: { used: 0, max: 0, percent: 0 },
    pendingApprovals: 0,
    autoApprovedCount: 0,
    humanApprovedCount: 0,
    qaPassCount: 0,
    qaFailCount: 0,
    qaAttempts: 0,
    autoQA: true,
    lastMessageAt: null,
    lastToolAt: null,
    processingStartedAt: null,
    lastPerception: null,
    aiSummarization: true,
    sessionNotesCount: 0,
    pendingRecommendations: []
};

// Getters and setters
function getHub() {
    return hub;
}

function setHub(h) {
    hub = h;
}

function getIsProcessing() {
    return isProcessing;
}

function setIsProcessing(val) {
    isProcessing = val;
}

function getOrchestrationState() {
    return orchestrationState;
}

function getAgentSessions() {
    return agentSessions;
}

function getAgentChatRooms() {
    return agentChatRooms;
}

function getMaxCycles() {
    return MAX_CYCLES;
}

function setMaxCycles(val) {
    MAX_CYCLES = val;
}

function getCycleDepth() {
    return cycleDepth;
}

function setCycleDepth(val) {
    cycleDepth = val;
}

function getMaxQaAttempts() {
    return MAX_QA_ATTEMPTS;
}

function setMaxQaAttempts(val) {
    MAX_QA_ATTEMPTS = val;
}

function getApprovalTimeout() {
    return APPROVAL_TIMEOUT_MS;
}

function setApprovalTimeout(val) {
    APPROVAL_TIMEOUT_MS = val;
}

function getMaxParallelAgents() {
    return maxParallelAgents;
}

function setMaxParallelAgents(val) {
    maxParallelAgents = val;
}

function getPendingApproval() {
    return pendingApproval;
}

function setPendingApproval(val) {
    pendingApproval = val;
}

function getPendingApprovalResolvers() {
    return pendingApprovalResolvers;
}

function getPendingApprovalData() {
    return pendingApprovalData;
}

function getPlanExecutionActive() {
    return planExecutionActive;
}

function setPlanExecutionActive(val) {
    planExecutionActive = val;
}

function getAwaitingPlanApproval() {
    return awaitingPlanApproval;
}

function setAwaitingPlanApproval(val) {
    awaitingPlanApproval = val;
}

function getPendingPlanResolvers() {
    return pendingPlanResolvers;
}

function setPendingPlanResolvers(val) {
    pendingPlanResolvers = val;
}

function getPendingPlanTaskIds() {
    return pendingPlanTaskIds;
}

function setPendingPlanTaskIds(val) {
    pendingPlanTaskIds = val;
}

function getPendingPlanRawText() {
    return pendingPlanRawText;
}

function setPendingPlanRawText(val) {
    pendingPlanRawText = val;
}

function getConsecutiveToolErrors() {
    return _consecutiveToolErrors;
}

function setConsecutiveToolErrors(val) {
    _consecutiveToolErrors = val;
}

function getAgentChainDepth() {
    return _agentChainDepth;
}

function setAgentChainDepth(val) {
    _agentChainDepth = val;
}

function getQaAttempts() {
    return qaAttempts;
}

function getDelegationAttempts() {
    return _delegationAttempts;
}

function getNextRoomId() {
    return _nextRoomId++;
}

module.exports = {
    // Hub
    getHub,
    setHub,
    
    // Processing state
    getIsProcessing,
    setIsProcessing,
    
    // Orchestration state
    getOrchestrationState,
    
    // Agent sessions
    getAgentSessions,
    getMaxParallelAgents,
    setMaxParallelAgents,
    
    // Chat rooms
    getAgentChatRooms,
    MAX_ROOM_AGENTS,
    
    // Cycle management
    getMaxCycles,
    setMaxCycles,
    getCycleDepth,
    setCycleDepth,
    
    // QA
    getMaxQaAttempts,
    setMaxQaAttempts,
    getQaAttempts,
    
    // Approval
    getApprovalTimeout,
    setApprovalTimeout,
    getPendingApproval,
    setPendingApproval,
    getPendingApprovalResolvers,
    getPendingApprovalData,
    
    // Plan mode
    getPlanExecutionActive,
    setPlanExecutionActive,
    getAwaitingPlanApproval,
    setAwaitingPlanApproval,
    getPendingPlanResolvers,
    setPendingPlanResolvers,
    getPendingPlanTaskIds,
    setPendingPlanTaskIds,
    getPendingPlanRawText,
    setPendingPlanRawText,
    
    // Error tracking
    getConsecutiveToolErrors,
    setConsecutiveToolErrors,
    getAgentChainDepth,
    setAgentChainDepth,
    
    // Delegation tracking
    getDelegationAttempts,
    
    // Helper functions
    describeError,
    isNetworkError,
    getNextRoomId
};
