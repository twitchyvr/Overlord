// ==================== OVERLORD WEB SERVER ====================
// Modular architecture with plugin system
// Access at: http://localhost:3031
//
// Normally started via launcher.js (node launcher.js / npm start).
// Can also be run directly: node server.js (dotenv loaded as fallback).

try { require('dotenv').config({ override: false }); } catch (_) {}

// Early banner — printed before heavy requires so the terminal isn't silent
process.stdout.write('\n⚡ OVERLORD loading… (this may take 10–30 seconds)\n');

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');

process.stdout.write('   ✅ Core dependencies ready\n');

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

// Create app and server
const app = express();
const server = http.createServer(app);
const isHttps = false;
const io = new Server(server, {
    pingTimeout: 60000,
    pingInterval: 25000,
    // Raise buffer to 50 MB so voice-clone audio files (base64-encoded) can
    // transit over socket.io. Default is 1 MB which silently drops larger payloads.
    maxHttpBufferSize: 50 * 1024 * 1024,
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

// ==================== AUTH SYSTEM ====================
// Simple session-based auth. Enabled when AUTH_ENABLED=true or ACCESS_PASSWORD is set,
// or automatically when users.json exists (once anyone has registered).
// Set AUTH_DISABLED=true to completely bypass for local dev.

const _SESSIONS = new Map(); // token → { userId, username, role, createdAt }
const _USERS_PATH = path.join(__dirname, '.overlord', 'users.json');

function _loadUsers() {
    try { return JSON.parse(fs.readFileSync(_USERS_PATH, 'utf8')); }
    catch (e) { return []; }
}
function _saveUsers(users) {
    fs.mkdirSync(path.dirname(_USERS_PATH), { recursive: true });
    fs.writeFileSync(_USERS_PATH, JSON.stringify(users, null, 2), 'utf8');
}
function _hashPwd(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}
function _parseCookies(header) {
    if (!header) return {};
    return Object.fromEntries(header.split(';').map(c => {
        const i = c.indexOf('=');
        if (i < 0) return ['', ''];
        return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
    }).filter(([k]) => k));
}
function _getSession(req) {
    const cookies = _parseCookies(req.headers.cookie);
    const token = cookies['_ov_session'];
    if (!token) return null;
    const s = _SESSIONS.get(token);
    if (!s) return null;
    if (Date.now() - s.createdAt > 30 * 24 * 3600 * 1000) { _SESSIONS.delete(token); return null; }
    return s;
}
function _isAuthEnabled() {
    if (process.env.AUTH_DISABLED === 'true') return false;
    if (process.env.AUTH_ENABLED === 'true' || process.env.ACCESS_PASSWORD) return true;
    return _loadUsers().length > 0; // auto-enable once anyone has registered
}
function _requireAuth(req, res, next) {
    if (!_isAuthEnabled()) return next();
    if (_getSession(req)) return next();
    if (req.path && req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
    res.redirect('/login.html');
}

// ── Auth API routes (must be BEFORE static middleware) ──────────────────────
app.get('/api/auth/status', (req, res) => {
    const users = _loadUsers();
    const session = _getSession(req);
    res.json({
        enabled: _isAuthEnabled(),
        needsSetup: _isAuthEnabled() && users.length === 0 && !process.env.ACCESS_PASSWORD,
        authenticated: !!session,
        username: session ? session.username : null,
        role: session ? session.role : null
    });
});

app.post('/api/auth/register', express.json(), (req, res) => {
    if (!_isAuthEnabled()) return res.json({ success: true, disabled: true });
    const body = req.body || {};
    const username = (body.username || '').trim();
    const password = body.password || '';
    const adminCode = body.adminCode || '';
    if (!username || username.length < 2) return res.json({ success: false, error: 'Username must be at least 2 characters' });
    if (!password || password.length < 6) return res.json({ success: false, error: 'Password must be at least 6 characters' });
    const users = _loadUsers();
    if (users.length > 0) {
        if (!process.env.ACCESS_PASSWORD || adminCode !== process.env.ACCESS_PASSWORD)
            return res.json({ success: false, error: 'An admin invite code is required to register' });
    }
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase()))
        return res.json({ success: false, error: 'Username already taken' });
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = _hashPwd(password, salt);
    const user = {
        id: crypto.randomBytes(16).toString('hex'),
        username, hash, salt, createdAt: Date.now(),
        role: users.length === 0 ? 'admin' : 'user'
    };
    users.push(user);
    _saveUsers(users);
    const token = crypto.randomBytes(32).toString('hex');
    _SESSIONS.set(token, { userId: user.id, username: user.username, role: user.role, createdAt: Date.now() });
    res.setHeader('Set-Cookie', `_ov_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`);
    res.json({ success: true, username: user.username, role: user.role });
});

app.post('/api/auth/login', express.json(), (req, res) => {
    if (!_isAuthEnabled()) return res.json({ success: true, disabled: true });
    const body = req.body || {};
    const username = (body.username || '').trim();
    const password = body.password || '';
    if (!username || !password) return res.json({ success: false, error: 'Username and password required' });
    // ACCESS_PASSWORD simple-mode (no users file)
    if (process.env.ACCESS_PASSWORD) {
        const users = _loadUsers();
        if (users.length === 0) {
            if (password !== process.env.ACCESS_PASSWORD) return res.json({ success: false, error: 'Incorrect password' });
            const token = crypto.randomBytes(32).toString('hex');
            _SESSIONS.set(token, { userId: 'admin', username: username || 'admin', role: 'admin', createdAt: Date.now() });
            res.setHeader('Set-Cookie', `_ov_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`);
            return res.json({ success: true, username: username || 'admin', role: 'admin' });
        }
    }
    const users = _loadUsers();
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) return res.json({ success: false, error: 'Invalid username or password' });
    if (_hashPwd(password, user.salt) !== user.hash) return res.json({ success: false, error: 'Invalid username or password' });
    const token = crypto.randomBytes(32).toString('hex');
    _SESSIONS.set(token, { userId: user.id, username: user.username, role: user.role, createdAt: Date.now() });
    res.setHeader('Set-Cookie', `_ov_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`);
    res.json({ success: true, username: user.username, role: user.role });
});

app.post('/api/auth/logout', (req, res) => {
    const cookies = _parseCookies(req.headers.cookie);
    if (cookies['_ov_session']) _SESSIONS.delete(cookies['_ov_session']);
    res.setHeader('Set-Cookie', '_ov_session=; Path=/; HttpOnly; Max-Age=0');
    res.json({ success: true });
});

// ── Expose session helpers so hub.js / Socket.IO middleware can use them ────
app._ovGetSession = _getSession;
app._ovIsAuthEnabled = _isAuthEnabled;
app._ovParseCookies = _parseCookies;
app._ovSessions = _SESSIONS;

// ── Protected main entry point (must be before express.static) ──────────────
app.get('/', _requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Suppress favicon 404
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Serve marked.js from node_modules
app.get('/marked.js', (req, res) => {
    res.sendFile(require.resolve('marked'));
});

// Serve static files (login.html, sw.js, etc. — no auth required for these)
app.use(express.static(path.join(__dirname, 'public')));

// Serve generated images, audio, and user uploads
app.use('/generated', express.static(path.join(__dirname, '.overlord', 'generated')));
app.use('/audio',     express.static(path.join(__dirname, '.overlord', 'audio')));
app.use('/uploads',   express.static(path.join(__dirname, 'uploads')));

// Directory browser API — used by the folder picker in settings
app.get('/api/browse-dirs', _requireAuth, (req, res) => {
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
    './modules/obsidian-vault-module',
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

    // ── Socket.IO auth middleware (checks session cookie on every connection) ─
    io.use((socket, next) => {
        if (!_isAuthEnabled()) return next();
        const cookies = _parseCookies(socket.handshake.headers.cookie || '');
        const token = cookies['_ov_session'];
        const session = token ? _SESSIONS.get(token) : null;
        if (!session || Date.now() - session.createdAt > 30 * 24 * 3600 * 1000) {
            return next(new Error('Unauthorized'));
        }
        if (!socket.data) socket.data = {};
        socket.data.user = session;
        next();
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
