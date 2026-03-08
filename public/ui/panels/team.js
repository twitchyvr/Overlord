/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Team Panel
   ═══════════════════════════════════════════════════════════════════
   Extracted from monolith: updateTeam(), buildAgentCard(),
   setTeamFilter(), _renderAgentSparkline()

   Features:
     - Agent cards with status dots, roles, capabilities
     - Filter tabs: All / Active / On Deck / Idle
     - Sparkline rendering for agent activity
     - Agent chat button integration
     - Per-agent message stats
     - Pause/resume buttons

   Dependencies: engine.js, components/card.js, components/tabs.js
   ═══════════════════════════════════════════════════════════════════ */

import { OverlordUI, h } from '../engine.js';
import { PanelComponent } from '../components/panel.js';
import { Tabs } from '../components/tabs.js';


export class TeamPanel extends PanelComponent {

    constructor(el, opts = {}) {
        super(el, opts);
        this._filter = 'all';
        this._agents = [];
        this._filterTabs = null;
        this._listEl = null;
        this._activityLog = {};       // { agentName: [{ts, type}] }
        this._agentStats = {};        // { agentName: {sent, recv} }
        this._agentTickers = {};      // processing heartbeat intervals
        this._sparklineInterval = null;
        this._sessionStates = {};     // { agentName: {isProcessing, paused, ...} }
    }

    mount() {
        super.mount();
        this._listEl = this.$('#team') || this.$('.panel-content');

        // Set up filter tabs
        const tabContainer = this.$('.team-filter-bar');
        if (tabContainer) {
            this._filterTabs = new Tabs(tabContainer, {
                items: [
                    { id: 'all',      label: 'All' },
                    { id: 'active',   label: 'Active' },
                    { id: 'on_deck',  label: 'On Deck' },
                    { id: 'idle',     label: 'Idle' }
                ],
                activeId: 'all',
                style: 'pills',
                onChange: (id) => {
                    this._filter = id;
                    this.render(this._agents);
                }
            });
            this._filterTabs.mount();
        }

        if (OverlordUI._store) {
            // Seed _sessionStates from whatever the store already holds (handles
            // the case where agent_session_state events fired before this panel mounted).
            this._sessionStates = { ...(OverlordUI._store.peek('agents.sessions') || {}) };

            // Subscribe to team agents list
            this.subscribe(OverlordUI._store, 'team.agents', (agents) => {
                this._agents = agents || [];
                this.render(this._agents);
            });

            // Subscribe to agents.sessions — socket-bridge merges every
            // agent_session_state event here, so this fires whenever any agent
            // starts or stops working → re-sort and re-filter in real time.
            this.subscribe(OverlordUI._store, 'agents.sessions', (sessions) => {
                this._sessionStates = sessions || {};
                this.render(this._agents);
            });
        }

        // Listen for agent_activity events to feed sparklines
        this._subs.push(OverlordUI.subscribe('agent_activity', (event) => {
            const name = event.agent || event.agentName || 'orchestrator';
            this._logActivity(name, event.type || 'activity');
        }));

        // Listen for agent_message to feed sparklines + stats
        this._subs.push(OverlordUI.subscribe('agent_message', (data) => {
            const name = data.agentName;
            if (name) {
                this._logActivity(name, 'message');
                // Update per-agent message stats
                if (!this._agentStats[name]) this._agentStats[name] = { sent: 0, recv: 0 };
                if (data.role === 'user') this._agentStats[name].sent++;
                if (data.role === 'assistant') this._agentStats[name].recv++;
                this._updateAgentStatsEl(name);
            }
        }));

        // Listen for agent_session_state to drive heartbeat sparkline tickers.
        // (Re-sorting is handled by the agents.sessions store subscription above.)
        this._subs.push(OverlordUI.subscribe('agent_session_state', (data) => {
            if (data.isProcessing && !this._agentTickers[data.agentName]) {
                this._agentTickers[data.agentName] = setInterval(() => {
                    this._logActivity(data.agentName, 'tick');
                }, 600);
            } else if (!data.isProcessing && this._agentTickers[data.agentName]) {
                clearInterval(this._agentTickers[data.agentName]);
                delete this._agentTickers[data.agentName];
            }
        }));

        // Refresh all visible sparklines every 1s
        this._sparklineInterval = setInterval(() => {
            this._agents.forEach(a => this._updateSparklineEl(a.name));
        }, 1000);
    }

    destroy() {
        if (this._sparklineInterval) clearInterval(this._sparklineInterval);
        Object.values(this._agentTickers).forEach(t => clearInterval(t));
        super.destroy?.();
    }

    render(agents) {
        if (!this._listEl) return;
        this._agents = agents || this._agents;

        const filtered = this._filterAgents(this._agents);

        if (!filtered.length) {
            OverlordUI.setContent(this._listEl, h('div', {
                style: 'padding:16px;text-align:center;color:var(--text-muted);font-size:12px;'
            }, this._filter === 'all' ? 'No agents registered' : `No ${this._filter} agents`));
            return;
        }

        // Sort: working agents first, then on-deck (inbox > 0), then idle.
        // Ported from index-ori.html:8385-8410 (activeNames → sections → concat).
        const sorted = [...filtered].sort((a, b) => {
            const rankOf = (agent) => {
                if (this._isAgentWorking(agent)) return 0;
                const ses = this._sessionStates[agent.name] || {};
                const st = (agent.status || '').toLowerCase();
                const isOnDeck = (ses.inboxCount || 0) > 0 ||
                    ['on_deck', 'standby', 'ready'].includes(st);
                if (isOnDeck) return 1;
                return 2;
            };
            return rankOf(a) - rankOf(b);
        });

        const frag = document.createDocumentFragment();
        for (const agent of sorted) {
            frag.appendChild(this._buildAgentCard(agent));
        }

        this._listEl.textContent = '';
        this._listEl.appendChild(frag);
    }

    // ── Private ──────────────────────────────────────────────────

    _logActivity(name, type) {
        if (!this._activityLog[name]) this._activityLog[name] = [];
        this._activityLog[name].push({ ts: Date.now(), type });
        const cutoff = Date.now() - 60000;
        this._activityLog[name] = this._activityLog[name].filter(e => e.ts > cutoff);
        this._updateSparklineEl(name);
    }

    _renderSparklineSVG(agentName) {
        const log = this._activityLog[agentName] || [];
        const W = 80, H = 14, bucketMs = 2000, buckets = 30;
        const now = Date.now();
        const counts = Array(buckets).fill(0);
        log.forEach(e => {
            const age = now - e.ts;
            if (age < 60000) {
                const bucket = Math.min(buckets - 1, Math.floor(age / bucketMs));
                counts[buckets - 1 - bucket]++;
            }
        });
        const mx = Math.max(...counts, 1);
        const pts = counts.map((v, i) => {
            const x = (i / (buckets - 1)) * W;
            const y = H - 1 - ((v / mx) * (H - 2));
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', W);
        svg.setAttribute('height', H);
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.style.cssText = 'display:inline-block;vertical-align:middle;margin-left:6px;opacity:0.8;';

        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        polyline.setAttribute('points', pts);
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke', 'var(--electric)');
        polyline.setAttribute('stroke-width', '1.4');
        polyline.setAttribute('stroke-linecap', 'round');
        polyline.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(polyline);

        return svg;
    }

    _updateSparklineEl(agentName) {
        const safeName = agentName.replace(/\s+/g, '_');
        const el = this._listEl?.querySelector(`#agent-sparkline-${CSS.escape(safeName)}`);
        if (el) {
            el.textContent = '';
            el.appendChild(this._renderSparklineSVG(agentName));
        }
    }

    _updateAgentStatsEl(agentName) {
        const el = this._listEl?.querySelector(`#agent-stats-${CSS.escape(agentName)}`);
        const s = this._agentStats[agentName];
        if (el && s) el.textContent = `↑${s.sent} ↓${s.recv}`;
    }

    _filterAgents(agents) {
        if (this._filter === 'all') return agents;
        return agents.filter(a => {
            const isWorking = this._isAgentWorking(a);
            const ses = this._sessionStates[a.name] || {};
            switch (this._filter) {
                case 'active':
                    return isWorking && !ses.paused;
                case 'on_deck':
                    // "On deck" = agent has queued work (inbox items) but is not currently
                    // processing. The backend never emits 'on_deck' status explicitly —
                    // it must be derived from inboxCount. Also accept explicit status values.
                    return !isWorking && !ses.paused && (
                        (ses.inboxCount || 0) > 0 ||
                        ['on_deck', 'standby', 'ready'].includes((a.status || '').toLowerCase())
                    );
                case 'idle':
                    // Idle = not working, not paused, nothing in inbox
                    return !isWorking && !ses.paused && (ses.inboxCount || 0) === 0;
                default:
                    return true;
            }
        });
    }

    // Single source of truth: is this agent currently processing work?
    _isAgentWorking(agent) {
        const ses = this._sessionStates[agent.name] || {};
        const status = (agent.status || '').toLowerCase();
        return ses.isProcessing || status === 'working' || status === 'thinking' || status === 'active';
    }

    _buildAgentCard(agent) {
        const ses = this._sessionStates[agent.name] || {};
        const isWorking = this._isAgentWorking(agent);
        const dotCls = ses.paused ? 'paused' : (isWorking ? 'working' : (agent.status || 'idle').toLowerCase());
        const effectiveStatus = ses.paused ? 'PAUSED' : isWorking ? 'WORKING' : (agent.status || 'IDLE').toUpperCase();
        const safeName = agent.name.replace(/\s+/g, '_');

        const card = h('div', {
            class: `agent-card agent-${dotCls}`,
            'data-agent': agent.name
        });

        // Header row: status dot + name + scope badge + task badge + inbox + status badge + sparkline + buttons
        const header = h('div', { class: 'agent-card-header', style: 'display:flex;align-items:center;gap:6px;padding:8px 10px;' });

        // Status dot
        header.appendChild(h('span', {
            class: `agent-status-dot ${dotCls}`,
            id: `agent-dot-${safeName}`
        }));

        // Name
        header.appendChild(h('span', { class: 'agent-card-name' }, agent.name || 'Agent'));

        // Scope badge (P = project, G = global)
        if (agent.scope === 'project') {
            header.appendChild(h('span', {
                style: 'font-size:9px;background:rgba(120,83,15,0.4);color:#fcd34d;border:1px solid rgba(252,211,77,0.3);border-radius:3px;padding:1px 4px;',
                title: 'Project-only agent'
            }, 'P'));
        } else {
            header.appendChild(h('span', {
                style: 'font-size:9px;background:rgba(37,99,235,0.2);color:#93c5fd;border:1px solid rgba(147,197,253,0.2);border-radius:3px;padding:1px 4px;',
                title: 'Global agent'
            }, 'G'));
        }

        // Active task count badge
        const tasks = OverlordUI._store?.peek('tasks.list', []) || [];
        const agentTaskCount = tasks.filter(t => !t.completed && t.assignee && (Array.isArray(t.assignee) ? t.assignee.includes(agent.name) : t.assignee === agent.name)).length;
        if (agentTaskCount > 0) {
            header.appendChild(h('span', {
                class: 'agent-task-badge',
                title: `${agentTaskCount} active task(s) assigned`
            }, String(agentTaskCount)));
        }

        // Inbox badge
        const inboxCnt = ses.inboxCount || agent.inboxCount || 0;
        header.appendChild(h('span', {
            class: 'agent-inbox-badge',
            id: `agent-inbox-${safeName}`,
            style: inboxCnt > 0 ? '' : 'display:none;'
        }, String(inboxCnt)));

        // Status badge
        header.appendChild(h('span', {
            class: `agent-badge ${effectiveStatus.toLowerCase()}`,
            id: `agent-status-badge-${safeName}`
        }, effectiveStatus));

        // Sparkline container
        const sparkWrap = h('span', { id: `agent-sparkline-${safeName}` });
        sparkWrap.appendChild(this._renderSparklineSVG(agent.name));
        header.appendChild(sparkWrap);

        // Chat button
        header.appendChild(h('button', {
            class: 'agent-card-btn',
            title: `Chat with ${agent.name}`,
            dataset: { action: 'agent-chat', agent: agent.name }
        }, '💬'));

        // Pause/resume button
        const pauseIcon = ses.paused ? '▶' : '⏸';
        header.appendChild(h('button', {
            class: 'agent-card-btn',
            id: `pause-btn-${safeName}`,
            title: ses.paused ? 'Resume agent' : 'Pause agent',
            dataset: { action: 'agent-pause', agent: agent.name }
        }, pauseIcon));

        card.appendChild(header);

        // Role
        if (agent.role) {
            card.appendChild(h('div', { class: 'agent-card-role' }, agent.role));
        }

        // Model badge
        if (agent.model) {
            card.appendChild(h('div', {
                style: 'font-size:9px;color:var(--text-muted);padding:0 10px 2px;opacity:0.7;'
            }, agent.model));
        }

        // Current task
        if (agent.currentTask) {
            card.appendChild(h('div', { class: 'agent-current-task' }, agent.currentTask));
        }

        // Capabilities
        if (agent.capabilities?.length) {
            const caps = h('div', { class: 'agent-caps' });
            agent.capabilities.slice(0, 5).forEach(c => caps.appendChild(h('span', { class: 'agent-cap' }, c)));
            if (agent.capabilities.length > 5) {
                caps.appendChild(h('span', { class: 'agent-cap', style: 'opacity:0.5;' }, `+${agent.capabilities.length - 5}`));
            }
            card.appendChild(caps);
        }

        // Per-agent message stats
        const stats = this._agentStats[agent.name] || { sent: 0, recv: 0 };
        card.appendChild(h('div', {
            class: 'agent-stats-row',
            id: `agent-stats-${agent.name}`,
            style: 'font-size:9px;color:var(--text-muted);padding:2px 10px 6px;font-family:monospace;'
        }, `↑${stats.sent} ↓${stats.recv}`));

        return card;
    }
}
