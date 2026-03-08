// ==================== MCP MANAGER MODULE ====================
// Manages multiple MCP servers (GitHub, filesystem, custom, etc.)
// Loads server config from .overlord/mcp-servers.json
// Each server is a McpServerConnection that speaks JSON-RPC over stdin/stdout

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let hub = null;

// ==================== DEFAULT SERVER PRESETS ====================

const SERVER_PRESETS = {
    minimax: {
        name: 'minimax',
        description: 'MiniMax MCP: web_search, understand_image',
        command: 'uvx',
        args: ['minimax-coding-plan-mcp', '-y'],
        env: { MINIMAX_API_KEY: '', MINIMAX_API_HOST: 'https://api.minimax.io' },
        required: true,
        enabled: true,
        builtin: true
    },
    github: {
        name: 'github',
        description: 'GitHub MCP: repos, issues, PRs, file browsing',
        command: 'uvx',
        args: ['mcp-server-github'],
        env: { GITHUB_TOKEN: '' },
        required: false,
        enabled: false,
        builtin: true
    },
    filesystem: {
        name: 'filesystem',
        description: 'Filesystem MCP: read/write files via MCP protocol',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        env: {},
        required: false,
        enabled: false,
        builtin: true
    },
    sequential_thinking: {
        name: 'sequential_thinking',
        description: 'Sequential thinking MCP: structured reasoning steps',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
        env: {},
        required: false,
        enabled: false,
        builtin: true
    },
    obsidian: {
        name: 'obsidian',
        description: 'Obsidian Local REST API MCP: read/write/search vault notes via the Obsidian plugin',
        command: 'npx',
        args: ['-y', 'obsidian-local-rest-api-mcp-server'],
        env: { OBSIDIAN_API_KEY: '', OBSIDIAN_API_URL: 'https://127.0.0.1:27124' },
        required: false,
        enabled: false,
        builtin: true
    }
};

// ==================== MCP SERVER CONNECTION ====================

// Default timeout for MCP operations (configurable via MCP_TIMEOUT_MS env var)
const MCP_TIMEOUT_MS = parseInt(process.env.MCP_TIMEOUT_MS, 10) || 60000;

class McpServerConnection {
    constructor(config) {
        this.config = config;
        this.proc = null;
        this.ready = false;
        this.pendingRequests = new Map();
        this.nextId = 1;
        this.tools = [];
        this.buffer = '';
        this.reconnectAttempts = 0;
        this.maxReconnects = 3;
        this.status = 'disconnected'; // disconnected | connecting | connected | error
        this.lastError = null;
    }

    getStatus() {
        return {
            name: this.config.name,
            description: this.config.description,
            status: this.status,
            tools: this.tools.map(t => t.name),
            toolCount: this.tools.length,
            lastError: this.lastError,
            enabled: this.config.enabled,
            builtin: this.config.builtin || false
        };
    }

    async start() {
        if (this.proc) return;
        this.status = 'connecting';
        this.lastError = null;

        // Merge env
        const env = { ...process.env };
        for (const [k, v] of Object.entries(this.config.env || {})) {
            if (v) env[k] = v;
        }

        // For minimax preset, inject API key from config
        if (this.config.name === 'minimax') {
            const cfg = hub?.getService('config');
            if (cfg?.apiKey) env['MINIMAX_API_KEY'] = cfg.apiKey;
            if (cfg?.baseUrl) env['MINIMAX_API_HOST'] = cfg.baseUrl.replace('/anthropic', '');
        }

        hub?.log(`[MCP:${this.config.name}] Starting: ${this.config.command} ${(this.config.args || []).join(' ')} (timeout: ${MCP_TIMEOUT_MS / 1000}s)`, 'info');

        try {
            this.proc = spawn(this.config.command, this.config.args || [], {
                env,
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: false
            });

            this.proc.stdout.on('data', (chunk) => this._onData(chunk));
            this.proc.stderr.on('data', (chunk) => {
                const msg = chunk.toString().trim();
                if (msg) hub?.log(`[MCP:${this.config.name}] stderr: ${msg}`, 'warn');
            });

            this.proc.on('exit', (code, signal) => {
                hub?.log(`[MCP:${this.config.name}] exited (code=${code}, signal=${signal})`, 'warn');
                this.proc = null;
                this.ready = false;
                this.status = 'disconnected';
                // Reject all pending requests
                for (const [, { reject }] of this.pendingRequests) {
                    reject(new Error(`MCP server "${this.config.name}" exited`));
                }
                this.pendingRequests.clear();
            });

            this.proc.on('error', (err) => {
                hub?.log(`[MCP:${this.config.name}] spawn error: ${err.message}`, 'error');
                this.lastError = err.message;
                this.status = 'error';
            });

            // Initialize
            await this._initialize();
            this.status = 'connected';
            this.reconnectAttempts = 0;
            hub?.log(`[MCP:${this.config.name}] Connected, ${this.tools.length} tools available`, 'success');

        } catch (err) {
            hub?.log(`[MCP:${this.config.name}] Failed to start: ${err.message}`, 'error');
            this.lastError = err.message;
            this.status = 'error';
            this.proc?.kill();
            this.proc = null;
            throw err;
        }
    }

    _onData(chunk) {
        this.buffer += chunk.toString();
        let newline;
        while ((newline = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.slice(0, newline).trim();
            this.buffer = this.buffer.slice(newline + 1);
            if (!line) continue;
            try {
                const msg = JSON.parse(line);
                if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
                    const { resolve, reject } = this.pendingRequests.get(msg.id);
                    this.pendingRequests.delete(msg.id);
                    if (msg.error) {
                        reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                    } else {
                        resolve(msg.result);
                    }
                }
            } catch (e) {
                // Ignore malformed lines
            }
        }
    }

    _send(method, params = {}) {
        return new Promise((resolve, reject) => {
            if (!this.proc || !this.proc.stdin.writable) {
                return reject(new Error(`MCP server "${this.config.name}" not running`));
            }
            const id = this.nextId++;
            const timeoutMs = MCP_TIMEOUT_MS;
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`MCP server "${this.config.name}" timeout on ${method} after ${timeoutMs / 1000}s — if this is a first run, the package may still be downloading. Set MCP_TIMEOUT_MS in .env to increase (current: ${timeoutMs}ms)`));
            }, timeoutMs);

            this.pendingRequests.set(id, {
                resolve: (val) => { clearTimeout(timeout); resolve(val); },
                reject: (err) => { clearTimeout(timeout); reject(err); }
            });

            const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
            this.proc.stdin.write(msg + '\n');
        });
    }

    _notify(method, params = {}) {
        if (!this.proc?.stdin?.writable) return;
        const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
        this.proc.stdin.write(msg + '\n');
    }

    async _initialize() {
        const result = await this._send('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            clientInfo: { name: 'overlord', version: '2.0' }
        });

        this._notify('notifications/initialized', {});
        this.ready = true;

        // Discover tools
        try {
            const toolsResult = await this._send('tools/list', {});
            this.tools = toolsResult?.tools || [];
        } catch (e) {
            hub?.log(`[MCP:${this.config.name}] Could not list tools: ${e.message}`, 'warn');
            this.tools = [];
        }
    }

    async callTool(name, args = {}) {
        if (!this.ready) await this.start();

        const result = await this._send('tools/call', { name, arguments: args });
        // Extract text from content array
        const content = result?.content || [];
        return content.map(c => c.text || JSON.stringify(c)).join('\n');
    }

    destroy() {
        if (this.proc) {
            try { this.proc.kill(); } catch (e) {}
            this.proc = null;
        }
        this.ready = false;
        this.status = 'disconnected';
        this.pendingRequests.clear();
    }
}

// ==================== SERVER REGISTRY ====================

const servers = new Map(); // name -> McpServerConnection
let configPath = null;

function getConfigPath() {
    if (configPath) return configPath;
    const conv = hub?.getService('conversation');
    const baseDir = conv?.getWorkingDirectory?.() || process.cwd();
    configPath = path.join(baseDir, '.overlord', 'mcp-servers.json');
    return configPath;
}

function loadServerConfig() {
    const cfgPath = getConfigPath();
    if (!fs.existsSync(cfgPath)) {
        // Write defaults
        const defaults = Object.values(SERVER_PRESETS);
        fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
        fs.writeFileSync(cfgPath, JSON.stringify(defaults, null, 2));
        return defaults;
    }
    try {
        return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch (e) {
        hub?.log('[MCPManager] Failed to parse mcp-servers.json: ' + e.message, 'error');
        return Object.values(SERVER_PRESETS);
    }
}

function saveServerConfig() {
    const cfgPath = getConfigPath();
    const configs = [...servers.values()].map(s => s.config);
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify(configs, null, 2));
}

async function startEnabledServers() {
    const configs = loadServerConfig();
    for (const cfg of configs) {
        if (!cfg.enabled) continue;
        // Skip minimax — handled by mcp-module.js
        if (cfg.name === 'minimax') continue;

        const conn = new McpServerConnection(cfg);
        servers.set(cfg.name, conn);

        // Retry loop: up to maxReconnects attempts with exponential backoff
        for (let attempt = 0; attempt <= conn.maxReconnects; attempt++) {
            try {
                await conn.start();
                break; // Success — exit retry loop
            } catch (e) {
                conn.reconnectAttempts = attempt + 1;
                if (attempt < conn.maxReconnects) {
                    const delay = Math.min(5000 * (attempt + 1), 15000); // 5s, 10s, 15s
                    hub?.log(`[MCP:${cfg.name}] Retry ${attempt + 1}/${conn.maxReconnects} in ${delay / 1000}s…`, 'warn');
                    await new Promise(r => setTimeout(r, delay));
                    // Reset for next attempt
                    conn.proc = null;
                    conn.ready = false;
                } else {
                    hub?.log(`[MCP:${cfg.name}] All ${conn.maxReconnects} retries exhausted — server disabled for this session`, 'error');
                }
            }
        }
    }
}

function listServers() {
    // Load ALL known configs (including disabled ones) so the Settings panel
    // can render every server with a Toggle button — not just active ones.
    let configs;
    try {
        configs = loadServerConfig();
    } catch (e) {
        configs = Object.values(SERVER_PRESETS);
    }

    const result = [];
    const seen = new Set();

    for (const cfg of configs) {
        // minimax is managed by mcp-module.js — surface it via hub service
        if (cfg.name === 'minimax') {
            seen.add('minimax');
            try {
                const mcpService = hub?.getService('mcp');
                const client = mcpService?.getMcpClient?.();
                const connStatus = !client        ? 'disabled'
                    : client.failed              ? 'error'
                    : client.starting            ? 'connecting'
                    : client.ready               ? 'connected'
                    :                              'idle';
                const toolList = connStatus === 'connected'
                    ? [{ name: 'web_search', description: 'Search the web' }, { name: 'understand_image', description: 'Analyze images' }]
                    : [];
                result.push({
                    name:        'minimax',
                    description: 'MiniMax AI — web_search + understand_image (managed internally)',
                    status:      connStatus,
                    tools:       toolList,
                    toolCount:   toolList.length,
                    lastError:   client?.failed ? 'Subprocess connection failed' : null,
                    enabled:     cfg.enabled !== false,
                    builtin:     true
                });
            } catch(e) {
                result.push({
                    name: 'minimax', description: 'MiniMax AI — web_search + understand_image',
                    status: 'unknown', tools: [], toolCount: 0, lastError: e.message, enabled: true, builtin: true
                });
            }
            continue;
        }
        seen.add(cfg.name);

        const conn = servers.get(cfg.name);
        if (conn) {
            // Live connection — return real status
            result.push(conn.getStatus());
        } else {
            // Disabled / not started — return a stub so UI can show Toggle
            result.push({
                name:        cfg.name,
                description: cfg.description || '',
                status:      'disabled',
                tools:       [],
                toolCount:   0,
                lastError:   null,
                enabled:     false,
                builtin:     cfg.builtin || false
            });
        }
    }

    // Also surface any live connections not in the saved config (custom additions)
    for (const [name, conn] of servers) {
        if (!seen.has(name) && name !== 'minimax') {
            result.push(conn.getStatus());
        }
    }

    return result;
}

async function enableServer(name, envOverrides = {}) {
    let conn = servers.get(name);
    if (!conn) {
        // Load from config or preset
        const configs = loadServerConfig();
        const cfg = configs.find(c => c.name === name) || SERVER_PRESETS[name];
        if (!cfg) throw new Error(`Unknown MCP server: ${name}`);
        cfg.enabled = true;
        Object.assign(cfg.env, envOverrides);
        conn = new McpServerConnection(cfg);
        servers.set(name, conn);
    } else {
        conn.config.enabled = true;
        Object.assign(conn.config.env, envOverrides);
    }

    await conn.start();
    saveServerConfig();

    // Register this server's tools
    registerServerTools(conn);

    broadcastServerList();
    return conn.getStatus();
}

async function disableServer(name) {
    const conn = servers.get(name);
    if (!conn) throw new Error(`Server "${name}" not found`);

    conn.config.enabled = false;
    conn.destroy();
    saveServerConfig();

    broadcastServerList();
    return { name, status: 'disabled' };
}

function registerServerTools(conn) {
    const toolsSvc = hub?.getService('tools');
    if (!toolsSvc?.registerTool) return;

    for (const toolDef of conn.tools) {
        const toolName = `mcp_${conn.config.name}_${toolDef.name}`;
        const wrappedDef = {
            name: toolName,
            description: `[MCP:${conn.config.name}] ${toolDef.description || toolDef.name}`,
            input_schema: toolDef.inputSchema || { type: 'object', properties: {} }
        };

        toolsSvc.registerTool(wrappedDef, async (input) => {
            try {
                const result = await conn.callTool(toolDef.name, input);
                return { success: true, result };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        hub?.log(`[MCPManager] Registered tool: ${toolName}`, 'info');
    }
}

function broadcastServerList() {
    try {
        hub?.broadcast('mcp_servers_updated', { servers: listServers() });
    } catch (e) {}
}

// ==================== SOCKET HANDLERS ====================

function setupSocketHandlers() {
    // Client requests server list
    hub.on('get_mcp_servers', (socket) => {
        hub.emitTo(socket, 'mcp_servers_updated', { servers: listServers() });
    });

    // Enable a server
    hub.on('enable_mcp_server', async (socket, data) => {
        const { name, env } = data || {};
        try {
            const status = await enableServer(name, env || {});
            hub.emitTo(socket, 'mcp_server_result', { success: true, server: status });
        } catch (e) {
            hub.emitTo(socket, 'mcp_server_result', { success: false, error: e.message });
        }
    });

    // Disable a server
    hub.on('disable_mcp_server', async (socket, data) => {
        const { name } = data || {};
        try {
            await disableServer(name);
            hub.emitTo(socket, 'mcp_server_result', { success: true, name, status: 'disabled' });
        } catch (e) {
            hub.emitTo(socket, 'mcp_server_result', { success: false, error: e.message });
        }
    });

    // Add custom server
    hub.on('add_mcp_server', async (socket, data) => {
        const { name, command, args, env, description } = data || {};
        if (!name || !command) {
            return hub.emitTo(socket, 'mcp_server_result', { success: false, error: 'name and command are required' });
        }

        const cfg = {
            name,
            description: description || name,
            command,
            args: args || [],
            env: env || {},
            enabled: true,
            builtin: false
        };

        const conn = new McpServerConnection(cfg);
        servers.set(name, conn);

        try {
            await conn.start();
            registerServerTools(conn);
            saveServerConfig();
            broadcastServerList();
            hub.emitTo(socket, 'mcp_server_result', { success: true, server: conn.getStatus() });
        } catch (e) {
            hub.emitTo(socket, 'mcp_server_result', { success: false, error: e.message });
        }
    });

    // Remove a server
    hub.on('remove_mcp_server', async (socket, data) => {
        const { name } = data || {};
        const conn = servers.get(name);
        if (conn) {
            conn.destroy();
            servers.delete(name);
        }
        saveServerConfig();
        broadcastServerList();
        hub.emitTo(socket, 'mcp_server_result', { success: true, name, status: 'removed' });
    });
}

// ==================== INIT ====================

async function init(h) {
    hub = h;

    // Setup socket event handlers
    setupSocketHandlers();

    // Cleanup on shutdown
    hub.on('shutdown', () => {
        for (const conn of servers.values()) {
            conn.destroy();
        }
    });

    hub.registerService('mcpManager', {
        listServers,
        enableServer,
        disableServer,
        getServer: (name) => servers.get(name),
        callServerTool: async (serverName, toolName, args) => {
            const conn = servers.get(serverName);
            if (!conn) throw new Error(`Server "${serverName}" not found`);
            return conn.callTool(toolName, args);
        }
    });

    // Start enabled servers (non-blocking)
    startEnabledServers().then(() => {
        broadcastServerList();
    }).catch(e => {
        hub.log('[MCPManager] Error starting servers: ' + e.message, 'warn');
    });

    hub.log('🔌 MCP Manager module loaded', 'success');
}

module.exports = { init };
