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
    await wait(800);
    await page.screenshot({ path: path.join(OUT, name), type: 'png' });
    console.log('  captured:', name);
}

// ── Demo chat messages ────────────────────────────────────────────────────────
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
            { role: 'assistant', text: 'Auth module complete. JWT tokens with 24 h expiry, bcrypt hashing, refresh token rotation. Now implementing CRUD routes for /tasks...' },
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

// ── Seed telemetry panel with demo data ───────────────────────────────────────
async function seedTelemetry(page) {
    await page.evaluate(() => {
        // Tiles
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('tp-user-val',   '12');
        set('tp-user-sub',   '~4.2k tokens');
        set('tp-ai-val',     '11');
        set('tp-ai-sub',     '~18k tokens');
        set('tp-agents-val', '47');
        set('tp-total-in-lbl',  '68,412');
        set('tp-total-out-lbl', '142,890');

        // Token chart — draw simple sparklines
        const inLine  = document.getElementById('tp-chart-in-line');
        const outLine = document.getElementById('tp-chart-out-line');
        const inArea  = document.getElementById('tp-chart-in-area');
        const outArea = document.getElementById('tp-chart-out-area');
        if (inLine) {
            const pts = '0,75 40,65 80,55 120,40 160,30 200,22 240,18 280,12 340,8';
            inLine.setAttribute('points', pts);
            inArea.setAttribute('d', 'M0,75 40,65 80,55 120,40 160,30 200,22 240,18 280,12 340,8 L340,80 L0,80 Z');
        }
        if (outLine) {
            const pts = '0,78 40,72 80,68 120,60 160,50 200,42 240,35 280,28 340,20';
            outLine.setAttribute('points', pts);
            outArea.setAttribute('d', 'M0,78 40,72 80,68 120,60 160,50 200,42 240,35 280,28 340,20 L340,80 L0,80 Z');
        }

        // Request timeline bars
        const timeline = document.getElementById('tp-req-timeline');
        if (timeline) {
            timeline.textContent = '';
            const reqs = [
                { dur: 1.2, label: 'scaffold project structure' },
                { dur: 3.8, label: 'implement JWT auth middleware' },
                { dur: 2.1, label: 'write CRUD routes /tasks' },
                { dur: 4.5, label: 'run npm test suite' },
                { dur: 0.9, label: 'lint check' },
            ];
            const maxDur = 5;
            reqs.forEach(r => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:5px;';
                const bar = document.createElement('div');
                const pct = Math.round((r.dur / maxDur) * 100);
                const color = r.dur < 2 ? '#3fb950' : r.dur < 4 ? '#f0883e' : '#f85149';
                bar.style.cssText = 'height:8px;border-radius:4px;background:' + color + ';opacity:0.8;';
                bar.style.width = pct + '%';
                const lbl = document.createElement('span');
                lbl.style.cssText = 'font-size:9px;color:rgba(255,255,255,0.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;';
                lbl.textContent = r.dur + 's — ' + r.label;
                row.appendChild(bar);
                row.appendChild(lbl);
                timeline.appendChild(row);
            });
        }

        // Agent comms feed
        const feed = document.getElementById('tp-bc-feed');
        if (feed) {
            feed.textContent = '';
            const msgs = [
                { from: 'PM', to: 'Backend', msg: 'Implement CRUD routes next. Use RESTful conventions.' },
                { from: 'Backend', to: 'PM', msg: 'Done. 14/14 tests passing. Moving to lint check.' },
                { from: 'PM', to: 'QA', msg: 'Run full suite — auth + CRUD combined.' },
                { from: 'QA', to: 'PM', msg: '87% coverage. 2 edge cases flagged for follow-up.' },
            ];
            msgs.forEach(m => {
                const row = document.createElement('div');
                row.style.cssText = 'padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:10px;';
                const header = document.createElement('div');
                header.style.cssText = 'color:var(--electric,#00d4ff);font-weight:600;font-family:monospace;margin-bottom:2px;';
                header.textContent = m.from + ' → ' + m.to;
                const body = document.createElement('div');
                body.style.cssText = 'color:rgba(255,255,255,0.6);';
                body.textContent = m.msg;
                row.appendChild(header);
                row.appendChild(body);
                feed.appendChild(row);
            });
        }
    });
}

// ── Seed backchannel panel ────────────────────────────────────────────────────
async function seedBackchannel(page) {
    await page.evaluate(() => {
        const feed = document.getElementById('bc-feed');
        if (!feed) return;
        feed.textContent = '';
        const msgs = [
            { from: 'PM-Orchestrator', to: 'Backend-Dev',   time: '14:31:02', text: 'Task 3 ready: implement /tasks CRUD with SQLite. Follow RESTful conventions, include pagination.' },
            { from: 'Backend-Dev',     to: 'PM-Orchestrator', time: '14:31:45', text: 'Starting implementation. Will use better-sqlite3 with prepared statements for performance.' },
            { from: 'PM-Orchestrator', to: 'QA-Engineer',   time: '14:32:10', text: 'Stand by for test run. Backend has auth + CRUD complete, 0 lint errors.' },
            { from: 'Backend-Dev',     to: 'QA-Engineer',   time: '14:33:01', text: 'src/routes/tasks.js ready. 14 unit tests in tests/tasks.test.js — run jest.' },
            { from: 'QA-Engineer',     to: 'PM-Orchestrator', time: '14:33:22', text: '14/14 passing. Coverage 87%. Edge case: empty task title returns 422, not 400. Filed #12.' },
            { from: 'PM-Orchestrator', to: 'Backend-Dev',   time: '14:33:40', text: 'Fix issue #12, then commit. Branch: feature/task-api. Tag v0.4.0 when done.' },
        ];
        msgs.forEach(m => {
            const el = document.createElement('div');
            el.style.cssText = 'padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:11px;';
            const hdr = document.createElement('div');
            hdr.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px;';
            const from = document.createElement('span');
            from.style.cssText = 'color:var(--electric,#00d4ff);font-weight:700;font-size:10px;font-family:monospace;';
            from.textContent = m.from;
            const arrow = document.createElement('span');
            arrow.style.cssText = 'color:rgba(255,255,255,0.3);font-size:10px;';
            arrow.textContent = '→';
            const to = document.createElement('span');
            to.style.cssText = 'color:var(--accent-green,#3fb950);font-weight:700;font-size:10px;font-family:monospace;';
            to.textContent = m.to;
            const ts = document.createElement('span');
            ts.style.cssText = 'color:rgba(255,255,255,0.25);font-size:9px;font-family:monospace;margin-left:auto;';
            ts.textContent = m.time;
            hdr.appendChild(from); hdr.appendChild(arrow); hdr.appendChild(to); hdr.appendChild(ts);
            const body = document.createElement('div');
            body.style.cssText = 'color:rgba(255,255,255,0.55);line-height:1.4;';
            body.textContent = m.text;
            el.appendChild(hdr); el.appendChild(body);
            feed.appendChild(el);
        });
    });
}

// ── Seed plan approval bar ────────────────────────────────────────────────────
async function showPlanApprovalBar(page) {
    await page.evaluate(() => {
        const bar = document.getElementById('plan-approval-bar');
        if (bar) {
            bar.style.display = 'flex';
            bar.style.visibility = 'visible';
            bar.style.opacity = '1';
        }
        const lbl = document.getElementById('plan-bar-label');
        if (lbl) lbl.textContent = 'Plan ready — 9 tasks';
    });
    // Also inject a plan-style conversation
    await page.evaluate(() => {
        const container = document.getElementById('chat-messages') ||
                          document.querySelector('.messages-container');
        if (!container) return;
        container.textContent = '';
        const msgs = [
            { role: 'user', text: 'Plan: Build a REST API with JWT auth, CRUD tasks, and SQLite.' },
            { role: 'assistant', isPlan: true, tasks: [
                'Scaffold Express project — package.json, .env, src/index.js',
                'Set up SQLite database — schema, migrations via better-sqlite3',
                'Implement JWT auth — register, login, refresh, /me endpoint',
                'Build /tasks CRUD — create, list, get, update, delete (with pagination)',
                'Add input validation — zod schemas for all endpoints',
                'Write unit tests — jest + supertest, 80%+ coverage target',
                'Add rate limiting — express-rate-limit on auth endpoints',
                'Set up ESLint + Prettier — enforce code style',
                'Create README — usage, endpoints, env vars, deploy guide',
            ]},
        ];
        msgs.forEach(m => {
            const wrap = document.createElement('div');
            if (m.isPlan) {
                wrap.className = 'message assistant-message';
                const bubble = document.createElement('div');
                bubble.className = 'msg-bubble ai-bubble';
                const heading = document.createElement('div');
                heading.style.cssText = 'font-size:11px;font-weight:700;color:var(--electric,#00d4ff);letter-spacing:0.06em;margin-bottom:8px;';
                heading.textContent = '🗺 PLAN — 9 tasks';
                bubble.appendChild(heading);
                m.tasks.forEach((t, i) => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;gap:8px;margin-bottom:4px;font-size:12px;color:rgba(255,255,255,0.8);';
                    const num = document.createElement('span');
                    num.style.cssText = 'color:var(--electric,#00d4ff);font-weight:700;font-family:monospace;min-width:16px;';
                    num.textContent = (i + 1) + '.';
                    const txt = document.createElement('span');
                    txt.textContent = t;
                    row.appendChild(num); row.appendChild(txt);
                    bubble.appendChild(row);
                });
                wrap.appendChild(bubble);
            } else {
                wrap.className = 'message user-message';
                const bubble = document.createElement('div');
                bubble.className = 'msg-bubble user-bubble';
                const text = document.createElement('div');
                text.className = 'msg-content';
                text.textContent = m.text;
                bubble.appendChild(text);
                wrap.appendChild(bubble);
            }
            container.appendChild(wrap);
        });
    });
}

(async () => {
    console.log('\nCapturing OVERLORD screenshots...\n');

    const browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    // ── Desktop (1440×900 @2x) ───────────────────────────────────────────────
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
    await wait(2000);

    // 01 — Clean hero state (empty chat, no panels)
    await shot(page, '01-hero.png');

    // 02 — Chat with realistic conversation
    await shot(page, '02-chat.png', injectChat);

    // 03 — PLAN mode: show plan in chat + approval bar
    await shot(page, '03-plan-mode.png', async p => {
        await showPlanApprovalBar(p);
        // Highlight PLAN button
        await p.evaluate(() => {
            const btn = document.getElementById('mode-btn-plan');
            if (btn) {
                btn.classList.add('active-auto');
                btn.style.background = 'rgba(0,212,255,0.2)';
                btn.style.borderColor = 'var(--electric,#00d4ff)';
                btn.style.color = 'var(--electric,#00d4ff)';
            }
        });
    });

    // 04 — Telemetry panel open with rich demo data
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
    await wait(1500);
    await shot(page, '04-telemetry.png', async p => {
        await injectChat(p);
        await p.evaluate(() => { if (typeof openTelemetry === 'function') openTelemetry(); });
        await wait(400);
        await seedTelemetry(p);
    });

    // 05 — Agent Comms panel with rich conversation data
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
    await wait(1500);
    await shot(page, '05-agent-comms.png', async p => {
        await injectChat(p);
        await p.evaluate(() => { if (typeof openBackchannel === 'function') openBackchannel(); });
        await wait(400);
        await seedBackchannel(p);
    });

    // 06 — Socket Inspector
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
    await wait(1500);
    await shot(page, '06-socket-inspector.png', async p => {
        await injectChat(p);
        await p.evaluate(() => { if (typeof openSocketInspector === 'function') openSocketInspector(); });
        await wait(600);
        // Seed socket inspector with some fake events so it's not empty
        await p.evaluate(() => {
            const feed = document.getElementById('si-feed');
            if (!feed) return;
            feed.textContent = '';
            const events = [
                { dir: '↑', name: 'user_input', size: '142b', ts: '14:33:01' },
                { dir: '↓', name: 'ai_stream_chunk', size: '2.1kb', ts: '14:33:01' },
                { dir: '↓', name: 'tool_call', size: '89b', ts: '14:33:02' },
                { dir: '↓', name: 'file_write_stream', size: '12kb', ts: '14:33:03' },
                { dir: '↓', name: 'ai_stream_chunk', size: '4.4kb', ts: '14:33:04' },
                { dir: '↑', name: 'update_config', size: '38b', ts: '14:33:08' },
                { dir: '↓', name: 'context_info', size: '201b', ts: '14:33:09' },
                { dir: '↓', name: 'agent_session_state', size: '117b', ts: '14:33:10' },
                { dir: '↓', name: 'backchannel_msg', size: '94b', ts: '14:33:11' },
                { dir: '↓', name: 'task_updated', size: '68b', ts: '14:33:12' },
            ];
            events.forEach(e => {
                const row = document.createElement('div');
                row.style.cssText = 'padding:4px 8px;border-bottom:1px solid rgba(255,255,255,0.04);display:flex;align-items:center;gap:8px;font-family:monospace;font-size:10px;';
                const ts = document.createElement('span');
                ts.style.cssText = 'color:rgba(255,255,255,0.25);min-width:52px;';
                ts.textContent = e.ts;
                const dir = document.createElement('span');
                dir.style.cssText = 'color:' + (e.dir === '↑' ? '#f0883e' : '#00d4ff') + ';min-width:12px;';
                dir.textContent = e.dir;
                const name = document.createElement('span');
                name.style.cssText = 'color:rgba(255,255,255,0.75);flex:1;';
                name.textContent = e.name;
                const size = document.createElement('span');
                size.style.cssText = 'color:rgba(255,255,255,0.25);';
                size.textContent = e.size;
                row.appendChild(ts); row.appendChild(dir); row.appendChild(name); row.appendChild(size);
                feed.appendChild(row);
            });
        });
    });

    // 07 — Overflow menu open
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
    await wait(1500);
    await shot(page, '07-overflow-menu.png', async p => {
        await injectChat(p);
        // Click the ⋯ button
        await p.evaluate(() => {
            const btn = document.querySelector('.toolbar-overflow-btn');
            if (btn) btn.click();
        });
        await wait(300);
    });

    // ── Mobile (390×844 @3x) ─────────────────────────────────────────────────
    const mobile = await browser.newPage();
    await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 3 });
    await mobile.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
    await wait(1500);

    // 08 — Mobile chat (CHAT tab active, messages visible)
    await shot(mobile, '08-mobile-chat.png', injectChat);

    // 09 — Mobile STATS tab (telemetry panel)
    await mobile.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
    await wait(1500);
    await shot(mobile, '09-mobile-stats.png', async p => {
        await injectChat(p);
        await p.evaluate(() => {
            // Click the STATS nav item
            const navItems = Array.from(document.querySelectorAll('.mobile-nav-item'));
            const statsBtn = navItems.find(el => el.textContent.trim().includes('STATS') || el.textContent.trim().includes('Telemetry'));
            if (statsBtn) statsBtn.click();
            else if (typeof openTelemetry === 'function') openTelemetry();
        });
        await wait(400);
        await seedTelemetry(p);
    });

    // 10 — Mobile conversation dropdown
    await mobile.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
    await wait(1500);
    await shot(mobile, '10-mobile-dropdown.png', async p => {
        await injectChat(p);
        await p.evaluate(() => {
            // Inject some fake conversations into the dropdown so it looks populated
            if (typeof toggleConversations === 'function') toggleConversations();
            const dropdown = document.getElementById('conv-dropdown');
            if (dropdown && dropdown.classList.contains('open')) {
                // Seed the dropdown with fake convs if it's empty
                const list = dropdown.querySelector('#conv-list') || dropdown;
                if (list && list.children.length < 2) {
                    const convs = [
                        { title: 'REST API + JWT Auth',    date: 'Today, 2:31 PM' },
                        { title: 'React Dashboard UI',      date: 'Today, 11:14 AM' },
                        { title: 'Python scraper project',  date: 'Yesterday, 7:48 PM' },
                        { title: 'Kubernetes deploy setup', date: 'Mon, 4:12 PM' },
                    ];
                    convs.forEach((c, i) => {
                        const item = document.createElement('div');
                        item.style.cssText = 'padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.06);cursor:pointer;';
                        item.style.background = i === 0 ? 'rgba(0,212,255,0.08)' : '';
                        const title = document.createElement('div');
                        title.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.85);font-weight:' + (i === 0 ? '700' : '400') + ';';
                        title.textContent = c.title;
                        const date = document.createElement('div');
                        date.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.3);margin-top:2px;';
                        date.textContent = c.date;
                        item.appendChild(title); item.appendChild(date);
                        list.appendChild(item);
                    });
                }
            }
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
