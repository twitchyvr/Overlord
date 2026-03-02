// ==================== CONTEXT TRACKER MODULE ====================
// Tracks context usage, compaction, timing, and provides context awareness

let HUB = null;
let CONFIG = null;

// Context tracking state
const contextState = {
    chatStartTime: null,
    lastRequestTime: null,
    lastRequestDuration: 0,
    compactionCount: 0,
    lastCompactionTime: null,
    lastCompactionSize: 0,
    requestHistory: [],
    maxHistory: 20,
    // Actual API token counts from the last request
    lastInputTokens: null,
    lastOutputTokens: null,
    totalInputTokens: 0,
    totalOutputTokens: 0
};

// ==================== INITIALIZATION ====================

function init(hub) {
    HUB = hub;
    CONFIG = hub.getService('config') || {};
    
    // Initialize chat start time
    contextState.chatStartTime = new Date().toISOString();
    
    // Register service
    const service = {
        // Timing
        recordRequestStart: recordRequestStart,
        recordRequestEnd: recordRequestEnd,
        getLastRequestDuration: () => contextState.lastRequestDuration,
        
        // Context tracking
        recordCompaction: recordCompaction,
        getCompactionStats: getCompactionStats,
        
        // Context info
        getContextInfo: getContextInfo,
        getFullStatus: getFullStatus,

        // API token tracking
        recordApiTokens: recordApiTokens,
        getApiTokens: () => ({
            lastInput: contextState.lastInputTokens,
            lastOutput: contextState.lastOutputTokens,
            totalInput: contextState.totalInputTokens,
            totalOutput: contextState.totalOutputTokens
        }),
        
        // Reset
        resetChat: resetChat,
        
        // State
        getState: () => ({ ...contextState })
    };
    
    HUB.registerService('contextTracker', service);
    
    HUB.log('📊 Context Tracker loaded', 'success');
}

// ==================== TIMING ====================

function recordRequestStart() {
    contextState.lastRequestTime = Date.now();
    return contextState.lastRequestTime;
}

function recordRequestEnd() {
    if (contextState.lastRequestTime) {
        contextState.lastRequestDuration = Date.now() - contextState.lastRequestTime;
        
        // Record in history
        contextState.requestHistory.push({
            timestamp: new Date().toISOString(),
            duration: contextState.lastRequestDuration,
            time: new Date().toLocaleTimeString()
        });
        
        // Keep only last N requests
        if (contextState.requestHistory.length > contextState.maxHistory) {
            contextState.requestHistory = contextState.requestHistory.slice(-contextState.maxHistory);
        }
        
        return contextState.lastRequestDuration;
    }
    return 0;
}

// ==================== COMPACTION ====================

function recordCompaction(details = {}) {
    contextState.compactionCount++;
    contextState.lastCompactionTime = new Date().toISOString();
    contextState.lastCompactionSize = details.messagesBefore || 0;
    
    HUB?.log(`📦 Context compacted (${contextState.compactionCount} total) - ${details.reason || 'token limit'}`, 'info');
    
    return {
        compactionNumber: contextState.compactionCount,
        timestamp: contextState.lastCompactionTime,
        messagesBefore: details.messagesBefore,
        messagesAfter: details.messagesAfter,
        reason: details.reason || 'token limit'
    };
}

function getCompactionStats() {
    return {
        totalCompactions: contextState.compactionCount,
        lastCompaction: contextState.lastCompactionTime,
        lastCompactionSize: contextState.lastCompactionSize,
        timeSinceLastCompaction: contextState.lastCompactionTime 
            ? Date.now() - new Date(contextState.lastCompactionTime).getTime()
            : null
    };
}

// ==================== API TOKEN TRACKING ====================

function recordApiTokens(inputTokens, outputTokens) {
    if (inputTokens != null) {
        contextState.lastInputTokens = inputTokens;
        contextState.totalInputTokens += inputTokens;
    }
    if (outputTokens != null) {
        contextState.lastOutputTokens = outputTokens;
        contextState.totalOutputTokens += outputTokens;
    }
}

// ==================== CONTEXT INFO ====================

function getContextInfo() {
    const now = new Date();
    const chatStart = contextState.chatStartTime ? new Date(contextState.chatStartTime) : now;
    
    return {
        // Timing
        currentTime: now.toISOString(),
        currentTimeFormatted: now.toLocaleTimeString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        
        // Chat duration
        chatStartTime: contextState.chatStartTime,
        chatDuration: now - chatStart,
        chatDurationFormatted: formatDuration(now - chatStart),
        
        // Request timing
        lastRequestDuration: contextState.lastRequestDuration,
        lastRequestDurationFormatted: formatDuration(contextState.lastRequestDuration),
        lastRequestTime: contextState.lastRequestTime,
        
        // Compaction
        compactionCount: contextState.compactionCount,
        lastCompactionTime: contextState.lastCompactionTime,

        // History
        requestCount: contextState.requestHistory.length,
        recentRequests: contextState.requestHistory.slice(-5).map(r => ({
            time: r.time,
            duration: formatDuration(r.duration)
        })),

        // Actual API token usage
        inputTokens: contextState.lastInputTokens,
        outputTokens: contextState.lastOutputTokens,
        totalInputTokens: contextState.totalInputTokens,
        totalOutputTokens: contextState.totalOutputTokens
    };
}

function getFullStatus() {
    const info = getContextInfo();
    const compaction = getCompactionStats();
    
    return {
        ...info,
        compactionStats: compaction,
        state: {
            chatStartTime: contextState.chatStartTime,
            lastRequestTime: contextState.lastRequestTime,
            compactionCount: contextState.compactionCount
        }
    };
}

function resetChat() {
    contextState.chatStartTime = new Date().toISOString();
    contextState.lastRequestTime = null;
    contextState.lastRequestDuration = 0;
    contextState.compactionCount = 0;
    contextState.lastCompactionTime = null;
    contextState.requestHistory = [];
    contextState.lastInputTokens = null;
    contextState.lastOutputTokens = null;
    contextState.totalInputTokens = 0;
    contextState.totalOutputTokens = 0;
    
    HUB?.log('📊 Chat context reset', 'info');
    
    return { success: true, chatStartTime: contextState.chatStartTime };
}

// ==================== HELPERS ====================

function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
}

module.exports = { init };
