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
        this._chatRooms = [];         // Active inter-agent chat rooms
        this._watchingRoom = null;    // Currently expanded room ID
        this._viewingNotes = null;    // Meeting notes ID being viewed
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
                // Ensure every agent has an initialized session state so filter
                // logic never encounters undefined (which would break comparisons).
                for (const a of this._agents) {
                    if (!this._sessionStates[a.name]) {
                        this._sessionStates[a.name] = { isProcessing: false, paused: false, inboxCount: 0 };
                    }
                }
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

        // ── Agent Chat Rooms ──────────────────────────────────────────
        // Fetch existing rooms on mount
        if (OverlordUI._socket) {
            OverlordUI._socket.emit('list_chat_rooms', (rooms) => {
                this._chatRooms = rooms || [];
                this.render(this._agents);
            });
        }

        // Listen for room lifecycle events
        this._subs.push(OverlordUI.subscribe('agent_room_opened', (room) => {
            this._chatRooms = this._chatRooms.filter(r => r.id !== room.id);
            this._chatRooms.unshift(room);
            this.render(this._agents);
        }));
        this._subs.push(OverlordUI.subscribe('agent_room_message', (data) => {
            const room = this._chatRooms.find(r => r.id === data.roomId);
            if (room) {
                room.messageCount = (room.messageCount || 0) + 1;
                if (!room.messages) room.messages = [];
                room.messages.push(data.message);
                this._updateRoomCard(data.roomId);
            }
        }));
        this._subs.push(OverlordUI.subscribe('agent_room_closed', (data) => {
            const room = this._chatRooms.find(r => r.id === data.roomId);
            if (room) {
                room.status = data.status || 'completed';
                this._updateRoomCard(data.roomId);
            }
        }));

        // Meeting lifecycle events
        this._subs.push(OverlordUI.subscribe('room_participant_joined', (data) => {
            const room = this._chatRooms.find(r => r.id === data.roomId);
            if (room) {
                room.participants = data.participants;
                room.isMeeting = data.isMeeting;
                this._updateRoomCard(data.roomId);
            }
        }));
        this._subs.push(OverlordUI.subscribe('room_participant_left', (data) => {
            const room = this._chatRooms.find(r => r.id === data.roomId);
            if (room) {
                room.participants = data.participants;
                room.userPresent = data.userPresent;
                this._updateRoomCard(data.roomId);
            }
        }));
        this._subs.push(OverlordUI.subscribe('room_user_joined', (data) => {
            const room = this._chatRooms.find(r => r.id === data.roomId);
            if (room) {
                room.userPresent = data.userPresent;
                this._updateRoomCard(data.roomId);
            }
        }));
        this._subs.push(OverlordUI.subscribe('meeting_notes_generated', (data) => {
            const room = this._chatRooms.find(r => r.id === data.roomId);
            if (room) {
                room.meetingNotes = data.notes;
                this._updateRoomCard(data.roomId);
            }
        }));

        // ── Click delegation for agent card buttons ────────────────
        this.on('click', '[data-action]', (e, el) => {
            const action = el.dataset.action;
            const agentName = el.dataset.agent;
            if (!agentName) return;

            if (action === 'agent-chat') {
                // Open the Agent Chat overlay for this agent
                const agent = this._agents.find(a => a.name === agentName);
                OverlordUI.dispatch('open_agent_chat', {
                    agentName,
                    role: agent?.role || '',
                    status: (this._sessionStates[agentName]?.isProcessing ? 'working' : 'idle'),
                    paused: this._sessionStates[agentName]?.paused || false,
                    inboxCount: this._sessionStates[agentName]?.inboxCount || 0
                });
            } else if (action === 'agent-pause') {
                const ses = this._sessionStates[agentName] || {};
                if (OverlordUI._socket) {
                    if (ses.paused) {
                        OverlordUI._socket.emit('resume_agent', { agentName });
                    } else {
                        OverlordUI._socket.emit('pause_agent', { agentName });
                    }
                }
            } else if (action === 'start-room') {
                // Create a new multi-agent room with this agent, then open RoomView
                if (OverlordUI._socket) {
                    OverlordUI._socket.emit('create_chat_room', {
                        fromAgent: 'user',
                        toAgent: agentName,
                        reason: `User started a room with ${agentName}`
                    }, (result) => {
                        if (result?.success && result.room) {
                            OverlordUI.dispatch('open_room_view', { room: result.room });
                        }
                    });
                }
            }
        });

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

        const frag = document.createDocumentFragment();

        // ── Active Chat Rooms section ────────────────────────────────
        const activeRooms = this._chatRooms.filter(r => r.status === 'active');
        if (activeRooms.length) {
            const roomsHeader = h('div', {
                style: 'display:flex;align-items:center;gap:6px;padding:6px 8px;font-size:10px;font-weight:700;color:var(--accent-primary);letter-spacing:0.05em;text-transform:uppercase;'
            }, `\u{1F4AC} Agent Rooms (${activeRooms.length})`);
            frag.appendChild(roomsHeader);
            for (const room of activeRooms) {
                frag.appendChild(this._buildRoomCard(room));
            }
            frag.appendChild(h('div', { style: 'height:8px;border-bottom:1px solid var(--border-color);margin-bottom:6px;' }));
        }

        const filtered = this._filterAgents(this._agents);

        if (!filtered.length && !activeRooms.length) {
            OverlordUI.setContent(this._listEl, h('div', {
                style: 'padding:16px;text-align:center;color:var(--text-muted);font-size:12px;'
            }, this._filter === 'all' ? 'No agents registered' : `No ${this._filter} agents`));
            return;
        }

        // Sort: Orchestrator always first, then Active (isProcessing), On Deck, Idle.
        const sorted = [...filtered].sort((a, b) => {
            const rankOf = (agent) => {
                if (agent.name === 'orchestrator') return -1;            // Always top
                const ses = this._sessionStates[agent.name] || { isProcessing: false, paused: false, inboxCount: 0 };
                if (ses.isProcessing === true && !ses.paused) return 0;  // Active
                if ((ses.inboxCount || 0) > 0 && !ses.paused)           return 1;  // On Deck
                return 2;                                                            // Idle
            };
            return rankOf(a) - rankOf(b);
        });

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
            // Orchestrator is always shown in the Active filter — it's the permanent top agent
            if (a.name === 'orchestrator' && this._filter === 'active') return true;

            // Always normalize ses so filter logic never hits undefined comparisons
            const ses = this._sessionStates[a.name] || { isProcessing: false, paused: false, inboxCount: 0 };
            const isWorking = ses.isProcessing === true;
            switch (this._filter) {
                case 'active':
                    return isWorking && !ses.paused;
                case 'on_deck':
                    // "On deck" = agent has queued work (inbox items) but is not currently
                    // processing. The backend never emits 'on_deck' status explicitly —
                    // it must be derived from inboxCount.
                    return !isWorking && !ses.paused && (ses.inboxCount || 0) > 0;
                case 'idle':
                    // Idle = not working, not paused, nothing in inbox
                    return !isWorking && !ses.paused && (ses.inboxCount || 0) === 0;
                default:
                    return true;
            }
        });
    }

    // Single source of truth: is this agent currently processing work?
    // IMPORTANT: agent.status from the server is the *registration* status (e.g. 'WORKING'
    // for ALL agents) and is NOT a reliable processing indicator. Only ses.isProcessing
    // from agent_session_state events reflects actual real-time processing.
    // We also accept 'thinking' status since that is a transient processing signal.
    _isAgentWorking(agent) {
        const ses = this._sessionStates[agent.name] || {};
        if (ses.isProcessing) return true;
        const status = (agent.status || '').toLowerCase();
        return status === 'thinking';
    }

    _buildAgentCard(agent) {
        const ses = this._sessionStates[agent.name] || {};
        const isWorking = this._isAgentWorking(agent);
        // Derive visual status from processing state, not agent.status (which is always 'WORKING')
        const isOnDeck = !isWorking && !ses.paused && ((ses.inboxCount || 0) > 0 ||
            ['on_deck', 'standby', 'ready'].includes((agent.status || '').toLowerCase()));
        const dotCls = ses.paused ? 'paused' : isWorking ? 'working' : isOnDeck ? 'on_deck' : 'idle';
        const effectiveStatus = ses.paused ? 'PAUSED' : isWorking ? 'WORKING' : isOnDeck ? 'ON DECK' : 'IDLE';
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

        // Chat button (1:1 direct chat)
        header.appendChild(h('button', {
            class: 'agent-card-btn',
            title: `Chat with ${agent.name}`,
            dataset: { action: 'agent-chat', agent: agent.name }
        }, '💬'));

        // Start Room button (opens a multi-agent room with this agent)
        header.appendChild(h('button', {
            class: 'agent-card-btn',
            title: `Start a room with ${agent.name}`,
            dataset: { action: 'start-room', agent: agent.name }
        }, '🚪'));

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

    // ── Agent Chat Rooms UI ──────────────────────────────────────

    _buildRoomCard(room) {
        const esc = (s) => OverlordUI.escapeHtml ? OverlordUI.escapeHtml(String(s)) : String(s);
        const participants = room.participants || [room.fromAgent, room.toAgent];
        const isActive = room.status === 'active';

        const card = h('div', {
            id: `room-card-${room.id}`,
            style: `background:var(--bg-secondary);border:1px solid ${room.isMeeting ? 'rgba(250,204,21,0.4)' : 'var(--border-color)'};border-radius:6px;margin:0 4px 4px;padding:8px 10px;`
        });

        // Header: meeting badge + participants + status
        const header = h('div', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:4px;' });
        if (room.isMeeting) {
            header.appendChild(h('span', {
                style: 'font-size:9px;background:rgba(250,204,21,0.15);color:#fcd34d;padding:1px 5px;border-radius:3px;border:1px solid rgba(250,204,21,0.3);font-weight:700;'
            }, 'MEETING'));
        }
        header.appendChild(h('span', { style: 'font-size:11px;font-weight:600;color:var(--text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' },
            participants.map(p => esc(p)).join(' \u2022 ')));
        if (room.tool) {
            header.appendChild(h('span', {
                style: 'font-size:9px;background:var(--bg-tertiary);color:var(--accent-primary);padding:1px 5px;border-radius:3px;flex-shrink:0;'
            }, esc(room.tool)));
        }
        header.appendChild(h('span', {
            style: `font-size:9px;flex-shrink:0;color:${isActive ? 'var(--accent-green)' : 'var(--text-muted)'};`
        }, isActive ? '\u25CF live' : esc(room.status)));
        card.appendChild(header);

        // Reason subtitle
        if (room.reason) {
            card.appendChild(h('div', {
                style: 'font-size:10px;color:var(--text-muted);margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
            }, esc(room.reason)));
        }

        // Action row: stats + Open button + End button
        const actions = h('div', { style: 'display:flex;align-items:center;gap:6px;' });
        actions.appendChild(h('span', { style: 'font-size:9px;color:var(--text-muted);' },
            `${room.messageCount || 0} msgs \u2022 ${participants.length} agents` +
            (room.userPresent ? ' \u2022 \u{1F464} you' : '')
        ));

        // Open Room button — opens the full-screen RoomView overlay
        actions.appendChild(h('button', {
            style: 'margin-left:auto;padding:2px 10px;font-size:10px;background:var(--accent-primary);border:none;border-radius:3px;cursor:pointer;color:#000;font-weight:700;',
            onClick: (e) => { e.stopPropagation(); this._openRoomView(room); }
        }, 'Open Room'));

        if (isActive) {
            actions.appendChild(h('button', {
                style: 'padding:2px 8px;font-size:10px;background:var(--accent-red, #f85149);border:none;border-radius:3px;cursor:pointer;color:#fff;font-weight:600;',
                onClick: (e) => { e.stopPropagation(); room.isMeeting ? this._endMeeting(room.id) : this._endRoom(room.id); }
            }, room.isMeeting ? 'End Meeting' : 'End'));
        }
        if (room.meetingNotes) {
            actions.appendChild(h('button', {
                style: 'padding:2px 8px;font-size:10px;background:rgba(250,204,21,0.2);border:1px solid rgba(250,204,21,0.3);border-radius:3px;cursor:pointer;color:#fcd34d;font-weight:600;',
                onClick: (e) => { e.stopPropagation(); this._openRoomView(room); }
            }, 'Notes'));
        }
        card.appendChild(actions);

        return card;
    }

    _openRoomView(room) {
        OverlordUI.dispatch('open_room_view', { room });
    }

    _toggleWatchRoom(roomId) {
        if (this._watchingRoom === roomId) {
            this._watchingRoom = null;
        } else {
            this._watchingRoom = roomId;
            // Fetch full room data (with messages) when watching
            if (OverlordUI._socket) {
                OverlordUI._socket.emit('get_chat_room', roomId, (fullRoom) => {
                    if (fullRoom) {
                        const idx = this._chatRooms.findIndex(r => r.id === roomId);
                        if (idx >= 0) this._chatRooms[idx] = fullRoom;
                    }
                    this.render(this._agents);
                });
                return; // render will be called in callback
            }
        }
        this.render(this._agents);
    }

    _endRoom(roomId) {
        if (OverlordUI._socket) {
            OverlordUI._socket.emit('end_chat_room', roomId, () => {
                const room = this._chatRooms.find(r => r.id === roomId);
                if (room) room.status = 'ended';
                this.render(this._agents);
            });
        }
    }

    _pullAgentIn(roomId, agentName) {
        if (OverlordUI._socket) {
            OverlordUI._socket.emit('pull_agent_into_room', { roomId, agentName, pulledBy: 'user' }, (result) => {
                if (result?.success) {
                    const room = this._chatRooms.find(r => r.id === roomId);
                    if (room) {
                        room.participants = result.participants;
                        room.isMeeting = result.isMeeting;
                    }
                    this.render(this._agents);
                } else {
                    console.warn('[Team] Pull-in failed:', result?.error);
                }
            });
        }
    }

    _userJoinRoom(roomId) {
        if (OverlordUI._socket) {
            OverlordUI._socket.emit('user_join_room', roomId, (result) => {
                if (result?.success) {
                    const room = this._chatRooms.find(r => r.id === roomId);
                    if (room) room.userPresent = true;
                    this.render(this._agents);
                }
            });
        }
    }

    _userLeaveRoom(roomId) {
        if (OverlordUI._socket) {
            OverlordUI._socket.emit('user_leave_room', roomId, (result) => {
                if (result?.success) {
                    const room = this._chatRooms.find(r => r.id === roomId);
                    if (room) {
                        room.userPresent = false;
                        room.participants = result.participants;
                    }
                    this.render(this._agents);
                }
            });
        }
    }

    _endMeeting(roomId) {
        if (OverlordUI._socket) {
            OverlordUI._socket.emit('end_meeting', roomId, (result) => {
                const room = this._chatRooms.find(r => r.id === roomId);
                if (room) {
                    room.status = 'completed';
                    if (result?.meetingNotes) room.meetingNotes = result.meetingNotes;
                }
                this.render(this._agents);
            });
        }
    }

    _updateRoomCard(roomId) {
        this.render(this._agents);
    }
}
