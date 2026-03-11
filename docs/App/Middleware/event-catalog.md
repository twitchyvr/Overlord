# Event Catalog

Complete catalog of all events in the Overlord system. Each entry lists the
event name, direction, payload shape, emitter, handler(s), and scope.

**Direction key:**

- `C->S` -- Client to server (socket.emit from browser)
- `S->C` -- Server to client (hub.broadcast / socket.emit)
- `Internal` -- Hub EventEmitter only (never crosses the socket)

**Scope key:**

- `room` -- Scoped to `conv:{id}` via `hub.broadcast()`
- `server-wide` -- All sockets via `hub.broadcastAll()`
- `volatile` -- Room-scoped but volatile (dropped if client not ready)
- `socket` -- Reply to requesting socket only
- `internal` -- Hub EventEmitter, never sent over the wire

---

## Connection Lifecycle

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `connect` | S->C | -- | Socket.IO | socket-bridge: sets `ui.connected`, requests full state sync | socket |
| `disconnect` | S->C | `reason: string` | Socket.IO | socket-bridge: sets `ui.connected = false` | socket |
| `reconnect_attempt` | S->C | `attempt: number` | Socket.IO | socket-bridge: dispatches log | socket |
| `reconnect` | S->C | `attempt: number` | Socket.IO | socket-bridge: sets `ui.connected = true` | socket |
| `connect_error` | S->C | `err: Error` | Socket.IO | socket-bridge: dispatches log | socket |
| `disconnecting` | Internal | -- | Socket.IO | hub: updates presence count for rooms being left | internal |
| `client_connected` | Internal | `socket` | hub | modules listening on hub | internal |

---

## Initialization and State Sync

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `init` | S->C | `{ conversationId, team, tasks, roadmap, workingDir, mode }` | hub (on connection) | socket-bridge: batch store update | socket |
| `process_state` | S->C | `{ isProcessing, mode, pid, uptime, memory, port }` | hub (`get_process_state` handler) | socket-bridge: sets `ui.processing`, `chat.mode` | socket |
| `get_process_state` | C->S | -- | socket-bridge (on connect) | hub: replies with `process_state` | socket |
| `get_config` | C->S | -- | socket-bridge (on connect) | hub: replies with `config_data` | socket |
| `get_team` | C->S | -- | socket-bridge (on connect) | hub: replies with `team_update` | socket |
| `get_context_info` | C->S | -- | socket-bridge (on connect) | hub: replies with `context_info` | socket |
| `get_orch_dashboard` | C->S | `{}` | socket-bridge (on connect) | hub: emits `get_orch_dashboard` internally, callback returns dashboard | socket |
| `get_all_agent_states` | C->S | -- | socket-bridge (on connect) | hub: replies with `all_agent_states` | socket |
| `register_client` | C->S | `data: object` | client | hub: emits `client_registered` internally | internal |
| `presence_update` | S->C | `{ count, room }` | hub (joinConversationRoom / disconnecting) | socket-bridge: sets `ui.presenceCount` | room |

---

## User Input and Messaging

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `user_input` | C->S | `text: string` | client chat input | hub: rate-limited, emits `user_message` internally | internal |
| `user_message` | Internal | `text, socket` | hub (from `user_input`) | orchestration-module: starts AI loop | internal |
| `cancel` | C->S | -- | client stop button | hub: emits `cancel_request` internally | internal |
| `cancel_request` | Internal | `socket` | hub | orchestration-module: aborts current AI cycle | internal |
| `new_conversation` | C->S | -- | client | hub: emits `new_conversation` internally | internal |
| `fork_conversation` | C->S | `{ messageIndex }` | client (message context menu) | hub: slices history, creates new conv, callback with `{ success, id }` | socket |
| `delete_message` | C->S | `{ messageIndex }` | client (message context menu) | hub: removes message from history, callback with `{ success }` | socket |
| `status_update` | S->C | `{ text, status }` | hub.status() / orchestration | socket-bridge: sets `ui.processing`, `ui.status` | room |
| `message_add` | S->C | `{ role, content }` | hub.addMessage() / orchestration | socket-bridge: dispatches `message_add` | room |
| `log` | S->C | `{ time, message, type }` | hub.log() | socket-bridge: dispatches `log` | server-wide |

---

## Message Queue and Hot Injection

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `get_message_queue` | C->S | -- | client (on connect) | hub: callback with `queue[]` | socket |
| `remove_queued_message` | C->S | `id: string` | client queue UI | hub: removes item, broadcasts `queue_updated` | room |
| `edit_queued_message` | C->S | `{ id, text }` | client queue UI | hub: updates item text, broadcasts `queue_updated` | room |
| `reorder_queue` | C->S | `ids: string[]` | client queue UI | hub: reorders by id array, broadcasts `queue_updated` | room |
| `clear_queue` | C->S | -- | client queue UI | hub: empties queue, broadcasts `queue_updated` | room |
| `force_dequeue` | C->S | `{ id? }` | client queue UI | hub: dequeues one item, emits `user_message` | room |
| `force_dequeue_all` | C->S | `{ mode? }` | client queue UI | hub: drains entire queue (consolidated or sequential) | room |
| `queue_updated` | S->C | `queue: Array<{ id, text, queuedAt }>` | hub (after any queue mutation) | socket-bridge: sets `queue.messages` | room |
| `hot_inject` | C->S | `text: string` | client hot-inject button | hub: if AI busy, buffers; if idle, routes as `user_message`. Callback: `{ status, id?, queueSize? }` | socket |
| `get_hot_inject_queue` | C->S | -- | client | hub: callback with buffer array | socket |
| `clear_hot_inject_queue` | C->S | -- | client | hub: empties buffer, broadcasts `hot_inject_pending` | room |
| `hot_inject_pending` | S->C | `{ count, preview }` | hub (on inject/clear) | socket-bridge: dispatches `hot_inject_pending` | room |
| `hot_inject_applied` | S->C | `{ id, text }` | hub.broadcastHotInjectApplied() | socket-bridge: dispatches `hot_inject_applied` | room |
| `message_injected` | S->C | `data` | orchestration-module | socket-bridge: dispatches `message_injected` | room |

---

## Approvals and Plans

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `approval_request` | S->C | `{ toolId, toolName, args, agentName }` | orchestration-module | socket-bridge: dispatches `approval_request` | room |
| `approval_response` | C->S | `{ toolId, approved }` | client approval modal | hub: emits `approval_response` internally, broadcasts `approval_resolved` | server-wide |
| `approval_resolved` | S->C | `{ toolId, approved }` | hub (from `approval_response` handler) | socket-bridge: dispatches `approval_resolved` | server-wide |
| `approval_timeout` | S->C | `{ toolId }` | orchestration-module | socket-bridge: dispatches `approval_timeout` | room |
| `approval_request_notice` | S->C | `data` | orchestration-module | socket-bridge: dispatches `approval_request_notice` | room |
| `approve_plan` | C->S | -- | client plan bar | hub: emits `plan_approved`, broadcasts `plan_approved_ack` | server-wide |
| `cancel_plan` | C->S | -- | client plan bar | hub: emits `plan_cancelled` internally | internal |
| `revise_plan` | C->S | `feedback: string` | client plan bar | hub: emits `plan_revision`, broadcasts `plan_cancelled_ack` (hides bar while revising) | server-wide |
| `switch_plan_variant` | C->S | `data: object` | client plan bar | hub: emits `switch_plan_variant` internally | internal |
| `plan_ready` | S->C | `{ tasks, variants?, summary }` | orchestration-module | socket-bridge: dispatches `plan_ready` | room |
| `plan_approved_ack` | S->C | `{}` | hub / orchestration | socket-bridge: dispatches `plan_approved_ack` | server-wide |
| `plan_cancelled_ack` | S->C | -- | orchestration-module | socket-bridge: dispatches `plan_cancelled_ack` | server-wide |
| `plan_variant_switched` | S->C | `data` | orchestration-module | socket-bridge: dispatches `plan_variant_switched` | room |
| `plan_timeout` | S->C | -- | orchestration-module | socket-bridge: dispatches `plan_timeout` | room |
| `plan_bypass_approved` | S->C | -- | orchestration-module | socket-bridge: dispatches `plan_bypass_approved` | room |
| `approve_checkpoint` | C->S | -- | client | hub: emits `checkpoint_approved` internally | internal |
| `approve_recommendation` | C->S | `data` | client task recommendation UI | hub: emits `approve_recommendation` internally | internal |
| `reject_recommendation` | C->S | `data` | client task recommendation UI | hub: emits `reject_recommendation` internally | internal |

---

## Configuration

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `update_config` | C->S | `{ model?, customInstructions?, projectMemory?, autoQA?, maxAICycles?, thinkingEnabled?, ... }` | settings UI | hub: validates and applies all fields to config service, persists to disk, replies with `config_updated` | socket |
| `config_data` | S->C | Full config snapshot (30+ fields) | hub (`get_config` handler) | socket-bridge: sets `settings.config` | socket |
| `config_updated` | S->C | Full config snapshot | hub (`update_config` handler) | socket-bridge: sets `settings.config` | socket |
| `config_updated_by_ai` | S->C | `{ field, oldValue, newValue }` | orchestration-module | socket-bridge: dispatches `config_updated_by_ai` | room |

---

## Agent Management

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `add_agent` | C->S | `agentData: { name, role, description, instructions, tools, securityRole, scope? }` | agent manager UI | hub: creates via agentManager service, handles project-scoped agents, broadcasts team update | socket + server-wide |
| `remove_agent` | C->S | `agentId: string` | agent manager UI | hub: deletes via agentManager, broadcasts team update | socket + server-wide |
| `list_agents` | C->S | -- | agent manager UI | hub: callback with merged global + project agents | socket |
| `get_agent` | C->S | `agentId: string` | agent manager UI | hub: callback with agent object | socket |
| `update_agent` | C->S | `{ id, name?, role?, description?, instructions?, tools?, securityRole? }` | agent manager UI | hub: updates via agentManager, broadcasts team update | socket + server-wide |
| `get_security_roles` | C->S | -- | agent manager UI | hub: callback with SECURITY_ROLES object | socket |
| `get_available_tools` | C->S | -- | agent manager UI | hub: callback with categorized tools from tools service | socket |
| `set_agent_tools` | C->S | `{ agentId, tools: string[] }` | agent manager UI | hub: replaces tools list via agentManager | socket |
| `agents_updated` | S->C | -- | orchestration-module (after agent changes) | socket-bridge: triggers `get_team` re-fetch | server-wide |
| `team_update` | S->C | `Array<{ name, role, description, capabilities, status, scope }>` | hub.broadcastTeamFromDB() | socket-bridge: sets `team.agents` | server-wide |
| `agent_added` | S->C | `{ success, agent }` | hub (`add_agent` handler) | client callback | socket |
| `agent_removed` | S->C | `{ success, id }` | hub (`remove_agent` handler) | client callback | socket |
| `ai_fill_agent` | C->S | `{ hint, lockedFields }` | agent manager UI | hub: calls AI to generate improved agent config, callback with JSON | socket |

---

## Agent Groups

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `list_groups` | C->S | -- | agent manager UI | hub: callback with groups array | socket |
| `create_group` | C->S | `groupData: { name, description }` | agent manager UI | hub: creates via agentManager | socket |
| `update_group` | C->S | `{ id, name?, description? }` | agent manager UI | hub: updates via agentManager | socket |
| `delete_group` | C->S | `groupId: string` | agent manager UI | hub: deletes via agentManager | socket |
| `add_agent_to_group` | C->S | `{ agentId, groupId }` | agent manager UI | hub: adds via agentManager | socket |
| `remove_agent_from_group` | C->S | `{ agentId }` | agent manager UI | hub: removes via agentManager | socket |

---

## Agent Chat Rooms and Meetings

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `create_chat_room` | C->S | `{ toAgent, fromAgent?, reason? }` | room view UI | hub: creates room via orchestration, auto-joins user | socket |
| `list_chat_rooms` | C->S | -- | room view UI | hub: callback with active rooms | socket |
| `get_chat_room` | C->S | `roomId: string` | room view UI | hub: callback with room object | socket |
| `end_chat_room` | C->S | `roomId: string` | room view UI | hub: ends room via orchestration | socket |
| `send_room_message` | C->S | `{ roomId, message }` | room view UI | hub: adds user message to transcript, triggers multi-round agent discussion (MAX_ROUNDS=4, 1.5s delay between rounds) | room |
| `stop_room_agents` | C->S | `roomId: string` | room view UI | hub: cancels pending round timers, clears agent callbacks | room |
| `pull_agent_into_room` | C->S | `{ roomId, agentName, pulledBy? }` | room view UI | hub: adds agent to room via orchestration | socket |
| `user_join_room` | C->S | `roomId: string` | room view UI | hub: marks user present via orchestration | socket |
| `user_leave_room` | C->S | `roomId: string` | room view UI | hub: marks user absent via orchestration | socket |
| `generate_meeting_notes` | C->S | `roomId: string` | room view UI | hub: AI-generates meeting notes via orchestration | socket |
| `end_meeting` | C->S | `roomId: string` | room view UI | hub: generates notes + closes room | socket |
| `list_meeting_notes` | C->S | `{ limit? }` | room view UI | hub: callback with notes list from agentManager | socket |
| `get_meeting_notes` | C->S | `noteId: string` | room view UI | hub: callback with single note | socket |
| `agent_room_opened` | S->C | `{ roomId, fromAgent, toAgent, participants, reason }` | orchestration-module | socket-bridge: dispatches `agent_room_opened` | room |
| `agent_room_message` | S->C | `{ roomId, from, content, type }` | orchestration-module | socket-bridge: dispatches `agent_room_message` | room |
| `agent_room_closed` | S->C | `{ roomId, reason }` | orchestration-module | socket-bridge: dispatches `agent_room_closed` | room |
| `room_participant_joined` | S->C | `{ roomId, agentName, pulledBy }` | orchestration-module | socket-bridge: dispatches `room_participant_joined` | room |
| `room_participant_left` | S->C | `{ roomId, agentName }` | orchestration-module | socket-bridge: dispatches `room_participant_left` | room |
| `room_user_joined` | S->C | `{ roomId }` | orchestration-module | socket-bridge: dispatches `room_user_joined` | room |
| `room_agent_thinking` | S->C | `{ roomId, agentName }` | hub (send_room_message handler) | client: shows thinking indicator | room |
| `room_agents_stopped` | S->C | `{ roomId }` | hub (stop_room_agents handler) | client: clears thinking indicators | room |
| `meeting_notes_generated` | S->C | `{ roomId, notes }` | orchestration-module | socket-bridge: dispatches `meeting_notes_generated` | room |

---

## Backchannel (Inter-Agent Communication)

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `orchestrator_send` | C->S | `{ agentName, message }` | backchannel UI | hub: routes message to agent session, stores in backchannel history | room |
| `get_backchannel` | C->S | -- | socket-bridge (on connect) | hub: callback with last 200 backchannel messages | socket |
| `direct_message` | C->S | `{ agentName, message }` | agent chat UI | hub: routes to orchestration.runAgentSession() | internal |
| `backchannel_msg` | S->C | `{ from, to, content, ts, type }` | hub (backchannel_push listener) | socket-bridge: appends to `backchannel.messages` (cap 500) | room |
| `backchannel_push` | Internal | `msg` | orchestration-module | hub: stores in history, broadcasts `backchannel_msg` | internal |

---

## Orchestration Controls

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `set_mode` | C->S | `mode: 'auto'\|'plan'\|'ask'\|'pm'\|'bypass'` | mode selector UI | hub: updates config.chatMode, broadcasts `mode_changed`. If bypass, emits `bypass_active`. If leaving plan, emits `plan_cancelled`. | server-wide |
| `set_strategy` | C->S | `data` | orchestration panel | hub: emits `set_strategy` internally | internal |
| `set_overlay` | C->S | `data` | orchestration panel | hub: emits `set_overlay` internally | internal |
| `set_max_cycles` | C->S | `data` | orchestration panel | hub: emits `set_max_cycles` internally | internal |
| `set_max_agents` | C->S | `data` | orchestration panel | hub: emits `set_max_agents` internally | internal |
| `pause_agent` | C->S | `data, cb` | orchestration panel | hub: emits `pause_agent` internally | internal |
| `resume_agent` | C->S | `data, cb` | orchestration panel | hub: emits `resume_agent` internally | internal |
| `kill_agent` | C->S | `data, cb` | orchestration panel | hub: emits `kill_agent` internally | internal |
| `set_auto_qa` | C->S | `data` | orchestration panel | hub: emits `set_auto_qa` internally | internal |
| `clear_tool_history` | C->S | -- | orchestration panel | hub: emits `clear_tool_history` internally | internal |
| `orchestration_state` | S->C | `{ mode, strategy, overlay, maxCycles, agent, ... }` | orchestration-module | socket-bridge: sets `orchestration.state` | room |
| `orchestrator_dashboard` | S->C | `{ agents, tasks, stats }` | orchestration-module | socket-bridge: sets `orchestration.dashboard` | room |
| `mode_changed` | S->C | `{ mode }` | hub (`set_mode` handler) | socket-bridge: sets `chat.mode` | server-wide |
| `overlay_changed` | S->C | `{ overlay }` | orchestration-module | socket-bridge: syncs `chat.mode` based on overlay type | room |
| `role_block` | S->C | `{ agentName, tool, role, reason }` | orchestration-module | socket-bridge: dispatches `role_block` | room |
| `delegation_request` | S->C | `{ from, to, task, reason }` | orchestration-module | socket-bridge: dispatches `delegation_request` | room |

---

## Agent Sessions and Activity

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `get_agent_session` | C->S | `{ agentName }` | agent chat UI | hub: callback with `{ state, history, inbox }` | socket |
| `agent_message` | S->C | `{ agentName, content, type }` | orchestration-module | socket-bridge: dispatches `agent_message` | room |
| `agent_session_state` | S->C | `{ agentName, status, cycle, ... }` | orchestration-module | socket-bridge: updates `agents.sessions[agentName]` | room |
| `agent_paused` | S->C | `{ agentName }` | orchestration-module | socket-bridge: sets `agents.sessions[agentName].paused = true` | room |
| `agent_resumed` | S->C | `{ agentName }` | orchestration-module | socket-bridge: sets `agents.sessions[agentName].paused = false` | room |
| `agent_inbox_update` | S->C | `{ agentName, inbox }` | orchestration-module | socket-bridge: dispatches `agent_inbox_update` | room |
| `all_agent_states` | S->C | `{ [agentName]: state }` | hub / orchestration | socket-bridge: sets `agents.sessions` | room |
| `agent_activity` | S->C | `{ type, data, timestamp }` | orchestration-module | socket-bridge: prepends to `activity.items` (cap 50) | volatile |
| `task_recommendations_update` | S->C | `recs[]` | orchestration-module | socket-bridge: sets `orchestration.recommendations` | room |

---

## AI Outputs and Streaming

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `stream_start` | S->C | -- | orchestration-module | socket-bridge: sets `ui.streaming = true` | room |
| `stream_update` | S->C | `text: string` | hub.streamUpdate() | socket-bridge: dispatches `stream_update` | volatile |
| `neural_thought` | S->C | `{ content }` | hub.neural() | socket-bridge: dispatches `neural_thought` | room |
| `thinking_done` | S->C | `{ stats }` | hub.neuralDone() / orchestration | socket-bridge: dispatches `thinking_done` | room |
| `images_generated` | S->C | `{ images }` | orchestration-module | socket-bridge: dispatches `images_generated` | room |
| `screenshot_taken` | S->C | `{ data }` | orchestration-module | socket-bridge: dispatches `screenshot_taken` | room |
| `audio_ready` | S->C | `{ data }` | orchestration-module | socket-bridge: dispatches `audio_ready` | room |
| `file_diff` | S->C | `{ path, diff }` | orchestration-module | socket-bridge: dispatches `file_diff` | room |
| `show_chart` | S->C | `{ data }` | orchestration-module | socket-bridge: dispatches `show_chart` | room |
| `request_start` | S->C | -- | orchestration-module | socket-bridge: sets `ui.processing = true` | room |
| `request_end` | S->C | -- | orchestration-module | socket-bridge: sets `ui.processing = false`, `ui.streaming = false` | room |
| `get_system_prompt` | C->S | -- | settings UI (prompt inspector) | hub: builds prompt via ai.buildSystemPrompt(), replies with `system_prompt_data` | socket |
| `system_prompt_data` | S->C | `{ prompt }` | hub | client: displays in prompt inspector | socket |
| `get_last_context` | C->S | -- | settings UI (context viewer) | hub: calls ai.getLastContext(), replies with `last_context_data` | socket |
| `last_context_data` | S->C | `context object or { error }` | hub | client: displays in context viewer | socket |
| `pm_query` | C->S | `{ messages, system? }` | PM chat UI | hub: streams AI response, callback with `{ text }` or `{ error }` | socket |
| `api_context_snapshot` | S->C | `snapshot` | ai-module | client: stores for debugging | room |

---

## File Streaming

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `file_write_start` | S->C | `{ path, size }` | orchestration-module | socket-bridge: dispatches `file_write_start` | room |
| `file_write_chunk` | S->C | `{ path, chunk, progress }` | orchestration-module | socket-bridge: dispatches `file_write_chunk` | room |
| `file_write_end` | S->C | `{ path, success }` | orchestration-module | socket-bridge: dispatches `file_write_end` | room |

---

## Tools and Execution

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `tool_result` | S->C | `{ tool, result, duration }` | hub.toolResult() / orchestration | socket-bridge: dispatches `tool_result` | room |
| `tool_result_binary` | S->C | `Buffer` | orchestration-module | socket-bridge: dispatches `tool_result_binary` | room |

---

## Tasks and Milestones

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `task_added` | C->S | `{ text, priority?, assignee? }` | task UI | hub: emits `socket:task_added` internally | internal |
| `task_toggled` | C->S | `{ id }` | task UI | hub: emits `socket:task_toggled` internally | internal |
| `task_deleted` | C->S | `{ id }` | task UI | hub: emits `socket:task_deleted` internally | internal |
| `task_updated` | C->S | `{ id, text?, priority?, ... }` | task UI | hub: emits `socket:task_updated` internally | internal |
| `tasks_reorder` | C->S | `{ ids }` | task UI (drag-and-drop) | hub: emits `socket:tasks_reorder` internally | internal |
| `add_child_task` | C->S | `{ parentId, text }` | task UI | hub: emits `socket:add_child_task` internally | internal |
| `reparent_task` | C->S | `{ taskId, newParentId }` | task UI | hub: emits `socket:reparent_task` internally | internal |
| `get_task_tree` | C->S | `data?` | task UI | hub: emits `socket:get_task_tree` internally | internal |
| `get_task_children` | C->S | `{ parentId }` | task UI | hub: emits `socket:get_task_children` internally | internal |
| `get_task_breadcrumb` | C->S | `{ taskId }` | task UI | hub: emits `socket:get_task_breadcrumb` internally | internal |
| `assign_task_to_milestone` | C->S | `{ taskId, milestoneId }` | kanban UI | hub: emits `socket:assign_task_to_milestone` internally | internal |
| `focus_task` | C->S | `{ taskId }` | task UI | hub: emits `socket:focus_task` internally | internal |
| `tasks_update` | S->C | `tasks[]` | tasks-engine / conversation-module | socket-bridge: sets `tasks.list` | room |
| `task_tree_update` | S->C | `tree` | tasks-engine | socket-bridge: sets `tasks.tree` | room |
| `list_milestones` | C->S | -- | kanban UI | hub: callback with milestones array | socket |
| `add_milestone` | C->S | `{ name, description?, color? }` | kanban UI | hub: creates via conversation service | socket |
| `update_milestone` | C->S | `{ id, name?, description?, color? }` | kanban UI | hub: updates via conversation service | socket |
| `delete_milestone` | C->S | `id: string` | kanban UI | hub: deletes via conversation service | socket |
| `launch_milestone` | C->S | `id: string` | kanban UI | hub: activates milestone, checks out git branch, broadcasts `agent_activity` | room |
| `orchestrate_milestone` | C->S | `milestoneId: string` | kanban UI | hub: launches milestone, broadcasts `tasks_update` and `agent_activity` | server-wide + room |
| `milestone_completed` | Internal | `{ id, text, branch }` | conversation-module | hub: auto-merges branch via git, broadcasts `milestone_complete_celebration` | server-wide |
| `milestone_complete_celebration` | S->C | `{ milestoneId, name }` | hub (milestone_completed handler) | socket-bridge: dispatches `milestone_complete_celebration` | server-wide |
| `milestone_all_tasks_done` | S->C | `{ milestoneId, name }` | orchestration-module | socket-bridge: dispatches `milestone_all_tasks_done` | room |
| `roadmap_update` | S->C | `items[]` | hub.roadmapUpdate() | socket-bridge: sets `roadmap.items` | room |
| `ai_fill_task` | C->S | `{ hint, agents, milestones, lockedFields }` | kanban UI | hub: AI-generates task fields, callback with JSON | socket |
| `ai_fill_milestone` | C->S | `{ hint, agents, lockedFields }` | kanban UI | hub: AI-generates milestone fields with suggested tasks, callback with JSON | socket |

---

## Conversations

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `list_conversations` | C->S | -- | client (on connect) | hub: replies with `conversations_list` | socket |
| `conversations_list` | S->C | `convs[]` | hub | socket-bridge: sets `conversations.list` | socket |
| `load_conversation` | C->S | `convId: string` | conversation list UI | hub: loads via conversation service, replies with `conversation_loaded` or `conversation_error` | socket |
| `conversation_loaded` | S->C | `{ id, messages, roadmap, conversationId?, mode? }` | hub / conversation-module | socket-bridge: sets `conversations.current`, `chat.mode` | socket |
| `conversation_error` | S->C | `{ error }` | hub | socket-bridge: dispatches log error | socket |
| `conversation_new` | S->C | `{ id, messages, roadmap }` | hub (`archive_and_new` handler) | socket-bridge: dispatches `conversation_new` | socket |
| `join_conversation` | C->S | `convId: string` | socket-bridge (on connect) | hub: joins conv room, replays history, callback `{ joined }` | socket |
| `get_room_presence` | C->S | `convId: string` | client | hub: callback `{ room, count }` | socket |
| `clear_context` | C->S | -- | client | hub: clears history + resets context tracker, replies `messages_cleared` | socket |
| `messages_cleared` | S->C | -- | hub | socket-bridge: dispatches `messages_cleared` | socket |
| `archive_and_new` | C->S | -- | client | hub: archives current, starts new, replies `conversation_new` | socket |
| `set_working_dir` | C->S | `dir: string` | folder browser UI | hub: sets via conversation service, persists to active project | room |
| `working_dir_update` | S->C | `path: string` | conversation-module | socket-bridge: sets `ui.workingDir` | room |

---

## Projects

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `list_projects` | C->S | -- | project manager UI | hub: callback with projects array | socket |
| `get_active_project` | C->S | -- | project manager UI | hub: callback with `{ project, data, projects }` | socket |
| `get_project` | C->S | `id: string` | project manager UI | hub: callback with `{ project, data }` (data includes links) | socket |
| `create_project` | C->S | `projectData` | project manager UI | hub: creates via projects service, broadcasts `projects_updated` | server-wide |
| `update_project` | C->S | `{ id, name?, workingDir?, customInstructions?, ... }` | project manager UI | hub: updates via projects service, applies live config if active project, broadcasts `projects_updated` | server-wide |
| `delete_project` | C->S | `id: string` | project manager UI | hub: deletes via projects service, broadcasts `projects_updated` | server-wide |
| `switch_project` | C->S | `id: string` | project manager UI | hub: switches via projects service, broadcasts `projects_updated` + `project_switched` | server-wide |
| `ai_populate_project` | C->S | `{ description }` | project manager UI | hub: AI extracts project fields, callback with `{ success, fields }` | socket |
| `link_projects` | C->S | `{ id1, id2, relation, note? }` | project manager UI | hub: links via projects service, broadcasts `projects_updated` | server-wide |
| `unlink_projects` | C->S | `{ id1, id2 }` | project manager UI | hub: unlinks via projects service, broadcasts `projects_updated` | server-wide |
| `projects_updated` | S->C | `projects[]` | hub (after any project mutation) | socket-bridge: sets `projects.list` | server-wide |
| `project_switched` | S->C | `{ projectId, projectName, tasks, roadmap, workingDir, conversationId }` | hub / project-module | socket-bridge: dispatches `project_switched` | server-wide |
| `project_agents_loaded` | S->C | `data` | project-module | client | server-wide |

---

## MCP Servers

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `get_mcp_servers` | C->S | -- | settings UI | hub: emits internally, mcp-manager-module replies with `mcp_servers_updated` | socket |
| `enable_mcp_server` | C->S | `data` | settings UI | hub: emits internally, mcp-manager-module enables server | internal |
| `disable_mcp_server` | C->S | `data` | settings UI | hub: emits internally, mcp-manager-module disables server | internal |
| `add_mcp_server` | C->S | `data` | settings UI | hub: emits internally, mcp-manager-module adds server | internal |
| `remove_mcp_server` | C->S | `data` | settings UI | hub: emits internally, mcp-manager-module removes server | internal |
| `mcp_servers_updated` | S->C | `servers[]` | mcp-manager-module | socket-bridge: sets `mcp.servers` | server-wide |
| `mcp_server_result` | S->C | `{ server, result }` | mcp-manager-module | socket-bridge: dispatches `mcp_server_result` | room |

---

## Context and Processing

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `context_info` | S->C | `{ tokensUsed, estimatedTokens, compactionCount, model, inputTokens, outputTokens, ... }` | hub.broadcastContextInfo() | socket-bridge: sets `context.info` | server-wide |
| `context_warning` | S->C | `{ usage, threshold }` | conversation-module | socket-bridge: dispatches `context_warning` | room |
| `summarization_start` | S->C | -- | summarization-module | socket-bridge: dispatches `summarization_start` | room |
| `summarization_complete` | S->C | `{ newLength, oldLength }` | summarization-module | socket-bridge: dispatches `summarization_complete` | room |
| `manual_compact` | C->S | -- | settings UI | hub: runs summarizer.compactHistory(), refreshes context info | socket |
| `set_ai_summarization` | C->S | `data` | settings UI | hub: emits `set_ai_summarization` internally | internal |
| `get_session_notes` | C->S | `data` | settings UI | hub: emits `get_session_notes` internally | internal |
| `input_request` | S->C | `{ prompt, requestId }` | orchestration-module (ask_user tool) | socket-bridge: dispatches `input_request` | room |
| `input_response` | C->S | `{ requestId, response }` | client input modal | hub: emits `input_response` internally | internal |

---

## Git Operations

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `gitops_commit_now` | C->S | -- | client | hub: emits `gitops_commit_now` internally | internal |
| `gitops_commit` | S->C | `{ message, files, sha }` | git-module | client | room |
| `gitops_push` | S->C | `{ remote, branch }` | git-module | client | room |
| `gitops_push_request` | S->C | `{ remote, branch }` | git-module | client (approval prompt) | room |

---

## Obsidian Vault

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `discover_vaults` | C->S | -- | settings UI | hub: emits internally, obsidian module discovers and broadcasts `vaults_discovered` | internal |
| `set_vault_path` | C->S | `{ path }` | settings UI | hub: emits internally | internal |
| `clear_vault_path` | C->S | -- | settings UI | hub: emits internally | internal |
| `vaults_discovered` | S->C | `vaults[]` | obsidian-vault-module | socket-bridge: sets `obsidian.vaults` | room |

---

## Web Push

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `push_subscribe` | C->S | `PushSubscription` | service worker registration | hub: registers subscription for socket | internal |
| `push_resubscribe` | C->S | `PushSubscription` | service worker (on pushsubscriptionchange) | hub: re-registers subscription | internal |

---

## Voice

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `voice_clone_create` | C->S | `data` | settings UI | hub: emits internally | internal |
| `voice_clone_upload` | C->S | `data` | settings UI | hub: emits internally | internal |

---

## Miscellaneous

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `request_restart` | C->S | `{ force? }` | settings UI | hub: replies `restarting`, then kills process after 1s delay | socket |
| `restarting` | S->C | `{ force }` | hub (`request_restart` handler) | socket-bridge: dispatches `restarting` | socket |
| `ping_rtt` | C->S | `clientTs, cb` | client (latency measurement) | hub: immediately calls back with clientTs for RTT calculation | socket |
| `reminder_due` | S->C | `{ text, id }` | orchestration-module | socket-bridge: dispatches `reminder_due` | room |
| `timeline_event` | S->C | `event` | modules | socket-bridge: dispatches `timeline_event` | room |
| `ui_action` | S->C | `{ action, data }` | modules | socket-bridge: dispatches `ui_action` | room |

---

## Metrics Namespace (/metrics)

| Event | Direction | Payload | Emitter | Handler | Scope |
|-------|-----------|---------|---------|---------|-------|
| `tick` | S->C | `{ cpu, heapMB, rssMB, sockets, uptime, ts, loopLag }` | hub (3s interval) | metrics dashboard | volatile (namespace) |
