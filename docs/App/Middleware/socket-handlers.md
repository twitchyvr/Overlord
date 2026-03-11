# Socket Handler Reference

Complete reference of all socket.on() handlers registered in `hub.js`
inside `setupSocketBridge()` within the `io.on('connection')` callback.

Each entry: event name, parameters, behavior summary, and resulting hub
emit or broadcast.

---

## Connection Lifecycle (5 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 1 | `connect` | -- | Auto-joins socket to active conversation room. Sends orchestration state and agent states for UI hydration. | `orchestration_state`, `all_agent_states`, `presence_update` to room |
| 2 | `disconnect` | -- | Unregisters any web push subscription for the socket. | -- |
| 3 | `disconnecting` | -- | For each `conv:*` room the socket is leaving, broadcasts updated presence count after 150ms delay. | `presence_update` to room |
| 4 | `ping_rtt` | `clientTs, cb` | Immediately calls back with the client timestamp for round-trip-time calculation. | -- (callback only) |
| 5 | `register_client` | `data` | Forwards to hub as `client_registered` event for module consumption. | hub.emit `client_registered` |

---

## User Input and Messaging (5 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 6 | `user_input` | `text` | Rate-limited via token bucket. If allowed, emits `user_message` on hub. If throttled, sends a warning log to the socket. | hub.emit `user_message` |
| 7 | `cancel` | -- | Emits `cancel_request` on hub for orchestration module to abort. | hub.emit `cancel_request` |
| 8 | `new_conversation` | -- | Emits `new_conversation` on hub. | hub.emit `new_conversation` |
| 9 | `fork_conversation` | `{ messageIndex }, cb` | Saves current conversation, slices history at the given index, creates a new conversation with the forked history. Callback returns `{ success, id }`. | -- |
| 10 | `delete_message` | `{ messageIndex }, cb` | Removes the message at the given index from history and saves. Callback returns `{ success }`. | -- |

---

## Message Queue (7 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 11 | `get_message_queue` | `cb` | Returns current queue array via callback, or emits `queue_updated` if no callback. | `queue_updated` to socket or callback |
| 12 | `remove_queued_message` | `id, cb` | Filters out the item by id, broadcasts updated queue. | broadcast `queue_updated` |
| 13 | `edit_queued_message` | `{ id, text }, cb` | Finds the queued item by id and replaces its text, broadcasts updated queue. | broadcast `queue_updated` |
| 14 | `reorder_queue` | `ids[], cb` | Reorders the queue to match the given id array. Items not in the array are appended at the end. | broadcast `queue_updated` |
| 15 | `clear_queue` | `cb` | Empties the entire queue. | broadcast `queue_updated` |
| 16 | `force_dequeue` | `{ id? }, cb` | Dequeues a specific item (or the first item) and emits it as `user_message` immediately. | hub.emit `user_message`, broadcast `queue_updated` |
| 17 | `force_dequeue_all` | `{ mode? }, cb` | Drains entire queue. In `consolidated` mode (default), joins all messages with `---` separators. In `sequential` mode, sends only the first item. | hub.emit `user_message`, broadcast `queue_updated` |

---

## Hot Chat Injection (3 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 18 | `hot_inject` | `text, cb` | If AI is busy, buffers the text for injection at next cycle boundary. If AI is idle, routes as regular `user_message`. Callback returns `{ status: 'hot_queued'\|'immediate', id?, queueSize? }`. | hub.emit `user_message` (if idle) or broadcast `hot_inject_pending` (if busy) |
| 19 | `get_hot_inject_queue` | `cb` | Returns the current hot inject buffer via callback. | -- (callback only) |
| 20 | `clear_hot_inject_queue` | `cb` | Empties the hot inject buffer. | broadcast `hot_inject_pending` with count 0 |

---

## Approvals and Plans (8 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 21 | `approval_response` | `data: { toolId, approved }` | Forwards to hub EventEmitter. Broadcasts `approval_resolved` to all sockets so other devices dismiss their approval modals. | hub.emit `approval_response`, broadcastAll `approval_resolved` |
| 22 | `approve_plan` | -- | Emits `plan_approved` on hub. Broadcasts `plan_approved_ack` to all sockets for cross-device dismissal. | hub.emit `plan_approved`, broadcastAll `plan_approved_ack` |
| 23 | `cancel_plan` | -- | Emits `plan_cancelled` on hub. Orchestration module handles the `plan_cancelled_ack` broadcast. | hub.emit `plan_cancelled` |
| 24 | `revise_plan` | `feedback: string` | If non-empty, emits `plan_revision` on hub. Broadcasts `plan_cancelled_ack` to hide the plan bar while the revision is being generated. | hub.emit `plan_revision`, broadcastAll `plan_cancelled_ack` |
| 25 | `switch_plan_variant` | `data` | Emits `switch_plan_variant` on hub for orchestration to swap to an alternate plan variant. | hub.emit `switch_plan_variant` |
| 26 | `approve_checkpoint` | -- | Emits `checkpoint_approved` on hub. | hub.emit `checkpoint_approved` |
| 27 | `approve_recommendation` | `data` | Emits `approve_recommendation` on hub for orchestration to accept a task recommendation. | hub.emit `approve_recommendation` |
| 28 | `reject_recommendation` | `data` | Emits `reject_recommendation` on hub. | hub.emit `reject_recommendation` |

---

## Configuration (4 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 29 | `update_config` | `data` | Validates and applies 40+ configuration fields (model, customInstructions, autoQA, maxAICycles, thinkingEnabled, gitOps, TTS, rate limits, etc.). Clamps numeric values to safe ranges. Propagates limits to orchestration module. Persists to disk via `config.save()`. | socket.emit `config_updated` |
| 30 | `get_config` | -- | Reads all configuration fields from the config service and sends a full snapshot. | socket.emit `config_data` |
| 31 | `get_system_prompt` | -- | Builds the full system prompt via `ai.buildSystemPrompt()` (async) and returns it. | socket.emit `system_prompt_data` |
| 32 | `get_last_context` | -- | Returns the last API context snapshot from the AI module for debugging. | socket.emit `last_context_data` |

---

## Chat Mode and Orchestration Controls (13 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 33 | `set_mode` | `mode: string` | Validates against `['auto','plan','ask','pm','bypass']`. Updates `config.chatMode`. If switching to bypass, emits `bypass_active` to auto-approve pending approvals. If leaving plan mode, emits `plan_cancelled`. | broadcastAll `mode_changed`, hub.emit `bypass_active`/`plan_cancelled` |
| 34 | `set_strategy` | `data` | Forwards to hub EventEmitter for orchestration module. | hub.emit `set_strategy` |
| 35 | `set_overlay` | `data` | Forwards to hub EventEmitter for orchestration module. | hub.emit `set_overlay` |
| 36 | `set_max_cycles` | `data` | Forwards to hub EventEmitter for orchestration module. | hub.emit `set_max_cycles` |
| 37 | `set_max_agents` | `data` | Forwards to hub EventEmitter for orchestration module. | hub.emit `set_max_agents` |
| 38 | `pause_agent` | `data, cb` | Forwards to hub EventEmitter with callback for orchestration module. | hub.emit `pause_agent` |
| 39 | `resume_agent` | `data, cb` | Forwards to hub EventEmitter with callback for orchestration module. | hub.emit `resume_agent` |
| 40 | `kill_agent` | `data, cb` | Forwards to hub EventEmitter with callback for orchestration module. | hub.emit `kill_agent` |
| 41 | `set_auto_qa` | `data` | Forwards to hub EventEmitter for orchestration module. | hub.emit `set_auto_qa` |
| 42 | `clear_tool_history` | -- | Forwards to hub EventEmitter for orchestration module. | hub.emit `clear_tool_history` |
| 43 | `get_orch_dashboard` | `data, cb` | Forwards to hub EventEmitter with callback. | hub.emit `get_orch_dashboard` |
| 44 | `set_ai_summarization` | `data` | Forwards to hub EventEmitter. | hub.emit `set_ai_summarization` |
| 45 | `get_session_notes` | `data, cb` | Forwards to hub EventEmitter with callback. | hub.emit `get_session_notes` |

---

## Agent Management (12 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 46 | `add_agent` | `agentData, cb` | Creates agent via agentManager service. Handles project-scoped agents by storing in project data. Broadcasts team update. | socket.emit `agent_added`, broadcastAll `team_update` (via broadcastTeamFromDB) |
| 47 | `remove_agent` | `agentId, cb` | Deletes agent via agentManager. Broadcasts team update on success. | socket.emit `agent_removed`, broadcastAll `team_update` |
| 48 | `list_agents` | `cb` | Returns merged list of global agents + active project's agents via callback. Falls back to `agents_list` emit if no callback. | callback or socket.emit `agents_list` |
| 49 | `get_agent` | `agentId, cb` | Returns single agent object by id or name via callback. | -- (callback only) |
| 50 | `update_agent` | `agentData, cb` | Updates agent via agentManager (handles upsert for default agents). Broadcasts team update. | broadcastAll `team_update` |
| 51 | `get_security_roles` | `cb` | Returns the SECURITY_ROLES object from agentManager via callback. | callback or socket.emit `security_roles` |
| 52 | `get_available_tools` | `cb` | Returns categorized tools from the tools service via callback. | -- (callback only) |
| 53 | `set_agent_tools` | `{ agentId, tools }, cb` | Replaces an agent's tools list via agentManager.updateAgent(). | -- (callback only) |
| 54 | `direct_message` | `{ agentName, message }` | Routes message to agent session via orchestration.runAgentSession(). | -- |
| 55 | `get_agent_session` | `{ agentName }, cb` | Returns `{ state, history, inbox }` for the specified agent via callback. | -- (callback only) |
| 56 | `ai_fill_agent` | `data, cb` | AI-powered agent configuration generator. Uses tool weight profiles to select appropriate tools. Retries up to 3 times on JSON parse failure. | -- (callback with generated config) |
| 57 | `ai_fill_task` | `data, cb` | AI-powered task field generator. Returns title, description, priority, assignee, suggested_agents, milestoneId, dependencies, actions. | -- (callback with generated fields) |

---

## Agent Groups (6 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 58 | `list_groups` | `cb` | Returns groups array via callback. | -- (callback only) |
| 59 | `create_group` | `groupData, cb` | Creates group via agentManager. | -- (callback only) |
| 60 | `update_group` | `{ id, ... }, cb` | Updates group via agentManager. | -- (callback only) |
| 61 | `delete_group` | `groupId, cb` | Deletes group via agentManager. | -- (callback only) |
| 62 | `add_agent_to_group` | `{ agentId, groupId }, cb` | Adds agent to group via agentManager. | -- (callback only) |
| 63 | `remove_agent_from_group` | `{ agentId }, cb` | Removes agent from its group via agentManager. | -- (callback only) |

---

## Agent Chat Rooms and Meetings (13 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 64 | `create_chat_room` | `data, cb` | Creates a new chat room between `fromAgent` (default 'user') and `toAgent` via orchestration. Auto-marks user present. | -- (callback with room) |
| 65 | `list_chat_rooms` | `cb` | Returns active chat rooms via callback. | -- (callback only) |
| 66 | `get_chat_room` | `roomId, cb` | Returns single room object via callback. | -- (callback only) |
| 67 | `end_chat_room` | `roomId, cb` | Ends the chat room via orchestration.endChatRoom(). | -- (callback only) |
| 68 | `send_room_message` | `{ roomId, message }, cb` | Adds user message to room transcript. Triggers multi-round agent discussion: agents respond sequentially, then up to 3 additional autonomous rounds with 1.5s delay between rounds. Stops any existing discussion first. | broadcast `room_agent_thinking` per agent |
| 69 | `stop_room_agents` | `roomId, cb` | Cancels any pending discussion round timers and clears agent callbacks for the room. | broadcast `room_agents_stopped` |
| 70 | `pull_agent_into_room` | `{ roomId, agentName, pulledBy? }, cb` | Adds a new agent participant to an existing room via orchestration. | -- (callback with result) |
| 71 | `user_join_room` | `roomId, cb` | Marks the user as present in the room. | -- (callback with result) |
| 72 | `user_leave_room` | `roomId, cb` | Marks the user as absent from the room. | -- (callback with result) |
| 73 | `generate_meeting_notes` | `roomId, cb` | AI-generates meeting notes from the room transcript (async). | -- (callback with result) |
| 74 | `end_meeting` | `roomId, cb` | Generates meeting notes and closes the room (async). | -- (callback with result) |
| 75 | `list_meeting_notes` | `{ limit? }, cb` | Returns meeting notes list from agentManager (up to limit, default 50). | -- (callback only) |
| 76 | `get_meeting_notes` | `noteId, cb` | Returns single meeting notes document via callback. | -- (callback only) |

---

## Backchannel (2 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 77 | `orchestrator_send` | `{ agentName, message }, cb` | Routes message to agent session as `[Orchestrator]: message`. Stores in backchannel history (cap 500). Broadcasts to room. | broadcast `backchannel_msg` |
| 78 | `get_backchannel` | `cb` | Returns last 200 backchannel messages via callback. | -- (callback only) |

---

## Conversations (8 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 79 | `list_conversations` | -- | Lists all conversations via conversation service. | socket.emit `conversations_list` |
| 80 | `load_conversation` | `convId` | Loads a conversation by id. On success, sends history and roadmap. On failure, sends error. Also sends context warning. | socket.emit `conversation_loaded` or `conversation_error`, `context_warning` |
| 81 | `join_conversation` | `convId, cb` | Joins the socket to the conversation room. Replays full history and roadmap. Sends context warning. | socket.emit `conversation_loaded`, `context_warning`; callback `{ joined }` |
| 82 | `get_room_presence` | `convId, cb` | Returns the number of sockets in the conversation room. | -- (callback `{ room, count }`) |
| 83 | `set_working_dir` | `dir` | Sets working directory via conversation service. Also persists to active project data if one is loaded. | broadcast `working_dir_update` (from conversation service) |
| 84 | `clear_context` | -- | Clears conversation history and resets context tracker. | socket.emit `messages_cleared` |
| 85 | `archive_and_new` | -- | Archives current conversation and starts a new one. | socket.emit `conversation_new` |
| 86 | `manual_compact` | -- | Runs AI-powered context compaction via the summarizer service (async). Replaces conversation history with compacted version. Requires 10+ messages. | broadcast `summarization_start`/`summarization_complete` (from summarizer) |

---

## State Queries (4 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 87 | `get_context_info` | -- | Builds merged context info from context tracker and conversation service. | socket.emit `context_info` |
| 88 | `get_process_state` | -- | Returns server process state (PID, uptime, memory, port). | socket.emit `process_state` |
| 89 | `get_all_agent_states` | -- | Returns all agent session states from orchestration module. | socket.emit `all_agent_states` |
| 90 | `get_team` | -- | Returns team list merged from DB agents + project-scoped agents. | socket.emit `team_update` |

---

## Tasks (12 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 91 | `task_added` | `data` | Bridges to tasks-engine via `socket:task_added` hub event. | hub.emit `socket:task_added` |
| 92 | `task_toggled` | `data` | Bridges to tasks-engine via `socket:task_toggled` hub event. | hub.emit `socket:task_toggled` |
| 93 | `task_deleted` | `data` | Bridges to tasks-engine via `socket:task_deleted` hub event. | hub.emit `socket:task_deleted` |
| 94 | `task_updated` | `data` | Bridges to tasks-engine via `socket:task_updated` hub event. | hub.emit `socket:task_updated` |
| 95 | `tasks_reorder` | `data` | Bridges to tasks-engine via `socket:tasks_reorder` hub event. | hub.emit `socket:tasks_reorder` |
| 96 | `add_child_task` | `data, cb` | Bridges to tasks-engine via `socket:add_child_task` hub event. | hub.emit `socket:add_child_task` |
| 97 | `reparent_task` | `data, cb` | Bridges to tasks-engine via `socket:reparent_task` hub event. | hub.emit `socket:reparent_task` |
| 98 | `get_task_tree` | `data, cb` | Bridges to tasks-engine via `socket:get_task_tree` hub event. | hub.emit `socket:get_task_tree` |
| 99 | `get_task_children` | `data, cb` | Bridges to tasks-engine via `socket:get_task_children` hub event. | hub.emit `socket:get_task_children` |
| 100 | `get_task_breadcrumb` | `data, cb` | Bridges to tasks-engine via `socket:get_task_breadcrumb` hub event. | hub.emit `socket:get_task_breadcrumb` |
| 101 | `assign_task_to_milestone` | `data, cb` | Bridges to tasks-engine via `socket:assign_task_to_milestone` hub event. | hub.emit `socket:assign_task_to_milestone` |
| 102 | `focus_task` | `data, cb` | Bridges to tasks-engine via `socket:focus_task` hub event. | hub.emit `socket:focus_task` |

---

## Milestones (7 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 103 | `list_milestones` | `cb` | Returns milestones array from conversation service via callback. | -- (callback only) |
| 104 | `add_milestone` | `{ name, description?, color? }, cb` | Creates milestone via conversation service. | -- (callback with milestone) |
| 105 | `update_milestone` | `{ id, name?, description?, color? }, cb` | Updates milestone via conversation service. | -- (callback with milestone) |
| 106 | `delete_milestone` | `id, cb` | Deletes milestone via conversation service. | -- (callback `{ success }`) |
| 107 | `launch_milestone` | `id, cb` | Activates milestone, checks out its git branch (async). Broadcasts agent activity. | broadcast `agent_activity` |
| 108 | `orchestrate_milestone` | `milestoneId, cb` | Launches milestone, broadcasts full task list and agent activity event. | broadcastAll `tasks_update`, broadcast `agent_activity` |
| 109 | `ai_fill_milestone` | `data, cb` | AI-generates milestone name, description, color, and suggested_tasks (3-6 tasks with dependencies). | -- (callback with generated fields) |

---

## Projects (10 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 110 | `list_projects` | `cb` | Returns projects array via callback. | -- (callback only) |
| 111 | `get_active_project` | `cb` | Returns `{ project, data, projects }` for the active project via callback. | -- (callback only) |
| 112 | `get_project` | `id, cb` | Returns `{ project, data }` with enriched data including linked project details. | -- (callback only) |
| 113 | `create_project` | `projectData, cb` | Creates project via projects service. Broadcasts updated project list. | broadcastAll `projects_updated` |
| 114 | `update_project` | `updateData, cb` | Updates project. If updating the active project, applies config fields live (customInstructions, projectMemory, referenceDocumentation, requirements, workingDir). | broadcastAll `projects_updated` |
| 115 | `delete_project` | `id, cb` | Deletes project via projects service. | broadcastAll `projects_updated` |
| 116 | `switch_project` | `id, cb` | Switches active project. Broadcasts project list and full project context (tasks, roadmap, workingDir, conversationId). | broadcastAll `projects_updated`, broadcastAll `project_switched` |
| 117 | `ai_populate_project` | `{ description }, cb` | AI extracts structured project fields (name, description, workingDir, customInstructions, projectMemory, referenceDocumentation, requirements) from a freeform description. | -- (callback with fields) |
| 118 | `link_projects` | `{ id1, id2, relation, note? }, cb` | Links two projects with a relationship type. Accepts both `relation` and `relationship` field names. | broadcastAll `projects_updated` |
| 119 | `unlink_projects` | `{ id1, id2 }, cb` | Removes the link between two projects. | broadcastAll `projects_updated` |

---

## MCP Servers (5 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 120 | `get_mcp_servers` | -- | Emits to hub for mcp-manager-module to handle. Module replies directly to the socket. | hub.emit `get_mcp_servers` |
| 121 | `enable_mcp_server` | `data` | Emits to hub for mcp-manager-module. | hub.emit `enable_mcp_server` |
| 122 | `disable_mcp_server` | `data` | Emits to hub for mcp-manager-module. | hub.emit `disable_mcp_server` |
| 123 | `add_mcp_server` | `data` | Emits to hub for mcp-manager-module. | hub.emit `add_mcp_server` |
| 124 | `remove_mcp_server` | `data` | Emits to hub for mcp-manager-module. | hub.emit `remove_mcp_server` |

---

## Obsidian Vault (3 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 125 | `discover_vaults` | -- | Emits to hub for obsidian-vault-module. Module broadcasts `vaults_discovered`. | hub.emit `discover_vaults` |
| 126 | `set_vault_path` | `data` | Emits to hub for obsidian-vault-module. | hub.emit `set_vault_path` |
| 127 | `clear_vault_path` | -- | Emits to hub for obsidian-vault-module. | hub.emit `clear_vault_path` |

---

## Web Push (2 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 128 | `push_subscribe` | `sub: PushSubscription` | Registers the push subscription for this socket. Used for notifications when browser tab is backgrounded. | -- |
| 129 | `push_resubscribe` | `sub: PushSubscription` | Re-registers subscription after a `pushsubscriptionchange` event from the service worker. | -- |

---

## Voice (2 handlers)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 130 | `voice_clone_create` | `data` | Emits to hub for voice module to handle. | hub.emit `voice_clone_create` |
| 131 | `voice_clone_upload` | `data` | Emits to hub for voice module to handle. | hub.emit `voice_clone_upload` |

---

## GitOps (1 handler)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 132 | `gitops_commit_now` | -- | Emits to hub for git module to trigger an immediate commit. | hub.emit `gitops_commit_now` |

---

## User Input Response (1 handler)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 133 | `input_response` | `data: { requestId, response }` | Emits to hub for orchestration module (ask_user tool response). | hub.emit `input_response` |

---

## Restart (1 handler)

| # | Event | Parameters | Behavior | Emits / Broadcasts |
|---|-------|-----------|----------|-------------------|
| 134 | `request_restart` | `{ force? }` | Sends `restarting` to the requesting socket, then after 1s kills the process with SIGTERM (graceful) or SIGKILL (force). | socket.emit `restarting` |

---

## Summary by Category

| Category | Count | Handler Numbers |
|----------|-------|-----------------|
| Connection Lifecycle | 5 | 1-5 |
| User Input & Messaging | 5 | 6-10 |
| Message Queue | 7 | 11-17 |
| Hot Chat Injection | 3 | 18-20 |
| Approvals & Plans | 8 | 21-28 |
| Configuration | 4 | 29-32 |
| Mode & Orchestration Controls | 13 | 33-45 |
| Agent Management | 12 | 46-57 |
| Agent Groups | 6 | 58-63 |
| Chat Rooms & Meetings | 13 | 64-76 |
| Backchannel | 2 | 77-78 |
| Conversations | 8 | 79-86 |
| State Queries | 4 | 87-90 |
| Tasks | 12 | 91-102 |
| Milestones | 7 | 103-109 |
| Projects | 10 | 110-119 |
| MCP Servers | 5 | 120-124 |
| Obsidian Vault | 3 | 125-127 |
| Web Push | 2 | 128-129 |
| Voice | 2 | 130-131 |
| GitOps | 1 | 132 |
| User Input Response | 1 | 133 |
| Restart | 1 | 134 |
| **Total** | **134** | |

Note: The original count of "149 socket.on() handlers" includes additional
handlers from Socket.IO middleware, namespace-level connection handlers, and
internal hub.on() event listeners that are not direct socket.on() registrations
within the connection callback. The 134 entries above represent the distinct
socket.on() handlers registered per client connection.
