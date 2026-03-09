// ==================== SYSTEM TOOLS MODULE ====================
// System info, working directory, config, UI actions, KV store

const os = require('os');
const fs = require('fs');
const path = require('path');

let HUB = null;
let CONFIG = null;

// KV store file path
const _kvPath = () => {
    const overlordDir = path.join(process.cwd(), '.overlord');
    return path.join(overlordDir, 'kv-store.json');
};

// Load KV store
function _kvLoad() {
    const kvPath = _kvPath();
    try {
        if (fs.existsSync(kvPath)) {
            return JSON.parse(fs.readFileSync(kvPath, 'utf-8'));
        }
    } catch (e) {
        // Return empty store on error
    }
    return {};
}

// Save KV store
function _kvSave(store) {
    const kvPath = _kvPath();
    const dir = path.dirname(kvPath);
    
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(kvPath, JSON.stringify(store, null, 2), 'utf-8');
    } catch (e) {
        HUB?.log(`[KV] Save error: ${e.message}`, 'error');
    }
}

// Get system information
async function systemInfo() {
    const cfg = HUB?.getService('config');
    const conv = HUB?.getService('conversation');
    
    const ctx = conv?.getContextUsage ? conv.getContextUsage() : {};
    
    return {
        platform: os.platform(),
        arch: os.arch(),
        release: os.release(),
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0]?.model || 'unknown',
        totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024) + ' GB',
        freeMemory: Math.round(os.freemem() / 1024 / 1024 / 1024) + ' GB',
        homedir: os.homedir(),
        tmpdir: os.tmpdir(),
        hostname: os.hostname(),
        nodeVersion: process.version,
        workingDir: conv?.getWorkingDirectory ? conv.getWorkingDirectory() : process.cwd(),
        aiModel: cfg?.model || 'unknown',
        apiBase: cfg?.baseUrl || 'unknown',
        timestamp: new Date().toISOString()
    };
}

// Get working directory
function getWorkingDir() {
    const conv = HUB?.getService('conversation');
    return conv?.getWorkingDirectory ? conv.getWorkingDirectory() : process.cwd();
}

// Set working directory
function setWorkingDir(p) {
    const conv = HUB?.getService('conversation');
    const targetPath = path.resolve(p);
    
    // Verify directory exists
    if (!fs.existsSync(targetPath)) {
        return { success: false, error: `Directory does not exist: ${targetPath}` };
    }
    
    if (!fs.statSync(targetPath).isDirectory()) {
        return { success: false, error: `Not a directory: ${targetPath}` };
    }
    
    if (conv?.setWorkingDirectory) {
        conv.setWorkingDirectory(targetPath);
    }
    
    HUB?.log(`[System] Working directory set to: ${targetPath}`, 'info');
    
    return { success: true, path: targetPath };
}

// Set thinking level
function setThinkingLevel(level) {
    const validLevels = [1, 2, 3, 4, 5];
    const lvl = Math.max(1, Math.min(5, parseInt(level, 10) || 3));
    
    // Update config
    const cfg = HUB?.getService('config');
    if (cfg) {
        cfg.setThinkingLevel?.(lvl);
    }
    
    const labels = {
        1: 'minimal (512 tokens)',
        2: 'low (1024 tokens)',
        3: 'normal (2048 tokens)',
        4: 'high (4096 tokens)',
        5: 'maximum (8192 tokens)'
    };
    
    return {
        success: true,
        level: lvl,
        description: labels[lvl]
    };
}

// Truncate result for display
function truncateResult(result) {
    const maxChars = 32000;
    const str = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    
    if (str.length > maxChars) {
        return str.substring(0, maxChars) + `\n\n[Output truncated - was ${str.length} chars]`;
    }
    
    return str;
}

// HTTP request helper
function httpRequest(endpoint, payload, apiKey) {
    // This is a placeholder - actual implementation would make HTTP requests
    return { success: false, error: 'Not implemented' };
}

// UI action - send action to browser clients
function uiAction(input) {
    const { action, params } = input;
    
    if (!action) {
        return { success: false, error: 'action is required' };
    }
    
    // Valid actions
    const validActions = ['open_panel', 'close_panel', 'show_toast', 'set_status', 'open_url', 'set_mode', 'scroll_to_bottom'];
    
    if (!validActions.includes(action)) {
        return { success: false, error: `Invalid action. Valid: ${validActions.join(', ')}` };
    }
    
    try {
        HUB?.broadcast('ui_action', { action, params });
        return { success: true, action, params };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Show chart - render chart in browser
function showChart(input) {
    const { type, labels, values, colors, title } = input;
    
    if (!type || !labels || !values) {
        return { success: false, error: 'type, labels, and values are required' };
    }
    
    const validTypes = ['bar', 'line', 'pie'];
    if (!validTypes.includes(type)) {
        return { success: false, error: `Invalid type. Valid: ${validTypes.join(', ')}` };
    }
    
    try {
        HUB?.broadcast('show_chart', { type, labels, values, colors, title });
        return { success: true, type, title };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Ask user - request input from user
async function askUser(input) {
    const { question, type, choices, default: defaultValue } = input;
    
    if (!question || !type) {
        return { success: false, error: 'question and type are required' };
    }
    
    // Broadcast ask_user event to UI
    HUB?.broadcast('ask_user', { question, type, choices, default: defaultValue });
    
    // This is handled asynchronously via socket response
    // The actual response comes back through a separate event
    return { 
        success: true, 
        message: 'Waiting for user response...',
        question,
        type
    };
}

// KV Store functions
function kvSet(key, value, ttlMs) {
    if (!key) {
        return { success: false, error: 'key is required' };
    }
    
    const store = _kvLoad();
    
    const entry = {
        value,
        createdAt: Date.now()
    };
    
    if (ttlMs) {
        entry.expiresAt = Date.now() + ttlMs;
    }
    
    store[key] = entry;
    _kvSave(store);
    
    return { success: true, key };
}

function kvGet(key) {
    if (!key) {
        return { success: false, error: 'key is required' };
    }
    
    const store = _kvLoad();
    const entry = store[key];
    
    if (!entry) {
        return { success: false, error: 'Key not found', value: null };
    }
    
    // Check expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
        delete store[key];
        _kvSave(store);
        return { success: false, error: 'Key expired', value: null };
    }
    
    return { success: true, value: entry.value };
}

function kvList(prefix, limit = 50) {
    const store = _kvLoad();
    const now = Date.now();
    const keys = Object.keys(store);
    
    let filtered = keys;
    
    // Filter by prefix
    if (prefix) {
        filtered = keys.filter(k => k.startsWith(prefix));
    }
    
    // Check expiration and limit
    const result = [];
    for (const key of filtered) {
        const entry = store[key];
        
        // Skip expired
        if (entry.expiresAt && now > entry.expiresAt) {
            continue;
        }
        
        result.push({
            key,
            value: entry.value,
            createdAt: entry.createdAt,
            expiresAt: entry.expiresAt
        });
        
        if (result.length >= limit) {
            break;
        }
    }
    
    return { success: true, keys: result };
}

function kvDelete(key, prefix) {
    const store = _kvLoad();
    let deleted = 0;
    
    if (key) {
        if (store[key]) {
            delete store[key];
            deleted = 1;
        }
    } else if (prefix) {
        const keys = Object.keys(store);
        for (const k of keys) {
            if (k.startsWith(prefix)) {
                delete store[k];
                deleted++;
            }
        }
    }
    
    _kvSave(store);
    
    return { success: true, deleted };
}

// Socket push - emit custom event to browser
function socketPush(event, data) {
    if (!event) {
        return { success: false, error: 'event is required' };
    }
    
    if (!event.startsWith('agent_')) {
        return { success: false, error: 'Event name must start with "agent_"' };
    }
    
    try {
        HUB?.broadcast(event, data);
        return { success: true, event };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Initialize module
function init(hub) {
    HUB = hub;
    CONFIG = hub.getService('config');
}

module.exports = {
    init,
    systemInfo,
    getWorkingDir,
    setWorkingDir,
    setThinkingLevel,
    truncateResult,
    httpRequest,
    uiAction,
    showChart,
    askUser,
    kvSet,
    kvGet,
    kvList,
    kvDelete,
    socketPush
};
