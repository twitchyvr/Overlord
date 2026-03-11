// ==================== AI CLIENT MODULE ====================
// HTTP client for MiniMax API communication

const https = require('https');
const { URL } = require('url');

let hub = null;
let config = null;

// Last API context for debugging
let _lastApiContext = null;

// Unicode sanitization helpers
let guardrail = null;

function initGuardrail() {
    try {
        guardrail = require('./guardrail-module');
    } catch (e) {
        guardrail = null;
    }
}

// Sanitize strings for JSON parsing
function sanitizeForJSON(str) {
    if (typeof str !== 'string') return str;
    
    if (guardrail && guardrail.sanitizeForOutput) {
        str = guardrail.sanitizeForOutput(str);
    }
    
    return str
        .replace(/[\uD800-\uDFFF]/g, (match) => {
            return match.charCodeAt(0).toString(16);
        })
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, (match) => {
            return '\\u' + match.charCodeAt(0).toString(16).padStart(4, '0');
        });
}

// Safe JSON parse with Unicode handling
function safeJSONParse(str) {
    if (typeof str !== 'string') {
        return { success: false, error: 'Input is not a string' };
    }
    
    try {
        return { success: true, data: JSON.parse(str) };
    } catch (e) {
        const sanitized = sanitizeForJSON(str);
        try {
            return { success: true, data: JSON.parse(sanitized) };
        } catch (e2) {
            return { success: false, error: e2.message };
        }
    }
}

// Get effective model based on mode
function _effectiveModel(cfg) {
    if (cfg && cfg.autoModelSwitch && cfg.chatMode === 'pm' && cfg.pmModel) {
        return cfg.pmModel;
    }
    return (cfg && cfg.model) || 'MiniMax-M2.5-highspeed';
}

// Clamp temperature to MiniMax's required range (0.0, 1.0]
function _safeTemperature(t) {
    const v = parseFloat(t) || 0.7;
    if (v <= 0) return 0.01;
    if (v > 1) return 1.0;
    return v;
}

// Convert system prompt string to cacheable array format
// Per MiniMax docs: cache_control on system block caches all tools + system content
function _cacheableSystem(systemPrompt) {
    if (!systemPrompt) return undefined;
    return [
        { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }
    ];
}

// Add cache_control to the last tool definition (caches all tools as a prefix)
function _cacheableTools(toolDefs) {
    if (!toolDefs || toolDefs.length === 0) return [];
    const cached = toolDefs.map((t, i) => {
        if (i === toolDefs.length - 1) {
            return { ...t, cache_control: { type: 'ephemeral' } };
        }
        return t;
    });
    return cached;
}

// Make a non-streaming request
function _makeRequest(messages, systemPrompt) {
    return new Promise((resolve, reject) => {
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
        
        const tools = hub?.getService('tools');
        const rawToolDefs = tools?.getDefinitions?.() || [];
        // Strip internal fields (e.g. category) that the API doesn't accept
        const toolDefs = rawToolDefs.map(({ category, ...rest }) => rest);

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    // Repair corrupted Unicode from MiniMax before parsing
                    let safeBody = body;
                    if (guardrail && guardrail.repairUnicode) {
                        safeBody = guardrail.repairUnicode(body);
                    }
                    const parsed = safeJSONParse(safeBody);
                    if (parsed.success) {
                        // Log cache metrics if present
                        const u = parsed.data?.usage;
                        if (u && hub && (u.cache_read_input_tokens || u.cache_creation_input_tokens)) {
                            hub.log(`[Cache] read=${u.cache_read_input_tokens || 0}, write=${u.cache_creation_input_tokens || 0}, uncached=${u.input_tokens || 0}`, 'info');
                        }
                        resolve(parsed.data);
                    } else {
                        reject(new Error('Failed to parse response: ' + parsed.error));
                    }
                } else {
                    reject(new Error(`API Error ${res.statusCode}: ${body}`));
                }
            });
        });
        
        req.on('error', reject);
        
        const cachedTools = _cacheableTools(toolDefs);
        const payload = {
            model: _effectiveModel(config),
            messages,
            system: _cacheableSystem(systemPrompt),
            max_tokens: config.maxTokens,
            temperature: _safeTemperature(config.temperature),
            stream: false,
            ...(cachedTools.length > 0 ? { tools: cachedTools } : {}),
            ...(config.thinkingEnabled ? {
                thinking: {
                    type: 'enabled',
                    budget_tokens: Math.min(config.thinkingBudget || 4096, config.maxTokens - 1)
                }
            } : {})
        };

        // Debug: log payload summary
        if (hub) {
            hub.log(`[AI] _makeRequest: model=${payload.model}, msgs=${messages.length}, system=${Array.isArray(payload.system) ? payload.system[0].text.length : 0} chars, tools=${cachedTools.length}, cache=on`, 'info');
            if (messages.length > 0) {
                hub.log(`[AI] First msg: role=${messages[0].role}, content=${JSON.stringify(messages[0].content).substring(0, 120)}`, 'info');
            } else {
                hub.log('[AI] WARNING: messages array is EMPTY!', 'error');
            }
        }

        req.write(JSON.stringify(payload));
        req.end();
    });
}

// Make a streaming request (internal)
async function _streamRequest(messages, systemPrompt, onEvent) {
    const baseUrl = config.baseUrl.replace(/\/$/, '');
    const url = new URL(`${baseUrl}/v1/messages`);
    
    return new Promise((resolve, reject) => {
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
                    reject(new Error('RATE_LIMITED'));
                });
                return;
            }
            
            if (res.statusCode !== 200) {
                let errBody = '';
                res.on('data', c => errBody += c);
                res.on('end', () => reject(new Error(`API Error ${res.statusCode}: ${errBody}`)));
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
            
            res.on('end', () => resolve());
        });
        
        req.on('error', reject);
        
        const tools = hub?.getService('tools');
        const rawToolDefs = tools?.getDefinitions?.() || [];
        const toolDefs = rawToolDefs.map(({ category, ...rest }) => rest);
        const cachedTools = _cacheableTools(toolDefs);

        const payload = {
            model: _effectiveModel(config),
            messages,
            system: _cacheableSystem(systemPrompt),
            max_tokens: config.maxTokens,
            temperature: _safeTemperature(config.temperature),
            stream: true,
            ...(cachedTools.length > 0 ? { tools: cachedTools } : {}),
            ...(config.thinkingEnabled ? {
                thinking: {
                    type: 'enabled',
                    budget_tokens: Math.min(config.thinkingBudget || 2048, config.maxTokens - 1)
                }
            } : {})
        };
        
        req.write(JSON.stringify(payload));
        req.end();
    });
}

// Get last API context
function getLastApiContext() {
    return _lastApiContext;
}

// Initialize module
function init(h, cfg) {
    hub = h;
    config = cfg;
    initGuardrail();
}

module.exports = {
    init,
    sanitizeForJSON,
    safeJSONParse,
    _effectiveModel,
    _safeTemperature,
    _cacheableSystem,
    _cacheableTools,
    _makeRequest,
    _streamRequest,
    getLastApiContext
};
