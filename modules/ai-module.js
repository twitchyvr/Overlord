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
            sendMessageStreamed: client.sendMessageStreamed.bind(client),
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

        // Auto-fetch messages from conversation service if not provided
        if (!messages) {
            const conv = hub?.getService('conversation');
            const raw = conv?.getMessages ? conv.getMessages() : [];
            hub?.log(`[AI sendMessage] Auto-fetched ${raw.length} messages from conversation`, 'info');
            if (raw.length > 0) {
                hub?.log(`[AI sendMessage] Last msg: role=${raw[raw.length-1].role}, content=${JSON.stringify(raw[raw.length-1].content).substring(0, 100)}`, 'info');
            }
            messages = raw;
        }

        // Sanitize messages for MiniMax API — strip internal fields (ts, null tool_call_id, etc.)
        messages = (messages || []).filter(m => m && m.role && m.content).map(m => {
            const clean = { role: m.role, content: m.content };
            if (m.tool_call_id) clean.tool_call_id = m.tool_call_id;
            if (m.tool_calls && m.tool_calls.length) clean.tool_calls = m.tool_calls;
            return clean;
        });

        if (messages.length === 0) {
            throw new Error('No messages to send');
        }

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

    /**
     * Streaming replacement for sendMessage — uses SSE internally but returns
     * the same assembled response object. Broadcasts text deltas to the UI
     * via hub.streamUpdate() and thinking via hub.neural() in real-time.
     */
    async sendMessageStreamed(messages, configOverrides) {
        const messageBuilder = require('./message-builder');
        const chatStreamMod = require('./chat-stream');

        // Auto-fetch messages from conversation service if not provided
        if (!messages) {
            const conv = hub?.getService('conversation');
            const raw = conv?.getMessages ? conv.getMessages() : [];
            hub?.log(`[AI streamed] Auto-fetched ${raw.length} messages`, 'info');
            messages = raw;
        }

        // Sanitize messages — preserve all roles including 'tool' (toAnthropicMessages in
        // chat-stream.js converts them to proper Anthropic tool_result format)
        messages = (messages || []).filter(m => m && m.role && (m.content !== undefined && m.content !== null)).map(m => {
            const clean = { role: m.role, content: m.content };
            if (m.tool_call_id) clean.tool_call_id = m.tool_call_id;
            if (m.tool_use_id) clean.tool_use_id = m.tool_use_id;
            if (m.tool_calls && m.tool_calls.length) clean.tool_calls = m.tool_calls;
            return clean;
        });

        if (messages.length === 0) {
            throw new Error('No messages to send');
        }

        this.stats.totalRequests++;
        const startTime = Date.now();
        const systemPrompt = messageBuilder.buildSystemPrompt(hub.getService('tools'));

        hub?.log(`[AI streamed] Starting SSE stream, model=${this.config.model}, msgs=${messages.length}`, 'info');

        return new Promise((resolve, reject) => {
            let textContent = '';
            let contentBlocks = [];
            let toolUseBlocks = [];
            let currentBlockType = null;
            let currentBlockText = '';
            let currentToolUse = null;
            let currentToolJson = '';
            let stopReason = 'end_turn';
            let responseUsage = {};

            const onEvent = (event) => {
                const delta = chatStreamMod.parseDelta(event);
                if (!delta) return;

                switch (delta.type) {
                    case 'content_block_start':
                        currentBlockText = '';
                        if (delta.contentBlock?.type === 'thinking') {
                            currentBlockType = 'thinking';
                        } else if (delta.contentBlock?.type === 'text') {
                            currentBlockType = 'text';
                        } else if (delta.contentBlock?.type === 'tool_use') {
                            currentBlockType = 'tool_use';
                            currentToolUse = {
                                type: 'tool_use',
                                id: delta.contentBlock.id,
                                name: delta.contentBlock.name,
                                input: {}
                            };
                            currentToolJson = '';
                        }
                        break;

                    case 'content_block_delta':
                        if (delta.text) {
                            currentBlockText += delta.text;
                            textContent += delta.text;
                            hub?.streamUpdate(textContent);
                        }
                        if (delta.thinking) {
                            currentBlockText += delta.thinking;
                            // hub.neural() already called in parseDelta
                        }
                        if (delta.json && currentToolUse) {
                            currentToolJson += delta.json;
                        }
                        break;

                    case 'content_block_stop':
                        if (currentBlockType === 'thinking' && currentBlockText) {
                            contentBlocks.push({ type: 'thinking', thinking: currentBlockText });
                        } else if (currentBlockType === 'text') {
                            contentBlocks.push({ type: 'text', text: currentBlockText });
                        } else if (currentBlockType === 'tool_use' && currentToolUse) {
                            try {
                                currentToolUse.input = JSON.parse(currentToolJson || '{}');
                            } catch (_) {
                                currentToolUse.input = {};
                            }
                            toolUseBlocks.push(currentToolUse);
                            contentBlocks.push({ ...currentToolUse });
                            currentToolUse = null;
                            currentToolJson = '';
                        }
                        currentBlockType = null;
                        currentBlockText = '';
                        break;

                    case 'message_delta':
                        if (delta.delta?.stop_reason) {
                            stopReason = delta.delta.stop_reason;
                        }
                        if (delta.usage) {
                            responseUsage = { ...responseUsage, ...delta.usage };
                        }
                        break;
                }
            };

            const onDone = () => {
                this.activeReq = null;
                this.stats.totalDuration += Date.now() - startTime;

                // Signal thinking done
                const thinkingBlocks = contentBlocks.filter(b => b.type === 'thinking');
                if (thinkingBlocks.length > 0) {
                    hub?.neuralDone({
                        chars: thinkingBlocks.reduce((n, b) => n + (b.thinking || '').length, 0)
                    });
                }

                // Build response matching non-streaming format
                const response = {
                    role: 'assistant',
                    content: contentBlocks.length > 0 ? contentBlocks : textContent,
                    stop_reason: stopReason,
                    usage: responseUsage
                };

                // Add tool_calls in the format tool-executor expects
                if (toolUseBlocks.length > 0) {
                    response.tool_calls = toolUseBlocks;
                }

                resolve(response);
            };

            const onStreamError = (err) => {
                this.activeReq = null;
                this.stats.totalDuration += Date.now() - startTime;
                reject(err);
            };

            // chatStream is async — must handle its Promise rejection
            const streamPromise = chatStreamMod.chatStream(
                messages, onEvent, onDone, onStreamError,
                systemPrompt, configOverrides
            );

            // chatStream returns a Promise<req> — handle both paths
            streamPromise.then(
                (req) => { this.activeReq = req; },
                (err) => {
                    hub?.log(`[AI streamed] chatStream failed: ${err.message}`, 'error');
                    this.activeReq = null;
                    this.stats.totalDuration += Date.now() - startTime;
                    reject(err);
                }
            );
        });
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
