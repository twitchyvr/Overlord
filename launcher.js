#!/usr/bin/env node
'use strict';

// ================================================================
// OVERLORD LAUNCHER — OS-agnostic entry point
// Handles: env loading, node version check, deps install,
//          process lifecycle, prerequisite detection, browser open.
// Then spawns server.js using the same Node binary that ran this.
// ================================================================

const path         = require('path');
const fs           = require('fs');
const net          = require('net');
const os           = require('os');
const { spawn, spawnSync, execFileSync } = require('child_process');

const ROOT = __dirname;

// ── 1. Load .env ─────────────────────────────────────────────────
// Parsed manually first (dotenv may not be installed yet).
// If dotenv is available it will overwrite with its richer parser.
function loadEnv() {
    const envFile = path.join(ROOT, '.env');
    if (!fs.existsSync(envFile)) return;

    // Minimal parser (no dotenv required at this stage)
    try {
        const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
        for (const raw of lines) {
            const line = raw.trim();
            if (!line || line.startsWith('#')) continue;
            const eq = line.indexOf('=');
            if (eq < 1) continue;
            const key = line.slice(0, eq).trim();
            let val   = line.slice(eq + 1).trim();
            // QUAL-005: Minimal parser - handles basic KEY=VALUE and "KEY=VALUE" only
            // Does not support: comments (#), multiline values, variable expansion,
            // escaped characters, or advanced dotenv features
            if (/^["'].*["']$/.test(val)) val = val.slice(1, -1);
            if (!(key in process.env)) process.env[key] = val;
        }
    } catch (_) {}

    // Re-apply with dotenv once deps are installed (richer parser)
    try {
        require('dotenv').config({ path: envFile, override: false });
    } catch (_) {}
}

// ── 2. Node version guard ─────────────────────────────────────────
function checkNode() {
    const major = parseInt(process.versions.node.split('.')[0], 10);
    if (major < 18) {
        console.error(
            `\n❌  Node.js 18 or higher is required (you have ${process.version}).\n` +
            `    Download: https://nodejs.org/\n`
        );
        process.exit(1);
    }
}

// ── 3. Ensure npm deps ────────────────────────────────────────────
function ensureDeps() {
    // Quick check: if express is installed, assume everything is.
    if (fs.existsSync(path.join(ROOT, 'node_modules', 'express'))) return;

    console.log('\n📦  node_modules missing — running npm install…\n');
    const npm    = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(npm, ['install'], { cwd: ROOT, stdio: 'inherit' });
    if (result.status !== 0) {
        console.error('\n❌  npm install failed. Install Node.js/npm and try again.\n');
        process.exit(1);
    }
    console.log('');
}

// ── 4. PID management (single-instance) ──────────────────────────
const PID_FILE = path.join(ROOT, '.overlord', 'server.pid');

function readPID() {
    try {
        const v = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
        return isNaN(v) ? null : v;
    } catch (_) { return null; }
}

function writePID(pid) {
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    fs.writeFileSync(PID_FILE, String(pid));
}

function removePID() {
    try { fs.unlinkSync(PID_FILE); } catch (_) {}
}

function isRunning(pid) {
    try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

async function stopExisting() {
    const old = readPID();
    if (!old || old === process.pid || !isRunning(old)) { removePID(); return; }

    console.log(`[Launcher] Stopping previous instance (PID ${old})…`);
    try {
        process.kill(old, 'SIGTERM');
        let waited = 0;
        while (waited < 8000 && isRunning(old)) { await sleep(200); waited += 200; }
        if (isRunning(old)) { process.kill(old, 'SIGKILL'); await sleep(300); }
        console.log('[Launcher] Previous instance stopped.\n');
    } catch (e) {
        console.log(`[Launcher] Could not stop previous instance: ${e.message}`);
    }
    removePID();
}

// ── 5. Find uvx (OS-agnostic) ─────────────────────────────────────
function findUvx() {
    const home  = os.homedir();
    const isWin = process.platform === 'win32';
    const bin   = isWin ? 'uvx.exe' : 'uvx';
    const sep   = isWin ? ';' : ':';

    const candidates = isWin
        ? [
            path.join(home, '.local',  'bin', bin),
            path.join(home, 'AppData', 'Roaming', 'uv', 'bin', bin),
            path.join(home, 'AppData', 'Local',   'uv', 'bin', bin),
            path.join(home, '.cargo',  'bin', bin),
            'C:\\Program Files\\uv\\bin\\' + bin,
          ]
        : [
            '/usr/local/bin/uvx',
            path.join(home, '.local', 'bin', 'uvx'),
            path.join(home, '.cargo', 'bin', 'uvx'),
            '/opt/homebrew/bin/uvx',
            '/usr/bin/uvx',
            path.join(home, '.uv', 'bin', 'uvx'),
          ];

    for (const dir of (process.env.PATH || '').split(sep)) {
        candidates.push(path.join(dir, bin));
    }

    for (const p of candidates) {
        try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch (_) {}
    }

    // Last resort: `where` (Windows) / `which` (Unix)
    try {
        const whichCmd = isWin ? 'where' : 'which';
        const r = execFileSync(whichCmd, [bin], { encoding: 'utf8', timeout: 2000 })
            .trim().split('\n')[0].trim();
        if (r && fs.existsSync(r)) return r;
    } catch (_) {}

    return null;
}

// ── 6. Prerequisite checks ────────────────────────────────────────
async function checkPrerequisites() {
    console.log('🔍  Checking prerequisites…\n');
    const results = {};

    // API key
    const apiKey = (
        process.env.ANTHROPIC_AUTH_TOKEN ||
        process.env.API_KEY              ||
        process.env.MINIMAX_API_KEY      || ''
    ).trim();
    results.apiKey = apiKey.length > 10;
    console.log(`   ${results.apiKey ? '✅' : '❌'} API key: ${results.apiKey ? 'Loaded' : 'MISSING — set MINIMAX_API_KEY in .env'}`);

    // uvx
    const uvxPath = findUvx();
    results.uvx     = !!uvxPath;
    results.uvxPath = uvxPath || null;
    console.log(`   ${results.uvx ? '✅' : '⚠️ '} uvx: ${uvxPath || 'Not found — https://docs.astral.sh/uv/'}`);

    results.minimaxMcp = results.uvx;
    console.log(`   ${results.uvx ? '✅' : '⚠️ '} minimax-coding-plan-mcp: ${results.uvx ? 'Available (installs on first use)' : 'Requires uvx'}`);

    // Ensure output directories exist
    for (const d of [
        path.join(ROOT, '.overlord', 'generated'),
        path.join(ROOT, '.overlord', 'audio'),
        path.join(ROOT, 'uploads'),
    ]) { fs.mkdirSync(d, { recursive: true }); }

    // Write prereqs.json — read by mcp-module and others at startup
    fs.writeFileSync(
        path.join(ROOT, '.overlord', 'prereqs.json'),
        JSON.stringify({ ...results, checkedAt: Date.now() }, null, 2)
    );

    console.log('');
    return results;
}

// ── 7. Open browser (OS-agnostic) ─────────────────────────────────
function openBrowser(url) {
    try {
        const p = process.platform;
        if (p === 'darwin') {
            spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
        } else if (p === 'win32') {
            // 'start' is a cmd built-in, not an executable
            spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
        } else {
            // Linux, FreeBSD, WSL, etc.
            spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
        }
    } catch (_) {
        // Non-fatal — user can open manually (URL printed in server banner)
    }
}

// ── 8. Poll until TCP port accepts connections ─────────────────────
function waitForPort(port, timeoutMs = 20000) {
    return new Promise(resolve => {
        const deadline = Date.now() + timeoutMs;
        (function attempt() {
            const s = net.createConnection(port, '127.0.0.1');
            s.once('connect', () => { s.destroy(); resolve(true); });
            s.once('error',   () => {
                if (Date.now() < deadline) setTimeout(attempt, 250);
                else resolve(false);
            });
        }());
    });
}

// ── Helpers ──────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────
async function main() {
    loadEnv();
    checkNode();
    ensureDeps();

    // Ensure .overlord dir exists before any PID/prereq work
    fs.mkdirSync(path.join(ROOT, '.overlord'), { recursive: true });

    await stopExisting();
    await checkPrerequisites();

    const PORT = parseInt(process.env.PORT || '3031', 10);

    // Spawn server.js with the SAME Node binary that ran this script.
    // process.execPath resolves correctly on every OS/nvm/fnm setup.
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
        cwd:   ROOT,
        env:   process.env,    // inherits dotenv-enriched environment
        stdio: 'inherit',      // server stdout/stderr flows straight to terminal
    });

    writePID(child.pid);

    // Relay termination signals to the child so it can shut down gracefully
    const relay = sig => () => { try { child.kill(sig); } catch (_) {} };
    process.on('SIGTERM', relay('SIGTERM'));
    process.on('SIGINT',  relay('SIGTERM'));  // Ctrl+C → graceful shutdown
    if (process.platform !== 'win32') {
        process.on('SIGHUP', relay('SIGHUP'));
    }

    child.on('exit', (code, signal) => {
        removePID();
        process.exit(code ?? (signal ? 1 : 0));
    });

    // Wait for the server port, then open the browser automatically
    waitForPort(PORT).then(ok => { if (ok) openBrowser(`http://localhost:${PORT}`); });
}

main().catch(e => {
    console.error('\n❌  Launcher error:', e.message || e, '\n');
    process.exit(1);
});
