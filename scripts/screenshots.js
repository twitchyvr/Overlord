#!/usr/bin/env node
'use strict';
// Capture README screenshots using puppeteer-core + local Chrome

const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE   = 'http://localhost:3031';
const OUT    = path.join(__dirname, '..', 'docs', 'screenshots');

fs.mkdirSync(OUT, { recursive: true });

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function shot(page, name, setupFn) {
    if (setupFn) await setupFn(page);
    await wait(700);
    await page.screenshot({ path: path.join(OUT, name), type: 'png' });
    console.log('  captured:', name);
}

// Inject fake conversation messages via DOM methods (no innerHTML)
async function injectChat(page) {
    await page.evaluate(() => {
        const container = document.getElementById('chat-messages') ||
                          document.querySelector('.messages-container') ||
                          document.querySelector('[id*="messages"]');
        if (!container) return;

        const messages = [
            { role: 'user', text: 'Build a REST API for a task manager with JWT auth, CRUD for tasks, and SQLite storage.' },
            { role: 'assistant', text: 'Understood. I\'ll scaffold the project, wire up JWT auth, implement CRUD routes, and configure SQLite via better-sqlite3. Starting with the project structure...' },
            { role: 'tool', name: 'read_file', detail: 'package.json → name, version, dependencies' },
            { role: 'tool', name: 'write_file', detail: 'src/server.js written (247 lines)' },
            { role: 'tool', name: 'write_file', detail: 'src/db.js written (89 lines) — schema + migrations' },
            { role: 'assistant', text: 'Auth module complete. JWT tokens with 24h expiry, bcrypt hashing, refresh token rotation. Now implementing CRUD routes for /tasks...' },
            { role: 'tool', name: 'bash', detail: 'npm test → 14/14 auth tests passing, 87% coverage' },
            { role: 'assistant', text: 'All tests passing. Running lint check before committing...' },
        ];

        container.textContent = '';

        messages.forEach(m => {
            const wrap = document.createElement('div');
            wrap.className = m.role === 'user' ? 'message user-message' : m.role === 'assistant' ? 'message assistant-message' : 'message tool-message';

            const bubble = document.createElement('div');
            bubble.className = m.role === 'user' ? 'msg-bubble user-bubble' : m.role === 'assistant' ? 'msg-bubble ai-bubble' : 'msg-bubble tool-bubble';

            if (m.role === 'tool') {
                const nameEl = document.createElement('span');
                nameEl.style.cssText = 'color:#00b4ff;font-weight:600;font-size:12px;font-family:monospace';
                nameEl.textContent = '▶ ' + m.name;
                const detail = document.createElement('div');
                detail.style.cssText = 'color:rgba(255,255,255,0.5);font-size:11px;font-family:monospace;margin-top:3px';
                detail.textContent = m.detail;
                bubble.appendChild(nameEl);
                bubble.appendChild(detail);
            } else {
                const text = document.createElement('div');
                text.className = 'msg-content';
                text.textContent = m.text;
                bubble.appendChild(text);
            }

            wrap.appendChild(bubble);
            container.appendChild(wrap);
        });

        container.scrollTop = container.scrollHeight;
    });
}

(async () => {
    console.log('\nCapturing OVERLORD screenshots...\n');

    const browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    // ── Desktop screenshots (1440×900 @2x) ─────────────────────────
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
    await wait(2000);

    // 01 — Clean hero/landing state
    await shot(page, '01-hero.png');

    // 02 — Chat with messages in flight
    await shot(page, '02-chat.png', injectChat);

    // 03 — Plan mode (click PLAN button)
    await shot(page, '03-plan-mode.png', async p => {
        await injectChat(p);
        await p.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const planBtn = btns.find(b => b.textContent.trim() === 'PLAN');
            if (planBtn) planBtn.click();
        });
        await wait(400);
    });

    // 04 — Telemetry panel open
    await shot(page, '04-telemetry.png', async p => {
        await injectChat(p);
        await p.evaluate(() => {
            if (typeof openTelemetry === 'function') openTelemetry();
        });
    });

    // 05 — Backchannel / Agent Comms panel
    await shot(page, '05-agent-comms.png', async p => {
        await injectChat(p);
        await p.evaluate(() => {
            if (typeof openBackchannel === 'function') openBackchannel();
        });
    });

    // 06 — Socket inspector
    await shot(page, '06-socket-inspector.png', async p => {
        await injectChat(p);
        await p.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button,.toolbar-overflow-item'));
            const inspector = btns.find(b => b.textContent.includes('Socket'));
            if (inspector) inspector.click();
        });
    });

    // 07 — Overflow menu open (shows all tools)
    await shot(page, '07-overflow-menu.png', async p => {
        await injectChat(p);
        await p.evaluate(() => {
            const btn = document.querySelector('.toolbar-overflow-btn');
            if (btn) btn.click();
        });
        await wait(300);
    });

    // ── Mobile (390×844 @3x) ───────────────────────────────────────
    const mobile = await browser.newPage();
    await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 3 });
    await mobile.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
    await wait(1500);

    // 08 — Mobile chat
    await shot(mobile, '08-mobile-chat.png', injectChat);

    // 09 — Mobile STATS tab
    await shot(mobile, '09-mobile-stats.png', async p => {
        await injectChat(p);
        await p.evaluate(() => {
            if (typeof openTelemetry === 'function') openTelemetry();
        });
    });

    // 10 — Mobile conv dropdown
    await shot(mobile, '10-mobile-dropdown.png', async p => {
        await injectChat(p);
        await p.evaluate(() => {
            if (typeof toggleConversations === 'function') toggleConversations();
        });
        await wait(300);
    });

    await mobile.close();
    await browser.close();

    const files = fs.readdirSync(OUT).filter(f => f.endsWith('.png'));
    console.log('\nDone!', files.length, 'screenshots saved to docs/screenshots/');
    files.forEach(f => {
        const kb = Math.round(fs.statSync(path.join(OUT, f)).size / 1024);
        console.log(' ', f, `(${kb} KB)`);
    });
    console.log('');
})().catch(e => { console.error('Screenshot error:', e.message); process.exit(1); });
