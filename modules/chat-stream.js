// ==================== CHAT STREAM MODULE ====================
// Chat streaming with delta parsing for SSE events

const { safeJSONParse, _effectiveModel } = require('./ai-client');
const https = require('https');
const { URL } = require('url');

let hub = null;
let config = null;

// Last API context for debugging
let _lastApiContext = null;

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
                    const jsonStr = line.slice(6);
                    if (jsonStr === '[DONE]') continue;
                    
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
    
    // Build system prompt from tools
    const tools = hub.getService('tools');
    if (!tools) {
        throw new Error('Tools service not available');
    }
    const toolDefs = tools.getDefinitions();
    const messageBuilder = require('./message-builder');
    const systemPrompt = messageBuilder.buildSystemPrompt(tools);
    
    hub.log(`Sending request with ${toolDefs.length} tools defined`, 'info');
    
    // Merge config overrides
    const effectiveCfg = configOverrides ? { ...config, ...configOverrides } : config;
    
    // Build request payload
    const toolParser = require('./tool-parser');
    const toolsSection = toolParser.extractToolDefinitions(toolDefs);
    
    const requestPayload = {
        model: _effectiveModel(effectiveCfg),
        messages: messages,
        system: systemOverride || systemPrompt,
        max_tokens: effectiveCfg.maxTokens,
        temperature: effectiveCfg.temperature,
        stream: true,
        tools: toolDefs,
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
            break;
            
        case 'content_block_start':
            delta.contentBlock = event.content_block;
            break;
            
        case 'content_block_delta':
            delta.delta = event.delta;
            // Parse specific delta types
            if (event.delta && event.delta.type === 'text_delta') {
                delta.text = event.delta.text;
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
