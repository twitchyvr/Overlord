// ==================== OVERLORD WEB - CENTRAL HUB ====================
// The event bus and plugin registry for the modular architecture
// All modules communicate through this hub
//
// Socket.IO Rooms Architecture:
//   conv:{id}  — one room per conversation; clients auto-join on load
//   broadcast() emits only to the room of the currently active conversation
//   broadcastAll() emits to every connected socket (server-wide events)
//   broadcastToRoom(room, …) sends to an explicit room

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

// ── Web Push (VAPID) ──────────────────────────────────────────────────────
let webpush = null;
try {
    webpush = require('web-push');
    webpush.setVapidDetails(
        'mailto:overlord@localhost',
        'BNCkqsZ1xzKoJ4IWK4l4wrqGZG1c_0VGt1dS9lmgeTqzg2KgIXMRuyrWyNgiV_u6t1OYfVfpF0moON7mOd3ot_0',
        'Td8JxAznufbkndPF4r1l-xNvqy4Uq_Oq-JBsajQtwtg'
    );
    console.log('[Hub] Web Push ready ✅');
} catch (e) {
    console.warn('[Hub] Web Push disabled — could not load web-push package:', e.message);
    console.warn('[Hub] Push notifications will not work. Try: npm install web-push@latest');
    webpush = null;
}

class Hub extends EventEmitter {
    constructor() {
        super();
        this.modules = new Map();
        this.services = {};
        this.config = {};
        this.io = null;
        this.initialized = false;
        // ── Web Push subscriptions (socketId → PushSubscription JSON) ──
        this._pushSubscriptions = new Map();
        
        // Process state tracking
        this.processState = {
            pid: process.pid,
            platform: process.platform,
            nodeVersion: process.version,
            startedAt: new Date().toISOString(),
            uptime: 0,
            memory: { rss: 0, heapUsed: 0, heapTotal: 0 },
            port: 3031
        };
        
        // Update process stats periodically
        setInterval(() => {
            this.processState.uptime = process.uptime();
            const mem = process.memoryUsage();
            this.processState.memory = {
                rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
                heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
                heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + 'MB'
            };
        }, 5000);
    }

    // Initialize the hub (module loading is handled by server.js)
    async init(io, config) {
        this.io = io;
        this.config = config;

        // Determine port from environment or default
        this.processState.port = parseInt(process.env.PORT, 10) || 3031;

        console.log('\n🧠 OVERLORD HUB v1.2 - Initializing...\n');

        // Set up Socket.IO event forwarding
        this.setupSocketBridge();

        this.initialized = true;
        console.log('   ✅ Hub event bus ready\n');
    }

    // Register a loaded module (called by server.js)
    registerModule(name, module) {
        this.modules.set(name, module);
    }

    // Build the full context_info payload (used by socket handler + proactive broadcast)
    _buildContextInfo() {
        const tracker = this.getService('contextTracker');
        const conv    = this.getService('conversation');
        const config  = this.getService('config');
        let info = tracker?.getContextInfo?.() || {};
        if (conv?.getContextUsage) {
            const usage = conv.getContextUsage();
            const compactionCount = tracker?.getCompactionStats?.()?.totalCompactions || 0;
            info = {
                ...info,
                ...usage,
                // Alias so client field names match
                tokensUsed: usage.estimatedTokens,
                compactionCount,
                // Model name for display
                model: config?.model || '—'
            };
        }
        // inputTokens / outputTokens come from context-tracker (populated by orchestration after each request)
        // They are already included via tracker.getContextInfo() spread above
        return info;
    }

    // Proactively push updated context stats to all clients (call after each AI request)
    broadcastContextInfo() {
        if (!this.io) return;
        const info = this._buildContextInfo();
        this.io.emit('context_info', info);
    }

    // ==================== ROOM MANAGEMENT ====================

    /**
     * Put a socket into a conversation room.
     * Leaves any previous conversation room first.
     * Room name: conv:{conversationId}
     */
    joinConversationRoom(socket, convId) {
        if (!convId) return;
        const room = `conv:${convId}`;
        // Leave previous conv room if different
        const prev = socket.data?.convRoom;
        if (prev && prev !== room) {
            socket.leave(prev);
        }
        socket.join(room);
        if (!socket.data) socket.data = {};
        socket.data.convRoom = room;
        socket.data.convId = convId;

        // ── Self-healing state resync on join/reconnect ──────────────────────
        // Send orchestration state and all agent states to the reconnecting socket
        const orch = this.getService('orchestration');
        if (orch) {
            if (orch.getOrchestratorState) socket.emit('orchestration_state', orch.getOrchestratorState());
            if (orch.getAllAgentStates) socket.emit('all_agent_states', orch.getAllAgentStates());
        }

        // Broadcast updated presence count to room
        if (this.io) {
            this.io.in(room).fetchSockets().then(sockets => {
                this.io.to(room).emit('presence_update', { count: sockets.length, room });
            }).catch(() => {});
        }
    }

    /**
     * broadcast() — emits to all clients watching the active conversation.
     * Falls back to global emit if no conversation is loaded.
     */
    broadcast(event, data) {
        if (!this.io) return;
        try {
            const conv = this.getService('conversation');
            const convId = conv?.getId?.();
            if (convId) {
                this.io.to(`conv:${convId}`).emit(event, data);
            } else {
                this.io.emit(event, data);
            }
        } catch (e) {
            // Swallow broadcast errors — never let socket.io issues crash the server
        }
    }

    /**
     * broadcastVolatile() — like broadcast() but uses Socket.IO volatile flag.
     * Volatile events are dropped if the client is not ready to receive.
     * Use for high-frequency / non-critical updates: activity feed, stream deltas, thinking.
     */
    broadcastVolatile(event, data) {
        if (!this.io) return;
        try {
            const conv = this.getService('conversation');
            const convId = conv?.getId?.();
            if (convId) {
                this.io.to(`conv:${convId}`).volatile.emit(event, data);
            } else {
                this.io.volatile.emit(event, data);
            }
        } catch (e) {
            // Volatile broadcast is non-critical; swallow errors to prevent process crash
        }
    }

    /**
     * broadcastAll() — server-wide events (restarts, prereq alerts, etc.)
     * Sends to every connected socket regardless of conversation.
     */
    broadcastAll(event, data) {
        if (!this.io) return;
        try { this.io.emit(event, data); } catch (e) { /* swallow — never crash on broadcast */ }
    }

    /**
     * broadcastToRoom(room, event, data) — targeted room broadcast.
     */
    broadcastToRoom(room, event, data) {
        if (this.io) this.io.to(room).emit(event, data);
    }

    // ==================== WEB PUSH ====================

    registerPushSubscription(socketId, sub) {
        this._pushSubscriptions.set(socketId, sub);
        this.log(`[Push] Subscription registered (${this._pushSubscriptions.size} total)`, 'info');
    }

    unregisterPushSubscription(socketId) {
        if (this._pushSubscriptions.delete(socketId)) {
            this.log(`[Push] Subscription removed (${this._pushSubscriptions.size} remaining)`, 'info');
        }
    }

    async sendPush(title, body, opts = {}) {
        if (!webpush || this._pushSubscriptions.size === 0) return;
        const payload = JSON.stringify({ title, body, tag: 'overlord-push', ...opts });
        const dead = [];
        for (const [id, sub] of this._pushSubscriptions) {
            try {
                await webpush.sendNotification(sub, payload);
            } catch (e) {
                // 410 Gone or 404 = subscription expired/unsubscribed — remove it
                if (e.statusCode === 410 || e.statusCode === 404) dead.push(id);
                else this.log(`[Push] Send error: ${e.message}`, 'warning');
            }
        }
        dead.forEach(id => this._pushSubscriptions.delete(id));
    }

    // ==================== RATE LIMITING ====================

    /**
     * Simple per-socket token bucket rate limiter.
     * Returns true if the event should be processed, false if throttled.
     * Bucket: 20 events per 5 seconds (refills smoothly).
     */
    checkRateLimit(socket) {
        if (!socket.data) socket.data = {};
        const now = Date.now();
        const cfg = this.getService('config') || {};
        const maxTokens = cfg.rateLimitTokens || 20;
        const refillRate = cfg.rateLimitRefillRate || 4;
        const bucket = socket.data.rateBucket || { tokens: maxTokens, lastRefill: now };

        // Refill at configurable rate (tokens/sec)
        const elapsed = (now - bucket.lastRefill) / 1000;
        bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsed * refillRate);
        bucket.lastRefill = now;

        if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
            socket.data.rateBucket = bucket;
            return true;
        }

        socket.data.rateBucket = bucket;
        return false;
    }

    // ==================== MESSAGE QUEUE ====================

    /**
     * If the AI is processing, queue incoming messages instead of dropping them.
     * Each entry: { id, text, queuedAt }
     * At most `messageQueueSize` messages buffered; oldest is dropped if full.
     * Returns the queued item so callers can broadcast the updated queue.
     */
    queueUserMessage(text) {
        if (!this._msgQueue) this._msgQueue = [];
        const cfg = this.getService('config') || {};
        const maxSize = cfg.messageQueueSize || 10; // allow more with managed queue
        if (this._msgQueue.length >= maxSize) {
            this._msgQueue.shift(); // drop oldest
        }
        const item = { id: 'mq_' + Date.now() + '_' + Math.random().toString(36).slice(2,6), text, queuedAt: new Date().toISOString() };
        this._msgQueue.push(item);
        return item;
    }

    drainMessageQueue() {
        if (!this._msgQueue || this._msgQueue.length === 0) return;
        const cfg = this.getService('config') || {};
        const mode = cfg.queueDrainMode || 'consolidated';
        if (mode === 'consolidated' && this._msgQueue.length > 1) {
            // Join all queued messages into a single prompt separated by dividers
            const combined = this._msgQueue.map(m => m.text).join('\n\n---\n\n');
            this._msgQueue = [];
            this.broadcast('queue_updated', []);
            this.emit('user_message', combined, null);
        } else {
            const next = this._msgQueue.shift();
            if (next) {
                // Broadcast the remaining queue so clients update immediately
                this.broadcast('queue_updated', this._msgQueue.slice());
                this.emit('user_message', next.text, null);
            }
        }
    }

    /** Broadcast the current queue to all clients in the active room */
    broadcastQueue() {
        this.broadcast('queue_updated', (this._msgQueue || []).slice());
    }

    // ── Hot Chat Injection ──────────────────────────────────────────────────
    // Hot injections are inserted into the orchestrator's context at the next
    // safe cycle boundary (after tool results, before the next AI call).
    // Unlike the regular queue, they don't wait until the task is fully done.

    hotInject(text) {
        if (!this._hotInjectBuffer) this._hotInjectBuffer = [];
        const item = {
            id: 'hi_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            text: text.trim(),
            injectedAt: new Date().toISOString()
        };
        this._hotInjectBuffer.push(item);
        this.broadcast('hot_inject_pending', {
            count: this._hotInjectBuffer.length,
            preview: item.text.substring(0, 80)
        });
        this.log(`[HotInject] Buffered: "${item.text.substring(0, 60)}..."`, 'info');
        return item;
    }

    consumeHotInject() {
        if (!this._hotInjectBuffer || this._hotInjectBuffer.length === 0) return null;
        const item = this._hotInjectBuffer.shift();
        this.broadcast('hot_inject_pending', { count: this._hotInjectBuffer.length, preview: null });
        return item;
    }

    broadcastHotInjectApplied(item) {
        this.broadcast('hot_inject_applied', { id: item.id, text: item.text });
    }

    // Bridge Socket.IO events to Hub events
    setupSocketBridge() {
        if (!this.io) return;

        // ── /metrics namespace — live server stats streamed every 3s ──────────
        const metricsNs = this.io.of('/metrics');
        let _lastCpuUsage = process.cpuUsage();
        let _lastCpuTs = Date.now();
        let _lastMetricsTick = null;

        const _getMetricsTick = () => {
            const now = Date.now();
            const cpuNow = process.cpuUsage();
            const elapsed = (now - _lastCpuTs) / 1000; // seconds
            const userDelta = (cpuNow.user - _lastCpuUsage.user) / 1e6;
            const sysDelta  = (cpuNow.system - _lastCpuUsage.system) / 1e6;
            const cpuPct = elapsed > 0 ? Math.min(100, Math.round(((userDelta + sysDelta) / elapsed) * 100)) : 0;
            _lastCpuUsage = cpuNow;
            _lastCpuTs = now;

            const mem = process.memoryUsage();
            return {
                cpu:    cpuPct,
                heapMB: Math.round(mem.heapUsed / 1024 / 1024),
                rssMB:  Math.round(mem.rss / 1024 / 1024),
                sockets: this.io.engine.clientsCount || 0,
                uptime: Math.round(process.uptime()),
                ts: now,
            };
        };

        // Measure event loop lag via setImmediate trick — store in rolling var
        let _loopLagMs = 0;
        const _measureLoopLag = () => {
            const t = Date.now();
            setImmediate(() => { _loopLagMs = Date.now() - t; setTimeout(_measureLoopLag, 1000); });
        };
        _measureLoopLag();

        // Stream metrics every 3s (volatile — drops if client isn't ready)
        setInterval(() => {
            try {
                const tick = _getMetricsTick();
                tick.loopLag = _loopLagMs;
                _lastMetricsTick = tick;
                metricsNs.volatile.emit('tick', tick);
            } catch (e) {
                // Metrics emit is non-critical; swallow errors to prevent process crash
            }
        }, 3000);

        // Send current state immediately on new /metrics connection
        metricsNs.on('connection', (socket) => {
            if (_lastMetricsTick) socket.emit('tick', _lastMetricsTick);
        });

        // ── Backchannel history store (in-memory, capped at 500 entries) ──────
        this._backchannelHistory = [];

        // Listen for backchannel_push from orchestration module
        this.on('backchannel_push', (msg) => {
            this._backchannelHistory.push(msg);
            if (this._backchannelHistory.length > 500) this._backchannelHistory.shift();
            this.broadcast('backchannel_msg', msg);
        });

        // ── Socket.IO middleware: initialize rate bucket + debug logging ───────
        this.io.use((socket, next) => {
            if (!socket.data) socket.data = {};
            socket.data.rateBucket = { tokens: 20, lastRefill: Date.now() };
            next();
        });

        // ── Milestone completed → auto-merge branch ──────────────────────────
        this.on('milestone_completed', async (ms) => {
            const git = this.getService('git');
            if (!git || !git.mergeBranch) return;
            try {
                await git.mergeBranch(ms.branch);
                this.log('[Milestone] Auto-merged: ' + ms.branch, 'success');
                this.broadcastAll('agent_activity', { type: 'milestone_merged', data: { name: ms.text, branch: ms.branch } });
                this.broadcastAll('milestone_complete_celebration', { milestoneId: ms.id, name: ms.text });
            } catch (e) {
                this.log('[Milestone] merge failed: ' + e.message, 'warn');
            }
        });

        // milestone_all_tasks_done is broadcast directly from orchestration-module
        // with { milestoneId, name } — no hub relay needed

        this.io.on('connection', (socket) => {
            // --- Join conversation room on connect ---
            // Client should emit 'join_conversation' with the convId they're viewing.
            // We also auto-join the current server-side active conversation.
            const conv = this.getService('conversation');
            const activeConvId = conv?.getId?.();
            if (activeConvId) {
                this.joinConversationRoom(socket, activeConvId);
            }

            // Forward client events to hub
            socket.on('user_input', (text) => {
                if (!this.checkRateLimit(socket)) {
                    socket.emit('log', { time: new Date().toISOString().split('T')[1].slice(0,8), message: 'Rate limited — slow down', type: 'warning' });
                    return;
                }
                this.emit('user_message', text, socket);
            });
            socket.on('cancel', () => this.emit('cancel_request', socket));

            // ── WebSocket latency measurement (RTT ping) ──────────────────────
            socket.on('ping_rtt', (clientTs, cb) => {
                if (typeof cb === 'function') cb(clientTs);
            });

            // ── Message queue management ──────────────────────────────────────
            socket.on('get_message_queue', (cb) => {
                if (typeof cb === 'function') cb((this._msgQueue || []).slice());
                else socket.emit('queue_updated', (this._msgQueue || []).slice());
            });

            socket.on('remove_queued_message', (id, cb) => {
                if (this._msgQueue) this._msgQueue = this._msgQueue.filter(m => m.id !== id);
                this.broadcastQueue();
                if (typeof cb === 'function') cb({ success: true, queue: (this._msgQueue || []).slice() });
            });

            socket.on('edit_queued_message', ({ id, text }, cb) => {
                const item = (this._msgQueue || []).find(m => m.id === id);
                if (item && text && text.trim()) item.text = text.trim();
                this.broadcastQueue();
                if (typeof cb === 'function') cb({ success: !!item, queue: (this._msgQueue || []).slice() });
            });

            socket.on('reorder_queue', (ids, cb) => {
                if (this._msgQueue && Array.isArray(ids)) {
                    const map = new Map(this._msgQueue.map(m => [m.id, m]));
                    const reordered = ids.map(id => map.get(id)).filter(Boolean);
                    const extras = this._msgQueue.filter(m => !ids.includes(m.id));
                    this._msgQueue = [...reordered, ...extras];
                }
                this.broadcastQueue();
                if (typeof cb === 'function') cb({ success: true, queue: (this._msgQueue || []).slice() });
            });

            socket.on('clear_queue', (cb) => {
                this._msgQueue = [];
                this.broadcastQueue();
                if (typeof cb === 'function') cb({ success: true });
            });

            socket.on('force_dequeue', ({ id } = {}, cb) => {
                if (!this._msgQueue) this._msgQueue = [];
                const idx = id ? this._msgQueue.findIndex(m => m.id === id) : 0;
                if (idx === -1) { if (typeof cb === 'function') cb({ success: false }); return; }
                const [item] = this._msgQueue.splice(idx, 1);
                this.broadcast('queue_updated', this._msgQueue.slice());
                if (item) this.emit('user_message', item.text, null);
                if (typeof cb === 'function') cb({ success: true, queue: this._msgQueue.slice() });
            });

            // ── Hot Chat Injection ────────────────────────────────────────────
            // Injects a message at the next cycle boundary when AI is busy.
            // If AI is not busy, routes as a regular message immediately.
            socket.on('hot_inject', (text, cb) => {
                if (!text || !text.trim()) { if (typeof cb === 'function') cb({ status: 'empty' }); return; }
                const orch = this.getService('orchestrator');
                const busy = orch?.isProcessing?.() || false;
                if (busy) {
                    const item = this.hotInject(text.trim());
                    if (typeof cb === 'function') cb({ status: 'hot_queued', id: item.id, queueSize: this._hotInjectBuffer.length });
                } else {
                    // Not busy — treat as regular user message
                    this.emit('user_message', text.trim(), socket);
                    if (typeof cb === 'function') cb({ status: 'immediate' });
                }
            });

            socket.on('get_hot_inject_queue', (cb) => {
                if (typeof cb === 'function') cb((this._hotInjectBuffer || []).slice());
            });

            socket.on('clear_hot_inject_queue', (cb) => {
                this._hotInjectBuffer = [];
                this.broadcast('hot_inject_pending', { count: 0, preview: null });
                if (typeof cb === 'function') cb({ success: true });
            });

            socket.on('force_dequeue_all', ({ mode } = {}, cb) => {
                if (!this._msgQueue || this._msgQueue.length === 0) { if (typeof cb === 'function') cb({ success: true }); return; }
                const drainMode = mode || 'consolidated';
                if (drainMode === 'consolidated') {
                    const combined = this._msgQueue.map(m => m.text).join('\n\n---\n\n');
                    this._msgQueue = [];
                    this.broadcast('queue_updated', []);
                    this.emit('user_message', combined, null);
                } else {
                    // Sequential: send one now, rest stay (normal drain will handle remainder)
                    const next = this._msgQueue.shift();
                    this.broadcast('queue_updated', this._msgQueue.slice());
                    if (next) this.emit('user_message', next.text, null);
                }
                if (typeof cb === 'function') cb({ success: true, queue: this._msgQueue.slice() });
            });

            socket.on('new_conversation', () => this.emit('new_conversation', socket));
            socket.on('approve_checkpoint', () => this.emit('checkpoint_approved', socket));
            socket.on('approval_response', (data) => {
                this.emit('approval_response', data, socket);
                // Notify every other connected client so they dismiss their approval modal too.
                // Whichever device (phone, tablet, desktop) submitted first wins — the rest clear.
                this.broadcastAll('approval_resolved', { toolId: data.toolId, approved: data.approved });
            });
            socket.on('register_client', (data) => this.emit('client_registered', data, socket));

            // ── Web Push subscription registration ───────────────────────────
            socket.on('push_subscribe', (sub) => {
                if (sub && sub.endpoint) this.registerPushSubscription(socket.id, sub);
            });
            socket.on('push_resubscribe', (sub) => {
                // Client received pushsubscriptionchange from SW and got a fresh sub
                if (sub && sub.endpoint) this.registerPushSubscription(socket.id, sub);
            });

            // ── Chat mode ────────────────────────────────────────────────────
            socket.on('set_mode', (mode) => {
                const valid = ['auto', 'plan', 'ask', 'pm', 'bypass'];
                if (!valid.includes(mode)) return;
                const config = this.getService('config');
                if (config) config.chatMode = mode;
                this.log('Chat mode → ' + mode + (mode === 'bypass' ? ' ⚠️  ALL APPROVALS DISABLED' : ''), 'info');
                this.broadcastAll('mode_changed', { mode });
                // Cancel any pending plan when switching away from plan mode
                if (mode !== 'plan') this.emit('plan_cancelled');
                // ── Live bypass: if switching TO bypass while approvals are pending,
                // auto-approve them so in-flight agents immediately stop waiting.
                if (mode === 'bypass') {
                    this.emit('bypass_active');
                }
            });

            // ── User input response (for ask_user tool) ──────────────────────
            socket.on('input_response', (data) => this.emit('input_response', data));

            // ── Plan approval ────────────────────────────────────────────────
            socket.on('approve_plan', () => {
                this.emit('plan_approved');
                // Tell every other device to dismiss the plan bar immediately —
                // whichever device tapped "Approve" first wins.
                this.broadcastAll('plan_approved_ack', {});
            });
            socket.on('cancel_plan', () => {
                this.emit('plan_cancelled');
                // plan_cancelled_ack is already broadcast by orchestration-module
                // after deleting tasks, so no extra broadcast needed here.
            });
            socket.on('revise_plan', (feedback) => {
                if (typeof feedback === 'string' && feedback.trim()) {
                    this.emit('plan_revision', feedback.trim());
                    // Hide the plan bar on all devices while the revision is being
                    // generated — a new plan_ready will arrive when ready.
                    this.broadcastAll('plan_cancelled_ack', {});
                }
            });
            socket.on('switch_plan_variant', (data) => this.emit('switch_plan_variant', data || {}));

            // --- Room: client explicitly joins a conversation ---
            socket.on('join_conversation', (convId, ack) => {
                this.joinConversationRoom(socket, convId);
                // Send full state replay to this socket
                const conv = this.getService('conversation');
                if (conv) {
                    const history = conv.getHistory();
                    socket.emit('conversation_loaded', {
                        id: convId,
                        messages: history,
                        roadmap: conv.getRoadmap()
                    });
                    if (conv.getContextUsage) {
                        socket.emit('context_warning', conv.getContextUsage());
                    }
                }
                if (typeof ack === 'function') ack({ joined: `conv:${convId}` });
            });

            // --- Room presence: who's in this conversation? ---
            socket.on('get_room_presence', async (convId, ack) => {
                if (!this.io) return;
                const room = `conv:${convId}`;
                const sockets = await this.io.in(room).fetchSockets();
                if (typeof ack === 'function') {
                    ack({ room, count: sockets.length });
                }
            });
            
            // Config management - update custom instructions or project memory
            socket.on('update_config', (data) => {
                const config = this.getService('config');
                if (config) {
                    if (data.model !== undefined) {
                        const allowed = ['MiniMax-M2.5-highspeed', 'MiniMax-M2.5'];
                        if (allowed.includes(data.model)) config.model = data.model;
                    }
                    if (data.customInstructions !== undefined) {
                        config.customInstructions = String(data.customInstructions).substring(0, 4000);
                    }
                    if (data.projectMemory !== undefined) {
                        config.projectMemory = String(data.projectMemory);
                    }
                    // AutoQA settings — user-controlled quality gates
                    if (data.autoQA !== undefined) config.autoQA = Boolean(data.autoQA);
                    if (data.autoQALint !== undefined) config.autoQALint = Boolean(data.autoQALint);
                    if (data.autoQATypes !== undefined) config.autoQATypes = Boolean(data.autoQATypes);
                    if (data.autoQATests !== undefined) config.autoQATests = Boolean(data.autoQATests);
                    // Compaction settings
                    if (data.autoCompact !== undefined) config.autoCompact = Boolean(data.autoCompact);
                    if (data.compactKeepRecent !== undefined) config.compactKeepRecent = Math.max(5, Math.min(50, parseInt(data.compactKeepRecent, 10) || 20));
                    // Behavior limits
                    if (data.maxAICycles !== undefined) {
                        const _c = parseInt(data.maxAICycles, 10);
                        // 0 = unlimited sentinel; otherwise clamp to >= 1 with no upper cap
                        config.maxAICycles = isNaN(_c) ? 250 : (_c === 0 ? 0 : Math.max(1, _c));
                    }
                    if (data.maxQAAttempts !== undefined) config.maxQAAttempts = Math.max(1, Math.min(10, parseInt(data.maxQAAttempts, 10) || 3));
                    if (data.approvalTimeoutMs !== undefined) config.approvalTimeoutMs = Math.max(10000, parseInt(data.approvalTimeoutMs, 10) || 300000);
                    if (data.requestTimeoutMs !== undefined) config.requestTimeoutMs = Math.max(10000, parseInt(data.requestTimeoutMs, 10) || 90000);
                    if (data.sessionNotesLines !== undefined) config.sessionNotesLines = Math.max(1, Math.min(200, parseInt(data.sessionNotesLines, 10) || 50));
                    if (data.timelineLines !== undefined) config.timelineLines = Math.max(1, Math.min(100, parseInt(data.timelineLines, 10) || 20));
                    if (data.rateLimitTokens !== undefined) config.rateLimitTokens = Math.max(1, Math.min(100, parseInt(data.rateLimitTokens, 10) || 20));
                    if (data.rateLimitRefillRate !== undefined) config.rateLimitRefillRate = Math.max(0.5, Math.min(20, parseFloat(data.rateLimitRefillRate) || 4));
                    if (data.messageQueueSize !== undefined) config.messageQueueSize = Math.max(0, Math.min(20, parseInt(data.messageQueueSize, 10) || 3));
                    if (data.chatMode !== undefined && ['auto', 'plan', 'ask', 'pm'].includes(data.chatMode)) config.chatMode = data.chatMode;
                    // Per-mode model switching
                    if (data.autoModelSwitch !== undefined) config.autoModelSwitch = Boolean(data.autoModelSwitch);
                    if (data.pmModel !== undefined) config.pmModel = String(data.pmModel).trim().substring(0, 100);
                    if (data.maxParallelAgents !== undefined) {
                        const n = parseInt(data.maxParallelAgents, 10);
                        config.maxParallelAgents = isNaN(n) ? 3 : Math.max(1, Math.min(8, n));
                    }
                    if (data.autoCreateIssues !== undefined) config.autoCreateIssues = Boolean(data.autoCreateIssues);
                    if (data.taskEnforcement !== undefined) config.taskEnforcement = Boolean(data.taskEnforcement);
                    // Response quality guardrails
                    if (data.noTruncate !== undefined) config.noTruncate = Boolean(data.noTruncate);
                    if (data.alwaysSecurity !== undefined) config.alwaysSecurity = Boolean(data.alwaysSecurity);
                    if (data.neverStripFeatures !== undefined) config.neverStripFeatures = Boolean(data.neverStripFeatures);
                    // Strict completion mode
                    if (data.strictCompletion !== undefined) config.strictCompletion = Boolean(data.strictCompletion);
                    // Queue drain mode
                    if (data.queueDrainMode !== undefined && ['consolidated', 'sequential'].includes(data.queueDrainMode)) config.queueDrainMode = data.queueDrainMode;
                    // Thinking mode
                    if (data.thinkingEnabled !== undefined) config.thinkingEnabled = Boolean(data.thinkingEnabled);
                    if (data.thinkingBudget !== undefined) { const tb = parseInt(data.thinkingBudget, 10); if (!isNaN(tb) && tb >= 512) config.thinkingBudget = tb; }
                    // Plan length
                    if (data.planLength !== undefined && ['short','regular','long','unlimited'].includes(data.planLength)) config.planLength = data.planLength;
                    // GitOps auto-commit settings
                    if (data.gitOpsEnabled !== undefined) config.gitOpsEnabled = Boolean(data.gitOpsEnabled);
                    if (data.gitOpsTrigger !== undefined && ['every','task','milestone','count','manual'].includes(data.gitOpsTrigger)) config.gitOpsTrigger = data.gitOpsTrigger;
                    if (data.gitOpsCommitStyle !== undefined && ['comprehensive','conventional','brief'].includes(data.gitOpsCommitStyle)) config.gitOpsCommitStyle = data.gitOpsCommitStyle;
                    if (data.gitOpsPush !== undefined && ['always','never','ask'].includes(data.gitOpsPush)) config.gitOpsPush = data.gitOpsPush;
                    if (data.gitOpsMinChanges !== undefined) { const n = parseInt(data.gitOpsMinChanges, 10); if (!isNaN(n) && n >= 1) config.gitOpsMinChanges = n; }
                    // Also propagate behavior limits to orchestration module
                    const orch = this.getService('orchestration');
                    if (orch && orch._updateLimits) orch._updateLimits(config);
                    // Persist to disk so settings survive server restarts
                    if (typeof config.save === 'function') config.save();
                    this.log('Config updated: ' + Object.keys(data).join(', '), 'info');
                    socket.emit('config_updated', {
                        model: config.model,
                        customInstructions: config.customInstructions,
                        projectMemory: config.projectMemory,
                        autoQA: config.autoQA,
                        autoQALint: config.autoQALint,
                        autoQATypes: config.autoQATypes,
                        autoQATests: config.autoQATests,
                        autoCompact: config.autoCompact,
                        compactKeepRecent: config.compactKeepRecent,
                        maxAICycles: config.maxAICycles,
                        maxQAAttempts: config.maxQAAttempts,
                        approvalTimeoutMs: config.approvalTimeoutMs,
                        requestTimeoutMs: config.requestTimeoutMs,
                        sessionNotesLines: config.sessionNotesLines,
                        timelineLines: config.timelineLines,
                        rateLimitTokens: config.rateLimitTokens,
                        rateLimitRefillRate: config.rateLimitRefillRate,
                        messageQueueSize: config.messageQueueSize,
                        maxParallelAgents: config.maxParallelAgents ?? 3,
                        autoCreateIssues: config.autoCreateIssues === true,
                        taskEnforcement: config.taskEnforcement === true,
                        noTruncate: config.noTruncate === true,
                        alwaysSecurity: config.alwaysSecurity === true,
                        neverStripFeatures: config.neverStripFeatures === true,
                        strictCompletion: config.strictCompletion !== false,
                        autoModelSwitch: config.autoModelSwitch === true,
                        pmModel: config.pmModel || 'MiniMax-Text-01',
                        queueDrainMode: config.queueDrainMode || 'consolidated',
                        thinkingEnabled: config.thinkingEnabled === true,
                        thinkingBudget: config.thinkingBudget || 2048,
                        planLength: config.planLength || 'regular',
                        gitOpsEnabled: config.gitOpsEnabled !== false,
                        gitOpsTrigger: config.gitOpsTrigger || 'task',
                        gitOpsCommitStyle: config.gitOpsCommitStyle || 'comprehensive',
                        gitOpsPush: config.gitOpsPush || 'always',
                        gitOpsMinChanges: config.gitOpsMinChanges || 3
                    });
                }
            });

            // Get current config (for settings UI)
            socket.on('get_config', () => {
                const config = this.getService('config');
                if (config) {
                    socket.emit('config_data', {
                        model: config.model,
                        customInstructions: config.customInstructions || '',
                        projectMemory: config.projectMemory || '',
                        maxTokens: config.maxTokens,
                        temperature: config.temperature,
                        thinkingLevel: config.thinkingLevel,
                        autoQA: config.autoQA !== false,
                        autoQALint: config.autoQALint !== false,
                        autoQATypes: config.autoQATypes !== false,
                        autoQATests: config.autoQATests === true,
                        autoCompact: config.autoCompact !== false,
                        compactKeepRecent: config.compactKeepRecent || 20,
                        // Behavior limits
                        maxAICycles: config.maxAICycles ?? 250,
                        maxQAAttempts: config.maxQAAttempts || 3,
                        approvalTimeoutMs: config.approvalTimeoutMs || 300000,
                        requestTimeoutMs: config.requestTimeoutMs || 90000,
                        sessionNotesLines: config.sessionNotesLines || 50,
                        timelineLines: config.timelineLines || 20,
                        rateLimitTokens: config.rateLimitTokens || 20,
                        rateLimitRefillRate: config.rateLimitRefillRate || 4,
                        messageQueueSize: config.messageQueueSize || 3,
                        chatMode: config.chatMode || 'auto',
                        maxParallelAgents: config.maxParallelAgents ?? 3,
                        autoCreateIssues: config.autoCreateIssues === true,
                        taskEnforcement: config.taskEnforcement === true,
                        noTruncate: config.noTruncate === true,
                        alwaysSecurity: config.alwaysSecurity === true,
                        neverStripFeatures: config.neverStripFeatures === true,
                        strictCompletion: config.strictCompletion !== false,
                        autoModelSwitch: config.autoModelSwitch === true,
                        pmModel: config.pmModel || 'MiniMax-Text-01',
                        queueDrainMode: config.queueDrainMode || 'consolidated',
                        thinkingEnabled: config.thinkingEnabled === true,
                        thinkingBudget: config.thinkingBudget || 2048,
                        planLength: config.planLength || 'regular',
                        gitOpsEnabled: config.gitOpsEnabled !== false,
                        gitOpsTrigger: config.gitOpsTrigger || 'task',
                        gitOpsCommitStyle: config.gitOpsCommitStyle || 'comprehensive',
                        gitOpsPush: config.gitOpsPush || 'always',
                        gitOpsMinChanges: config.gitOpsMinChanges || 3
                    });
                }
            });

            // Manual GitOps commit trigger from UI
            socket.on('gitops_commit_now', () => {
                this.emit('gitops_commit_now');
            });

            // ── Agent session socket handlers ──
            socket.on('direct_message', ({ agentName, message }) => {
                const orch = this.getService('orchestration');
                if (orch && orch.runAgentSession) orch.runAgentSession(agentName, message);
            });

            socket.on('pause_agent', ({ agentName }) => {
                const orch = this.getService('orchestration');
                if (orch && orch.pauseAgent) orch.pauseAgent(agentName);
            });

            socket.on('resume_agent', ({ agentName }) => {
                const orch = this.getService('orchestration');
                if (orch && orch.resumeAgent) orch.resumeAgent(agentName);
            });

            socket.on('get_agent_session', ({ agentName }, ack) => {
                const orch = this.getService('orchestration');
                if (!orch) { if (ack) ack(null); return; }
                const state = orch.getAgentSessionState ? orch.getAgentSessionState(agentName) : null;
                const history = orch.getAgentHistory ? orch.getAgentHistory(agentName) : [];
                const inbox = orch.getAgentInbox ? orch.getAgentInbox(agentName) : [];
                if (ack) ack({ state, history, inbox });
            });

            // ── Agent comms backchannel ────────────────────────────────────────
            socket.on('orchestrator_send', ({ agentName, message }, cb) => {
                if (!agentName || !message) { if (cb) cb({ success: false, error: 'missing agentName or message' }); return; }
                const orch = this.getService('orchestration');
                if (orch?.runAgentSession) orch.runAgentSession(agentName, `[Orchestrator]: ${message}`);
                const msg = { from: 'orchestrator', to: agentName, content: message, ts: Date.now(), type: 'orchestrator_to_agent' };
                this._backchannelHistory.push(msg);
                if (this._backchannelHistory.length > 500) this._backchannelHistory.shift();
                this.broadcast('backchannel_msg', msg);
                if (cb) cb({ success: true });
            });

            socket.on('get_backchannel', (cb) => {
                if (typeof cb === 'function') cb((this._backchannelHistory || []).slice(-200));
            });

            // ── PM Query: project manager AI chat ────────────────────────────
            socket.on('pm_query', async (data, ack) => {
                if (typeof ack !== 'function') return;
                const ai = this.getService('ai');
                if (!ai || !ai.chatStream) return ack({ error: 'AI service not available' });

                const messages = Array.isArray(data && data.messages) ? data.messages : [];
                const systemCtx = (data && data.system) ? data.system : 'You are a concise Project Manager AI. Answer in 1-3 sentences.';

                let fullText = '';
                try {
                    await new Promise((resolve, reject) => {
                        ai.chatStream(
                            messages.length ? messages : [{ role: 'user', content: 'Hello' }],
                            (event) => {
                                if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                                    fullText += event.delta.text || '';
                                }
                            },
                            resolve, reject, systemCtx
                        );
                    });
                    ack({ text: fullText.trim() });
                } catch (err) {
                    ack({ error: 'AI request failed: ' + err.message });
                }
            });

            // Conversation management
            socket.on('list_conversations', () => {
                const conv = this.getService('conversation');
                if (conv) {
                    const list = conv.listConversations();
                    socket.emit('conversations_list', list);
                }
            });
            
            socket.on('load_conversation', (convId) => {
                const conv = this.getService('conversation');
                if (conv) {
                    const result = conv.loadConversation(convId);
                    if (result.success) {
                        // Emit the loaded conversation to this client
                        socket.emit('conversation_loaded', {
                            id: result.id,
                            messages: conv.getHistory(),
                            roadmap: conv.getRoadmap()
                        });
                        // Send context warning on load
                        if (conv.getContextUsage) {
                            socket.emit('context_warning', conv.getContextUsage());
                        }
                    } else {
                        socket.emit('conversation_error', { error: result.error });
                    }
                }
            });

            // Working directory management
            // NOTE: conv.setWorkingDirectory() already calls hub.broadcast('working_dir_update')
            // so we do NOT emit a second time here to avoid duplicate logs.
            socket.on('set_working_dir', (dir) => {
                const conv = this.getService('conversation');
                if (conv && conv.setWorkingDirectory) {
                    conv.setWorkingDirectory(dir);
                    // Also persist to active project data if one is loaded
                    const projects = this.getService('projects');
                    if (projects && projects.getActiveProjectId()) {
                        const aid = projects.getActiveProjectId();
                        const data = projects.getProjectData(aid);
                        if (data) { data.workingDir = dir; projects.saveProjectData(aid, data); }
                    }
                }
            });

            // ── Task events → TasksEngine (modules/tasks-engine.js) ───────────────
            // Bridge socket events to the tasks engine via hub EventEmitter.
            // All task logic (CRUD, broadcast) now lives in tasks-engine.js.
            socket.on('task_added',   (data)      => this.emit('socket:task_added',   { socket, data }));
            socket.on('task_toggled', (data)      => this.emit('socket:task_toggled', { socket, data }));
            socket.on('task_deleted', (data)      => this.emit('socket:task_deleted', { socket, data }));
            socket.on('task_updated', (data)      => this.emit('socket:task_updated', { socket, data }));

            // Agent management (add/remove agents dynamically)
            socket.on('add_agent', (agentData, cb) => {
                const agentMgr = this.getService('agentManager');
                if (!agentMgr || !agentMgr.createAgent) {
                    if (typeof cb === 'function') cb({ success: false, error: 'Agent manager unavailable' });
                    return;
                }

                // Project-scoped agents are stored in project data, not SQLite
                if (agentData.scope === 'project') {
                    const projects = this.getService('projects');
                    const activeProjectId = projects?.getActiveProjectId?.();
                    if (!activeProjectId) {
                        if (typeof cb === 'function') cb({ success: false, error: 'No active project — switch to a project first or create a global agent' });
                        return;
                    }
                    const result = agentMgr.createAgent(agentData);
                    if (result.success) {
                        projects.addProjectAgent(activeProjectId, result.agent);
                        socket.emit('agent_added', result);
                        this.broadcastTeamFromDB();
                    }
                    if (typeof cb === 'function') cb(result);
                    return;
                }

                const result = agentMgr.createAgent(agentData);
                socket.emit('agent_added', result);
                this.broadcastTeamFromDB();
                if (typeof cb === 'function') cb(result);
            });

            socket.on('remove_agent', (agentId) => {
                const agentMgr = this.getService('agentManager');
                if (agentMgr && agentMgr.deleteAgent) {
                    agentMgr.deleteAgent(agentId);
                    socket.emit('agent_removed', { success: true, id: agentId });
                    this.broadcastTeamFromDB();
                }
            });

            socket.on('list_agents', (cb) => {
                const agentMgr = this.getService('agentManager');
                const projects  = this.getService('projects');
                const activeProjectId = projects?.getActiveProjectId?.();
                const projectAgents = activeProjectId ? (projects.listProjectAgents?.(activeProjectId) || []) : [];
                const agents = agentMgr?.listAgents?.(projectAgents) || [];
                // Support both callback (Agent Manager UI) and broadcast (Team panel)
                if (typeof cb === 'function') {
                    cb(agents);
                } else {
                    socket.emit('agents_list', agents);
                }
            });

            // Update agent (edit name, role, description, instructions, tools, securityRole)
            socket.on('update_agent', (agentData, cb) => {
                const agentMgr = this.getService('agentManager');
                if (!agentMgr) { if (cb) cb({ success: false, error: 'Agent manager unavailable' }); return; }
                // updateAgent() handles upsert (inserts default agents on first customisation)
                const result = agentMgr.updateAgent(agentData.id, agentData);
                if (cb) cb(result);
                this.broadcastTeamFromDB();
            });

            // Get single agent by id or name
            socket.on('get_agent', (agentId, cb) => {
                const agentMgr = this.getService('agentManager');
                if (!agentMgr) { if (cb) cb(null); return; }
                const agent = agentMgr.getAgent(agentId);
                if (cb) cb(agent);
            });

            // Set agent tool permissions (replaces tools list)
            socket.on('set_agent_tools', (data, cb) => {
                const agentMgr = this.getService('agentManager');
                if (!agentMgr) { if (cb) cb({ success: false, error: 'Agent manager unavailable' }); return; }
                const result = agentMgr.updateAgent(data.agentId, { tools: data.tools });
                if (cb) cb(result);
            });

            // List groups
            socket.on('list_groups', (cb) => {
                const agentMgr = this.getService('agentManager');
                if (!agentMgr) { if (cb) cb([]); return; }
                if (cb) cb(agentMgr.listGroups());
            });

            // Create group
            socket.on('create_group', (groupData, cb) => {
                const agentMgr = this.getService('agentManager');
                if (!agentMgr) { if (cb) cb({ success: false }); return; }
                const result = agentMgr.createGroup(groupData);
                if (cb) cb(result);
            });

            // Update group
            socket.on('update_group', (data, cb) => {
                const agentMgr = this.getService('agentManager');
                if (!agentMgr || !data || !data.id) { if (cb) cb({ success: false }); return; }
                const result = agentMgr.updateGroup(data.id, data);
                if (cb) cb(result);
            });

            // Delete group
            socket.on('delete_group', (groupId, cb) => {
                const agentMgr = this.getService('agentManager');
                if (!agentMgr) { if (cb) cb({ success: false }); return; }
                const result = agentMgr.deleteGroup(groupId);
                if (cb) cb(result);
            });

            // Add agent to group
            socket.on('add_agent_to_group', (data, cb) => {
                const agentMgr = this.getService('agentManager');
                if (!agentMgr || !data || !data.agentId || !data.groupId) { if (cb) cb({ success: false }); return; }
                const result = agentMgr.addAgentToGroup(data.agentId, data.groupId);
                if (cb) cb(result);
            });

            // Remove agent from group
            socket.on('remove_agent_from_group', (data, cb) => {
                const agentMgr = this.getService('agentManager');
                if (!agentMgr || !data || !data.agentId) { if (cb) cb({ success: false }); return; }
                const result = agentMgr.removeAgentFromGroup(data.agentId);
                if (cb) cb(result);
            });

            // Context management

            // Context management
            socket.on('clear_context', () => {
                const conv = this.getService('conversation');
                if (conv && conv.clearHistory) {
                    conv.clearHistory();
                    socket.emit('messages_cleared');
                }
                // Also reset context tracker
                const tracker = this.getService('contextTracker');
                if (tracker && tracker.resetChat) {
                    tracker.resetChat();
                }
            });

            // Get context tracker info (merged with conversation context usage)
            socket.on('get_context_info', () => {
                socket.emit('context_info', this._buildContextInfo());
            });
            
            // Get process state
            socket.on('get_process_state', () => {
                socket.emit('process_state', this.getProcessState());
            });
            
            // Request server restart
            socket.on('request_restart', (data) => {
                const force = data?.force || false;
                socket.emit('restarting', { force });
                setTimeout(() => {
                    if (force) {
                        this.forceRestart();
                    } else {
                        this.requestRestart();
                    }
                }, 1000);
            });

            // Manual context compaction via AI summarization
            socket.on('manual_compact', async () => {
                const summarizer = this.getService('summarizer');
                const conv = this.getService('conversation');
                if (!summarizer || !conv) {
                    socket.emit('log', { time: new Date().toISOString().split('T')[1].slice(0,8), message: 'Summarizer not available', type: 'error' });
                    return;
                }
                const history = conv.getHistory();
                if (!summarizer.canCompact(history)) {
                    socket.emit('log', { time: new Date().toISOString().split('T')[1].slice(0,8), message: 'History too short to compact (need 10+ messages)', type: 'info' });
                    socket.emit('summarization_complete', { newLength: history.length, oldLength: history.length });
                    return;
                }
                try {
                    const newHistory = await summarizer.compactHistory(history);
                    conv.replaceHistory(newHistory);
                    // Refresh context info for all clients
                    socket.emit('get_context_info');
                } catch (err) {
                    this.log('Context compaction error: ' + err.message, 'error');
                }
            });

            // Archive and new conversation
            socket.on('archive_and_new', () => {
                const conv = this.getService('conversation');
                if (conv && conv.archiveCurrentAndNew) {
                    conv.archiveCurrentAndNew();
                    socket.emit('conversation_new', { id: conv.getId(), messages: [], roadmap: conv.getRoadmap() });
                }
            });

            // ── Milestone CRUD & Launch ─────────────────────────────────────────
            socket.on('list_milestones', (cb) => {
                const conv = this.getService('conversation');
                if (typeof cb === 'function') cb(conv ? conv.getMilestones() : []);
            });

            socket.on('add_milestone', (data, cb) => {
                const conv = this.getService('conversation');
                if (!conv) { if (typeof cb === 'function') cb({ error: 'Conversation service unavailable' }); return; }
                const ms = conv.addMilestone({ name: data.name || 'Untitled', description: data.description || '', color: data.color || '#58a6ff' });
                if (typeof cb === 'function') cb(ms);
            });

            socket.on('update_milestone', (data, cb) => {
                const conv = this.getService('conversation');
                if (!conv || !data || !data.id) { if (typeof cb === 'function') cb({ error: 'Bad request' }); return; }
                const ms = conv.updateMilestone(data.id, data);
                if (typeof cb === 'function') cb(ms || { error: 'Milestone not found' });
            });

            socket.on('delete_milestone', (id, cb) => {
                const conv = this.getService('conversation');
                if (!conv) { if (typeof cb === 'function') cb({ error: 'Conversation service unavailable' }); return; }
                const ok = conv.deleteMilestone(id);
                if (typeof cb === 'function') cb({ success: ok });
            });

            socket.on('launch_milestone', async (id, cb) => {
                const conv = this.getService('conversation');
                if (!conv) { if (typeof cb === 'function') cb({ error: 'Conversation service unavailable' }); return; }
                const ms = conv.launchMilestone(id);
                if (!ms) { if (typeof cb === 'function') cb({ error: 'Milestone not found' }); return; }
                const git = this.getService('git');
                if (git && git.checkoutBranch) {
                    try { await git.checkoutBranch(ms.branch); }
                    catch (e) { this.log('[Milestone] Branch checkout error: ' + e.message, 'warn'); }
                }
                this.broadcast('agent_activity', { type: 'milestone_launched', data: { name: ms.text, branch: ms.branch } });
                if (typeof cb === 'function') cb({ success: true, milestone: ms });
            });

            // Bridge to tasks-engine
            socket.on('assign_task_to_milestone', (data, cb) => this.emit('socket:assign_task_to_milestone', { socket, data, cb }));
            socket.on('focus_task',               (data, cb) => this.emit('socket:focus_task',               { socket, data, cb }));

            // ── Orchestrate milestone: mark active + broadcast + let AI know ──────
            socket.on('orchestrate_milestone', (milestoneId, cb) => {
                const conv = this.getService('conversation');
                if (!conv) { if (typeof cb === 'function') cb({ error: 'Conversation service unavailable' }); return; }
                const ms = conv.launchMilestone ? conv.launchMilestone(milestoneId) : null;
                if (!ms) { if (typeof cb === 'function') cb({ error: 'Milestone not found: ' + milestoneId }); return; }

                const allTasks = conv.getTasks ? conv.getTasks() : [];
                this.broadcastAll('tasks_update', allTasks);
                this.broadcast('agent_activity', {
                    type: 'milestone_launched',
                    data: { name: ms.text, branch: ms.branch }
                });
                this.log(`[orchestrate_milestone] "${ms.text}" → active`, 'info');
                if (typeof cb === 'function') cb({ success: true, milestone: ms });
            });

            // ── Project Management ────────────────────────────────────────────
            socket.on('list_projects', (cb) => {
                const projects = this.getService('projects');
                if (typeof cb === 'function') cb(projects ? projects.listProjects() : []);
            });

            socket.on('get_active_project', (cb) => {
                const projects = this.getService('projects');
                if (!projects) { if (typeof cb === 'function') cb({ project: null, data: null, projects: [] }); return; }
                const proj = projects.getActiveProject();
                const data = proj ? projects.getProjectData(proj.id) : null;
                if (typeof cb === 'function') cb({ project: proj, data, projects: projects.listProjects() });
            });

            socket.on('get_project', (id, cb) => {
                const projects = this.getService('projects');
                if (!projects) { if (typeof cb === 'function') cb({ error: 'Projects service unavailable' }); return; }
                const proj = projects.getProject(id);
                const data = proj ? projects.getProjectData(id) : null;
                // Include linked projects in data for UI
                const enrichedData = data ? { ...data, links: (proj && proj.linkedProjects) ? proj.linkedProjects.map(l => ({ targetId: l.id, relation: l.relationship || l.relation || 'related', note: l.note || '' })) : [] } : null;
                if (typeof cb === 'function') cb({ project: proj, data: enrichedData });
            });

            socket.on('create_project', (projectData, cb) => {
                const projects = this.getService('projects');
                if (!projects) { if (typeof cb === 'function') cb({ error: 'Projects service unavailable' }); return; }
                const result = projects.createProject(projectData);
                this.broadcastAll('projects_updated', projects.listProjects());
                if (typeof cb === 'function') cb({ success: true, ...result });
            });

            socket.on('update_project', (updateData, cb) => {
                const projects = this.getService('projects');
                if (!projects || !updateData || !updateData.id) { if (typeof cb === 'function') cb({ error: 'Bad request' }); return; }
                const proj = projects.updateProject(updateData.id, updateData);
                // If updating the active project's config fields, apply them live
                if (updateData.id === projects.getActiveProjectId()) {
                    const cfg = this.getService('config');
                    if (cfg) {
                        if (updateData.customInstructions !== undefined) cfg._projectCustomInstructions = updateData.customInstructions;
                        if (updateData.projectMemory !== undefined) cfg._projectMemory = updateData.projectMemory;
                        if (updateData.referenceDocumentation !== undefined) cfg._projectReferenceDocumentation = updateData.referenceDocumentation;
                        if (updateData.requirements !== undefined) cfg._projectRequirements = updateData.requirements;
                    }
                    if (updateData.workingDir) {
                        const conv = this.getService('conversation');
                        if (conv && conv.setWorkingDirectory) conv.setWorkingDirectory(updateData.workingDir);
                    }
                }
                this.broadcastAll('projects_updated', projects.listProjects());
                if (typeof cb === 'function') cb({ success: !!proj, project: proj });
            });

            socket.on('delete_project', (id, cb) => {
                const projects = this.getService('projects');
                if (!projects) { if (typeof cb === 'function') cb({ error: 'Projects service unavailable' }); return; }
                const ok = projects.deleteProject(id);
                this.broadcastAll('projects_updated', projects.listProjects());
                if (typeof cb === 'function') cb({ success: ok });
            });

            socket.on('switch_project', (id, cb) => {
                const projects = this.getService('projects');
                if (!projects) { if (typeof cb === 'function') cb({ error: 'Projects service unavailable' }); return; }
                const result = projects.switchProject(id);
                if (!result) { if (typeof cb === 'function') cb({ error: 'Project not found' }); return; }
                this.broadcastAll('projects_updated', projects.listProjects());
                // Broadcast project_switched with tasks/roadmap/workingDir so all clients update
                const conv = this.getService('conversation');
                this.broadcastAll('project_switched', {
                    projectId: id,
                    projectName: result.project ? result.project.name : id,
                    tasks: conv ? conv.getTasks() : [],
                    roadmap: conv ? conv.getRoadmap() : [],
                    workingDir: result.data ? result.data.workingDir : '',
                    conversationId: conv ? conv.getId?.() : null   // so client can joinConvRoom
                });
                if (typeof cb === 'function') cb({ success: true, ...result });
            });

            socket.on('link_projects', ({ id1, id2, relation, relationship, note }, cb) => {
                const projects = this.getService('projects');
                if (!projects) { if (typeof cb === 'function') cb({ error: 'Projects service unavailable' }); return; }
                // Accept both 'relation' and 'relationship' for compatibility
                const ok = projects.linkProjects(id1, id2, relation || relationship || 'related', note);
                this.broadcastAll('projects_updated', projects.listProjects());
                if (typeof cb === 'function') cb({ success: ok });
            });

            socket.on('unlink_projects', ({ id1, id2 }, cb) => {
                const projects = this.getService('projects');
                if (!projects) { if (typeof cb === 'function') cb({ error: 'Projects service unavailable' }); return; }
                const ok = projects.unlinkProjects(id1, id2);
                this.broadcastAll('projects_updated', projects.listProjects());
                if (typeof cb === 'function') cb({ success: ok });
            });

            // ── MCP Server management ─────────────────────────────────────────
            // Bridge socket events → hub EventEmitter so mcp-manager-module.js
            // handlers (which listen on hub.on('get_mcp_servers', ...)) are reached
            socket.on('get_mcp_servers',    ()     => this.emit('get_mcp_servers',    socket));
            socket.on('enable_mcp_server',  (data) => this.emit('enable_mcp_server',  socket, data));
            socket.on('disable_mcp_server', (data) => this.emit('disable_mcp_server', socket, data));
            socket.on('add_mcp_server',     (data) => this.emit('add_mcp_server',     socket, data));
            socket.on('remove_mcp_server',  (data) => this.emit('remove_mcp_server',  socket, data));

            // ── Task reorder → tasks-engine ────────────────────────────────────
            socket.on('tasks_reorder', (data) => this.emit('socket:tasks_reorder', { socket, data }));

            // ── AI Fill: generate improved agent field suggestions ──────────────
            socket.on('ai_fill_agent', async (data, ack) => {
                if (typeof ack !== 'function') return;
                const ai = this.getService('ai');
                if (!ai || !ai.chatStream) return ack({ error: 'AI service not available' });

                const hint         = (data && data.hint)         ? data.hint         : {};
                const lockedFields = (data && Array.isArray(data.lockedFields)) ? data.lockedFields : [];

                const ALL_TOOLS = [
                    'bash','powershell',
                    'read_file','read_file_lines','write_file','patch_file','append_file','list_dir',
                    'web_search','understand_image',
                    'system_info','get_working_dir','set_working_dir',
                    'list_agents','get_agent_info','assign_task',
                    'qa_run_tests','qa_check_lint','qa_check_types','qa_check_coverage',
                    'record_note','recall_notes',
                    'list_skills','get_skill','activate_skill'
                ];
                const SECURITY_ROLES = ['developer','security-aware','security-analyst','security-lead','ciso','readonly'];

                const lockedDesc = lockedFields.length
                    ? 'LOCKED (omit from output): ' + lockedFields.join(', ')
                    : 'No locked fields — improve all.';

                const ctx = [
                    hint.name         ? 'name: "' + hint.name + '"'               : '',
                    hint.role         ? 'role: "' + hint.role + '"'               : '',
                    hint.description  ? 'description: "' + hint.description + '"' : '',
                    hint.instructions ? 'instructions: "' + hint.instructions.substring(0,300) + '"' : '',
                    hint.securityRole ? 'securityRole: "' + hint.securityRole + '"' : '',
                    hint.tools && hint.tools.length ? 'current tools: ' + hint.tools.join(', ') : '',
                    hint.prompt       ? 'user note: "' + hint.prompt + '"'        : ''
                ].filter(Boolean).join('\n');

                const EXAMPLE_JSON = JSON.stringify({
                    name: 'agent-name-slug',
                    role: 'Short Role Title',
                    description: 'One or two sentences describing the agent.',
                    instructions: 'Specific instructions for the system prompt. Be concise and directive.',
                    securityRole: 'developer',
                    tools: ['bash', 'read_file', 'write_file']
                }, null, 2);

                const systemOverride = [
                    'You are an agent configuration assistant for an AI orchestration platform called OVERLORD.',
                    'OUTPUT FORMAT: You MUST respond with ONLY a single raw JSON object. No markdown. No code fences. No prose. No explanation before or after.',
                    'The VERY FIRST character of your response must be `{` and the VERY LAST character must be `}`.',
                    `Example of the exact output format required:\n${EXAMPLE_JSON}`,
                    `Security roles available: ${SECURITY_ROLES.join(', ')}`,
                    `Tools available: ${ALL_TOOLS.join(', ')}`,
                    'Field rules: name=lowercase-slug, role=2-5 words, description=1-2 sentences, instructions=2-4 specific directive sentences, securityRole=one of the available values, tools=array of available tool names.',
                    lockedDesc,
                    'Only include unlocked fields in your JSON output.'
                ].join('\n');

                const userMsg = [
                    'Improve or fill this agent configuration. Use the existing values as context — enhance them to be specific, professional, and complete.',
                    ctx ? `Existing values:\n${ctx}` : '(No existing values — generate a useful general-purpose developer agent.)',
                    hint.prompt ? `Additional instructions from user: "${hint.prompt}"` : '',
                    'Return ONLY the raw JSON object with these keys (omit locked fields): name, role, description, instructions, securityRole, tools'
                ].filter(Boolean).join('\n\n');

                // Helper to extract and parse JSON from potentially-noisy LLM output
                function extractJSON(text) {
                    let s = text.trim();
                    // Strip markdown code fences
                    const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/);
                    if (fenceMatch) s = fenceMatch[1].trim();
                    // Find outermost { ... }
                    const first = s.indexOf('{');
                    const last  = s.lastIndexOf('}');
                    if (first !== -1 && last > first) s = s.slice(first, last + 1);
                    return JSON.parse(s); // throws if invalid
                }

                // Attempt with up to 3 retries so transient JSON failures are recovered automatically
                let parsed = null;
                const MAX_ATTEMPTS = 3;
                for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                    let fullText = '';
                    try {
                        await new Promise((resolve, reject) => {
                            ai.chatStream(
                                [{ role: 'user', content: userMsg }],
                                (event) => {
                                    if (event.type === 'content_block_delta' && event.delta && event.delta.type === 'text_delta') {
                                        fullText += event.delta.text || '';
                                    }
                                },
                                resolve,
                                reject,
                                systemOverride
                            );
                        });
                    } catch (err) {
                        this.log(`[AI Fill] stream error (attempt ${attempt}): ` + err.message, 'error');
                        if (attempt === MAX_ATTEMPTS) return ack({ error: 'AI request failed: ' + err.message });
                        continue;
                    }

                    try {
                        parsed = extractJSON(fullText);
                        break; // success
                    } catch (e) {
                        this.log(`[AI Fill] JSON parse failed (attempt ${attempt}): ` + fullText.slice(0, 160), 'error');
                        if (attempt === MAX_ATTEMPTS) {
                            return ack({ error: 'AI returned invalid JSON after ' + MAX_ATTEMPTS + ' attempts. Please try again.' });
                        }
                        // Brief pause before retry
                        await new Promise(r => setTimeout(r, 500));
                    }
                }
                if (!parsed) return ack({ error: 'AI Fill: could not parse a valid response.' });

                // Sanitize result
                const out = {};
                ['name','role','description','instructions','securityRole'].forEach(f => {
                    if (!lockedFields.includes(f) && typeof parsed[f] === 'string' && parsed[f].trim()) {
                        out[f] = parsed[f].trim();
                    }
                });
                if (out.name) out.name = out.name.toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
                if (out.securityRole && !SECURITY_ROLES.includes(out.securityRole)) out.securityRole = 'developer';
                if (!lockedFields.includes('tools') && Array.isArray(parsed.tools)) {
                    out.tools = parsed.tools.filter(t => typeof t === 'string' && ALL_TOOLS.includes(t));
                }

                this.log('[AI Fill] generated config for: ' + (out.name || hint.name || '(unnamed)'), 'info');
                ack(out);
            });

            // ── AI Fill: Task creation ────────────────────────────────────────
            socket.on('ai_fill_task', async (data, ack) => {
                if (typeof ack !== 'function') return;
                const ai = this.getService('ai');
                if (!ai || !ai.chatStream) return ack({ error: 'AI service not available' });

                const hint         = (data && data.hint)         ? data.hint         : {};
                const agents       = (data && Array.isArray(data.agents))    ? data.agents    : [];
                const milestones   = (data && Array.isArray(data.milestones)) ? data.milestones : [];
                const lockedFields = (data && Array.isArray(data.lockedFields)) ? data.lockedFields : [];

                const PRIORITIES = ['critical', 'high', 'medium', 'low'];
                const agentNames = agents.map(a => a.name);
                const lockedDesc = lockedFields.length ? 'LOCKED (omit): ' + lockedFields.join(', ') : 'No locked fields.';

                const ctx = [
                    hint.title       ? `title: "${hint.title}"`             : '',
                    hint.description ? `description: "${hint.description.substring(0,300)}"` : '',
                    hint.priority    ? `priority: "${hint.priority}"`        : '',
                    hint.assignee    ? `assignee: "${hint.assignee}"`        : '',
                    hint.milestoneId ? `milestoneId: "${hint.milestoneId}"` : '',
                    hint.prompt      ? `user note: "${hint.prompt}"`         : ''
                ].filter(Boolean).join('\n');

                const systemOverride = `You are a project management assistant for an AI dev platform.
Respond with ONLY valid JSON — no markdown, no code fences.
Available agents: ${agentNames.length ? agentNames.join(', ') : '(none)'}
Available priorities: ${PRIORITIES.join(', ')}
Available milestones (id: name): ${milestones.map(m => `${m.id}: ${m.text}`).join(', ') || '(none)'}
${lockedDesc}
Rules:
- title: short imperative (5-10 words)
- description: 2-4 sentences explaining what needs to be done and why
- priority: one of ${PRIORITIES.join('/')}
- assignee: array of agent names from Available agents, or [] if none fit
- suggested_agents: array of {name, role, description} for agents that WOULD be ideal but aren't in Available agents. Empty array if all needed agents exist.
- milestoneId: id from Available milestones if this task fits one, else null
- dependencies: array of task title strings that must be completed before this task
- actions: object with keys "test" (bool), "lint" (bool), "approval" (bool)`;

                const userMsg = `Fill or improve this task. Use existing values as context.\n\n${ctx || '(no context — create a well-structured dev task)'}\n\nReturn JSON with keys: title, description, priority, assignee, suggested_agents, milestoneId, dependencies, actions`;

                let fullText = '';
                try {
                    await new Promise((resolve, reject) => {
                        ai.chatStream(
                            [{ role: 'user', content: userMsg }],
                            (event) => {
                                if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                                    fullText += event.delta.text || '';
                                }
                            },
                            resolve, reject, systemOverride
                        );
                    });
                } catch (err) {
                    return ack({ error: 'AI request failed: ' + err.message });
                }

                let jsonStr = fullText.trim();
                const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (fence) jsonStr = fence[1].trim();
                const fb = jsonStr.indexOf('{'), lb = jsonStr.lastIndexOf('}');
                if (fb !== -1 && lb > fb) jsonStr = jsonStr.slice(fb, lb + 1);

                let parsed;
                try { parsed = JSON.parse(jsonStr); }
                catch (e) { return ack({ error: 'AI returned invalid JSON — please try again.' }); }

                const out = {};
                if (!lockedFields.includes('title') && parsed.title)       out.title = String(parsed.title).trim();
                if (!lockedFields.includes('description') && parsed.description) out.description = String(parsed.description).trim();
                if (!lockedFields.includes('priority') && parsed.priority && PRIORITIES.includes(parsed.priority)) out.priority = parsed.priority;
                if (!lockedFields.includes('assignee') && Array.isArray(parsed.assignee)) out.assignee = parsed.assignee.filter(n => typeof n === 'string');
                if (!lockedFields.includes('milestoneId') && parsed.milestoneId) out.milestoneId = String(parsed.milestoneId);
                if (!lockedFields.includes('dependencies') && Array.isArray(parsed.dependencies)) out.dependencies = parsed.dependencies.filter(n => typeof n === 'string');
                if (!lockedFields.includes('actions') && parsed.actions && typeof parsed.actions === 'object') out.actions = parsed.actions;
                out.suggested_agents = Array.isArray(parsed.suggested_agents) ? parsed.suggested_agents : [];

                this.log('[AI Fill Task] generated: ' + (out.title || '(no title)'), 'info');
                ack(out);
            });

            // ── AI Fill: Milestone creation ───────────────────────────────────
            socket.on('ai_fill_milestone', async (data, ack) => {
                if (typeof ack !== 'function') return;
                const ai = this.getService('ai');
                if (!ai || !ai.chatStream) return ack({ error: 'AI service not available' });

                const hint         = (data && data.hint)         ? data.hint         : {};
                const agents       = (data && Array.isArray(data.agents))    ? data.agents    : [];
                const lockedFields = (data && Array.isArray(data.lockedFields)) ? data.lockedFields : [];

                const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#3b82f6','#8b5cf6','#ec4899','#14b8a6'];
                const agentNames = agents.map(a => a.name);

                const ctx = [
                    hint.name        ? `name: "${hint.name}"`               : '',
                    hint.description ? `description: "${hint.description.substring(0,300)}"` : '',
                    hint.color       ? `color: "${hint.color}"`             : '',
                    hint.prompt      ? `user note: "${hint.prompt}"`         : ''
                ].filter(Boolean).join('\n');

                const systemOverride = `You are a project management assistant for an AI dev platform.
Respond with ONLY valid JSON — no markdown, no code fences.
Available agents: ${agentNames.length ? agentNames.join(', ') : '(none)'}
Available colors: ${COLORS.join(', ')}
Rules:
- name: 3-6 words, milestone phase name (e.g. "Authentication & Security", "MVP Launch")
- description: 2-3 sentences explaining what this milestone achieves
- color: one of the available colors (hex)
- suggested_tasks: array of {title, description, priority, assignee, dependencies} — 3-6 tasks that logically belong in this milestone. Dependencies should reference other task titles in this list.`;

                const userMsg = `Fill or improve this milestone. Use existing values as context.\n\n${ctx || '(no context — create a meaningful development milestone)'}\n\nReturn JSON with keys: name, description, color, suggested_tasks`;

                let fullText = '';
                try {
                    await new Promise((resolve, reject) => {
                        ai.chatStream(
                            [{ role: 'user', content: userMsg }],
                            (event) => {
                                if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                                    fullText += event.delta.text || '';
                                }
                            },
                            resolve, reject, systemOverride
                        );
                    });
                } catch (err) {
                    return ack({ error: 'AI request failed: ' + err.message });
                }

                let jsonStr = fullText.trim();
                const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (fence) jsonStr = fence[1].trim();
                const fb = jsonStr.indexOf('{'), lb = jsonStr.lastIndexOf('}');
                if (fb !== -1 && lb > fb) jsonStr = jsonStr.slice(fb, lb + 1);

                let parsed;
                try { parsed = JSON.parse(jsonStr); }
                catch (e) { return ack({ error: 'AI returned invalid JSON — please try again.' }); }

                const out = {};
                if (!lockedFields.includes('name') && parsed.name)         out.name = String(parsed.name).trim();
                if (!lockedFields.includes('description') && parsed.description) out.description = String(parsed.description).trim();
                if (!lockedFields.includes('color') && parsed.color && COLORS.includes(parsed.color)) out.color = parsed.color;
                out.suggested_tasks = Array.isArray(parsed.suggested_tasks) ? parsed.suggested_tasks : [];

                this.log('[AI Fill Milestone] generated: ' + (out.name || '(no name)'), 'info');
                ack(out);
            });

            // ── Presence: update count when a socket disconnects ──────────────
            socket.on('disconnect', () => {
                this.unregisterPushSubscription(socket.id);
            });
            socket.on('disconnecting', () => {
                for (const room of socket.rooms) {
                    if (room.startsWith('conv:')) {
                        setTimeout(async () => {
                            try {
                                const sockets = await this.io.in(room).fetchSockets();
                                // -1 because this socket hasn't fully left yet
                                const count = Math.max(0, sockets.length - 1);
                                this.io.to(room).emit('presence_update', { count, room });
                            } catch (_) {}
                        }, 150);
                    }
                }
            });

            // Notify modules of new connection
            this.emit('client_connected', socket);
        });
    }

    // Emit to specific socket
    emitTo(socket, event, data) {
        if (socket && socket.emit) {
            socket.emit(event, data);
        }
    }

    // Register a service (singleton)
    registerService(name, service) {
        this.services[name] = service;
    }

    // Get a service
    getService(name) {
        return this.services[name];
    }

    // Get the name of the currently executing agent (for agent memory tools)
    getCurrentAgentName() {
        const orch = this.getService('orchestration');
        return orch && orch.getState ? (orch.getState().agent || null) : null;
    }
    
    // Get all process info for context (PID, uptime, memory, port)
    // Fixed: removed duplicate getProcessState method (was causing lint error)
    getProcessState() {
        return {
            ...this.processState,
            pid: process.pid,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            port: this.processState.port
        };
    }

    // Emit a log message — server-wide (all clients see server logs)
    log(message, type = 'info') {
        const entry = {
            time: new Date().toISOString().split('T')[1].slice(0, 8),
            message,
            type
        };
        // Logs go to every connected client (server-wide observability)
        this.broadcastAll('log', entry);
    }

    // Update status — scoped to active conversation room
    status(text, state = 'idle') {
        this.broadcast('status_update', { text, status: state });
    }

    // Update team status — scoped to active conversation room
    teamUpdate(agents) {
        this.broadcast('team_update', agents);
    }

    // Broadcast the current team from DB (agent manager) to all clients
    broadcastTeamFromDB() {
        const agentMgr = this.getService('agentManager');
        if (!agentMgr) return;
        const projects = this.getService('projects');
        const activeProjectId = projects?.getActiveProjectId?.();
        const projectAgents = activeProjectId ? (projects.listProjectAgents?.(activeProjectId) || []) : [];
        const dbAgents = agentMgr.listAgents ? agentMgr.listAgents(projectAgents) : [];
        const team = dbAgents.map(a => ({
            name: a.name,
            role: a.role,
            description: a.description || '',
            capabilities: a.capabilities || [],
            status: a.status || 'IDLE',
            scope: a.scope || 'global'
        }));
        this.broadcastAll('team_update', team);
    }

    // Update roadmap — scoped to active conversation room
    roadmapUpdate(items) {
        this.broadcast('roadmap_update', items);
    }

    // Neural thought — scoped to active conversation room
    neural(thought) {
        this.broadcast('neural_thought', thought);
    }

    // Signal that a thinking block finished streaming
    neuralDone(stats = {}) {
        this.broadcast('thinking_done', stats);
    }

    // Request server restart (graceful)
    requestRestart() {
        console.log('[Hub] Restart requested, sending SIGTERM to self...');
        process.kill(process.pid, 'SIGTERM');
    }
    
    // Request server kill and restart (forceful)
    forceRestart() {
        console.log('[Hub] Force restart requested...');
        process.kill(process.pid, 'SIGKILL');
    }

    // Add message to chat
    addMessage(role, content) {
        this.broadcast('message_add', { role, content });
    }

    // Tool result - goes to Tools panel
    toolResult(data) {
        this.broadcast('tool_result', data);
    }

    // Stream update — volatile since stream deltas are stateless (UI reconstructs from full msg)
    streamUpdate(text) {
        this.broadcastVolatile('stream_update', text);
    }

    // Context warning - broadcasts to client when context is running low
    contextWarning(usage) {
        this.broadcast('context_warning', usage);
    }
}

// Create singleton hub
const hub = new Hub();

module.exports = hub;
