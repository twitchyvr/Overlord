/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Agent Chat View
   ═══════════════════════════════════════════════════════════════════
   Overlay for direct messaging with individual sub-agents in the
   orchestration system. Supports per-agent message history, real-time
   status display, and pause/resume controls.

   Features:
     - Agent selection header (name, role, status dot)
     - Per-agent message thread with timestamps
     - Text input with send button (socket emit)
     - Processing state display (idle/working/paused)
     - Pause / Resume agent controls
     - Open / Close overlay lifecycle

   Engine events consumed:
     agent_message, agent_session_state,
     agent_paused, agent_resumed, open_agent_chat

   Dependencies: engine.js (Component, OverlordUI, h)
   ═══════════════════════════════════════════════════════════════════ */

import { Component, OverlordUI, h } from '../engine.js';

export class AgentChatView extends Component {

    constructor(el, opts = {}) {
        super(el, opts);
        this._socket = opts.socket || null;
        this._currentAgent = null;   // { name, role, status, paused, inboxCount }
        this._messages = new Map();  // agentName -> [{ role, content, ts }]
        this._visible = false;
    }

    // ══════════════════════════════════════════════════════════════
    //  LIFECYCLE
    // ══════════════════════════════════════════════════════════════

    mount() {
        this._mounted = true;
        this.el.classList.add('agent-chat-overlay');
        this.el.classList.remove('open');

        // Engine event subscriptions
        this._subs.push(
            OverlordUI.subscribe('agent_message', (data) => {
                if (!data?.agentName) return;
                this._addMessage(data.agentName, {
                    role: data.role || 'agent',
                    content: data.content || data.message || '',
                    ts: data.timestamp || Date.now()
                });
                if (this._visible && this._currentAgent?.name === data.agentName) {
                    this.render();
                }
            }),
            OverlordUI.subscribe('agent_session_state', (data) => {
                if (this._currentAgent && data?.agentName === this._currentAgent.name) {
                    Object.assign(this._currentAgent, {
                        status: data.status ?? this._currentAgent.status,
                        inboxCount: data.inboxCount ?? this._currentAgent.inboxCount
                    });
                    if (this._visible) this.render();
                }
            }),
            OverlordUI.subscribe('agent_paused', (data) => {
                if (this._currentAgent && data?.agentName === this._currentAgent.name) {
                    this._currentAgent.paused = true;
                    if (this._visible) this.render();
                }
            }),
            OverlordUI.subscribe('agent_resumed', (data) => {
                if (this._currentAgent && data?.agentName === this._currentAgent.name) {
                    this._currentAgent.paused = false;
                    if (this._visible) this.render();
                }
            }),
            OverlordUI.subscribe('open_agent_chat', (data) => {
                if (data?.agentName) this.openChat(data.agentName, data);
            })
        );

        // Delegated event handlers
        this.on('click', '.agent-chat-close-btn', () => this.close());
        this.on('click', '.agent-chat-send-btn', () => this._send());
        this.on('click', '.agent-chat-pause-btn', () => this._pauseAgent());
        this.on('click', '.agent-chat-resume-btn', () => this._resumeAgent());
        this.on('keydown', '.agent-chat-input', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this._send();
            }
        });

        // Close on backdrop click
        this.el.addEventListener('mousedown', (e) => {
            if (e.target === this.el) this.close();
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  OPEN / CLOSE
    // ══════════════════════════════════════════════════════════════

    openChat(agentName, agentData = {}) {
        this._currentAgent = {
            name: agentName,
            role: agentData.role || '',
            status: agentData.status || 'idle',
            paused: agentData.paused || false,
            inboxCount: agentData.inboxCount || 0
        };
        if (!this._messages.has(agentName)) {
            this._messages.set(agentName, []);
        }
        this._visible = true;
        this.el.classList.add('open');
        this.render();

        // Focus the input after render
        requestAnimationFrame(() => {
            const input = this.$('.agent-chat-input');
            if (input) input.focus();
        });
    }

    close() {
        this._visible = false;
        this.el.classList.remove('open');
        this._currentAgent = null;
    }

    // ══════════════════════════════════════════════════════════════
    //  RENDER
    // ══════════════════════════════════════════════════════════════

    render() {
        if (!this._visible || !this._currentAgent) return;

        const panel = h('div', { class: 'agent-chat-panel' },
            this._renderHeader(),
            this._renderMessages(),
            this._renderInput()
        );

        this.el.textContent = '';
        this.el.appendChild(panel);
    }

    _renderHeader() {
        const agent = this._currentAgent;
        const statusClass = agent.paused ? 'paused' : (agent.status || 'idle');
        const statusLabel = agent.paused ? 'paused' : (agent.status || 'idle');

        const controls = h('div', { class: 'agent-chat-controls' });
        if (agent.paused) {
            controls.appendChild(h('button', { class: 'agent-chat-resume-btn', title: 'Resume agent' }, 'Resume'));
        } else {
            controls.appendChild(h('button', { class: 'agent-chat-pause-btn', title: 'Pause agent' }, 'Pause'));
        }
        controls.appendChild(h('button', { class: 'agent-chat-close-btn', title: 'Close chat' }, 'X'));

        return h('div', { class: 'agent-chat-header' },
            h('div', { class: 'agent-chat-identity' },
                h('div', { class: `agent-status-dot ${statusClass}` }),
                h('div', { class: 'agent-chat-name-block' },
                    h('span', { class: 'agent-chat-name' }, agent.name),
                    agent.role
                        ? h('span', { class: 'agent-chat-role' }, agent.role)
                        : null
                )
            ),
            h('div', { class: 'agent-chat-meta' },
                h('span', { class: `agent-chat-status agent-chat-status--${statusClass}` }, statusLabel),
                agent.inboxCount > 0
                    ? h('span', { class: 'agent-chat-inbox-badge' }, String(agent.inboxCount))
                    : null
            ),
            controls
        );
    }

    _renderMessages() {
        const agentName = this._currentAgent.name;
        const msgs = this._messages.get(agentName) || [];

        const container = h('div', { class: 'agent-chat-messages' });

        if (!msgs.length) {
            container.appendChild(h('div', { class: 'agent-chat-empty' },
                'No messages yet. Send a message to begin.'
            ));
            return container;
        }

        for (const msg of msgs) {
            const isUser = msg.role === 'user';
            const time = new Date(msg.ts);
            const timeStr = time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

            container.appendChild(
                h('div', { class: `agent-chat-msg agent-chat-msg--${isUser ? 'user' : 'agent'}` },
                    h('div', { class: 'agent-chat-msg-meta' },
                        h('span', { class: 'agent-chat-msg-sender' }, isUser ? 'You' : agentName),
                        h('span', { class: 'agent-chat-msg-time' }, timeStr)
                    ),
                    h('div', { class: 'agent-chat-msg-content' }, msg.content)
                )
            );
        }

        // Scroll to bottom after DOM update
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
        });

        return container;
    }

    _renderInput() {
        return h('div', { class: 'agent-chat-input-area' },
            h('textarea', {
                class: 'agent-chat-input',
                placeholder: `Message ${this._currentAgent.name}...`,
                rows: '1'
            }),
            h('button', { class: 'agent-chat-send-btn', title: 'Send message' }, 'Send')
        );
    }

    // ══════════════════════════════════════════════════════════════
    //  ACTIONS
    // ══════════════════════════════════════════════════════════════

    _addMessage(agentName, msg) {
        if (!this._messages.has(agentName)) {
            this._messages.set(agentName, []);
        }
        this._messages.get(agentName).push(msg);
    }

    _send() {
        const input = this.$('.agent-chat-input');
        if (!input || !this._currentAgent) return;

        const content = input.value.trim();
        if (!content) return;

        const agentName = this._currentAgent.name;

        // Add to local history
        this._addMessage(agentName, {
            role: 'user',
            content,
            ts: Date.now()
        });

        // Emit via socket — server listens on 'direct_message' to trigger runAgentSession
        if (this._socket) {
            this._socket.emit('direct_message', { agentName, message: content });
        }

        // Clear input and re-render
        input.value = '';
        this.render();
    }

    _pauseAgent() {
        if (!this._socket || !this._currentAgent) return;
        this._socket.emit('pause_agent', { agentName: this._currentAgent.name });
    }

    _resumeAgent() {
        if (!this._socket || !this._currentAgent) return;
        this._socket.emit('resume_agent', { agentName: this._currentAgent.name });
    }
}
