// ==================== AI MODULE (BACKWARD COMPATIBILITY) ====================
// This file re-exports all AI modules for backward compatibility.
// New code should import directly from specific modules:
//
// - ai-client.js: HTTP client, request/response handling
// - chat-stream.js: Chat streaming with delta parsing
// - message-builder.js: Message building functions
// - tool-parser.js: Tool definition extraction and parsing

// Import all modules
const aiClient = require('./ai-client');
const chatStream = require('./chat-stream');
const messageBuilder = require('./message-builder');
const toolParser = require('./tool-parser');

// Re-export for backward compatibility
module.exports = {
    // Init - replaces the original init function
    init: function(h) {
        const config = h.getService('config');
        
        // Initialize all sub-modules
        aiClient.init(h, config);
        chatStream.init(h, config);
        messageBuilder.init(h, config);
        toolParser.init(h, config);
        
        // Create and store AIClient instance
        const AIClient = require('./ai-client');
        const client = new AIClientClass(config);
        aiClient._setAIClient(client);
        
        h.registerService('ai', {
            sendMessage: client.sendMessage.bind(client),
            sendMessageStream: client.sendMessageStream.bind(client),
            abort: client.abort.bind(client),
            getContext: client.getContext.bind(client),
            getStats: client.getStats.bind(client)
        });
        
        h.log('✅ AI module initialized', 'info');
    },
    
    // Re-export sub-modules
    aiClient,
    chatStream,
    messageBuilder,
    toolParser,
    
    // Helper functions
    sanitizeForJSON: aiClient.sanitizeForJSON,
    safeJSONParse: aiClient.safeJSONParse,
    _effectiveModel: aiClient._effectiveModel,
    
    // For backward compatibility
    getAI: function() {
        return aiClient.getAI();
    }
};

// AIClient class (reconstructed from original)
class AIClientClass {
    constructor(cfg) {
        this.config = cfg;
        this.activeReq = null;
        this.stats = {
            totalRequests: 0,
            totalTokens: 0,
            totalDuration: 0
        };
    }

    abort() {
        if (this.activeReq) {
            this.activeReq.destroy();
            this.activeReq = null;
            return true;
        }
        return false;
    }

    getContext() {
        const tokenMgr = hub?.getService('tokenManager');
        const conv = hub?.getService('conversation');
        
        if (!conv || !tokenMgr) return null;
        
        const ctx = tokenMgr.getContextUsage ? tokenMgr.getContextUsage() : {};
        const messages = conv.getMessages ? conv.getMessages() : [];
        
        return {
            timestamp: new Date().toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            workingDirectory: conv.getWorkingDirectory ? conv.getWorkingDirectory() : process.cwd(),
            chatLength: {
                messageCount: messages.length,
                durationFormatted: chatStream.formatDuration(Date.now() - (messages[0]?.ts || Date.now()))
            },
            lastRequestDurationFormatted: this.stats.totalRequests > 0 
                ? chatStream.formatDuration(this.stats.totalDuration / this.stats.totalRequests)
                : 'N/A',
            contextUsage: ctx,
            compaction: {
                count: tokenMgr.getCompactionCount ? tokenMgr.getCompactionCount() : 0,
                timeSinceLastCompactionFormatted: 'N/A'
            },
            model: {
                name: this.config.model,
                description: 'MiniMax Model',
                maxTokens: this.config.maxTokens,
                thinkingBudget: this.config.thinkingBudget || 0
            },
            tools: (hub?.getService('tools')?.getDefinitions?.() || []).length
        };
    }

    getStats() {
        return { ...this.stats };
    }

    async sendMessage(messages, configOverrides) {
        // Quick complete mode - non-streaming
        const messageBuilder = require('./message-builder');
        const aiClient = require('./ai-client');
        
        const systemPrompt = messageBuilder.buildSystemPrompt(hub.getService('tools'));
        
        try {
            const response = await aiClient._makeRequest(messages, systemPrompt);
            return response;
        } catch (e) {
            if (e.message.includes('RATE_LIMITED')) {
                throw new Error('Rate limited - please wait and try again');
            }
            throw e;
        }
    }

    async sendMessageStream(messages, onEvent, onDone, onError, systemOverride, configOverrides) {
        this.stats.totalRequests++;
        const startTime = Date.now();
        
        try {
            const stream = chatStream.chatStream(
                messages,
                onEvent,
                () => {
                    this.stats.totalDuration += Date.now() - startTime;
                    if (onDone) onDone();
                },
                (err) => {
                    this.stats.totalDuration += Date.now() - startTime;
                    if (onError) onError(err);
                },
                systemOverride,
                configOverrides
            );
            
            this.activeReq = stream;
            return stream;
        } catch (e) {
            if (onError) onError(e);
            throw e;
        }
    }
}

// Store hub reference
let hub = null;

// Override init to store hub
const originalInit = module.exports.init;
module.exports.init = function(h) {
    hub = h;
    return originalInit(h);
};

// getAI helper for backward compatibility
aiClient._setAIClient = function(client) {
    aiClient._aiClientInstance = client;
};

aiClient.getAI = function() {
    return aiClient._aiClientInstance;
};
