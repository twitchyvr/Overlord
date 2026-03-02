// ==================== OVERLORD WEB SERVER ====================
// Modular architecture with plugin system
// Access at: http://localhost:3031
//
// Normally started via launcher.js (node launcher.js / npm start).
// Can also be run directly: node server.js (dotenv loaded as fallback).

try { require('dotenv').config({ override: false }); } catch (_) {}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

// Create app and server
const app = express();
const server = http.createServer(app);
const isHttps = false;
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
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

// Exif-parser for EXIF data extraction
let exifParser;
try { exifParser = require('exif-parser'); console.log('[Upload] EXIF parser loaded'); } catch (e) { 
    // QUAL-004: Log missing EXIF functionality with warning level
    console.warn('[Upload] EXIF parsing not available - image metadata extraction disabled'); 
}

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
app.use('/audio',     express.static(path.join(__dirname, '.overlord', 'audio')));
app.use('/uploads',   express.static(path.join(__dirname, 'uploads')));

// Directory browser API — used by the folder picker in settings
app.get('/api/browse-dirs', (req, res) => {
    const os = require('os');
    const requestedPath = req.query.path || os.homedir();
    try {
        const resolved = path.resolve(requestedPath);
        const entries  = fs.readdirSync(resolved, { withFileTypes: true });
        const dirs = entries
            .filter(e => e.isDirectory() && !e.name.startsWith('.'))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(e => ({ name: e.name, path: path.join(resolved, e.name) }));
        res.json({ path: resolved, parent: path.dirname(resolved), dirs, sep: path.sep });
    } catch (e) {
        res.status(400).json({ error: e.message, path: requestedPath });
    }
});

// File upload endpoint
app.post('/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.json({ success: false, error: 'No file uploaded' });
    console.log('[Upload] File saved to:', req.file.path);
    res.json({ success: true, path: req.file.path, originalName: req.file.originalname });
});

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
    './modules/tasks-engine',       // dedicated task socket handlers + service API
    './modules/git-module',
    './modules/orchestration-module'
];

async function loadModules() {
    console.log('\n📦 Loading modules sequentially...\n');
    for (const mod of moduleFiles) {
        const modName = mod.replace('./modules/', '');
        try {
            const m = require(mod);
            if (m.init) {
                await m.init(hub);
                hub.registerModule(modName, m);
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

    console.log(`\n[Server] Received ${signal}, shutting down gracefully...`);

    // Hard timeout — force exit after 5 seconds no matter what
    const forceExit = setTimeout(() => {
        console.log('[Server] Force exit after 5s timeout');
        process.exit(0);
    }, 5000);
    forceExit.unref();

    // Notify all modules to clean up (kills MCP subprocesses, etc.)
    try { hub.emit('shutdown'); } catch (_) {}

    // Disconnect all Socket.IO clients
    try { io.disconnectSockets(true); } catch (_) {}

    // Close HTTP server
    server.close(() => {
        console.log('[Server] HTTP server closed. Exiting.');
        clearTimeout(forceExit);
        process.exit(0);
    });
}

// ==================== START ====================

async function start() {
    // Graceful shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
    if (process.platform !== 'win32') {
        process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));
    }

    // Prevent crashes from unhandled promise rejections
    process.on('unhandledRejection', (reason) => {
        console.error('[Server] Unhandled rejection:', reason?.message || reason);
    });

    // Initialize hub (event bus + socket bridge)
    await hub.init(io, {});

    // Load all modules in order
    await loadModules();

    // Read config for startup banner
    const config       = hub.getService('config') || {};
    const apiKeyStatus = (config.apiKey || '').length > 10 ? '✅ Loaded' : '❌ MISSING';
    const platformName = process.platform === 'darwin' ? 'macOS'
                       : process.platform === 'win32'  ? 'Windows' : 'Linux';

    // Read MCP status from prereqs.json (written by launcher)
    let mcpStatus = '⚠️  Install uvx';
    try {
        const prereqs = JSON.parse(fs.readFileSync(path.join(__dirname, '.overlord', 'prereqs.json'), 'utf8'));
        mcpStatus = prereqs.uvx ? '✅ Ready' : '⚠️  Install uvx';
    } catch (_) {}

    const PORT     = process.env.PORT || 3031;
    const BASE_DIR = path.join(__dirname, '..');

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
    console.error('❌ Failed to start server:', e);
    process.exit(1);
});
