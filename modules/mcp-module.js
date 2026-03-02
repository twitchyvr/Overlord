// ==================== MCP CLIENT MODULE ====================
// MiniMax MCP Client — uses minimax-coding-plan-mcp subprocess for real
// web_search and understand_image capabilities.
//
// Tool priority chain:
//   1. MCP subprocess (uvx minimax-coding-plan-mcp) — real results
//   2. DuckDuckGo Instant Answers API — fallback search
//   3. MiniMax vision API — fallback image understanding
//   4. Model-based response — last resort

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

let config = null;
let hub = null;

// ==================== MCP SUBPROCESS CLIENT ====================

class McpSubprocessClient {
    constructor(apiKey, uvxPath) {
        this.apiKey = apiKey;
        this.uvxPath = uvxPath;
        this.proc = null;
        this.msgId = 0;
        this.pending = new Map();
        this.buffer = '';
        this.ready = false;
        this.starting = false;
        this.failed = false;
    }

    async ensureReady() {
        if (this.ready) return true;
        if (this.failed) return false;
        if (this.starting) {
            // Wait for startup to complete
            for (let i = 0; i < 60; i++) {
                await new Promise(r => setTimeout(r, 500));
                if (this.ready) return true;
                if (this.failed) return false;
            }
            return false;
        }
        return this._start();
    }

    async _start() {
        if (!this.uvxPath) {
            console.log('[MCP-proc] uvx not found, MCP subprocess unavailable');
            this.failed = true;
            return false;
        }

        this.starting = true;
        console.log('[MCP-proc] Starting minimax-coding-plan-mcp via', this.uvxPath);

        try {
            this.proc = spawn(this.uvxPath, ['minimax-coding-plan-mcp', '-y'], {
                env: {
                    ...process.env,
                    MINIMAX_API_KEY: this.apiKey,
                    MINIMAX_API_HOST: 'https://api.minimax.io'
                },
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this.proc.stdout.on('data', d => this._onData(d.toString()));
            this.proc.stderr.on('data', d => {
                const msg = d.toString().trim();
                if (msg) console.log('[MCP-proc stderr]', msg.substring(0, 200));
            });
            this.proc.on('error', e => {
                console.error('[MCP-proc error]', e.message);
                this._onCrash();
            });
            this.proc.on('exit', (code) => {
                console.log('[MCP-proc] Process exited with code', code);
                this._onCrash();
            });

            // MCP initialize handshake
            const initResult = await this._send('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                clientInfo: { name: 'overlord-web', version: '2.0' }
            });

            // Send initialized notification (required by MCP spec)
            this._notify('notifications/initialized', {});

            this.ready = true;
            this.starting = false;
            console.log('[MCP-proc] Ready. Server:', initResult?.serverInfo?.name || 'minimax-coding-plan-mcp');
            return true;

        } catch (e) {
            console.error('[MCP-proc] Failed to start:', e.message);
            this.failed = true;
            this.starting = false;
            try { this.proc?.kill(); } catch(ke) {}
            return false;
        }
    }

    _onCrash() {
        this.ready = false;
        this.starting = false;
        // Reject all pending requests
        for (const [id, { reject }] of this.pending) {
            reject(new Error('MCP process crashed'));
        }
        this.pending.clear();
        this.proc = null;
        // Allow restart on next call (unless permanently failed)
        if (!this.failed) {
            setTimeout(() => { /* allow restart */ }, 1000);
        }
    }

    _onData(chunk) {
        this.buffer += chunk;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop(); // keep incomplete last line

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const msg = JSON.parse(trimmed);
                if (msg.id !== undefined && this.pending.has(msg.id)) {
                    const { resolve, reject } = this.pending.get(msg.id);
                    this.pending.delete(msg.id);
                    if (msg.error) {
                        reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                    } else {
                        resolve(msg.result);
                    }
                }
            } catch(e) {
                // Ignore non-JSON lines (e.g., startup messages)
            }
        }
    }

    _send(method, params) {
        const id = ++this.msgId;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error(`MCP timeout: ${method} (30s)`));
                }
            }, 30000);

            this.pending.set(id, {
                resolve: (r) => { clearTimeout(timer); resolve(r); },
                reject: (e) => { clearTimeout(timer); reject(e); }
            });

            const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
            try {
                this.proc.stdin.write(msg);
            } catch(e) {
                this.pending.delete(id);
                clearTimeout(timer);
                reject(new Error('MCP write failed: ' + e.message));
            }
        });
    }

    _notify(method, params) {
        const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
        try { this.proc?.stdin?.write(msg); } catch(e) {}
    }

    async callTool(name, args) {
        const ok = await this.ensureReady();
        if (!ok) throw new Error('MCP subprocess not available');

        const result = await this._send('tools/call', { name, arguments: args });

        // MCP result format: { content: [{ type: 'text', text: '...' }, ...] }
        if (result?.content && Array.isArray(result.content)) {
            return result.content
                .filter(c => c.type === 'text' && c.text)
                .map(c => c.text)
                .join('\n');
        }
        if (typeof result === 'string') return result;
        return JSON.stringify(result);
    }

    destroy() {
        try { this.proc?.kill('SIGTERM'); } catch(e) {}
        this.proc = null;
        this.ready = false;
    }
}

// Singleton MCP client (created once per session)
let mcpClient = null;

function getMcpClient() {
    if (!config?.apiKey || config.apiKey.length < 10) return null;

    const prereqFile = path.join(__dirname, '..', '.overlord', 'prereqs.json');
    let uvxPath = null;
    try {
        const prereqs = JSON.parse(fs.readFileSync(prereqFile, 'utf8'));
        uvxPath = prereqs.uvxPath || null;
    } catch(e) {}

    if (!uvxPath) return null;

    if (!mcpClient) {
        mcpClient = new McpSubprocessClient(config.apiKey, uvxPath);
    }
    return mcpClient;
}

// ==================== DUCKDUCKGO SEARCH ====================

function duckDuckGoSearch(query) {
    return new Promise((resolve, reject) => {
        const encodedQuery = encodeURIComponent(query);
        const options = {
            hostname: 'api.duckduckgo.com',
            path: `/?q=${encodedQuery}&format=json&no_redirect=1&no_html=1&skip_disambig=1`,
            method: 'GET',
            headers: { 'User-Agent': 'OverlordWeb/2.0' }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const parts = [];

                    if (data.AbstractText) {
                        parts.push(`**Summary**: ${data.AbstractText}`);
                        if (data.AbstractURL) parts.push(`Source: ${data.AbstractURL}`);
                    }

                    if (data.Answer) {
                        parts.push(`**Answer**: ${data.Answer}`);
                    }

                    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
                        parts.push('\n**Related Results:**');
                        const topics = data.RelatedTopics.slice(0, 5);
                        topics.forEach(t => {
                            if (t.Text && t.FirstURL) {
                                parts.push(`- [${t.Text.substring(0, 100)}](${t.FirstURL})`);
                            }
                        });
                    }

                    if (parts.length === 0) {
                        resolve(null); // No useful results
                    } else {
                        resolve(`# DuckDuckGo: ${query}\n\n` + parts.join('\n'));
                    }
                } catch(e) {
                    reject(new Error('DDG parse error: ' + e.message));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('DDG timeout')); });
        req.end();
    });
}

// ==================== TOOL DEFINITIONS ====================

const MCP_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'understand_image',
            description: 'Analyze an image using AI vision. Provide detailed descriptions. Supports local file paths or URLs.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to image file or URL' },
                    prompt: { type: 'string', description: 'What you want to know about the image' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'web_search',
            description: 'Search the web for real-time information.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'The search query' }
                },
                required: ['query']
            }
        }
    }
];

// ==================== INIT ====================

function init(h) {
    hub = h;
    return new Promise((resolve) => {
        const checkConfig = () => {
            const cfg = hub?.getService('config');
            if (cfg) {
                config = cfg;

                hub.registerService('mcp', {
                    understandImage: async (imagePath, prompt, cfg) => {
                        const apiKey = cfg?.apiKey || config?.apiKey;
                        return executeUnderstandImage(imagePath, prompt, apiKey);
                    },
                    webSearch: async (query) => {
                        const apiKey = config?.apiKey;
                        return executeWebSearch(query, apiKey);
                    },
                    chatWithTools: (messages, tools) => chatWithTools(messages, tools),
                    getToolDefinitions: () => MCP_TOOLS,
                    getMcpClient: getMcpClient
                });

                // Clean up MCP subprocess on server shutdown
                hub.on('shutdown', () => {
                    if (mcpClient) {
                        mcpClient.destroy();
                        mcpClient = null;
                        console.log('[MCP] Subprocess cleaned up');
                    }
                });

                console.log('[MCP] Initialized with subprocess support');
                resolve();
            } else {
                setTimeout(checkConfig, 100);
            }
        };
        checkConfig();
    });
}

// ==================== WEB SEARCH ====================

async function executeWebSearch(query, apiKey) {
    console.log('[MCP] executeWebSearch:', query);

    // Check search provider preference
    const searchProvider = config?.searchProvider || process.env.SEARCH_PROVIDER || 'mcp';

    // Try MCP subprocess first (unless user prefers DuckDuckGo)
    if (searchProvider !== 'duckduckgo') {
        const client = getMcpClient();
        if (client) {
            try {
                console.log('[MCP] Trying MCP subprocess for web_search...');
                const result = await client.callTool('web_search', { query });
                if (result && result.length > 10) {
                    console.log('[MCP] web_search via MCP subprocess: success');
                    return result;
                }
            } catch (e) {
                console.log('[MCP] MCP subprocess search failed:', e.message, '— trying fallback');
            }
        }
    }

    // DuckDuckGo fallback (or primary if configured)
    try {
        console.log('[MCP] Trying DuckDuckGo search...');
        const ddgResult = await duckDuckGoSearch(query);
        if (ddgResult) {
            console.log('[MCP] DuckDuckGo search: success');
            return ddgResult;
        }
    } catch(e) {
        console.log('[MCP] DuckDuckGo failed:', e.message);
    }

    // Final fallback: model-based (labeled clearly)
    console.log('[MCP] Using model-based fallback for search');
    if (apiKey && apiKey.length > 10) {
        try {
            const response = await makeRequest('/v1/chat/completions', {
                model: 'MiniMax-M2.5-highspeed',
                messages: [{
                    role: 'user',
                    content: `Please provide factual information about: "${query}". Note: This is AI knowledge, not a live web search.`
                }],
                max_tokens: 1500
            }, apiKey);

            if (response.choices && response.choices[0]?.message?.content) {
                return `# AI Response (not live search): ${query}\n\n⚠️ *Note: Web search unavailable. This is AI knowledge from training data.*\n\n${response.choices[0].message.content}`;
            }
        } catch(e) {
            console.log('[MCP] Model fallback failed:', e.message);
        }
    }

    return `Web search unavailable for: "${query}". Please install uvx and configure MINIMAX_API_KEY.`;
}

// ==================== IMAGE UNDERSTANDING ====================

async function executeUnderstandImage(imagePath, prompt, apiKey) {
    console.log('[MCP] executeUnderstandImage:', imagePath);

    if (!imagePath) return 'ERROR: No image path provided';

    // Try MCP subprocess first
    const client = getMcpClient();
    if (client) {
        try {
            console.log('[MCP] Trying MCP subprocess for understand_image...');
            // The MCP understand_image tool expects image_url parameter
            const args = {
                image_url: imagePath,
                prompt: prompt || 'Describe this image in detail. What do you see?'
            };
            const result = await client.callTool('understand_image', args);
            if (result && result.length > 10) {
                console.log('[MCP] understand_image via MCP subprocess: success');
                return result;
            }
        } catch(e) {
            console.log('[MCP] MCP subprocess understand_image failed:', e.message, '— trying fallback');
        }
    }

    // Fallback: direct vision API
    return executeUnderstandImageDirect(imagePath, prompt, apiKey);
}

async function executeUnderstandImageDirect(imagePath, prompt, apiKey) {
    let imageData = null;
    let mimeType = 'image/png';
    let imageUrl = null;
    const isUrl = imagePath.startsWith('http://') || imagePath.startsWith('https://');

    if (isUrl) {
        imageUrl = imagePath;
    } else {
        try {
            const buffer = fs.readFileSync(imagePath);
            if (buffer.length > 10 * 1024 * 1024) {
                return 'ERROR: Image too large. Maximum 10MB.';
            }
            imageData = buffer.toString('base64');
            const ext = path.extname(imagePath).toLowerCase();
            const mimeTypes = {
                '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp'
            };
            mimeType = mimeTypes[ext] || 'image/png';
        } catch(e) {
            return 'ERROR: Cannot read image: ' + e.message;
        }
    }

    const content = [];
    if (isUrl) {
        content.push({ type: 'image_url', image_url: { url: imageUrl } });
    } else {
        content.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageData}` } });
    }
    content.push({ type: 'text', text: prompt || 'Describe this image in detail. What do you see?' });

    const payload = {
        model: 'MiniMax-M2.5-highspeed',
        max_tokens: 2048,
        messages: [{ role: 'user', content }]
    };

    try {
        const response = await makeVisionRequest('/v1/text/chatcompletion_v2', payload, apiKey);
        if (response.choices?.[0]?.message?.content) return response.choices[0].message.content;
        if (response.content) return response.content;
        return 'ERROR: No response content: ' + JSON.stringify(response).substring(0, 200);
    } catch(e) {
        return 'ERROR: Vision API failed: ' + e.message;
    }
}

// ==================== HTTP HELPERS ====================

function makeVisionRequest(endpoint, payload, apiKey) {
    return new Promise((resolve, reject) => {
        const baseUrl = 'https://api.minimax.io';
        const url = new URL(baseUrl + endpoint);
        const body = JSON.stringify(payload);

        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey,
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let responseBody = '';
            res.on('data', chunk => responseBody += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error('API ' + res.statusCode + ': ' + responseBody.substring(0, 300)));
                    return;
                }

                // Handle SSE response
                if (res.headers['content-type']?.includes('text/event-stream')) {
                    let fullContent = '';
                    const lines = responseBody.split('\n');
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed.startsWith('data: ')) continue;
                        const jsonStr = trimmed.slice(6);
                        if (jsonStr === '[DONE]') continue;
                        try {
                            const event = JSON.parse(jsonStr);
                            const delta = event.choices?.[0]?.delta?.content;
                            const text = event.choices?.[0]?.message?.content;
                            if (delta) fullContent += delta;
                            else if (text) fullContent = text;
                        } catch(e) {}
                    }
                    if (fullContent) {
                        resolve({ choices: [{ message: { content: fullContent } }] });
                    } else {
                        try { resolve(JSON.parse(responseBody)); } catch(e) { reject(new Error('SSE parse failed')); }
                    }
                } else {
                    try { resolve(JSON.parse(responseBody)); } catch(e) { reject(new Error('Parse error')); }
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(60000, () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(body);
        req.end();
    });
}

function makeRequest(endpoint, payload, apiKey) {
    return new Promise((resolve, reject) => {
        const baseUrl = 'https://api.minimax.io';
        const url = new URL(baseUrl + endpoint);
        const body = JSON.stringify(payload);

        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey,
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let responseBody = '';
            res.on('data', chunk => responseBody += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error('API ' + res.statusCode + ': ' + responseBody.substring(0, 200)));
                    return;
                }
                try { resolve(JSON.parse(responseBody)); } catch(e) { reject(new Error('Parse error')); }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(body);
        req.end();
    });
}

// ==================== CHAT WITH TOOLS ====================

async function chatWithTools(messages, cfg) {
    const apiKey = cfg?.apiKey || config?.apiKey;
    if (!apiKey) return { success: false, content: 'ERROR: No API key' };

    const payload = {
        model: 'MiniMax-M2.5-highspeed',
        messages,
        tools: MCP_TOOLS,
        tool_choice: 'auto',
        max_tokens: 4096
    };

    try {
        const response = await makeRequest('/v1/chat/completions', payload, apiKey);
        if (response.choices?.[0]?.message) {
            return { success: true, content: response.choices[0].message.content || '', toolCalls: response.choices[0].message.tool_calls };
        }
        return { success: false, content: 'No response' };
    } catch(e) {
        return { success: false, content: 'ERROR: ' + e.message };
    }
}

module.exports = { init };
