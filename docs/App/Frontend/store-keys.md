# Overlord UI -- Store Keys Reference

Complete reference of all reactive store keys. The store uses dot-notation paths (e.g., `team.agents`). Values are deep-cloned on `get()` to prevent mutation.

---

## Persisted Keys

These keys are synced to `localStorage` and hydrated on page load via `store.persist()`.

| Store Key | localStorage Key | Default | Type | Description |
|-----------|-----------------|---------|------|-------------|
| `tasks.view` | `overlord_task_view` | `'list'` | string | Active task view: `'list'`, `'tree'`, or `'kanban'` |
| `tasks.treeCollapsed` | `overlord_tree_collapsed` | `[]` | string[] | Array of task IDs whose tree branches are collapsed |
| `panels.visibility` | `overlord_panel_visibility` | `{}` | object | `{ panelId: boolean }` -- which panels are visible |
| `panels.states` | `overlord_panel_states` | `{}` | object | `{ panelId: boolean }` -- which panels are collapsed |
| `panels.heights` | `overlord_panel_heights` | `{}` | object | `{ panelId: string }` -- flex-basis pixel values (e.g., `'200px'`) |
| `panels.width` | `overlord_panel_width` | `320` | number or string | Right panel width in pixels |
| `chat.mode` | `overlord_chat_mode` | `'auto'` | string | Chat mode: `'auto'`, `'plan'`, `'pm'`, `'ask'` |
| `settings.aiSetKeys` | `overlord_ai_set_keys` | `[]` | string[] | Config keys that were set by AI (shown with badge) |
| `settings.longRunning` | `overlord_long_running` | `'off'` | string | Long-running mode: `'off'` or `'on'` |
| `settings.notifications` | `overlord_notifications` | `'on'` | string | Browser notifications: `'on'` or `'off'` |
| `ui.theme` | `theme` | `'dark'` | string | Active theme: `'dark'` or `'light'` |

---

## Non-Persisted Keys

These keys are initialized with defaults on store creation and updated at runtime. They are lost on page refresh (but re-synced from the server on reconnect).

| Store Key | Default | Type | Description |
|-----------|---------|------|-------------|
| `team.agents` | `[]` | object[] | Array of all registered agents |
| `tasks.list` | `[]` | object[] | Array of all tasks |
| `roadmap.items` | `[]` | object[] | Roadmap items (milestones, features, etc.) |
| `tasks.tree` | `null` | object or null | Pre-built tree structure (optional server-provided) |
| `orchestration.recommendations` | `[]` | object[] | Pending task recommendations from AI |
| `backchannel.messages` | `[]` | object[] | Agent backchannel messages (capped at 500) |
| `conversations.list` | `[]` | object[] | All saved conversations |
| `conversations.current` | `null` | string or null | Active conversation ID |
| `agents.sessions` | `{}` | object | `{ agentName: { isProcessing, paused, inboxCount, ... } }` |
| `agents.messages` | `{}` | object | `{ agentName: message[] }` -- per-agent message history |
| `ui.processing` | `false` | boolean | Whether the AI is currently processing |
| `ui.connected` | `false` | boolean | Socket.IO connection state |
| `ui.popouts` | `{}` | object | `{ panelId: windowRef }` -- popped out panels |
| `activity.items` | `[]` | object[] | Execution timeline entries (capped at 50) |
| `queue.messages` | `[]` | object[] | Pending message queue |
| `queue.drainMode` | `'consolidated'` | string | Queue drain mode |

---

## Dynamic Keys

These keys are set at runtime by socket-bridge.js or components but are not part of the initial store creation.

| Store Key | Type | Set By | Description |
|-----------|------|--------|-------------|
| `ui.workingDir` | string | socket-bridge (`init`, `working_dir_update`) | Current working directory path |
| `ui.status` | object | socket-bridge (`status_update`) | `{ status, message }` -- current processing status |
| `ui.streaming` | boolean | socket-bridge (`stream_start`, `request_end`) | Whether AI is streaming a response |
| `ui.layoutMode` | string | router.js | Current layout: `'desktop'`, `'tablet'`, `'mobile'` |
| `ui.presenceCount` | number | socket-bridge (`presence_update`) | Number of connected users |
| `orchestration.state` | object | socket-bridge (`orchestration_state`) | Lightweight orchestration state (status dot) |
| `orchestration.dashboard` | object | socket-bridge (`orchestrator_dashboard`) | Full orchestration dashboard state |
| `settings.config` | object | socket-bridge (`config_data`, `config_updated`) | Server configuration data |
| `context.info` | object | socket-bridge (`context_info`) | Context window usage info |
| `mcp.servers` | object | socket-bridge (`mcp_servers_updated`) | MCP server list and states |
| `obsidian.vaults` | array | socket-bridge (`vaults_discovered`) | Discovered Obsidian vaults |
| `projects.list` | array | socket-bridge (`projects_updated`) | List of projects |

---

## Key Access Patterns

### Writers and Readers by Key

| Store Key | Writers | Readers |
|-----------|---------|---------|
| `team.agents` | socket-bridge (`init`, `team_update`) | TeamPanel, ProjectPanel, RoomView, AgentManagerView |
| `tasks.list` | socket-bridge (`init`, `tasks_update`) | TasksPanel, ProjectPanel, OrchestrationPanel, TeamPanel |
| `tasks.view` | TasksPanel | TasksPanel |
| `tasks.tree` | socket-bridge (`task_tree_update`) | TasksPanel |
| `tasks.treeCollapsed` | TasksPanel | TasksPanel |
| `roadmap.items` | socket-bridge (`init`, `roadmap_update`) | ProjectPanel |
| `orchestration.recommendations` | socket-bridge (`task_recommendations_update`) | OrchestrationPanel |
| `orchestration.state` | socket-bridge (`orchestration_state`) | OrchestrationPanel |
| `orchestration.dashboard` | socket-bridge (`orchestrator_dashboard`), OrchestrationPanel | OrchestrationPanel |
| `backchannel.messages` | socket-bridge (`backchannel_msg`, `connect`) | (consumed via engine events) |
| `conversations.list` | socket-bridge (`conversations_list`) | ChatView (via engine event) |
| `conversations.current` | socket-bridge (`init`, `conversation_loaded`) | socket-bridge (on connect) |
| `agents.sessions` | socket-bridge (`agent_session_state`, `agent_paused`, `agent_resumed`, `all_agent_states`) | TeamPanel, OrchestrationPanel, AgentChatView |
| `agents.messages` | (components) | AgentChatView |
| `ui.processing` | socket-bridge (`process_state`, `status_update`, `request_start`, `request_end`) | ChatView (via store or engine) |
| `ui.connected` | socket-bridge (`connect`, `disconnect`, `reconnect`) | (status bar) |
| `ui.streaming` | socket-bridge (`stream_start`, `request_end`) | ChatView |
| `ui.workingDir` | socket-bridge (`init`, `working_dir_update`) | (status bar, settings) |
| `ui.theme` | SettingsView | (CSS via `html[data-theme]`) |
| `ui.layoutMode` | Router | (layout switching) |
| `ui.status` | socket-bridge (`status_update`) | (status bar) |
| `ui.presenceCount` | socket-bridge (`presence_update`) | (status bar) |
| `activity.items` | socket-bridge (`agent_activity`) | ActivityPanel |
| `queue.messages` | socket-bridge (`queue_updated`, `connect`) | ChatView (queue display) |
| `queue.drainMode` | (initial only) | (queue processing) |
| `panels.visibility` | panel.js (`togglePanelVisibility`, `showAllPanels`, `hideAllPanels`) | panel.js (`applyPanelVisibility`) |
| `panels.states` | PanelComponent (`_persistCollapseState`) | PanelComponent (`_applyPersistedState`) |
| `panels.heights` | panel.js (`savePanelHeights`) | panel.js (`applyPersistedHeights`) |
| `panels.width` | panel.js (`initRightPanelResize`) | panel.js (`initRightPanelResize`) |
| `chat.mode` | socket-bridge (`init`, `process_state`, `conversation_loaded`, `mode_changed`, `overlay_changed`) | ChatView (mode selector) |
| `settings.config` | socket-bridge (`config_data`, `config_updated`) | SettingsView |
| `settings.aiSetKeys` | SettingsView | SettingsView |
| `settings.longRunning` | SettingsView | (input area) |
| `settings.notifications` | SettingsView | (notification logic) |
| `context.info` | socket-bridge (`context_info`) | SettingsView (context viewer) |
| `mcp.servers` | socket-bridge (`mcp_servers_updated`) | SettingsView (MCP tab) |
| `obsidian.vaults` | socket-bridge (`vaults_discovered`) | SettingsView |
| `projects.list` | socket-bridge (`projects_updated`) | (project manager) |

---

## Subscription Semantics

```
store.subscribe('tasks', fn)
```

This fires when ANY child key changes:
- `store.set('tasks.list', [...])` -- fires
- `store.set('tasks.view', 'tree')` -- fires
- `store.set('tasks.treeCollapsed', [...])` -- fires

```
store.subscribe('*', fn)
```

This fires on EVERY key change in the entire store.

```
store.subscribe('tasks.list', fn)
```

This fires ONLY when `tasks.list` is set directly.

---

## Batch Updates

The `init` and `process_state` socket events use `store.batch()` to set multiple keys atomically. Subscribers are notified only once, after all keys are updated:

```javascript
store.batch(() => {
    store.set('team.agents', agents);
    store.set('tasks.list', tasks);
    store.set('roadmap.items', items);
    store.set('chat.mode', mode);
});
// All subscribers fire here, once.
```
