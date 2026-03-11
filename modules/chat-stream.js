// ==================== CHAT STREAM MODULE ====================
// Chat streaming with delta parsing for SSE events

const { safeJSONParse, _effectiveModel, _safeTemperature, _cacheableSystem, _cacheableTools } = require('./ai-client');
const https = require('https');
const { URL } = require('url');

let hub = null;
let config = null;

// Last API context for debugging
let _lastApiContext = null;

// Cumulative session token/cache stats
let _sessionStats = {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheHits: 0,
    cacheMisses: 0
};

// Convert stored message format to Anthropic API format.
// Handles:
//   role:'tool' → role:'user' with tool_result content block (grouped)
//   role:'assistant' with tool_calls array → content blocks with tool_use
//   role:'assistant' with content blocks → passed through as-is
function toAnthropicMessages(messages) {
    const out = [];
    for (const msg of messages) {
        if (!msg || !msg.role) continue;

        // ── Synthetic tool IDs (from text-fallback parser) ─────────────
        // MiniMax rejects tool_result blocks whose IDs it didn't generate.
        // Convert synthetic pairs to plain user text so the API accepts them.
        const _isSynthId = (id) => id && id.startsWith('toolu_txt_');

        if (msg.role === 'tool') {
            const toolId = msg.tool_call_id || msg.tool_use_id || 'unknown';

            if (_isSynthId(toolId)) {
                // Inject as plain-text user message instead of tool_result
                const resultText = '[Tool Result]\n' +
                    (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
                const last = out[out.length - 1];
                if (last && last.role === 'user' && typeof last.content === 'string') {
                    last.content += '\n\n' + resultText;
                } else if (last && last.role === 'user' && Array.isArray(last.content)) {
                    last.content.push({ type: 'text', text: resultText });
                } else {
                    out.push({ role: 'user', content: resultText });
                }
                continue;
            }

            // Normal (native) tool results
            const toolBlock = {
                type: 'tool_result',
                tool_use_id: toolId,
                content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
            };
            const last = out[out.length - 1];
            if (last && last.role === 'user' && Array.isArray(last.content) &&
                last.content.length > 0 && last.content[0].type === 'tool_result') {
                last.content.push(toolBlock);
            } else {
                out.push({ role: 'user', content: [toolBlock] });
            }
            continue;
        }

        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            // Convert OpenAI-style tool_calls to Anthropic content blocks
            const blocks = [];
            const seenToolIds = new Set();
            if (msg.content && typeof msg.content === 'string' && msg.content.trim()) {
                blocks.push({ type: 'text', text: msg.content });
            } else if (Array.isArray(msg.content)) {
                // Push content blocks, tracking any tool_use IDs already present
                for (const b of msg.content) {
                    blocks.push(b);
                    if (b.type === 'tool_use' && b.id) seenToolIds.add(b.id);
                }
            }
            // Add tool_use blocks from tool_calls, skipping any already in content
            for (const tc of msg.tool_calls) {
                const id = tc.id;
                if (seenToolIds.has(id)) continue; // avoid duplicate tool_use IDs
                seenToolIds.add(id);
                blocks.push({
                    type: 'tool_use',
                    id,
                    name: tc.name || tc.function?.name,
                    input: tc.input || (typeof tc.function?.arguments === 'string'
                        ? (() => { try { return JSON.parse(tc.function.arguments); } catch(_) { return {}; } })()
                        : tc.function?.arguments || {})
                });
            }
            out.push({ role: 'assistant', content: blocks });
            continue;
        }

        // Default: pass through, ensure content is valid
        // Strip synthetic tool_use blocks from assistant content arrays
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
            const cleaned = msg.content.filter(b =>
                !(b.type === 'tool_use' && _isSynthId(b.id))
            );
            // Ensure we don't send an empty content array
            if (cleaned.length === 0) {
                cleaned.push({ type: 'text', text: '(tool executed)' });
            }
            out.push({ role: msg.role, content: cleaned });
            continue;
        }

        if (msg.content !== undefined && msg.content !== null) {
            out.push({ role: msg.role, content: msg.content });
        }
    }

    // ── Post-processing: repair broken history ──────────────────────────
    // 1. Merge consecutive same-role messages (prevents alternation errors)
    // 2. Ensure every tool_result has a matching tool_use in the preceding assistant
    return _sanitizeAlternation(out);
}

/**
 * Repair message alternation and orphaned tool_results.
 * The Anthropic API requires strict user/assistant alternation and every
 * tool_result must follow a tool_use in the immediately preceding assistant msg.
 */
function _sanitizeAlternation(messages) {
    if (messages.length === 0) return messages;

    // Pass 1: merge consecutive same-role messages
    const merged = [messages[0]];
    for (let i = 1; i < messages.length; i++) {
        const prev = merged[merged.length - 1];
        const cur = messages[i];
        if (prev.role === cur.role) {
            // Merge into prev
            prev.content = _mergeContent(prev.content, cur.content);
        } else {
            merged.push(cur);
        }
    }

    // Pass 2: ensure tool_results have matching tool_use in preceding assistant
    for (let i = 1; i < merged.length; i++) {
        const msg = merged[i];
        if (msg.role !== 'user' || !Array.isArray(msg.content)) continue;

        const toolResults = msg.content.filter(b => b.type === 'tool_result');
        if (toolResults.length === 0) continue;

        // Collect tool_use IDs from the preceding assistant message
        const prev = merged[i - 1];
        const assistantToolIds = new Set();
        if (prev && prev.role === 'assistant' && Array.isArray(prev.content)) {
            for (const b of prev.content) {
                if (b.type === 'tool_use' && b.id) assistantToolIds.add(b.id);
            }
        }

        // Convert orphaned tool_results to plain text
        msg.content = msg.content.map(b => {
            if (b.type === 'tool_result' && !assistantToolIds.has(b.tool_use_id)) {
                return { type: 'text', text: `[Previous tool result: ${b.content || '(empty)'}]` };
            }
            return b;
        });
    }

    return merged;
}

/** Merge two content values (string or array) into one */
function _mergeContent(a, b) {
    const aBlocks = typeof a === 'string' ? [{ type: 'text', text: a }] : (Array.isArray(a) ? a : []);
    const bBlocks = typeof b === 'string' ? [{ type: 'text', text: b }] : (Array.isArray(b) ? b : []);
    return [...aBlocks, ...bBlocks];
}

// Chat stream with delta parsing
async function chatStream(messages, onEvent, onDone, onError, systemOverride, configOverrides) {
    const baseUrl = config.baseUrl.replace(/\/$/, '');
    const url = new URL(`${baseUrl}/v1/messages`);
    
    const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey,
            'Authorization': `Bearer ${config.apiKey}`,
            'anthropic-version': '2023-06-01'
        }
    };
    
    const req = https.request(options, (res) => {
        if (res.statusCode === 429) {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                setTimeout(() => onError(new Error('RATE_LIMITED')), 2000);
            });
            return;
        }
        
        if (res.statusCode !== 200) {
            let errBody = '';
            res.on('data', c => errBody += c);
            res.on('end', () => onError(new Error(`API Error ${res.statusCode}: ${errBody}`)));
            return;
        }
        
        let buffer = '';
        res.on('data', (chunk) => {
            buffer += chunk.toString();
            let lineEnd;
            while ((lineEnd = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, lineEnd).trim();
                buffer = buffer.slice(lineEnd + 1);
                
                if (line.startsWith('data: ')) {
                    let jsonStr = line.slice(6);
                    if (jsonStr === '[DONE]') continue;

                    // Repair corrupted Unicode from MiniMax before parsing
                    try {
                        const guardrail = require('./guardrail-module');
                        if (guardrail && guardrail.repairUnicode) {
                            jsonStr = guardrail.repairUnicode(jsonStr);
                        }
                    } catch (_) {}

                    const parsed = safeJSONParse(jsonStr);
                    if (parsed.success) {
                        // Debug: log non-text events so we can see MiniMax's tool_use format
                        const t = parsed.data?.type;
                        if (t && t !== 'content_block_delta') {
                            const extra = t === 'content_block_start'
                                ? ` block_type=${parsed.data.content_block?.type || '?'} name=${parsed.data.content_block?.name || ''}`
                                : t === 'message_delta'
                                    ? ` stop=${parsed.data.delta?.stop_reason || ''} has_tool_calls=${!!(parsed.data.delta?.tool_calls)}`
                                    : '';
                            hub?.log(`[SSE] ${t}${extra}`, 'info');
                        }
                        onEvent(parsed.data);
                    }
                }
            }
        });
        
        res.on('end', () => { onDone(); });
    });
    
    req.on('error', onError);
    
    // Configurable timeout
    const _timeoutMs = config.requestTimeoutMs || 300000;
    req.setTimeout(_timeoutMs, () => {
        req.destroy(new Error(`API request timed out after ${_timeoutMs / 1000}s`));
    });
    
    // Build system prompt from tools (unless already provided via systemOverride)
    const tools = hub.getService('tools');
    if (!tools && !systemOverride) {
        throw new Error('Tools service not available');
    }
    const rawToolDefs = tools ? tools.getDefinitions() : [];
    // Strip internal fields (e.g. category) that the API doesn't accept
    const toolDefs = rawToolDefs.map(({ category, ...rest }) => rest);
    const messageBuilder = require('./message-builder');
    const systemPrompt = systemOverride || messageBuilder.buildSystemPrompt(tools);

    hub.log(`Sending request with ${toolDefs.length} tools defined`, 'info');

    // Merge config overrides
    const effectiveCfg = configOverrides ? { ...config, ...configOverrides } : config;

    // Build request payload
    const toolParser = require('./tool-parser');
    const toolsSection = toolParser.extractToolDefinitions(toolDefs);

    const cachedTools = _cacheableTools(toolDefs);
    const requestPayload = {
        model: _effectiveModel(effectiveCfg),
        messages: toAnthropicMessages(messages),
        system: _cacheableSystem(systemOverride || systemPrompt),
        max_tokens: effectiveCfg.maxTokens,
        temperature: _safeTemperature(effectiveCfg.temperature),
        stream: true,
        ...(cachedTools.length > 0 ? { tools: cachedTools } : {}),
        ...(effectiveCfg.thinkingEnabled ? {
            thinking: {
                type: 'enabled',
                budget_tokens: Math.min(effectiveCfg.thinkingBudget || 2048, effectiveCfg.maxTokens - 1)
            }
        } : {})
    };
    
    // Store context for debugging
    _lastApiContext = {
        ts: Date.now(),
        model: requestPayload.model,
        system: typeof requestPayload.system === 'string' ? requestPayload.system : JSON.stringify(requestPayload.system),
        systemLength: (typeof requestPayload.system === 'string' ? requestPayload.system : JSON.stringify(requestPayload.system)).length,
        messagesCount: messages.length,
        toolsCount: toolDefs.length,
        toolNames: toolDefs.map(t => t.name)
    };
    
    req.write(JSON.stringify(requestPayload));
    req.end();
    
    return req;
}

// Parse streaming events into structured deltas
function parseDelta(event) {
    if (!event || !event.type) {
        return null;
    }
    
    const delta = {
        type: event.type,
        timestamp: Date.now()
    };
    
    switch (event.type) {
        case 'message_start':
            delta.message = event.message;
            // Accumulate and broadcast usage metrics
            if (event.message?.usage && hub) {
                const u = event.message.usage;
                const cacheRead = u.cache_read_input_tokens || 0;
                const cacheWrite = u.cache_creation_input_tokens || 0;
                const uncached = u.input_tokens || 0;

                _sessionStats.requests++;
                _sessionStats.inputTokens += uncached + cacheRead;
                _sessionStats.cacheReadTokens += cacheRead;
                _sessionStats.cacheWriteTokens += cacheWrite;
                if (cacheRead > 0) _sessionStats.cacheHits++;
                else _sessionStats.cacheMisses++;

                const savings = _sessionStats.inputTokens > 0
                    ? Math.round((_sessionStats.cacheReadTokens / _sessionStats.inputTokens) * 100)
                    : 0;

                if (cacheRead || cacheWrite) {
                    hub.log(`[Cache] ✅ read=${cacheRead.toLocaleString()} write=${cacheWrite.toLocaleString()} uncached=${uncached.toLocaleString()} | session savings: ${savings}%`, 'info');
                } else {
                    hub.log(`[Tokens] in=${uncached.toLocaleString()} | cache miss (${_sessionStats.cacheMisses} total)`, 'info');
                }

                // Broadcast live usage stats to UI
                hub.broadcast('usage_stats', {
                    request: { cacheRead, cacheWrite, uncachedInput: uncached },
                    session: { ..._sessionStats, cacheSavingsPct: savings }
                });
            }
            break;
            
        case 'content_block_start':
            delta.contentBlock = event.content_block;
            if (event.content_block && event.content_block.type === 'thinking') {
                delta.isThinkingBlock = true;
            }
            break;

        case 'content_block_delta':
            delta.delta = event.delta;
            // Parse specific delta types
            if (event.delta && event.delta.type === 'text_delta') {
                delta.text = event.delta.text;
            } else if (event.delta && event.delta.type === 'thinking_delta') {
                delta.thinking = event.delta.thinking;
                // Broadcast thinking to UI via hub
                if (hub && hub.neural && event.delta.thinking) {
                    hub.neural(event.delta.thinking);
                }
            } else if (event.delta && event.delta.type === 'input_json_delta') {
                delta.json = event.delta.partial_json;
            }
            break;
            
        case 'content_block_stop':
            break;
            
        case 'message_delta':
            delta.delta = event.delta;
            delta.usage = event.usage;
            // Capture output tokens
            if (event.usage?.output_tokens && hub) {
                _sessionStats.outputTokens += event.usage.output_tokens;
                hub.broadcast('usage_stats', {
                    session: { ..._sessionStats }
                });
            }
            break;
            
        case 'message_stop':
            break;
            
        case 'error':
            delta.error = event.error;
            break;
            
        default:
            // Unknown event type
            break;
    }
    
    return delta;
}

// Format duration for display
function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`;
}

// Get last API context
function getLastApiContext() {
    return _lastApiContext;
}

// Get cumulative session stats
function getSessionStats() {
    return { ..._sessionStats };
}

// Reset session stats (call on new conversation)
function resetSessionStats() {
    _sessionStats = {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cacheHits: 0,
        cacheMisses: 0
    };
}

// Initialize module
function init(h, cfg) {
    hub = h;
    config = cfg;
}

module.exports = {
    init,
    chatStream,
    parseDelta,
    formatDuration,
    getLastApiContext,
    getSessionStats,
    resetSessionStats
};
