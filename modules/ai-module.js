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

// ── Text-based tool call fallback ─────────────────────────────────────────
// MiniMax M2.5 sometimes emits tool calls as text instead of native tool_use
// blocks. These helpers detect and convert them so the tool loop can fire.

const _DIRECT_TOOLS = new Set([
    'bash', 'read_file', 'read_file_lines', 'write_file', 'patch_file', 'append_file',
    'list_dir', 'web_search', 'understand_image', 'fetch_webpage', 'save_webpage_to_vault',
    'system_info', 'get_working_dir', 'set_working_dir', 'set_thinking_level',
    'qa_run_tests', 'qa_check_lint', 'qa_check_types', 'qa_check_coverage', 'qa_audit_deps',
    'github', 'record_note', 'recall_notes', 'session_note', 'list_skills', 'get_skill',
    'activate_skill', 'deactivate_skill', 'ui_action', 'show_chart', 'ask_user',
    'kv_set', 'kv_get', 'kv_list', 'kv_delete', 'socket_push', 'add_todo', 'toggle_todo',
    'list_agents', 'delegate_to_agent'
]);

const _ACTION_MAP = {
    'list-directory': 'list_dir', 'list_directory': 'list_dir',
    'explore-directory': 'list_dir', 'ls': 'list_dir',
    'read-file': 'read_file', 'cat': 'read_file', 'view-file': 'read_file',
    'write-file': 'write_file', 'create-file': 'write_file',
    'bash': 'bash', 'run-command': 'bash', 'execute': 'bash', 'shell': 'bash',
    'search': 'web_search', 'web-search': 'web_search',
    'list-agents': 'list_agents',
};

function _buildTextToolCall(rawName, args) {
    const id = 'toolu_txt_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
    const actionKey = (args.action || rawName || '').replace(/_/g, '-').toLowerCase();
    const mappedTool = _ACTION_MAP[actionKey] || _ACTION_MAP[rawName.toLowerCase()] || rawName;

    if (_DIRECT_TOOLS.has(mappedTool)) {
        const input = {};
        if (args.path !== undefined)    input.path    = args.path;
        if (args.content !== undefined) input.content = args.content;
        if (args.command !== undefined) input.command = args.command;
        if (args.query !== undefined)   input.query   = args.query;
        if (args.agent !== undefined)   input.agent   = args.agent;
        if (args.task !== undefined)    input.task    = args.task;
        if (mappedTool === 'bash' && !input.command)
            input.command = [args.action, args.path].filter(Boolean).join(' ');
        return { type: 'tool_use', id, name: mappedTool, input };
    }

    // Unknown name — wrap as agent delegation
    const taskParts = [];
    if (args.action) taskParts.push(args.action.replace(/-/g, ' '));
    if (args.path)   taskParts.push(args.path);
    if (args.task)   taskParts.push(args.task);
    const task = taskParts.join(' ') || `perform: ${rawName} ${JSON.stringify(args)}`;
    return { type: 'tool_use', id, name: 'delegate_to_agent', input: { agent: rawName, task } };
}

function _parseBraceCall(inner) {
    const nameMatch = inner.match(/\btool\s*(?:=>|:)\s*["']([^"']+)["']/i)
                   || inner.match(/^["']?([\w-]+)["']?/);
    if (!nameMatch) return null;
    const rawName = nameMatch[1].trim();

    const args = {};
    const argsMatch = inner.match(/\bargs\s*(?:=>|:)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/i);
    if (argsMatch) {
        const flagRe = /--?([\w-]+)\s+["']([^"']*)["']|--?([\w-]+)\s+([^\s,}]+)/g;
        let m;
        while ((m = flagRe.exec(argsMatch[1])) !== null) {
            const k = (m[1] || m[3] || '').replace(/-/g, '_');
            const v = m[2] !== undefined ? m[2] : (m[4] || '');
            if (k) args[k] = v;
        }
    }
    return _buildTextToolCall(rawName, args);
}

function _parseTextToolCalls(text) {
    if (!text) return { calls: [], cleanText: text };
    const calls = [];
    let cleanText = text;

    // Format 1: [TOOL_CALL] ... [/TOOL_CALL]
    cleanText = cleanText.replace(/\[TOOL_CALL\]([\s\S]*?)\[\/TOOL_CALL\]/gi, (_, inner) => {
        const tc = _parseBraceCall(inner.trim());
        if (tc) calls.push(tc);
        return '';
    });

    // Format 2: minimax:tool_call name args (only if nothing found above)
    if (calls.length === 0) {
        cleanText = cleanText.replace(/\bminimax:tool_call\s+([\w:/-]+)(?:\s+([^\n]*))?/gi, (_, name, args) => {
            const tc = _buildTextToolCall(name.trim(), args ? { path: args.trim() } : {});
            if (tc) calls.push(tc);
            return '';
        });
    }

    return { calls, cleanText: cleanText.replace(/\n{3,}/g, '\n\n').trim() };
}

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
                        // Some MiniMax variants send tool_calls inside message_delta
                        if (delta.delta?.tool_calls && Array.isArray(delta.delta.tool_calls)) {
                            for (const tc of delta.delta.tool_calls) {
                                const name = tc.function?.name || tc.name;
                                let input = {};
                                try { input = JSON.parse(tc.function?.arguments || '{}'); } catch (_) {}
                                toolUseBlocks.push({
                                    type: 'tool_use',
                                    id: tc.id || ('toolu_md_' + Date.now().toString(36)),
                                    name,
                                    input
                                });
                            }
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

                // Fallback: if MiniMax emitted text-based tool calls instead of native
                // tool_use blocks, parse them now and treat them as real tool calls.
                if (toolUseBlocks.length === 0 && textContent) {
                    const parsed = _parseTextToolCalls(textContent);
                    if (parsed.calls.length > 0) {
                        hub?.log(`[AI] Text tool-call fallback: parsed ${parsed.calls.length} call(s) from response text`, 'warn');
                        toolUseBlocks.push(...parsed.calls);
                        // Strip the [TOOL_CALL] noise from the displayed text
                        textContent = parsed.cleanText;
                        // Rebuild content blocks: keep thinking, replace text, add tool_use entries
                        contentBlocks = contentBlocks.filter(b => b.type === 'thinking');
                        if (textContent) contentBlocks.push({ type: 'text', text: textContent });
                        for (const tc of toolUseBlocks) contentBlocks.push({ ...tc });
                        // Stream the cleaned text to UI
                        hub?.streamUpdate(textContent);
                    }
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
