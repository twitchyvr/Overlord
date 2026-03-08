/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Orchestration Manager Panel
   ═══════════════════════════════════════════════════════════════════
   Full-featured orchestration manager ported from monolith:
   renderOrchDashboard(), renderOrchPipeline(), renderOrchStrategy(),
   renderOrchFleet(), renderOrchTimeline(), renderOrchConfig(),
   renderRecommendations()

   Features:
     - Pipeline status gauge with cycle + context progress bars
     - Perception readout (chain depth, hot-inject, active agents)
     - Strategy selector (Auto / Supervised / Autonomous)
     - Overlay controls (Planning / PM / None)
     - Agent fleet with pause/resume/kill per agent
     - Max Parallel Agents slider
     - Execution timeline with tool history + tier badges
     - Config: Max Cycles slider, Auto QA toggle, AI Summarization toggle
     - Approval & QA stats, session notes count
     - Collapsible sections
     - Task recommendation cards with approve/reject

   Socket emits:
     set_strategy, set_overlay, set_max_cycles, set_max_agents,
     set_auto_qa, set_ai_summarization, pause_agent, resume_agent,
     kill_agent, clear_tool_history, approve_recommendation,
     reject_recommendation, get_orch_dashboard

   Dependencies: engine.js, components/panel.js
   ═══════════════════════════════════════════════════════════════════ */

import { OverlordUI, h } from '../engine.js';
import { PanelComponent } from '../components/panel.js';


export class OrchestrationPanel extends PanelComponent {

    constructor(el, opts = {}) {
        super(el, opts);
        this._state = {};             // orchestrator_dashboard state
        this._orchFrontState = {};     // orchestration_state (status bar hints)
        this._socket = opts.socket;
    }

    mount() {
        super.mount();

        // ── Subscribe to dashboard state (primary data feed) ──
        if (OverlordUI._store) {
            this.subscribe(OverlordUI._store, 'orchestration.dashboard', (state) => {
                if (state) {
                    this._state = state;
                    this._renderAll();
                }
            });

            // Also listen for orchestration_state (lighter updates for status dot)
            this.subscribe(OverlordUI._store, 'orchestration.state', (state) => {
                if (state) {
                    this._orchFrontState = state;
                    this._updateStatusDot();
                }
            });

            // Recommendations
            this.subscribe(OverlordUI._store, 'orchestration.recommendations', (recs) => {
                this._renderRecommendations(recs || []);
            });
        }

        // ── Collapsible sections via event delegation ──
        this.on('click', '.orch-section-header', (e, header) => {
            const body = header.nextElementSibling;
            if (body) {
                body.classList.toggle('collapsed');
                const arrow = header.querySelector('.orch-section-arrow');
                if (arrow) arrow.textContent = body.classList.contains('collapsed') ? '▸' : '▾';
            }
        });

        // ── Request initial dashboard state ──
        if (this._socket) {
            this._socket.emit('get_orch_dashboard', {}, (state) => {
                if (state) {
                    this._state = state;
                    if (OverlordUI._store) {
                        OverlordUI._store.set('orchestration.dashboard', state);
                    }
                    this._renderAll();
                }
            });
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  RENDER ALL SECTIONS
    // ══════════════════════════════════════════════════════════════

    _renderAll() {
        this._renderPipeline();
        this._renderStrategy();
        this._renderFleet();
        this._renderTimeline();
        this._renderConfig();
        this._updateStatusDot();

        // Re-render recommendations if we have them
        const recs = OverlordUI._store?.peek('orchestration.recommendations', []);
        if (recs?.length) this._renderRecommendations(recs);
    }

    _updateStatusDot() {
        const dot = document.getElementById('orch-status-dot');
        if (dot) {
            const status = this._state.status || this._orchFrontState.status || 'idle';
            dot.className = 'orch-status-dot ' + status;
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  SECTION 1: PIPELINE + PERCEPTION
    // ══════════════════════════════════════════════════════════════

    _renderPipeline() {
        const s = this._state;

        // ── Status label ──
        const statusEl = document.getElementById('orch-pipeline-status');
        if (statusEl) {
            const statusLabel = (s.status || 'idle').toUpperCase().replace(/_/g, ' ');
            const frag = document.createDocumentFragment();

            const row = h('div', { style: 'font-size:11px;color:var(--text-primary);margin-bottom:6px;' });
            row.appendChild(h('strong', null, 'Status: '));
            row.appendChild(document.createTextNode(statusLabel));
            if (s.agent) {
                row.appendChild(document.createTextNode(' — '));
                row.appendChild(h('span', { style: 'color:var(--electric);' }, s.agent));
            }
            if (s.tool) {
                row.appendChild(document.createTextNode(' → '));
                row.appendChild(h('span', { style: 'color:var(--accent-cyan);' }, s.tool));
            }
            frag.appendChild(row);
            statusEl.textContent = '';
            statusEl.appendChild(frag);

            // ── Perception readout (appended after status) ──
            this._renderPerception(statusEl.parentNode);
        }

        // ── Cycle gauge ──
        const cycleEl = document.getElementById('orch-cycle-gauge');
        if (cycleEl) {
            const maxC = s.maxCycles || 10;
            const isUnlimited = maxC === 0 || maxC === Infinity || maxC > 99999;
            const pct = isUnlimited ? Math.min(100, (s.cycleDepth || 0)) : Math.min(100, Math.round(((s.cycleDepth || 0) / maxC) * 100));
            const fill = (!isUnlimited && pct > 80) ? '#ef4444' : 'var(--accent-cyan)';
            const label = isUnlimited ? `${s.cycleDepth || 0}/∞` : `${s.cycleDepth || 0}/${maxC}`;

            cycleEl.textContent = '';
            cycleEl.appendChild(h('div', { class: 'orch-gauge-label' },
                h('span', null, 'Cycles'),
                h('span', null, label)
            ));
            cycleEl.appendChild(h('div', { class: 'orch-gauge' },
                h('div', { class: 'orch-gauge-fill', style: `width:${isUnlimited ? 5 : pct}%;background:${fill};` })
            ));
        }

        // ── Context gauge ──
        const ctxEl = document.getElementById('orch-context-gauge');
        if (ctxEl && s.contextUsage) {
            const pct = Math.round(s.contextUsage.percent || s.contextUsage.percentUsed || 0);
            const fill = pct > 85 ? '#ef4444' : pct > 60 ? '#f7931e' : 'var(--accent-cyan)';

            ctxEl.textContent = '';
            ctxEl.appendChild(h('div', { class: 'orch-gauge-label' },
                h('span', null, 'Context'),
                h('span', null, `${pct}%`)
            ));
            ctxEl.appendChild(h('div', { class: 'orch-gauge' },
                h('div', { class: 'orch-gauge-fill', style: `width:${pct}%;background:${fill};` })
            ));
        } else if (ctxEl) {
            ctxEl.textContent = '';
        }
    }

    _renderPerception(parentEl) {
        if (!parentEl) return;
        const p = this._state.lastPerception;

        // Remove any existing perception readout
        let percEl = document.getElementById('orch-perception-readout');

        if (!p) {
            if (percEl) percEl.remove();
            return;
        }

        if (!percEl) {
            percEl = h('div', { id: 'orch-perception-readout' });
            parentEl.appendChild(percEl);
        }

        const frag = document.createDocumentFragment();
        const wrap = h('div', {
            style: 'font-size:9px;color:var(--text-muted);margin-top:6px;border-top:1px solid var(--border);padding-top:4px;'
        });

        wrap.appendChild(h('div', null,
            `Chain depth: ${p.agentChainDepth || 0} | Hot-inject: ${p.hotInjectPending || 0}`
        ));

        const stratLine = h('div', null, 'Strategy: ');
        stratLine.appendChild(h('strong', { style: 'color:var(--accent-cyan);' }, p.strategy || 'auto'));
        if (p.overlay) {
            stratLine.appendChild(document.createTextNode(' + '));
            stratLine.appendChild(h('em', { style: 'color:var(--accent-orange,#f7931e);' }, p.overlay));
            stratLine.appendChild(document.createTextNode(' overlay'));
        }
        wrap.appendChild(stratLine);

        if (p.activeAgents?.length) {
            wrap.appendChild(h('div', null, 'Active: ' + p.activeAgents.map(a => a.name).join(', ')));
        }

        frag.appendChild(wrap);
        percEl.textContent = '';
        percEl.appendChild(frag);
    }

    // ══════════════════════════════════════════════════════════════
    //  SECTION 2: STRATEGY + OVERLAY
    // ══════════════════════════════════════════════════════════════

    _renderStrategy() {
        const s = this._state;

        // ── Strategy selector ──
        const el = document.getElementById('orch-strategy-selector');
        if (el) {
            const current = s.strategy || 'auto';
            const strategies = [
                { id: 'auto',       label: 'Auto',       desc: 'AI chooses approval level' },
                { id: 'supervised', label: 'Supervised',  desc: 'Approve tier 3-4 tools' },
                { id: 'autonomous', label: 'Autonomous',  desc: 'Skip all approval gates' }
            ];

            const group = h('div', { class: 'orch-strategy-group' });
            for (const strat of strategies) {
                const btn = h('button', {
                    class: `orch-strategy-btn${current === strat.id ? ' active' : ''}`,
                    title: strat.desc
                }, strat.label);
                btn.addEventListener('click', () => this._emitStrategy(strat.id));
                group.appendChild(btn);
            }

            el.textContent = '';
            el.appendChild(group);
        }

        // ── Overlay controls ──
        const overlayEl = document.getElementById('orch-overlay-controls');
        if (overlayEl) {
            const overlay = s.activeOverlay;

            const frag = document.createDocumentFragment();
            frag.appendChild(h('div', {
                style: 'font-size:10px;color:var(--text-muted);margin:8px 0 4px 0;'
            }, 'Active Overlay'));

            const btnGroup = h('div', { style: 'display:flex;gap:4px;' });

            const overlays = [
                { id: 'planning', label: 'Planning' },
                { id: 'pm',       label: 'PM' },
                { id: null,        label: 'None' }
            ];
            for (const ov of overlays) {
                const isActive = ov.id === overlay || (ov.id === null && !overlay);
                const btn = h('button', {
                    class: `orch-strategy-btn${isActive ? ' active' : ''}`,
                    style: 'flex:1;'
                }, ov.label);
                btn.addEventListener('click', () => this._emitOverlay(ov.id));
                btnGroup.appendChild(btn);
            }
            frag.appendChild(btnGroup);

            if (overlay) {
                frag.appendChild(h('div', {
                    style: 'font-size:9px;color:var(--text-muted);margin-top:4px;'
                }, 'Auto-reverts when task completes'));
            }

            overlayEl.textContent = '';
            overlayEl.appendChild(frag);
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  SECTION 3: AGENT FLEET + MAX PARALLEL SLIDER
    // ══════════════════════════════════════════════════════════════

    _renderFleet() {
        const s = this._state;
        const agents = s.activeAgents || [];

        // ── Agent list ──
        const el = document.getElementById('orch-agent-list');
        if (el) {
            if (agents.length === 0) {
                el.textContent = '';
                el.appendChild(h('div', {
                    style: 'font-size:10px;color:var(--text-muted);padding:4px 0;'
                }, 'No active agents'));
            } else {
                const frag = document.createDocumentFragment();
                for (const a of agents) {
                    frag.appendChild(this._buildFleetAgentCard(a));
                }
                el.textContent = '';
                el.appendChild(frag);
            }
        }

        // ── Max Parallel slider ──
        const sliderEl = document.getElementById('orch-parallel-slider');
        if (sliderEl) {
            const maxP = s.maxParallelAgents || 3;
            const row = h('div', { class: 'orch-slider-row' });
            row.appendChild(h('label', null, 'Max Parallel'));

            const slider = h('input', {
                type: 'range',
                min: '1',
                max: '8',
                value: String(maxP)
            });
            const valueLabel = h('span', { class: 'slider-value' }, String(maxP));

            slider.addEventListener('input', () => {
                valueLabel.textContent = slider.value;
                this._emitMaxAgents(parseInt(slider.value, 10));
            });

            row.appendChild(slider);
            row.appendChild(valueLabel);

            sliderEl.textContent = '';
            sliderEl.appendChild(row);
        }
    }

    _buildFleetAgentCard(a) {
        const statusColor = a.status === 'running' ? '#22c55e' :
                            a.status === 'paused'  ? '#eab308' : 'var(--text-muted)';
        const taskText = a.task ? a.task.substring(0, 30) : 'idle';

        const card = h('div', { class: 'orch-agent-card' });

        // Status dot
        card.appendChild(h('div', { class: 'agent-status', style: `background:${statusColor};` }));

        // Name + persistent context badge
        const nameEl = h('div', { class: 'agent-name' }, a.name || 'Agent');
        if (a.hasPersistentContext) {
            nameEl.appendChild(h('span', {
                title: 'Has persistent context from session notes',
                style: 'margin-left:3px;'
            }, '📝'));
        }
        card.appendChild(nameEl);

        // Task snippet
        card.appendChild(h('div', {
            style: 'font-size:9px;color:var(--text-muted);'
        }, taskText));

        // Action buttons
        const actions = h('div', { class: 'agent-actions' });

        if (a.status === 'running') {
            const pauseBtn = h('button', { title: 'Pause' }, '⏸');
            pauseBtn.addEventListener('click', () => this._emitPauseAgent(a.name));
            actions.appendChild(pauseBtn);
        } else {
            const resumeBtn = h('button', { title: 'Resume' }, '▶');
            resumeBtn.addEventListener('click', () => this._emitResumeAgent(a.name));
            actions.appendChild(resumeBtn);
        }

        const killBtn = h('button', { title: 'Stop', style: 'color:#ef4444;' }, '✕');
        killBtn.addEventListener('click', () => this._emitKillAgent(a.name));
        actions.appendChild(killBtn);

        card.appendChild(actions);
        return card;
    }

    // ══════════════════════════════════════════════════════════════
    //  SECTION 4: EXECUTION TIMELINE
    // ══════════════════════════════════════════════════════════════

    _renderTimeline() {
        const el = document.getElementById('orch-tool-timeline');
        if (!el) return;

        const history = (this._state.toolHistory || []).slice(-20).reverse();

        if (history.length === 0) {
            el.textContent = '';
            el.appendChild(h('div', {
                style: 'font-size:10px;color:var(--text-muted);padding:4px 0;'
            }, 'No tools executed yet'));
            return;
        }

        const frag = document.createDocumentFragment();
        for (const t of history) {
            const dur = t.duration ? (t.duration / 1000).toFixed(1) + 's' : '...';
            const entry = h('div', { class: `orch-tool-entry ${t.status || 'success'}` });

            // Tool name
            entry.appendChild(h('span', { class: 'tool-name' }, t.name || '?'));

            // Tier badge
            if (t.tier) {
                const tierColors = { 1: '#22c55e', 2: '#06b6d4', 3: '#f7931e', 4: '#ef4444' };
                entry.appendChild(h('span', {
                    style: `font-size:8px;padding:1px 4px;border-radius:3px;background:${tierColors[t.tier] || '#6b7280'};color:#000;margin-left:4px;font-weight:600;`
                }, `T${t.tier}`));
            }

            // Agent name
            if (t.agent) {
                entry.appendChild(h('span', {
                    style: 'color:var(--text-muted);font-size:9px;margin-left:4px;'
                }, t.agent));
            }

            // Duration
            entry.appendChild(h('span', { class: 'tool-duration' }, dur));

            frag.appendChild(entry);
        }

        el.textContent = '';
        el.appendChild(frag);
    }

    // ══════════════════════════════════════════════════════════════
    //  SECTION 5: CONFIGURATION
    // ══════════════════════════════════════════════════════════════

    _renderConfig() {
        const el = document.getElementById('orch-config-controls');
        if (!el) return;

        const s = this._state;
        const maxC = s.maxCycles || 10;
        const isUnlimited = maxC === 0 || maxC > 99999;

        // ── In-place update guard ─────────────────────────────────────────────
        // _renderConfig() is called on every state update. Rebuilding the DOM
        // each time destroys event listeners attached to cycleSlider / unlimCb.
        // Instead, if the elements already exist, update their values in-place
        // and return early — preserving all listeners.
        const existingSlider = el.querySelector('.orch-cycle-slider');
        if (existingSlider) {
            const existingCb    = el.querySelector('.orch-unlimited-cb');
            const existingValue = el.querySelector('.slider-value');
            existingSlider.disabled = isUnlimited;
            if (!isUnlimited) existingSlider.value = String(maxC);
            if (existingValue) existingValue.textContent = isUnlimited ? '∞' : String(maxC);
            if (existingCb)    existingCb.checked = isUnlimited;
            // Update toggle rows (Auto QA, AI Context Summarization)
            const toggles = el.querySelectorAll('.panel-config-toggle');
            if (toggles[0]) toggles[0].classList.toggle('on', s.autoQA !== false);
            if (toggles[2]) toggles[2].classList.toggle('on', s.aiSummarization !== false);
            // Update stats
            const gauges = el.querySelectorAll('.orch-gauge-label span:last-child');
            if (gauges[0]) gauges[0].textContent = `${s.autoApprovedCount || 0} auto / ${s.humanApprovedCount || 0} manual`;
            if (gauges[1]) gauges[1].textContent = `${s.qaPassCount || 0} pass / ${s.qaFailCount || 0} fail`;
            if (gauges[2]) gauges[2].textContent = `${s.sessionNotesCount || 0} saved`;
            return;
        }

        const frag = document.createDocumentFragment();

        // ── Max Cycles slider ──
        const cycleRow = h('div', { class: 'orch-slider-row' });
        cycleRow.appendChild(h('label', null, 'Max Cycles'));
        const cycleSlider = h('input', {
            class: 'orch-cycle-slider',
            type: 'range', min: '1', max: '100', value: String(isUnlimited ? 100 : maxC)
        });
        if (isUnlimited) cycleSlider.disabled = true;
        const cycleValue = h('span', { class: 'slider-value' }, isUnlimited ? '∞' : String(maxC));
        cycleSlider.addEventListener('input', () => {
            cycleValue.textContent = cycleSlider.value;
            this._emitMaxCycles(parseInt(cycleSlider.value, 10));
        });
        cycleRow.appendChild(cycleSlider);
        cycleRow.appendChild(cycleValue);

        // ── Unlimited checkbox ──
        const unlimLabel = h('label', { style: 'display:flex;align-items:center;gap:4px;font-size:10px;color:var(--text-muted);margin-left:8px;cursor:pointer;' });
        const unlimCb = h('input', { class: 'orch-unlimited-cb', type: 'checkbox' });
        if (isUnlimited) unlimCb.checked = true;
        unlimCb.addEventListener('change', () => {
            if (unlimCb.checked) {
                cycleSlider.disabled = true;
                cycleValue.textContent = '∞';
                this._emitMaxCycles(0); // 0 = unlimited
            } else {
                cycleSlider.disabled = false;
                const v = parseInt(cycleSlider.value, 10) || 10;
                cycleValue.textContent = String(v);
                this._emitMaxCycles(v);
            }
        });
        unlimLabel.appendChild(unlimCb);
        unlimLabel.appendChild(document.createTextNode('Unlimited'));
        cycleRow.appendChild(unlimLabel);
        frag.appendChild(cycleRow);

        // ── Auto QA toggle ──
        frag.appendChild(this._buildToggleRow('Auto QA (lint/types)', s.autoQA !== false, () => {
            this._emitToggleAutoQA();
        }));

        // ── Orchestrator Guardrails (display-only, always on) ──
        frag.appendChild(this._buildToggleRow(
            'Orchestrator Guardrails',
            true,
            null,
            'Prevents orchestrator from using implementation tools directly'
        ));

        // ── AI Context Summarization toggle ──
        frag.appendChild(this._buildToggleRow(
            'AI Context Summarization',
            s.aiSummarization !== false,
            () => this._emitToggleAISummarization(),
            'Use AI to summarize old context instead of mechanical truncation'
        ));

        // ── Stats ──
        const stats = h('div', { style: 'margin-top:8px;' });
        stats.appendChild(h('div', { class: 'orch-gauge-label' },
            h('span', null, 'Approvals'),
            h('span', null, `${s.autoApprovedCount || 0} auto / ${s.humanApprovedCount || 0} manual`)
        ));
        stats.appendChild(h('div', { class: 'orch-gauge-label' },
            h('span', null, 'QA'),
            h('span', null, `${s.qaPassCount || 0} pass / ${s.qaFailCount || 0} fail`)
        ));
        stats.appendChild(h('div', { class: 'orch-gauge-label' },
            h('span', null, 'Session Notes'),
            h('span', null, `${s.sessionNotesCount || 0} saved`)
        ));
        frag.appendChild(stats);

        // ── Clear Timeline button ──
        const clearRow = h('div', { style: 'margin-top:6px;text-align:right;' });
        const clearBtn = h('button', {
            style: 'font-size:9px;padding:2px 8px;background:var(--bg-input);border:1px solid var(--border);border-radius:4px;color:var(--text-muted);cursor:pointer;'
        }, 'Clear Timeline');
        clearBtn.addEventListener('click', () => {
            if (this._socket) this._socket.emit('clear_tool_history');
        });
        clearRow.appendChild(clearBtn);
        frag.appendChild(clearRow);

        el.textContent = '';
        el.appendChild(frag);
    }

    _buildToggleRow(label, isOn, onClick, title) {
        const row = h('div', { class: 'orch-toggle-row' });
        row.appendChild(h('span', null, label));

        const toggle = h('div', {
            class: `panel-config-toggle${isOn ? ' on' : ''}`,
            style: onClick ? 'cursor:pointer;' : ''
        });
        if (title) toggle.title = title;
        if (onClick) {
            toggle.addEventListener('click', onClick);
        }
        row.appendChild(toggle);
        return row;
    }

    // ══════════════════════════════════════════════════════════════
    //  SECTION 6: RECOMMENDATIONS
    // ══════════════════════════════════════════════════════════════

    _renderRecommendations(recs) {
        const container = document.getElementById('orch-rec-list');
        const badge = document.getElementById('rec-badge');
        if (!container) return;

        if (!recs || recs.length === 0) {
            container.textContent = '';
            container.appendChild(h('div', {
                style: 'font-size:10px;color:var(--text-muted);padding:4px;'
            }, 'No pending recommendations'));
            if (badge) { badge.style.display = 'none'; badge.textContent = ''; }
            return;
        }

        if (badge) {
            badge.style.display = 'inline';
            badge.textContent = String(recs.length);
        }

        const frag = document.createDocumentFragment();
        for (const rec of recs) {
            frag.appendChild(this._buildRecCard(rec));
        }
        container.textContent = '';
        container.appendChild(frag);
    }

    _buildRecCard(rec) {
        const priorityColors = {
            high:   'var(--accent-red)',
            medium: 'var(--accent-yellow, #d29922)',
            normal: 'var(--text-muted)',
            low:    'var(--text-muted)'
        };

        const card = h('div', { class: 'rec-card', 'data-rec-id': rec.id });

        // Title
        card.appendChild(h('div', { class: 'rec-card-title' }, rec.title || 'Untitled'));

        // Description
        if (rec.description) {
            card.appendChild(h('div', { class: 'rec-card-desc' }, rec.description));
        }

        // Rationale
        if (rec.rationale) {
            card.appendChild(h('div', { class: 'rec-card-rationale' }, `"${rec.rationale}"`));
        }

        // Meta line
        const metaParts = [];
        metaParts.push(`● ${rec.priority || 'normal'}`);
        if (rec.assignee) metaParts.push(`Assign: ${rec.assignee}`);
        if (rec.recommendedBy) metaParts.push(`From: ${rec.recommendedBy}`);

        const meta = h('div', { class: 'rec-card-meta' });
        const prioritySpan = h('span', {
            style: `color:${priorityColors[rec.priority] || 'var(--text-muted)'};`
        }, `● ${rec.priority || 'normal'}`);
        meta.appendChild(prioritySpan);
        if (rec.assignee) {
            meta.appendChild(document.createTextNode(` · Assign: ${rec.assignee}`));
        }
        if (rec.recommendedBy) {
            meta.appendChild(document.createTextNode(` · From: ${rec.recommendedBy}`));
        }
        card.appendChild(meta);

        // Action buttons
        const actions = h('div', { class: 'rec-card-actions' });

        const approveBtn = h('button', { class: 'rec-approve-btn' }, '✓ Approve');
        approveBtn.addEventListener('click', () => this._approveRec(rec.id, card, approveBtn));
        actions.appendChild(approveBtn);

        const rejectBtn = h('button', { class: 'rec-reject-btn' }, '✗ Reject');
        rejectBtn.addEventListener('click', () => this._rejectRec(rec.id, card, rejectBtn));
        actions.appendChild(rejectBtn);

        card.appendChild(actions);
        return card;
    }

    _approveRec(id, card, btn) {
        if (!id || !this._socket) return;
        this._socket.emit('approve_recommendation', { id });
        if (card) {
            card.style.opacity = '0.4';
            card.style.pointerEvents = 'none';
        }
        if (btn) btn.textContent = '✓ Approved';
    }

    _rejectRec(id, card, btn) {
        if (!id || !this._socket) return;
        this._socket.emit('reject_recommendation', { id });
        if (card) {
            card.style.opacity = '0.3';
            card.style.pointerEvents = 'none';
        }
        if (btn) btn.textContent = '✗ Rejected';
    }

    // ══════════════════════════════════════════════════════════════
    //  SOCKET EMITTERS
    // ══════════════════════════════════════════════════════════════

    _emitStrategy(strategy) {
        if (this._socket) {
            this._socket.emit('set_strategy', { strategy });
            // Optimistic update
            this._state.strategy = strategy;
            this._renderStrategy();
        }
    }

    _emitOverlay(overlay) {
        if (this._socket) {
            this._socket.emit('set_overlay', { overlay });
            // Optimistic update
            this._state.activeOverlay = overlay;
            this._renderStrategy();
        }
    }

    _emitMaxCycles(val) {
        if (this._socket) {
            this._socket.emit('set_max_cycles', { value: val });
        }
    }

    _emitMaxAgents(val) {
        if (this._socket) {
            this._socket.emit('set_max_agents', { value: val });
        }
    }

    _emitPauseAgent(name) {
        if (this._socket) {
            this._socket.emit('pause_agent', { agent: name }, (res) => {
                if (res?.success) {
                    // Update local state
                    const a = (this._state.activeAgents || []).find(x => x.name === name);
                    if (a) a.status = 'paused';
                    this._renderFleet();
                }
            });
        }
    }

    _emitResumeAgent(name) {
        if (this._socket) {
            this._socket.emit('resume_agent', { agent: name }, (res) => {
                if (res?.success) {
                    const a = (this._state.activeAgents || []).find(x => x.name === name);
                    if (a) a.status = 'running';
                    this._renderFleet();
                }
            });
        }
    }

    _emitKillAgent(name) {
        if (!confirm(`Stop agent "${name}"? This will cancel its current task.`)) return;
        if (this._socket) {
            this._socket.emit('kill_agent', { agent: name }, (res) => {
                if (res?.success) {
                    this._state.activeAgents = (this._state.activeAgents || []).filter(x => x.name !== name);
                    this._renderFleet();
                }
            });
        }
    }

    _emitToggleAutoQA() {
        const current = this._state.autoQA !== false;
        if (this._socket) {
            this._socket.emit('set_auto_qa', { enabled: !current });
            this._state.autoQA = !current;
            this._renderConfig();
        }
    }

    _emitToggleAISummarization() {
        const current = this._state.aiSummarization !== false;
        if (this._socket) {
            this._socket.emit('set_ai_summarization', { enabled: !current });
            this._state.aiSummarization = !current;
            this._renderConfig();
        }
    }
}
