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
        const toolDefs = tools?.getDefinitions?.() || [];
        
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    const parsed = safeJSONParse(body);
                    if (parsed.success) {
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
        
        const payload = {
            model: _effectiveModel(config),
            messages,
            system: systemPrompt,
            max_tokens: config.maxTokens,
            temperature: config.temperature,
            stream: false,
            tools: toolDefs
        };
        
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
        const toolDefs = tools?.getDefinitions?.() || [];
        
        const payload = {
            model: _effectiveModel(config),
            messages,
            system: systemPrompt,
            max_tokens: config.maxTokens,
            temperature: config.temperature,
            stream: true,
            tools: toolDefs,
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
    _makeRequest,
    _streamRequest,
    getLastApiContext
};
