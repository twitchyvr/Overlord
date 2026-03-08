/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Socket Bridge
   ═══════════════════════════════════════════════════════════════════
   Maps all ~83 Socket.IO events to state store updates and engine
   dispatches. Replaces the 83 scattered socket.on() handlers in
   the monolith.

   Architecture:
     socket.on('event') → store.set('key', data)
                        → engine.dispatch('event', data)
     Components subscribe to store keys and re-render automatically.

   Dependencies: engine.js (OverlordUI), state.js (Store)
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Initialize the socket bridge.
 * Connects all Socket.IO events to the store and engine.
 *
 * @param {object}     socket — Socket.IO client instance
 * @param {Store}      store  — reactive state store
 * @param {OverlordUI} engine — UI engine
 */
export function initSocketBridge(socket, store, engine) {

    // ══════════════════════════════════════════════════════════════
    //  CONNECTION LIFECYCLE
    // ══════════════════════════════════════════════════════════════

    socket.on('connect', () => {
        store.set('ui.connected', true);
        engine.dispatch('connected', true);

        // ── Full state sync on every connect/reconnect ──
        // These requests ensure the UI is fully populated even after a
        // hard refresh while agents are working in the background.
        socket.emit('get_process_state');
        socket.emit('get_config');
        socket.emit('get_team');
        socket.emit('list_conversations');
        socket.emit('get_context_info');
        socket.emit('get_orch_dashboard', {}, (state) => {
            if (state) store.set('orchestration.dashboard', state);
        });
        // Request all agent session states so team panel + orchestration
        // immediately reflect which agents are actually processing.
        socket.emit('get_all_agent_states');

        const currentConv = store.peek('conversations.current');
        if (currentConv) {
            socket.emit('join_conversation', currentConv, (ack) => {
                if (ack?.joined) engine.dispatch('log', { message: 'Room: ' + ack.joined, type: 'info' });
            });
        }

        if (!socket.recovered) {
            socket.emit('get_message_queue', (q) => {
                store.set('queue.messages', q || []);
            });
            socket.emit('get_backchannel', (msgs) => {
                if (msgs) store.set('backchannel.messages', msgs);
            });
        }
    });

    socket.on('disconnect', (reason) => {
        store.set('ui.connected', false);
        engine.dispatch('disconnected', reason);
        engine.dispatch('log', { message: 'Disconnected: ' + reason, type: 'warning' });
    });

    socket.on('reconnect_attempt', (attempt) => {
        engine.dispatch('log', { message: `Reconnecting… (attempt ${attempt})`, type: 'warning' });
    });

    socket.on('reconnect', (attempt) => {
        store.set('ui.connected', true);
        engine.dispatch('log', { message: `Reconnected after ${attempt} attempt(s)`, type: 'success' });
    });

    socket.on('connect_error', (err) => {
        engine.dispatch('log', { message: 'Connection error: ' + err.message, type: 'error' });
    });

    // ══════════════════════════════════════════════════════════════
    //  INITIALIZATION & STATE SYNC
    // ══════════════════════════════════════════════════════════════

    socket.on('init', (data) => {
        store.batch(() => {
            if (data.conversationId) {
                store.set('conversations.current', data.conversationId);
            }
            if (data.team) store.set('team.agents', data.team);
            if (data.tasks) store.set('tasks.list', data.tasks);
            if (data.roadmap) store.set('roadmap.items', data.roadmap);
            if (data.workingDir) store.set('ui.workingDir', data.workingDir);
            if (data.mode) store.set('chat.mode', data.mode);
        });

        engine.dispatch('init', data);
    });

    socket.on('process_state', (state) => {
        store.batch(() => {
            store.set('ui.processing', state.isProcessing || false);
            if (state.mode) store.set('chat.mode', state.mode);
        });
        engine.dispatch('process_state', state);
    });

    // ══════════════════════════════════════════════════════════════
    //  CORE STATE BROADCASTS
    // ══════════════════════════════════════════════════════════════

    socket.on('roadmap_update', (items) => {
        store.set('roadmap.items', items || []);
        engine.dispatch('roadmap_update', items);
    });

    socket.on('team_update', (agents) => {
        store.set('team.agents', agents || []);
        engine.dispatch('team_update', agents);
    });

    socket.on('tasks_update', (taskList) => {
        store.set('tasks.list', taskList || []);
        engine.dispatch('tasks_update', taskList);
    });

    socket.on('task_tree_update', (tree) => {
        store.set('tasks.tree', tree);
        engine.dispatch('task_tree_update', tree);
    });

    socket.on('working_dir_update', (path) => {
        store.set('ui.workingDir', path);
        engine.dispatch('working_dir_update', path);
    });

    // ══════════════════════════════════════════════════════════════
    //  MESSAGING & STREAMING
    // ══════════════════════════════════════════════════════════════

    socket.on('status_update', (data) => {
        // Derive processing state so Stop button enables and send-area aurora fires.
        // The legacy build (index-ori.html:6739) used: isProcessing = (data.status === 'thinking' || data.status === 'tool')
        store.set('ui.processing', data.status === 'thinking' || data.status === 'tool');
        store.set('ui.status', data);
        engine.dispatch('status_update', data);
    });

    socket.on('message_add', (msg) => {
        engine.dispatch('message_add', msg);
    });

    socket.on('stream_start', () => {
        store.set('ui.streaming', true);
        engine.dispatch('stream_start');
    });

    socket.on('stream_update', (text) => {
        engine.dispatch('stream_update', text);
    });

    // ══════════════════════════════════════════════════════════════
    //  CONVERSATIONS
    // ══════════════════════════════════════════════════════════════

    socket.on('conversations_list', (convs) => {
        store.set('conversations.list', convs || []);
        engine.dispatch('conversations_list', convs);
    });

    socket.on('conversation_loaded', (data) => {
        store.batch(() => {
            if (data.conversationId) store.set('conversations.current', data.conversationId);
            if (data.mode) store.set('chat.mode', data.mode);
        });
        engine.dispatch('conversation_loaded', data);
    });

    socket.on('conversation_error', (data) => {
        engine.dispatch('log', { message: 'Error: ' + data.error, type: 'error' });
    });

    socket.on('conversation_new', (d) => {
        engine.dispatch('conversation_new', d);
    });

    socket.on('messages_cleared', () => {
        engine.dispatch('messages_cleared');
        engine.dispatch('log', { message: 'Context cleared', type: 'success' });
    });

    // ══════════════════════════════════════════════════════════════
    //  TOOLS & EXECUTION
    // ══════════════════════════════════════════════════════════════

    socket.on('tool_result', (data) => {
        engine.dispatch('tool_result', data);
    });

    socket.on('tool_result_binary', (buf) => {
        engine.dispatch('tool_result_binary', buf);
    });

    socket.on('approval_request', (data) => {
        engine.dispatch('approval_request', data);
    });

    socket.on('approval_timeout', (data) => {
        engine.dispatch('approval_timeout', data);
    });

    socket.on('approval_resolved', (data) => {
        engine.dispatch('approval_resolved', data);
    });

    // ══════════════════════════════════════════════════════════════
    //  AGENT CHAT ROOMS & DELEGATION
    // ══════════════════════════════════════════════════════════════

    socket.on('agent_room_opened', (room) => {
        engine.dispatch('agent_room_opened', room);
    });
    socket.on('agent_room_message', (data) => {
        engine.dispatch('agent_room_message', data);
    });
    socket.on('agent_room_closed', (data) => {
        engine.dispatch('agent_room_closed', data);
    });
    socket.on('role_block', (data) => {
        engine.dispatch('role_block', data);
    });
    socket.on('delegation_request', (data) => {
        engine.dispatch('delegation_request', data);
    });

    // Meeting system events
    socket.on('room_participant_joined', (data) => {
        engine.dispatch('room_participant_joined', data);
    });
    socket.on('room_participant_left', (data) => {
        engine.dispatch('room_participant_left', data);
    });
    socket.on('room_user_joined', (data) => {
        engine.dispatch('room_user_joined', data);
    });
    socket.on('meeting_notes_generated', (data) => {
        engine.dispatch('meeting_notes_generated', data);
    });

    // ══════════════════════════════════════════════════════════════
    //  AGENT ORCHESTRATION
    // ══════════════════════════════════════════════════════════════

    socket.on('orchestration_state', (state) => {
        store.set('orchestration.state', state);
        engine.dispatch('orchestration_state', state);
    });

    socket.on('orchestrator_dashboard', (state) => {
        store.set('orchestration.dashboard', state);
        engine.dispatch('orchestrator_dashboard', state);
    });

    socket.on('agent_message', (data) => {
        engine.dispatch('agent_message', data);
    });

    socket.on('agent_session_state', (data) => {
        store.update('agents.sessions', sessions => {
            return { ...sessions, [data.agentName]: { ...sessions?.[data.agentName], ...data } };
        });
        engine.dispatch('agent_session_state', data);
    });

    socket.on('agent_paused', (data) => {
        store.update('agents.sessions', sessions => {
            return { ...sessions, [data.agentName]: { ...sessions?.[data.agentName], paused: true } };
        });
        engine.dispatch('agent_paused', data);
    });

    socket.on('agent_resumed', (data) => {
        store.update('agents.sessions', sessions => {
            return { ...sessions, [data.agentName]: { ...sessions?.[data.agentName], paused: false } };
        });
        engine.dispatch('agent_resumed', data);
    });

    socket.on('agent_inbox_update', (data) => {
        engine.dispatch('agent_inbox_update', data);
    });

    socket.on('all_agent_states', (states) => {
        store.set('agents.sessions', states || {});
        engine.dispatch('all_agent_states', states);
    });

    socket.on('agent_activity', (event) => {
        store.update('activity.items', items => {
            const updated = [event, ...(items || [])];
            return updated.slice(0, 50); // Cap at 50
        });
        engine.dispatch('agent_activity', event);
    });

    socket.on('task_recommendations_update', (recs) => {
        store.set('orchestration.recommendations', recs || []);
        engine.dispatch('task_recommendations_update', recs);
    });

    // ══════════════════════════════════════════════════════════════
    //  AI OUTPUTS
    // ══════════════════════════════════════════════════════════════

    socket.on('neural_thought', (thought) => {
        engine.dispatch('neural_thought', thought);
    });

    socket.on('thinking_done', (data) => {
        engine.dispatch('thinking_done', data);
    });

    socket.on('images_generated', (data) => {
        engine.dispatch('images_generated', data);
    });

    socket.on('screenshot_taken', (data) => {
        engine.dispatch('screenshot_taken', data);
    });

    socket.on('audio_ready', (data) => {
        engine.dispatch('audio_ready', data);
    });

    socket.on('file_diff', (data) => {
        engine.dispatch('file_diff', data);
    });

    socket.on('show_chart', (data) => {
        engine.dispatch('show_chart', data);
    });

    // ══════════════════════════════════════════════════════════════
    //  MCP SERVERS
    // ══════════════════════════════════════════════════════════════

    socket.on('mcp_servers_updated', (data) => {
        store.set('mcp.servers', data);
        engine.dispatch('mcp_servers_updated', data);
    });

    socket.on('mcp_server_result', (data) => {
        engine.dispatch('mcp_server_result', data);
    });

    // ══════════════════════════════════════════════════════════════
    //  OBSIDIAN VAULT
    // ══════════════════════════════════════════════════════════════

    socket.on('vaults_discovered', (vaults) => {
        store.set('obsidian.vaults', vaults || []);
        engine.dispatch('vaults_discovered', vaults);
    });

    // ══════════════════════════════════════════════════════════════
    //  CONTEXT & PROCESSING
    // ══════════════════════════════════════════════════════════════

    socket.on('context_info', (info) => {
        store.set('context.info', info);
        engine.dispatch('context_info', info);
    });

    socket.on('context_warning', (usage) => {
        engine.dispatch('context_warning', usage);
    });

    socket.on('summarization_start', () => {
        engine.dispatch('summarization_start');
    });

    socket.on('summarization_complete', (data) => {
        engine.dispatch('summarization_complete', data);
    });

    socket.on('request_start', () => {
        store.set('ui.processing', true);
        engine.dispatch('request_start');
    });

    socket.on('request_end', () => {
        store.set('ui.processing', false);
        store.set('ui.streaming', false);
        engine.dispatch('request_end');
    });

    socket.on('restarting', (data) => {
        engine.dispatch('restarting', data);
    });

    socket.on('presence_update', ({ count }) => {
        store.set('ui.presenceCount', count);
        engine.dispatch('presence_update', { count });
    });

    // ══════════════════════════════════════════════════════════════
    //  PLAN SYSTEM
    // ══════════════════════════════════════════════════════════════

    socket.on('plan_ready', (d) => {
        engine.dispatch('plan_ready', d);
    });

    socket.on('plan_variant_switched', (d) => {
        engine.dispatch('plan_variant_switched', d);
    });

    socket.on('plan_cancelled_ack', () => {
        engine.dispatch('plan_cancelled_ack');
    });

    socket.on('plan_approved_ack', () => {
        engine.dispatch('plan_approved_ack');
    });

    socket.on('plan_timeout', () => {
        engine.dispatch('plan_timeout');
    });

    socket.on('plan_bypass_approved', () => {
        engine.dispatch('plan_bypass_approved');
    });

    socket.on('approval_request_notice', (d) => {
        engine.dispatch('approval_request_notice', d);
    });

    // ══════════════════════════════════════════════════════════════
    //  CHAT MODE
    // ══════════════════════════════════════════════════════════════

    socket.on('mode_changed', (d) => {
        if (d.mode) store.set('chat.mode', d.mode);
        engine.dispatch('mode_changed', d);
    });

    // ══════════════════════════════════════════════════════════════
    //  BACKCHANNEL
    // ══════════════════════════════════════════════════════════════

    socket.on('backchannel_msg', (msg) => {
        store.update('backchannel.messages', msgs => {
            const updated = [...(msgs || []), msg];
            return updated.slice(-500); // Cap at 500
        });
        engine.dispatch('backchannel_msg', msg);
    });

    // ══════════════════════════════════════════════════════════════
    //  MESSAGE QUEUE
    // ══════════════════════════════════════════════════════════════

    socket.on('queue_updated', (queue) => {
        store.set('queue.messages', queue || []);
        engine.dispatch('queue_updated', queue);
    });

    socket.on('message_injected', (data) => {
        engine.dispatch('message_injected', data);
    });

    // ══════════════════════════════════════════════════════════════
    //  SETTINGS & CONFIG
    // ══════════════════════════════════════════════════════════════

    socket.on('config_data', (data) => {
        store.set('settings.config', data);
        engine.dispatch('config_data', data);
    });

    socket.on('config_updated', (data) => {
        store.set('settings.config', data);
        engine.dispatch('config_updated', data);
    });

    socket.on('config_updated_by_ai', (d) => {
        engine.dispatch('config_updated_by_ai', d);
    });

    socket.on('input_request', (d) => {
        engine.dispatch('input_request', d);
    });

    // ══════════════════════════════════════════════════════════════
    //  HOT INJECT
    // ══════════════════════════════════════════════════════════════

    socket.on('hot_inject_pending', (data) => {
        engine.dispatch('hot_inject_pending', data);
    });

    socket.on('hot_inject_applied', (data) => {
        engine.dispatch('hot_inject_applied', data);
    });

    // ══════════════════════════════════════════════════════════════
    //  MILESTONES
    // ══════════════════════════════════════════════════════════════

    socket.on('milestone_complete_celebration', (data) => {
        engine.dispatch('milestone_complete_celebration', data);
    });

    socket.on('milestone_all_tasks_done', (data) => {
        engine.dispatch('milestone_all_tasks_done', data);
    });

    // ══════════════════════════════════════════════════════════════
    //  FILE STREAMING
    // ══════════════════════════════════════════════════════════════

    socket.on('file_write_start', (d) => {
        engine.dispatch('file_write_start', d);
    });

    socket.on('file_write_chunk', (d) => {
        engine.dispatch('file_write_chunk', d);
    });

    socket.on('file_write_end', (d) => {
        engine.dispatch('file_write_end', d);
    });

    // ══════════════════════════════════════════════════════════════
    //  PROJECTS
    // ══════════════════════════════════════════════════════════════

    socket.on('projects_updated', (projects) => {
        store.set('projects.list', projects || []);
        engine.dispatch('projects_updated', projects);
    });

    socket.on('project_switched', (data) => {
        engine.dispatch('project_switched', data);
    });

    // ══════════════════════════════════════════════════════════════
    //  MISC
    // ══════════════════════════════════════════════════════════════

    socket.on('timeline_event', (event) => {
        engine.dispatch('timeline_event', event);
    });

    socket.on('overlay_changed', (data) => {
        engine.dispatch('overlay_changed', data);
        // Sync mode bar: planning→plan, pm→pm (don't revert on null — mode should persist)
        const overlayToMode = { planning: 'plan', pm: 'pm' };
        if (data.overlay && overlayToMode[data.overlay]) {
            const newMode = overlayToMode[data.overlay];
            if (store.get('chat.mode') !== newMode) store.set('chat.mode', newMode);
        }
    });

    socket.on('reminder_due', (d) => {
        engine.dispatch('reminder_due', d);
    });

    socket.on('ui_action', (d) => {
        engine.dispatch('ui_action', d);
    });

    socket.on('log', (entry) => {
        engine.dispatch('log', entry);
    });

    console.log('[SocketBridge] All 83 socket events mapped');
}
