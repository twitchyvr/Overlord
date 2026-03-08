/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Room View (Meeting Room Overlay)
   ═══════════════════════════════════════════════════════════════════
   Full-screen overlay for watching and participating in agent chat
   rooms. Supports multi-participant conversations, pull-in controls
   (orchestrator, PM, custom agents), user messaging, and meeting notes.

   Features:
     - Full transcript with per-agent color-coded messages
     - Pull-in: Orchestrator, Project Manager, any custom agent
     - User message input (broadcast to all room agents)
     - Leave / End / End Meeting buttons
     - Live meeting badge when orchestrator/PM is present
     - Meeting notes panel when available

   Engine events consumed:
     agent_room_message, room_participant_joined, room_participant_left,
     room_user_joined, meeting_notes_generated, agent_room_closed,
     open_room_view

   Dependencies: engine.js (Component, OverlordUI, h)
   ═══════════════════════════════════════════════════════════════════ */

import { Component, OverlordUI, h } from '../engine.js';

const MEETING_AGENTS = ['orchestrator', 'project-manager'];

export class RoomView extends Component {

    constructor(el, opts = {}) {
        super(el, opts);
        this._socket = opts.socket || null;
        this._agents = [];            // All known agents (for pull-in dropdown)
        this._currentRoom = null;     // Full room object
        this._visible = false;
        this._showNotes = false;
        this._thinkingAgents = new Set();  // agents currently processing in this room
    }

    // ══════════════════════════════════════════════════════════════
    //  LIFECYCLE
    // ══════════════════════════════════════════════════════════════

    mount() {
        this._mounted = true;
        this.el.classList.add('room-view-overlay');
        this.el.classList.remove('open');

        // Track all known agents for pull-in dropdown
        if (OverlordUI._store) {
            this._agents = OverlordUI._store.peek('team.agents') || [];
            this._subs.push(OverlordUI._store.subscribe('team.agents', (agents) => {
                this._agents = agents || [];
            }));
        }

        // Engine event subscriptions
        this._subs.push(
            OverlordUI.subscribe('open_room_view', (data) => {
                if (data?.room) this.openRoom(data.room);
            }),

            OverlordUI.subscribe('agent_room_message', (data) => {
                if (!this._currentRoom || data.roomId !== this._currentRoom.id) return;
                if (!this._currentRoom.messages) this._currentRoom.messages = [];
                this._currentRoom.messages.push(data.message);
                this._currentRoom.messageCount = (this._currentRoom.messageCount || 0) + 1;
                // Clear thinking state for this agent when their message arrives
                if (data.message?.from) this._thinkingAgents.delete(data.message.from);
                if (this._visible) { this._renderMessages(); this._updateThinkingBar(); }
            }),

            OverlordUI.subscribe('room_agent_thinking', (data) => {
                if (!this._currentRoom || data.roomId !== this._currentRoom.id) return;
                this._thinkingAgents.add(data.agentName);
                if (this._visible) this._updateThinkingBar();
            }),

            OverlordUI.subscribe('room_agents_stopped', (data) => {
                if (!this._currentRoom || data.roomId !== this._currentRoom.id) return;
                this._thinkingAgents.clear();
                if (this._visible) this._updateThinkingBar();
            }),

            OverlordUI.subscribe('room_participant_joined', (data) => {
                if (!this._currentRoom || data.roomId !== this._currentRoom.id) return;
                this._currentRoom.participants = data.participants;
                this._currentRoom.isMeeting = data.isMeeting;
                if (this._visible) this.render();
            }),

            OverlordUI.subscribe('room_participant_left', (data) => {
                if (!this._currentRoom || data.roomId !== this._currentRoom.id) return;
                this._currentRoom.participants = data.participants;
                this._currentRoom.userPresent = data.userPresent;
                if (this._visible) this.render();
            }),

            OverlordUI.subscribe('room_user_joined', (data) => {
                if (!this._currentRoom || data.roomId !== this._currentRoom.id) return;
                this._currentRoom.userPresent = data.userPresent;
                if (this._visible) this.render();
            }),

            OverlordUI.subscribe('meeting_notes_generated', (data) => {
                if (!this._currentRoom || data.roomId !== this._currentRoom.id) return;
                this._currentRoom.meetingNotes = data.notes;
                if (this._visible) this.render();
            }),

            OverlordUI.subscribe('agent_room_closed', (data) => {
                if (!this._currentRoom || data.roomId !== this._currentRoom.id) return;
                this._currentRoom.status = data.status || 'completed';
                if (this._visible) this.render();
            })
        );

        // Delegated event handlers
        this.on('click', '.rv-close-btn', () => this.close());
        this.on('click', '.rv-leave-btn', () => this._leaveRoom());
        this.on('click', '.rv-end-btn', () => this._endRoom());
        this.on('click', '.rv-end-meeting-btn', () => this._endMeeting());
        this.on('click', '.rv-notes-btn', () => { this._showNotes = !this._showNotes; this.render(); });
        this.on('click', '.rv-send-btn', () => this._sendMessage());
        this.on('click', '.rv-pull-orchestrator', () => this._pullIn('orchestrator'));
        this.on('click', '.rv-pull-pm', () => this._pullIn('project-manager'));
        this.on('click', '.rv-stop-agent-btn', (e, el) => {
            const agentName = el.dataset.agent;
            if (agentName && this._socket) {
                this._socket.emit('pause_agent', { agentName });
                this._thinkingAgents.delete(agentName);
                this._updateThinkingBar();
            }
        });
        this.on('click', '.rv-stop-all-btn', () => {
            if (!this._currentRoom || !this._socket) return;
            this._socket.emit('stop_room_agents', this._currentRoom.id);
            this._thinkingAgents.clear();
            this._updateThinkingBar();
        });
        this.on('keydown', '.rv-input', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._sendMessage(); }
        });

        // Close on backdrop click
        this.el.addEventListener('mousedown', (e) => {
            if (e.target === this.el) this.close();
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  OPEN / CLOSE
    // ══════════════════════════════════════════════════════════════

    openRoom(room) {
        this._currentRoom = { ...room, messages: room.messages ? [...room.messages] : [] };
        this._visible = true;
        this._showNotes = false;
        this._thinkingAgents.clear();
        this.el.classList.add('open');

        // Fetch full room data (messages) from server
        if (this._socket) {
            this._socket.emit('get_chat_room', room.id, (fullRoom) => {
                if (fullRoom) {
                    this._currentRoom = fullRoom;
                    if (this._visible) this.render();
                }
            });
        }

        this.render();
        requestAnimationFrame(() => {
            const input = this.$('.rv-input');
            if (input) input.focus();
        });
    }

    close() {
        this._visible = false;
        this.el.classList.remove('open');
        this._currentRoom = null;
        this._showNotes = false;
        this._thinkingAgents.clear();
    }

    // ══════════════════════════════════════════════════════════════
    //  RENDER
    // ══════════════════════════════════════════════════════════════

    render() {
        if (!this._visible || !this._currentRoom) return;
        const room = this._currentRoom;

        OverlordUI.setContent(this.el,
            h('div', { class: 'rv-panel' },
                this._renderHeader(room),
                this._renderPullInBar(room),
                this._renderMessages(true),
                room.meetingNotes && this._showNotes ? this._renderNotes(room.meetingNotes) : null,
                this._thinkingAgents.size > 0 ? this._buildThinkingBar() : null,
                room.status === 'active' ? this._renderInput(room) : this._renderClosedBanner(room)
            )
        );
    }

    _renderHeader(room) {
        const esc = (s) => String(s || '');
        const participants = room.participants || [room.fromAgent, room.toAgent];
        const isMeeting = room.isMeeting;
        const isActive = room.status === 'active';

        const title = h('div', { class: 'rv-header-title' },
            isMeeting
                ? h('span', { class: 'rv-meeting-badge' }, 'MEETING')
                : null,
            h('span', { class: 'rv-participants' },
                participants.map(p => esc(p)).join('  ·  ')
            ),
            h('span', { class: `rv-status-dot ${isActive ? 'live' : 'closed'}` }),
            h('span', { class: 'rv-status-label' }, isActive ? 'live' : room.status || 'closed')
        );

        const controls = h('div', { class: 'rv-header-controls' });
        if (room.meetingNotes) {
            controls.appendChild(h('button', { class: 'rv-notes-btn' }, '📋 Notes'));
        }
        if (isActive) {
            if (room.userPresent) {
                controls.appendChild(h('button', { class: 'rv-leave-btn' }, 'Leave'));
            }
            if (isMeeting) {
                controls.appendChild(h('button', { class: 'rv-end-meeting-btn' }, 'End Meeting'));
            } else {
                controls.appendChild(h('button', { class: 'rv-end-btn' }, 'End Room'));
            }
        }
        controls.appendChild(h('button', { class: 'rv-close-btn' }, '✕'));

        const sub = room.reason
            ? h('div', { class: 'rv-header-reason' }, esc(room.reason))
            : null;

        return h('div', { class: 'rv-header' }, title, sub ? h('div', { class: 'rv-header-sub' }, sub, controls) : controls);
    }

    _renderPullInBar(room) {
        const participants = room.participants || [room.fromAgent, room.toAgent];
        if (room.status !== 'active' || participants.length >= 5) return null;

        const bar = h('div', { class: 'rv-pullin-bar' },
            h('span', { class: 'rv-pullin-label' }, 'Pull in:')
        );

        if (!participants.includes('orchestrator')) {
            bar.appendChild(h('button', { class: 'rv-pull-orchestrator rv-pull-btn' }, '🤖 Orchestrator'));
        }
        if (!participants.includes('project-manager')) {
            bar.appendChild(h('button', { class: 'rv-pull-pm rv-pull-btn' }, '📋 Project Manager'));
        }

        // Custom agent dropdown (always available, excludes already-present + special agents)
        const available = this._agents.filter(a =>
            !participants.includes(a.name) &&
            !MEETING_AGENTS.includes(a.name)
        );
        if (available.length > 0) {
            const sel = h('select', { class: 'rv-pull-select' });
            sel.appendChild(h('option', { value: '' }, '+ Add agent...'));
            for (const a of available.slice(0, 40)) {
                sel.appendChild(h('option', { value: a.name }, a.name));
            }
            sel.addEventListener('change', () => {
                if (sel.value) { this._pullIn(sel.value); sel.value = ''; }
            });
            bar.appendChild(sel);
        }

        if (!room.userPresent) {
            bar.appendChild(h('button', {
                class: 'rv-join-btn',
                onClick: () => this._joinRoom()
            }, '👤 Join as participant'));
        }

        return bar;
    }

    _renderMessages(returnOnly = false) {
        const room = this._currentRoom;
        const msgs = room?.messages || [];
        const participants = room?.participants || [room?.fromAgent, room?.toAgent];

        // Build a color palette per participant
        const colors = ['#58a6ff', '#3fb950', '#f78166', '#d2a8ff', '#ffa657', '#79c0ff'];
        const colorMap = {};
        participants.forEach((p, i) => { colorMap[p] = colors[i % colors.length]; });
        colorMap['user'] = '#00d4ff';
        colorMap['system'] = '#888';

        const container = h('div', { class: 'rv-messages' });

        if (msgs.length === 0) {
            container.appendChild(h('div', { class: 'rv-empty' }, 'Waiting for messages...'));
        } else {
            for (const msg of msgs) {
                const isSystem = msg.from === 'system';
                const isUser = msg.from === 'user';
                const color = colorMap[msg.from] || '#aaa';

                container.appendChild(h('div', {
                    class: `rv-msg ${isSystem ? 'rv-msg--system' : isUser ? 'rv-msg--user' : 'rv-msg--agent'}`,
                    style: `--agent-color: ${color}`
                },
                    !isSystem
                        ? h('span', { class: 'rv-msg-sender' }, msg.from === 'user' ? 'You' : msg.from)
                        : null,
                    h('span', { class: 'rv-msg-content' }, String(msg.content || '').substring(0, 1000))
                ));
            }
        }

        if (returnOnly) {
            // Scroll after render
            requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
            return container;
        }

        // Partial update: replace just the messages area
        const existing = this.$('.rv-messages');
        if (existing) {
            existing.replaceWith(container);
            requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
        }
    }

    _renderInput(room) {
        const placeholder = `Message all ${(room.participants || []).length} agents...`;
        return h('div', { class: 'rv-input-area' },
            h('textarea', { class: 'rv-input', placeholder, rows: '2' }),
            h('button', { class: 'rv-send-btn' }, 'Send')
        );
    }

    _renderClosedBanner(room) {
        return h('div', { class: 'rv-closed-banner' },
            `Room ${room.status || 'closed'}.`,
            room.meetingNotes
                ? h('button', { class: 'rv-notes-btn', style: 'margin-left:8px;' }, '📋 View Notes')
                : null
        );
    }

    _buildThinkingBar() {
        const bar = h('div', { class: 'rv-thinking-bar' });
        for (const agentName of this._thinkingAgents) {
            const color = this._getAgentColor(agentName);
            bar.appendChild(
                h('div', { class: 'rv-thinking-item', style: `--agent-color: ${color}` },
                    h('span', { class: 'rv-thinking-dots' },
                        h('span', {}), h('span', {}), h('span', {})
                    ),
                    h('span', { class: 'rv-thinking-name' }, `${agentName} is thinking...`),
                    h('button', { class: 'rv-stop-agent-btn', 'data-agent': agentName, title: `Stop ${agentName}` }, '⏹')
                )
            );
        }
        if (this._thinkingAgents.size > 1) {
            bar.appendChild(h('button', { class: 'rv-stop-all-btn' }, '⏹ Stop All'));
        }
        return bar;
    }

    /** Replace or insert the thinking bar without a full re-render. */
    _updateThinkingBar() {
        const existing = this.$('.rv-thinking-bar');
        if (!this._thinkingAgents.size) {
            if (existing) existing.remove();
            return;
        }
        const bar = this._buildThinkingBar();
        if (existing) {
            existing.replaceWith(bar);
        } else {
            // Insert before the input area (or closed banner)
            const anchor = this.$('.rv-input-area') || this.$('.rv-closed-banner');
            if (anchor) anchor.insertAdjacentElement('beforebegin', bar);
        }
    }

    _getAgentColor(agentName) {
        const colors = ['#58a6ff', '#3fb950', '#f78166', '#d2a8ff', '#ffa657', '#79c0ff'];
        const participants = this._currentRoom?.participants || [];
        const idx = participants.indexOf(agentName);
        return colors[Math.max(0, idx) % colors.length];
    }

    _renderNotes(notes) {
        const esc = (s) => String(s || '');
        const section = (title, items) => {
            if (!items?.length) return null;
            const ul = h('ul', { class: 'rv-notes-list' });
            for (const item of items) {
                ul.appendChild(h('li', {}, typeof item === 'string' ? esc(item) :
                    esc(`${item.action || item} → ${item.assignee || '?'} [${item.priority || '?'}]`)));
            }
            return h('div', { class: 'rv-notes-section' },
                h('div', { class: 'rv-notes-section-title' }, title),
                ul
            );
        };

        const raid = notes.raid || {};
        const raidSections = [
            section('Risks', raid.risks),
            section('Assumptions', raid.assumptions),
            section('Issues', raid.issues),
            section('Dependencies', raid.dependencies)
        ].filter(Boolean);

        return h('div', { class: 'rv-notes-panel' },
            h('div', { class: 'rv-notes-title' }, '📋 ' + esc(notes.title || 'Meeting Notes')),
            h('div', { class: 'rv-notes-meta' },
                esc(notes.date || '') + '  ·  ' + esc(notes.duration || '') + '  ·  ' +
                (notes.participants || []).join(', ')
            ),
            notes.summary
                ? h('div', { class: 'rv-notes-summary' }, esc(notes.summary))
                : null,
            section('Key Decisions', notes.keyDecisions),
            raidSections.length > 0
                ? h('div', { class: 'rv-notes-raid' },
                    h('div', { class: 'rv-notes-section-title rv-notes-raid-title' }, 'RAID Log'),
                    h('div', { class: 'rv-notes-raid-grid' }, ...raidSections)
                  )
                : null,
            section('Action Items', notes.actionItems),
            section('Next Steps', notes.nextSteps)
        );
    }

    // ══════════════════════════════════════════════════════════════
    //  ACTIONS
    // ══════════════════════════════════════════════════════════════

    _sendMessage() {
        const input = this.$('.rv-input');
        if (!input || !this._currentRoom) return;
        const message = input.value.trim();
        if (!message) return;
        input.value = '';

        // Emit to server — server calls addRoomMessage which broadcasts agent_room_message
        // back to ALL clients (including sender), so no local push needed here
        if (this._socket) {
            this._socket.emit('send_room_message', { roomId: this._currentRoom.id, message });
        }
    }

    _pullIn(agentName) {
        if (!this._socket || !this._currentRoom) return;
        this._socket.emit('pull_agent_into_room', { roomId: this._currentRoom.id, agentName, pulledBy: 'user' }, (result) => {
            if (result?.success && this._currentRoom) {
                this._currentRoom.participants = result.participants;
                this._currentRoom.isMeeting = result.isMeeting;
                this.render();
            }
        });
    }

    _joinRoom() {
        if (!this._socket || !this._currentRoom) return;
        this._socket.emit('user_join_room', this._currentRoom.id, (result) => {
            if (result?.success && this._currentRoom) {
                this._currentRoom.userPresent = true;
                this.render();
            }
        });
    }

    _leaveRoom() {
        if (!this._socket || !this._currentRoom) return;
        this._socket.emit('user_leave_room', this._currentRoom.id, (result) => {
            if (result?.success && this._currentRoom) {
                this._currentRoom.userPresent = false;
                this._currentRoom.participants = result.participants;
                this.render();
            }
        });
    }

    _endRoom() {
        if (!this._socket || !this._currentRoom) return;
        this._socket.emit('end_chat_room', this._currentRoom.id, () => {
            if (this._currentRoom) this._currentRoom.status = 'ended';
            this.render();
        });
    }

    _endMeeting() {
        if (!this._socket || !this._currentRoom) return;
        this._socket.emit('end_meeting', this._currentRoom.id, (result) => {
            if (!this._currentRoom) return;
            this._currentRoom.status = 'completed';
            if (result?.meetingNotes) {
                this._currentRoom.meetingNotes = result.meetingNotes;
                this._showNotes = true;
            }
            this.render();
        });
    }
}
