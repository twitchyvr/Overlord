// ==================== MESSAGE QUEUE MODULE ====================
// Message management for conversation

let HUB = null;

// Add user message
function addUserMessage(content) {
    return {
        role: 'user',
        content: content,
        ts: Date.now()
    };
}

// Add assistant message
function addAssistantMessage(message) {
    const msg = {
        role: 'assistant',
        ts: Date.now()
    };
    
    if (typeof message === 'string') {
        msg.content = message;
    } else {
        Object.assign(msg, message);
    }
    
    return msg;
}

// Add tool result
function addToolResult(toolId, content) {
    return {
        role: 'tool',
        tool_call_id: toolId,
        content: content,
        ts: Date.now()
    };
}

// Get all messages
function getMessages(conv) {
    return conv?.messages || [];
}

// Replace history
function replaceHistory(newHistory) {
    return newHistory.map(msg => ({
        ...msg,
        ts: msg.ts || Date.now()
    }));
}

// Add roadmap item
function addRoadmapItem(text, type) {
    return {
        id: 'rm_' + Date.now(),
        text,
        type: type || 'general',
        done: false,
        createdAt: Date.now()
    };
}

// Sanitize history
function sanitizeHistory(h) {
    if (!h || !Array.isArray(h)) return [];
    
    return h.filter(m => {
        if (!m || !m.role) return false;
        if (m.content === undefined || m.content === null) return false;
        return true;
    }).map(m => {
        // Ensure required fields
        return {
            role: m.role,
            content: m.content,
            ts: m.ts || Date.now(),
            tool_call_id: m.tool_call_id || null
        };
    });
}

// Get messages in AI API format
function getMessagesForAPI(conv) {
    const messages = conv?.messages || [];
    
    return messages
        .filter(m => m.role !== 'system') // System prompt handled separately
        .map(m => {
            // Convert to API format
            if (m.role === 'tool') {
                return {
                    role: 'user',
                    content: m.content
                };
            }
            return {
                role: m.role,
                content: m.content
            };
        });
}

// Checkpoint current state
function checkpoint(summary) {
    return {
        id: 'cp_' + Date.now(),
        summary,
        timestamp: Date.now()
    };
}

// Initialize module
function init(h) {
    HUB = h;
}

module.exports = {
    init,
    addUserMessage,
    addAssistantMessage,
    addToolResult,
    getMessages,
    replaceHistory,
    addRoadmapItem,
    sanitizeHistory,
    getMessagesForAPI,
    checkpoint
};
