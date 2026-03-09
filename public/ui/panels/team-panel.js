/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Team Panel
   ═══════════════════════════════════════════════════════════════════
   Main container: TeamPanel class, state management, render(), event handlers

   Dependencies: engine.js, components/panel.js, components/tabs.js
   ═══════════════════════════════════════════════════════════════════ */

import { OverlordUI, h } from '../engine.js';
import { PanelComponent } from '../components/panel.js';
import { Tabs } from '../components/tabs.js';
import { buildAgentCard, buildAgentList } from './agent-list.js';
import { buildRoomCard } from './room-list.js';

export class TeamPanel extends PanelComponent {

    constructor(el, opts = {}) {
        super(el, opts);
        this._filter = 'all';
        this._agents = [];
        this._filterTabs = null;
        this._listEl = null;
        this._activityLog = {};
        this._agentStats = {};
        this._agentTickers = {};
        this._sparklineInterval = null;
        this._sessionStates = {};
        this._chatRooms = [];
        this._watchingRoom = null;
    }

    mount() {
        super.mount();
        this._listEl = this.$('#team') || this.$('.panel-content');

        // Set up filter tabs
        const tabContainer = this.$('.team-filter-bar');
        if (tabContainer) {
            this._filterTabs = new Tabs(tabContainer, {
                items: [
                    { id: 'all', label: 'All' },
                    { id: 'active', label: 'Active' },
                    { id: 'on_deck', label: 'On Deck' },
                    { id: 'idle', label: 'Idle' }
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

        this._initStoreSubscriptions();
        this._initEventSubscriptions();
        this._initClickHandlers();

        // Refresh sparklines every 1s
        this._sparklineInterval = setInterval(() => {
            this._agents.forEach(a => this._updateSparklineEl(a.name));
        }, 1000);
    }

    destroy() {
        if (this._sparklineInterval) clearInterval(this._sparklineInterval);
        Object.values(this._agentTickers).forEach(t => clearInterval(t));
        super.destroy?.();
    }

    _initStoreSubscriptions() {
        if (OverlordUI._store) {
            this._sessionStates = { ...(OverlordUI._store.peek('agents.sessions') || {}) };

            this.subscribe(OverlordUI._store, 'team.agents', (agents) => {
                this._agents = agents || [];
                for (const a of this._agents) {
                    if (!this._sessionStates[a.name]) {
                        this._sessionStates[a.name] = { isProcessing: false, paused: false, inboxCount: 0 };
                    }
                }
                this.render(this._agents);
            });

            this.subscribe(OverlordUI._store, 'agents.sessions', (sessions) => {
                this._sessionStates = sessions || {};
                this.render(this._agents);
            });
        }
    }

    _initEventSubscriptions() {
        // Agent activity for sparklines
        this._subs.push(OverlordUI.subscribe('agent_activity', (event) => {
            const name = event.agent || event.agentName || 'orchestrator';
            this._logActivity(name, event.type || 'activity');
        }));

        // Agent messages for sparklines + stats
        this._subs.push(OverlordUI.subscribe('agent_message', (data) => {
            const name = data.agentName;
            if (name) {
                this._logActivity(name, 'message');
                if (!this._agentStats[name]) this._agentStats[name] = { sent: 0, recv: 0 };
                if (data.role === 'user') this._agentStats[name].sent++;
                if (data.role === 'assistant') this._agentStats[name].recv++;
                this._updateAgentStatsEl(name);
            }
        }));

        // Agent session state for heartbeat tickers
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

        // Chat rooms
        if (OverlordUI._socket) {
            OverlordUI._socket.emit('list_chat_rooms', (rooms) => {
                this._chatRooms = rooms || [];
                this.render(this._agents);
            });
        }

        // Room lifecycle events
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

        // Meeting events
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
    }

    _initClickHandlers() {
        this.on('click', '[data-action]', (e, el) => {
            const action = el.dataset.action;
            const agentName = el.dataset.agent;
            if (!agentName) return;

            if (action === 'agent-chat') {
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
    }

    render(agents) {
        if (!this._listEl) return;
        this._agents = agents || this._agents;

        const frag = document.createDocumentFragment();

        // Active chat rooms
        const activeRooms = this._chatRooms.filter(r => r.status === 'active');
        if (activeRooms.length) {
            const roomsHeader = h('div', {
                style: 'display:flex;align-items:center;gap:6px;padding:6px 8px;font-size:10px;font-weight:700;color:var(--accent-primary);letter-spacing:0.05em;text-transform:uppercase;'
            }, `\u{1F4AC} Agent Rooms (${activeRooms.length})`);
            frag.appendChild(roomsHeader);
            for (const room of activeRooms) {
                frag.appendChild(buildRoomCard(room, {
                    onOpen: (r) => this._openRoomView(r),
                    onEnd: (r) => r.isMeeting ? this._endMeeting(r.id) : this._endRoom(r.id)
                }));
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

        // Sort agents
        const sorted = [...filtered].sort((a, b) => {
            const rankOf = (agent) => {
                if (agent.name === 'orchestrator') return -1;
                const ses = this._sessionStates[agent.name] || { isProcessing: false, paused: false, inboxCount: 0 };
                if (ses.isProcessing === true && !ses.paused) return 0;
                if ((ses.inboxCount || 0) > 0 && !ses.paused) return 1;
                return 2;
            };
            return rankOf(a) - rankOf(b);
        });

        for (const agent of sorted) {
            frag.appendChild(buildAgentCard(agent, {
                sessionState: this._sessionStates[agent.name] || {},
                agentStats: this._agentStats[agent.name] || { sent: 0, recv: 0 },
                sparklineRenderer: (name) => this._renderSparklineSVG(name),
                onAction: (action, agentName) => this._handleAgentAction(action, agentName)
            }));
        }

        this._listEl.textContent = '';
        this._listEl.appendChild(frag);
    }

    _handleAgentAction(action, agentName) {
        const el = this.el.querySelector(`[data-action="${action}"][data-agent="${agentName}"]`);
        if (el) {
            el.click();
        }
    }

    // Activity logging
    _logActivity(name, type) {
        if (!this._activityLog[name]) this._activityLog[name] = [];
        this._activityLog[name].push({ ts: Date.now(), type });
        const cutoff = Date.now() - 60000;
        this._activityLog[name] = this._activityLog[name].filter(e => e.ts > cutoff);
        this._updateSparklineEl(name);
    }

    // Sparkline rendering
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

    // Filtering
    _filterAgents(agents) {
        if (this._filter === 'all') return agents;
        return agents.filter(a => {
            if (a.name === 'orchestrator' && this._filter === 'active') return true;
            const ses = this._sessionStates[a.name] || { isProcessing: false, paused: false, inboxCount: 0 };
            const isWorking = ses.isProcessing === true;
            switch (this._filter) {
                case 'active':
                    return isWorking && !ses.paused;
                case 'on_deck':
                    return !isWorking && !ses.paused && (ses.inboxCount || 0) > 0;
                case 'idle':
                    return !isWorking && !ses.paused && (ses.inboxCount || 0) === 0;
                default:
                    return true;
            }
        });
    }

    // Room handlers
    _openRoomView(room) {
        OverlordUI.dispatch('open_room_view', { room });
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
