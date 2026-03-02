// ==================== OVERLORD WEB SERVER ====================
// Modular architecture with plugin system
// Access at: http://localhost:3031

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const os = require('os');

// ==================== PROCESS MANAGEMENT ====================
// Track server PID for graceful restarts

const PID_FILE = path.join(__dirname, '.overlord', 'server.pid');
const LOG_FILE = path.join(__dirname, '.overlord', 'server.log');

// Ensure .overlord directory exists
const overlordDir = path.dirname(PID_FILE);
if (!fs.existsSync(overlordDir)) {
    fs.mkdirSync(overlordDir, { recursive: true });
}

// Get current server PID
function getCurrentPID() {
    try {
        if (fs.existsSync(PID_FILE)) {
            const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());
            return isNaN(pid) ? null : pid;
        }
    } catch (e) {}
    return null;
}

// Check if process is running
function isProcessRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return false;
    }
}

// Save PID to file
function savePID() {
    fs.writeFileSync(PID_FILE, String(process.pid));
}

// Graceful restart - stop old server, start new one
async function gracefulRestart() {
    const oldPID = getCurrentPID();

    if (oldPID && oldPID !== process.pid && isProcessRunning(oldPID)) {
        console.log(`[Manager] Found old server (PID ${oldPID}), requesting graceful shutdown...`);

        try {
            process.kill(oldPID, 'SIGTERM');

            // Wait up to 8 seconds for graceful shutdown
            let waited = 0;
            while (waited < 8000 && isProcessRunning(oldPID)) {
                await new Promise(r => setTimeout(r, 200));
                waited += 200;
            }

            if (isProcessRunning(oldPID)) {
                console.log(`[Manager] Force killing old server (PID ${oldPID})...`);
                process.kill(oldPID, 'SIGKILL');
                await new Promise(r => setTimeout(r, 500));
            }

            console.log(`[Manager] Old server stopped`);
        } catch (e) {
            console.log(`[Manager] Could not stop old server: ${e.message}`);
        }
    }

    // Remove stale PID file
    try { if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE); } catch(e) {}
}

// ==================== PREREQUISITE CHECK ====================

function findUvx() {
    const home = os.homedir();
    const candidates = [
        '/usr/local/bin/uvx',
        path.join(home, '.local', 'bin', 'uvx'),
        path.join(home, '.cargo', 'bin', 'uvx'),
        '/opt/homebrew/bin/uvx',
        '/usr/bin/uvx',
        path.join(home, '.uv', 'bin', 'uvx')
    ];

    // Check PATH-based candidates from process.env.PATH
    const pathDirs = (process.env.PATH || '').split(':');
    for (const dir of pathDirs) {
        candidates.push(path.join(dir, 'uvx'));
    }

    for (const p of candidates) {
        try {
            if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
        } catch(e) {}
    }

    // Try execFileSync with 'which' as last resort
    try {
        const result = execFileSync('which', ['uvx'], { encoding: 'utf8', timeout: 2000 }).trim();
        if (result && fs.existsSync(result)) return result;
    } catch(e) {}

    return null;
}

async function checkPrerequisites() {
    console.log('\n🔍 Checking prerequisites...\n');
    const results = {};

    // Check API key
    const apiKey = (process.env.ANTHROPIC_AUTH_TOKEN || process.env.API_KEY || process.env.MINIMAX_API_KEY || '').trim();
    results.apiKey = apiKey.length > 10;
    console.log(`   ${results.apiKey ? '✅' : '❌'} MINIMAX_API_KEY: ${results.apiKey ? 'Loaded' : 'MISSING - set MINIMAX_API_KEY in .env'}`);

    // Check uvx
    const uvxPath = findUvx();
    results.uvx = !!uvxPath;
    results.uvxPath = uvxPath;
    console.log(`   ${results.uvx ? '✅' : '⚠️ '} uvx: ${uvxPath || 'Not found - install from https://docs.astral.sh/uv/'}`);

    // Mark MCP as available if uvx found (it will install on first use)
    results.minimaxMcp = results.uvx;
    if (results.uvx) {
        console.log(`   ✅ minimax-coding-plan-mcp: Available (uvx will install on first use)`);
    } else {
        console.log(`   ⚠️  minimax-coding-plan-mcp: Requires uvx`);
    }

    // Ensure output directories exist
    const dirs = [
        path.join(__dirname, '.overlord', 'generated'),
        path.join(__dirname, '.overlord', 'audio'),
        path.join(__dirname, 'uploads')
    ];
    dirs.forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

    // Write prereq state for modules to read
    fs.writeFileSync(
        path.join(__dirname, '.overlord', 'prereqs.json'),
        JSON.stringify({ ...results, checkedAt: Date.now() }, null, 2)
    );

    console.log('');
    return results;
}

// Create app and server
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingTimeout: 60000,
    pingInterval: 25000,
    // Connection State Recovery: Socket.IO v4 feature.
    // When a client reconnects within maxDisconnectionDuration, missed events are replayed
    // automatically so manual state resync logic (get_message_queue, etc.) becomes a fallback.
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        skipMiddlewares: true
    }
});

// Multer for file uploads
const multer = require('multer');
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

// Exif-parser for EXIF data extraction
let exifParser;
try { exifParser = require('exif-parser'); console.log('[Upload] EXIF parser loaded'); } catch (e) { console.log('[Upload] EXIF parsing not available'); }

// Hub (central event bus)
const hub = require('./hub');

// Suppress favicon 404
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Serve marked.js from node_modules
app.get('/marked.js', (req, res) => {
    res.sendFile(require.resolve('marked'));
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve generated images, audio, and user uploads
app.use('/generated', express.static(path.join(__dirname, '.overlord', 'generated')));
app.use('/audio', express.static(path.join(__dirname, '.overlord', 'audio')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Directory browser API — used by the folder picker in settings
app.get('/api/browse-dirs', (req, res) => {
    const os = require('os');
    const requestedPath = req.query.path || os.homedir();
    try {
        const resolved = path.resolve(requestedPath);
        const entries = fs.readdirSync(resolved, { withFileTypes: true });
        const dirs = entries
            .filter(e => e.isDirectory() && !e.name.startsWith('.'))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(e => ({ name: e.name, path: path.join(resolved, e.name) }));
        res.json({
            path: resolved,
            parent: path.dirname(resolved),
            dirs,
            sep: path.sep
        });
    } catch (e) {
        res.status(400).json({ error: e.message, path: requestedPath });
    }
});

// File upload endpoint
app.post('/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.json({ success: false, error: 'No file uploaded' });
    }
    const uploadedPath = req.file.path;
    console.log('[Upload] File saved to:', uploadedPath);
    res.json({
        success: true,
        path: uploadedPath,
        originalName: req.file.originalname
    });
});

// Port
const PORT = process.env.PORT || 3031;
const BASE_DIR = path.join(__dirname, '..');

// ==================== LOAD MODULES ====================
// ORDER MATTERS: config first, then tools, then agents

const moduleFiles = [
    './modules/config-module',
    './modules/markdown-module',
    './modules/guardrail-module',
    './modules/character-normalization',
    './modules/token-manager-module',
    './modules/context-tracker-module',
    './modules/mcp-module',
    './modules/mcp-manager-module',
    './modules/database-module',
    './modules/notes-module',
    './modules/skills-module',
    './modules/tools-v5',
    './modules/agent-system-module',
    './modules/agent-manager-module',
    './modules/ai-module',
    './modules/summarization-module',
    './modules/test-server-module',
    './modules/file-tools-module',
    './modules/screenshot-module',
    './modules/minimax-image-module',
    './modules/minimax-tts-module',
    './modules/minimax-files-module',
    './modules/project-module',
    './modules/conversation-module',
    './modules/git-module',
    './modules/orchestration-module'
];

async function loadModules() {
    console.log('\n📦 Loading modules sequentially...\n');

    for (const mod of moduleFiles) {
        const modName = mod.replace('./modules/', '');
        try {
            const module = require(mod);
            if (module.init) {
                await module.init(hub);
                hub.registerModule(modName, module);
                console.log(`   ✅ ${modName}`);
            } else {
                console.log(`   ⚠️  ${modName}: no init function`);
            }
        } catch (e) {
            console.error(`   ❌ ${modName}: ${e.message}`);
            // Non-critical modules don't crash the server
        }
    }
}

// ==================== GRACEFUL SHUTDOWN ====================

let isShuttingDown = false;

function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n[Manager] Received ${signal}, shutting down gracefully...`);

    // Clean up PID file immediately
    try { fs.unlinkSync(PID_FILE); } catch(e) {}

    // Hard timeout — force exit after 5 seconds no matter what
    const forceExit = setTimeout(() => {
        console.log('[Manager] Force exit after 5s timeout');
        process.exit(0);
    }, 5000);
    forceExit.unref(); // Don't let this timer keep the process alive

    // Notify all modules to clean up (kills MCP subprocesses, etc.)
    try { hub.emit('shutdown'); } catch(e) {}

    // Disconnect all Socket.IO clients immediately
    try { io.disconnectSockets(true); } catch(e) {}

    // Close HTTP server
    server.close(() => {
        console.log('[Manager] HTTP server closed. Exiting.');
        clearTimeout(forceExit);
        process.exit(0);
    });
}

// ==================== START ====================
async function start() {
    // Check for existing server and gracefully restart if needed
    await gracefulRestart();

    // Save our PID
    savePID();

    // Set up graceful shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

    // Prevent crashes from unhandled promise rejections
    process.on('unhandledRejection', (reason) => {
        console.error('[Server] Unhandled rejection:', reason?.message || reason);
    });

    // Initialize hub (event bus + socket bridge only)
    await hub.init(io, {});

    // Check prerequisites
    const prereqs = await checkPrerequisites();

    // Load all modules in order
    await loadModules();

    // Read config for startup banner
    const config = hub.getService('config') || {};
    const apiKeyStatus = (config.apiKey || '').length > 10 ? '✅ Loaded' : '❌ MISSING';
    const platformName = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux';
    const mcpStatus = prereqs.uvx ? '✅ Ready' : '⚠️  Install uvx';

    // Start server
    server.listen(PORT, () => {
        console.log('');
        console.log('╔═══════════════════════════════════════════════════════════╗');
        console.log('║  OVERLORD WEB v2.0 - AI Coding Assistant                 ║');
        console.log('╠═══════════════════════════════════════════════════════════╣');
        console.log(`║  🌐 Open: http://localhost:${PORT}                          ║`);
        console.log(`║  📁 Dir: ${BASE_DIR.substring(0, 46).padEnd(46)}║`);
        console.log(`║  🔑 API Key: ${apiKeyStatus.padEnd(43)}║`);
        console.log(`║  🧠 Model: ${(config.model || 'MiniMax-M2.5-highspeed').padEnd(45)}║`);
        console.log(`║  🔌 MCP: ${mcpStatus.padEnd(47)}║`);
        console.log(`║  💻 Platform: ${platformName.padEnd(42)}║`);
        console.log('╚═══════════════════════════════════════════════════════════╝');
        console.log('');
    });
}

start().catch(e => {
    console.error('❌ Failed to start:', e);
    process.exit(1);
});
