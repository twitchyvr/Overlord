// ==================== CHAT STREAM MODULE ====================
// Chat streaming with delta parsing for SSE events

const { safeJSONParse, _effectiveModel, _safeTemperature, _cacheableSystem, _cacheableTools } = require('./ai-client');
const https = require('https');
const { URL } = require('url');

let hub = null;
let config = null;

// Last API context for debugging
let _lastApiContext = null;

// Convert stored message format to Anthropic API format.
// Handles:
//   role:'tool' → role:'user' with tool_result content block (grouped)
//   role:'assistant' with tool_calls array → content blocks with tool_use
//   role:'assistant' with content blocks → passed through as-is
function toAnthropicMessages(messages) {
    const out = [];
    for (const msg of messages) {
        if (!msg || !msg.role) continue;

        if (msg.role === 'tool') {
            // Merge consecutive tool results into one user message
            const toolBlock = {
                type: 'tool_result',
                tool_use_id: msg.tool_call_id || msg.tool_use_id || 'unknown',
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
            if (msg.content && typeof msg.content === 'string' && msg.content.trim()) {
                blocks.push({ type: 'text', text: msg.content });
            } else if (Array.isArray(msg.content)) {
                blocks.push(...msg.content);
            }
            for (const tc of msg.tool_calls) {
                blocks.push({
                    type: 'tool_use',
                    id: tc.id,
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
        if (msg.content !== undefined && msg.content !== null) {
            out.push({ role: msg.role, content: msg.content });
        }
    }
    return out;
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
            // Log cache metrics from usage if present
            if (event.message?.usage && hub) {
                const u = event.message.usage;
                if (u.cache_read_input_tokens || u.cache_creation_input_tokens) {
                    hub.log(`[Cache] read=${u.cache_read_input_tokens || 0}, write=${u.cache_creation_input_tokens || 0}, uncached=${u.input_tokens || 0}`, 'info');
                }
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
    getLastApiContext
};
