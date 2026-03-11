// ==================== CONTEXT TRACKER MODULE ====================
// Context management and compaction

let HUB = null;

// Token estimation
function estimateTokens(text) {
    if (!text) return 0;
    // Rough estimate: 1 token ≈ 4 characters for English
    return Math.ceil(text.length / 4);
}

// Calculate context usage
function calculateContextUsage(messages, maxTokens = 100000) {
    let totalTokens = 0;
    const messagePreviews = [];
    
    for (const msg of messages) {
        let content = '';
        
        if (typeof msg.content === 'string') {
            content = msg.content;
        } else if (Array.isArray(msg.content)) {
            content = msg.content.map(b => {
                if (b.type === 'text') return b.text;
                if (b.type === 'tool_use') return `[tool: ${b.name}]`;
                if (b.type === 'tool_result') return `[tool result]`;
                return '';
            }).join(' ');
        }
        
        const tokens = estimateTokens(content);
        totalTokens += tokens;
        
        // Keep previews for recent messages
        if (messagePreviews.length < 10) {
            messagePreviews.push({
                role: msg.role,
                tokens,
                preview: content.substring(0, 100)
            });
        }
    }
    
    const usagePercent = Math.round((totalTokens / maxTokens) * 100);
    const rawUsagePercent = (totalTokens / maxTokens) * 100;
    
    let status = 'normal';
    if (usagePercent > 90) status = 'critical';
    else if (usagePercent > 75) status = 'warning';
    
    let contextWarning = null;
    if (usagePercent > 75) {
        contextWarning = `Context is ${usagePercent}% full - consider starting a new conversation`;
    }
    
    return {
        estimatedTokens: totalTokens,
        maxTokens,
        usagePercent,
        rawUsagePercent,
        status,
        contextWarning,
        recentMessages: messagePreviews
    };
}

// Broadcast context warning
function broadcastContextWarning(usage) {
    if (!HUB) return;
    
    HUB.broadcast('context_warning', {
        usagePercent: usage.usagePercent,
        estimatedTokens: usage.estimatedTokens,
        maxTokens: usage.maxTokens,
        message: usage.contextWarning
    });
}

// Truncate history to fit within token limit
function truncateHistory(messages, maxMessages = 100) {
    if (messages.length <= maxMessages) {
        return messages;
    }
    
    // Keep first message (system) and last N messages
    const systemMsg = messages.find(m => m.role === 'system');
    const otherMsgs = messages.filter(m => m.role !== 'system');
    
    const kept = otherMsgs.slice(-maxMessages);
    
    if (systemMsg) {
        return [systemMsg, ...kept];
    }
    
    return kept;
}

// Compaction state
let compactionCount = 0;
let lastCompactionTime = 0;

// Get compaction count
function getCompactionCount() {
    return compactionCount;
}

// Summarize and compact history
async function summarizeAndCompact(targetHistory, aiClient) {
    if (!aiClient || !aiClient.sendMessage) {
        return targetHistory;
    }
    
    const MAX_MESSAGES = 50;
    
    if (targetHistory.length <= MAX_MESSAGES) {
        return targetHistory;
    }
    
    // Keep system message and last MAX_MESSAGES
    const systemMsg = targetHistory.find(m => m.role === 'system');
    const recentMsgs = targetHistory.slice(-MAX_MESSAGES);
    
    // Get messages to summarize
    const toSummarize = targetHistory.slice(1, -MAX_MESSAGES);
    
    if (toSummarize.length < 5) {
        return targetHistory;
    }
    
    // Build summary prompt
    const summaryRequest = [
        { role: 'system', content: 'You are a summarization assistant. Create a brief summary of the conversation history below. Focus on key decisions, completed tasks, and important context.' },
        { role: 'user', content: `Summarize these ${toSummarize.length} messages into 2-3 paragraphs:\n\n${toSummarize.map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n')}` }
    ];
    
    try {
        const summaryResponse = await aiClient.sendMessage(summaryRequest);
        
        let summaryText = '';
        if (summaryResponse.content) {
            if (typeof summaryResponse.content === 'string') {
                summaryText = summaryResponse.content;
            } else if (Array.isArray(summaryResponse.content)) {
                summaryText = summaryResponse.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
            }
        }
        
        // Build compacted history
        const compacted = systemMsg 
            ? [systemMsg, { role: 'user', content: '[Previous conversation summary: ' + summaryText + ']' }, ...recentMsgs]
            : [{ role: 'user', content: '[Previous conversation summary: ' + summaryText + ']' }, ...recentMsgs];
        
        compactionCount++;
        lastCompactionTime = Date.now();
        
        HUB?.log(`[Context] Compacted ${toSummarize.length} messages into summary`, 'info');
        
        return compacted;
    } catch (err) {
        HUB?.log('[Context] Compaction failed: ' + err.message, 'warn');
        return targetHistory;
    }
}

// Get context usage for a conversation
function getContextUsage(conv) {
    const messages = conv?.messages || [];
    const maxTokens = 100000; // Default context window
    
    return calculateContextUsage(messages, maxTokens);
}

// Initialize module
function init(h) {
    HUB = h;
}

module.exports = {
    init,
    estimateTokens,
    calculateContextUsage,
    broadcastContextWarning,
    truncateHistory,
    getCompactionCount,
    summarizeAndCompact,
    getContextUsage
};
