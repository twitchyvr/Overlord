# Overlord UI -- Component Reference

Complete reference for every UI module in the frontend. Organized by layer: Core, Components, Panels, Views.

---

## Table of Contents

- [Core Modules](#core-modules)
  - [engine.js](#enginejs)
  - [state.js](#statejs)
  - [socket-bridge.js](#socket-bridgejs)
  - [router.js](#routerjs)
- [Components](#components)
  - [modal.js](#modaljs)
  - [panel.js](#paneljs)
  - [toast.js](#toastjs)
  - [tabs.js](#tabsjs)
  - [button.js](#buttonjs)
  - [dropdown.js](#dropdownjs)
  - [card.js](#cardjs)
  - [table.js](#tablejs)
  - [drill-item.js](#drill-itemjs)
- [Panels](#panels)
  - [log.js](#logjs)
  - [orchestration.js](#orchestrationjs)
  - [team.js](#teamjs)
  - [tasks.js](#tasksjs)
  - [activity.js](#activityjs)
  - [project.js](#projectjs)
  - [tools.js](#toolsjs)
- [Views](#views)
  - [chat.js](#chatjs)
  - [settings.js](#settingsjs)
  - [agent-manager.js](#agent-managerjs)
  - [agent-chat.js](#agent-chatjs)
  - [kanban.js](#kanbanjs)
  - [room-view.js](#room-viewjs)

---

## Core Modules

### engine.js

**Path:** `public/ui/engine.js`

**Purpose:** Central singleton (`OverlordUI`) that manages component lifecycle, event dispatch, DOM helpers, and pop-out window synchronization. Also exports the `Component` base class and `h()` hyperscript helper.

**Key Exports:**

| Export | Type | Description |
|--------|------|-------------|
| `Component` | Class | Base class for all UI components |
| `OverlordUI` | Object (singleton) | Engine with registry, event bus, DOM helpers |
| `h` | Function | Bound reference to `OverlordUI.h()` |

**Component Base Class:**

| Method | Description |
|--------|-------------|
| `constructor(el, opts)` | Stores root element and options |
| `mount()` | Override: called when entering the DOM |
| `render(state)` | Override: called on state change |
| `unmount()` | Override: temporary removal |
| `destroy()` | Full teardown: subs, listeners, DOM removal |
| `subscribe(store, key, fn)` | Auto-cleaned store subscription |
| `$(selector)` | Scoped querySelector within component root |
| `$$(selector)` | Scoped querySelectorAll (returns Array) |
| `on(eventType, selector, handler)` | Delegated event listener, auto-cleaned |

**OverlordUI Singleton:**

| Category | Methods |
|----------|---------|
| Init | `init(store)` |
| Component Registry | `registerComponent(id, instance)`, `mountComponent(id)`, `unmountComponent(id)`, `destroyComponent(id)`, `getComponent(id)`, `mountAll()` |
| Legacy Compat | `register(id, deps, render)`, `dispatch(event, data)`, `getState(event)`, `refresh(id)`, `refreshForEvent(event)` |
| Event Bus | `subscribe(event, fn)` -- returns unsubscribe function |
| DOM Helpers | `h(tag, attrs, ...children)`, `setContent(el, content)`, `setTrustedContent(el, htmlString)`, `$(selector, scope)`, `$$(selector, scope)` |
| Event Delegation | `on(root, eventType, selector, handler)` -- returns teardown function |
| BroadcastChannel | `broadcast(msg)`, `popOut(panelId)`, `pullBack(panelId)` |
| Utility | `debounce(fn, delay)`, `throttle(fn, limit)`, `escapeHtml(str)`, `uid(prefix)`, `formatTime(date)`, `clamp(val, min, max)` |

**Internal Maps:**

| Map | Key -> Value |
|-----|-------------|
| `_components` | id -> Component instance |
| `_panels` | id -> { deps, render } (legacy) |
| `_state` | eventName -> latestData |
| `_eventBus` | eventName -> Set of callbacks |

**BroadcastChannel Messages:**

| type | Direction | Data |
|------|-----------|------|
| `panel_popped_out` | Main -> Popout | `{ panelId }` |
| `panel_pulled_back` | Main -> Popout | `{ panelId }` |
| `popout_closing` | Popout -> Main | `{ panelId }` |
| `theme_changed` | Both | `{ theme }` |
| `state_sync` | Both | `{ key, value }` |

---

### state.js

**Path:** `public/ui/state.js`

**Purpose:** Centralized reactive state store replacing scattered globals. Supports dot-notation keys, reactive subscriptions, localStorage persistence, batch updates, and snapshot/restore.

**Key Exports:**

| Export | Type | Description |
|--------|------|-------------|
| `Store` | Class | The reactive state store |
| `createStore()` | Function | Factory that returns a pre-configured Store |

**Store API:**

| Method | Description |
|--------|-------------|
| `get(key, fallback)` | Deep-cloned value at dot-notation path |
| `peek(key, fallback)` | Uncloned value (performance, read-only use) |
| `set(key, value, opts)` | Set value, notify subscribers, persist if registered. Options: `{ silent, broadcast }` |
| `update(key, fn, opts)` | Apply transform function to current value |
| `delete(key)` | Remove key and notify |
| `has(key)` | Check existence |
| `subscribe(key, fn)` | Listen for changes. `'*'` for all. Returns unsubscribe |
| `persist(key, storageKey, fallback)` | Register for localStorage persistence + hydrate |
| `batch(fn)` | Group multiple set() calls, notify once after |
| `snapshot()` | Deep clone of entire store |
| `restore(data)` | Replace store data, notify all listeners |

**Subscription Semantics:**

- Exact match on key fires listener.
- Wildcard `'*'` fires on any key change.
- Parent key listeners fire when child keys change (e.g., subscribing to `'tasks'` fires when `'tasks.list'` changes).

**Default Store (created by `createStore()`):**

- 11 persisted keys (see store-keys.md for full list).
- 17 non-persisted keys initialized with defaults.
- Total: 28 initial keys.

---

### socket-bridge.js

**Path:** `public/ui/socket-bridge.js`

**Purpose:** Maps all 83 Socket.IO events from the server to store updates and engine dispatches. This is the single connection point between the server and the UI state.

**Key Export:**

| Export | Type | Description |
|--------|------|-------------|
| `initSocketBridge(socket, store, engine)` | Function | Wires all event handlers |

**Event Categories and Mappings:**

| Category | Socket Events | Store Keys Written | Engine Events Dispatched |
|----------|---------------|--------------------|--------------------------|
| Connection | `connect`, `disconnect`, `reconnect_attempt`, `reconnect`, `connect_error` | `ui.connected` | `connected`, `disconnected`, `log` |
| Init | `init` | `conversations.current`, `team.agents`, `tasks.list`, `roadmap.items`, `ui.workingDir`, `chat.mode` | `init` |
| Process | `process_state` | `ui.processing`, `chat.mode` | `process_state` |
| State Broadcasts | `roadmap_update`, `team_update`, `agents_updated`, `tasks_update`, `task_tree_update`, `working_dir_update` | `roadmap.items`, `team.agents`, `tasks.list`, `tasks.tree`, `ui.workingDir` | corresponding event names |
| Messaging | `status_update`, `message_add`, `stream_start`, `stream_update` | `ui.processing`, `ui.status`, `ui.streaming` | corresponding event names |
| Conversations | `conversations_list`, `conversation_loaded`, `conversation_error`, `conversation_new`, `messages_cleared` | `conversations.list`, `conversations.current`, `chat.mode` | corresponding event names |
| Tools | `tool_result`, `tool_result_binary`, `approval_request`, `approval_timeout`, `approval_resolved` | (none) | corresponding event names |
| Agent Rooms | `agent_room_opened`, `agent_room_message`, `agent_room_closed`, `role_block`, `delegation_request` | (none) | corresponding event names |
| Meeting | `room_participant_joined`, `room_participant_left`, `room_user_joined`, `meeting_notes_generated` | (none) | corresponding event names |
| Orchestration | `orchestration_state`, `orchestrator_dashboard`, `agent_message`, `agent_session_state`, `agent_paused`, `agent_resumed`, `agent_inbox_update`, `all_agent_states`, `agent_activity`, `task_recommendations_update` | `orchestration.state`, `orchestration.dashboard`, `agents.sessions`, `activity.items`, `orchestration.recommendations` | corresponding event names |
| AI Outputs | `neural_thought`, `thinking_done`, `images_generated`, `screenshot_taken`, `audio_ready`, `file_diff`, `show_chart` | (none) | corresponding event names |
| MCP | `mcp_servers_updated`, `mcp_server_result` | `mcp.servers` | corresponding event names |
| Obsidian | `vaults_discovered` | `obsidian.vaults` | `vaults_discovered` |
| Context | `context_info`, `context_warning`, `summarization_start`, `summarization_complete`, `request_start`, `request_end` | `context.info`, `ui.processing`, `ui.streaming` | corresponding event names |
| Plan | `plan_ready`, `plan_variant_switched`, `plan_cancelled_ack`, `plan_approved_ack`, `plan_timeout`, `plan_bypass_approved`, `approval_request_notice` | (none) | corresponding event names |
| Chat Mode | `mode_changed` | `chat.mode` | `mode_changed` |
| Backchannel | `backchannel_msg` | `backchannel.messages` (capped at 500) | `backchannel_msg` |
| Queue | `queue_updated`, `message_injected` | `queue.messages` | corresponding event names |
| Settings | `config_data`, `config_updated`, `config_updated_by_ai`, `input_request` | `settings.config` | corresponding event names |
| Hot Inject | `hot_inject_pending`, `hot_inject_applied` | (none) | corresponding event names |
| Milestones | `milestone_complete_celebration`, `milestone_all_tasks_done` | (none) | corresponding event names |
| File Streaming | `file_write_start`, `file_write_chunk`, `file_write_end` | (none) | corresponding event names |
| Projects | `projects_updated`, `project_switched` | `projects.list` | corresponding event names |
| Misc | `timeline_event`, `overlay_changed`, `reminder_due`, `ui_action`, `log`, `presence_update` | `ui.presenceCount`, `chat.mode` | corresponding event names |

**Connect Behavior:**

On every `connect` event (including reconnects), the bridge emits these requests to sync full state:
- `get_process_state`
- `get_config`
- `get_team`
- `list_conversations`
- `get_context_info`
- `get_orch_dashboard`
- `get_all_agent_states`
- `join_conversation` (if `conversations.current` exists)
- `get_message_queue` (if not recovered)
- `get_backchannel` (if not recovered)

---

### router.js

**Path:** `public/ui/router.js`

**Purpose:** Controls mobile/tablet/desktop layout switching. Sets CSS classes on `#app` and manages mobile view navigation.

**Key Export:**

| Export | Type | Description |
|--------|------|-------------|
| `Router` | Object (singleton) | Layout router |

**Breakpoints:**

| Mode | Viewport Width | Behavior |
|------|---------------|----------|
| mobile | <= 768px | Full-screen views, bottom tab bar, one panel at a time |
| tablet | 769px -- 1100px | Chat + narrow right panel (200-240px) |
| desktop | > 1100px | Chat + full right panel side-by-side |

**API:**

| Method | Description |
|--------|-------------|
| `init(engine, store)` | Bootstrap -- detect mode, set up resize listener |
| `setView(viewId)` | Switch mobile view (chat, project, team, activity, tasks, log, orchestration) |
| `getView()` | Get active mobile view ID |

**Store Keys Written:** `ui.layoutMode`

**Engine Events Dispatched:** `layout_mode`

**DOM Elements Managed:** `#app` (adds `mode-desktop` / `mode-tablet` / `mode-mobile` class), `#mobile-nav`

**Legacy Compat:** `window.showMobilePanel` is set to `Router.setView`.

---

## Components

### modal.js

**Path:** `public/ui/components/modal.js`

**Purpose:** Unified overlay/modal manager with z-stack, backdrop click close, escape key close, and body scroll lock. Replaces 15+ bespoke overlay implementations.

**Key Export:**

| Export | Type | Description |
|--------|------|-------------|
| `Modal` | Class (static methods) | Modal manager |

**Static API:**

| Method | Description |
|--------|-------------|
| `Modal.open(id, options)` | Open a modal. Returns backdrop element |
| `Modal.close(id)` | Close by ID |
| `Modal.closeAll()` | Close all open modals (topmost first) |
| `Modal.isOpen(id)` | Check if open |
| `Modal.count` | Number of open modals |
| `Modal.getBody(id)` | Get `.modal-body` element of an open modal |

**Options for `Modal.open()`:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `content` | string or Node | -- | Modal body content |
| `title` | string | -- | Header title (optional) |
| `size` | string | `'md'` | `'sm'`, `'md'`, `'lg'`, `'xl'`, `'full'` |
| `position` | string | `'center'` | `'center'`, `'bottom-sheet'`, `'drawer-right'`, `'fullscreen'` |
| `closeOnBackdrop` | boolean | `true` | Close on backdrop click |
| `closeOnEscape` | boolean | `true` | Close on Escape key |
| `className` | string | `''` | Additional CSS class |
| `onClose` | Function | -- | Callback when modal closes |
| `onOpen` | Function | -- | Callback after modal opens |

**Z-Index Management:** Base z-index is 1000. Each stacked modal adds 10. Topmost modal handles Escape key exclusively.

**DOM Structure:** Modals are appended to `#modal-root` (created on first use in `document.body`).

---

### panel.js

**Path:** `public/ui/components/panel.js`

**Purpose:** Self-contained panel component with collapse/expand, visibility toggle, pop-out, maximize/solo, drag-resize, and state persistence.

**Key Exports:**

| Export | Type | Description |
|--------|------|-------------|
| `PanelComponent` | Class (extends Component) | Panel base class |
| `getPanels()` | Function | Returns `Map<id, PanelComponent>` |
| `getPanelRegistry()` | Function | Returns array of `{id, label, icon, defaultVisible}` |
| `initPanelSystem()` | Function | Mount all, apply visibility, init dividers/resize |
| `applyPanelVisibility()` | Function | Apply visibility from store to all panels |
| `togglePanelVisibility(panelId)` | Function | Toggle and persist one panel |
| `showAllPanels()` | Function | Show all, persist |
| `hideAllPanels()` | Function | Hide all, persist |
| `applyPersistedHeights()` | Function | Restore flex-basis values from store |
| `savePanelHeights()` | Function | Save current flex-basis values |
| `updateDividerVisibility()` | Function | Show dividers only between visible panels |
| `initPanelDividers()` | Function | Wire up drag-resize on `.panel-divider` elements |
| `initRightPanelResize()` | Function | Wire up `#panel-resize-handle` for right panel width |
| `renderPanelConfigurator(menuEl)` | Function | Render visibility toggle menu |
| `renderToolbarPanelToggles(containerEl)` | Function | Render toolbar toggle buttons |

**PanelComponent API:**

| Method | Description |
|--------|-------------|
| `collapse()` / `expand()` / `toggleCollapse()` | Collapse/expand (animated) |
| `show()` / `hide()` | Visibility |
| `popOut()` / `pullBack()` | Pop-out to separate window |
| `maximize()` / `restore()` / `toggleMaximize()` | Solo mode |
| `setContent(content)` | Safe content update |
| `setTrustedContent(htmlString)` | Trusted HTML content update |

**Store Keys Used:** `panels.visibility`, `panels.states`, `panels.heights`, `panels.width`

**Accessibility:** Panel headers have `role="button"`, `aria-expanded`, `aria-controls`, and keyboard support (Enter/Space).

---

### toast.js

**Path:** `public/ui/components/toast.js`

**Purpose:** Notification toast system with auto-dismiss, stacking, and five visual types.

**Key Export:**

| Export | Type | Description |
|--------|------|-------------|
| `Toast` | Class (static methods) | Toast manager |

**Static API:**

| Method | Description |
|--------|-------------|
| `Toast.show(message, opts)` | Show a toast. Returns toast element |
| `Toast.dismiss(toastEl)` | Dismiss with exit animation |
| `Toast.dismissAll()` | Dismiss all active toasts |
| `Toast.info(msg, opts)` | Convenience: info toast |
| `Toast.success(msg, opts)` | Convenience: success toast |
| `Toast.warning(msg, opts)` | Convenience: warning toast |
| `Toast.error(msg, opts)` | Convenience: error toast |
| `Toast.agent(msg, opts)` | Convenience: agent toast (aurora border) |

**Options for `Toast.show()`:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `type` | string | `'info'` | `'info'`, `'success'`, `'warning'`, `'error'`, `'agent'` |
| `duration` | number | `4000` | Auto-dismiss ms (0 = no auto-dismiss) |
| `closable` | boolean | `true` | Show close button |
| `title` | string | -- | Title (for agent toasts) |
| `preview` | string | -- | Preview text (for agent toasts) |
| `link` | string | -- | Link text (for agent toasts) |
| `onClick` | Function | -- | Click handler |

**DOM:** Toasts are appended to `#toast-container` (created on first use).

---

### tabs.js

**Path:** `public/ui/components/tabs.js`

**Purpose:** Accessible segmented control / tab bar. Used for plan variant selectors, team filters, task view tabs, settings tabs, and chat mode selector.

**Key Export:**

| Export | Type | Description |
|--------|------|-------------|
| `Tabs` | Class (extends Component) | Tab bar |

**Constructor Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `items` | Array | `[]` | `[{ id, label, badge?, icon?, disabled? }]` |
| `activeId` | string | first item | Initially active tab |
| `style` | string | `'pills'` | `'pills'`, `'underline'`, `'segmented'` |
| `onChange` | Function | -- | Callback `(id, prevId)` on tab switch |

**API:**

| Method | Description |
|--------|-------------|
| `getActive()` | Currently active tab ID |
| `setActive(id, silent)` | Programmatically activate a tab |
| `setBadge(id, text)` | Update badge on a specific tab |
| `setItems(items, activeId)` | Replace entire item list |

**Keyboard Navigation:** Arrow keys (left/right/up/down), Home, End.

**Accessibility:** `role="tab"`, `aria-selected`, `aria-disabled`, managed `tabindex`.

---

### button.js

**Path:** `public/ui/components/button.js`

**Purpose:** Standardized button factory with consistent variants and sizes.

**Key Export:**

| Export | Type | Description |
|--------|------|-------------|
| `Button` | Class (static methods) | Button factory |

**Static API:**

| Method | Description |
|--------|-------------|
| `Button.create(label, opts)` | Create a button element |
| `Button.setLoading(btn, loading)` | Toggle loading state |
| `Button.group(buttons, opts)` | Wrap buttons in a `.btn-group` |

**Options for `Button.create()`:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `variant` | string | `'secondary'` | `'primary'`, `'secondary'`, `'ghost'`, `'danger'`, `'electric'` |
| `size` | string | `'md'` | `'sm'`, `'md'`, `'lg'` |
| `icon` | string | -- | Prepended icon |
| `iconAfter` | string | -- | Appended icon |
| `disabled` | boolean | `false` | Disabled state |
| `loading` | boolean | `false` | Loading spinner |
| `className` | string | -- | Additional CSS class |
| `title` | string | -- | Tooltip |
| `type` | string | `'button'` | `'button'`, `'submit'`, `'reset'` |
| `dataset` | object | `{}` | data-* attributes |
| `onClick` | Function | -- | Click handler |

---

### dropdown.js

**Path:** `public/ui/components/dropdown.js`

**Purpose:** Self-positioning dropdown with click-outside close and optional search filtering. Renders at `document.body` level to escape stacking contexts.

**Key Export:**

| Export | Type | Description |
|--------|------|-------------|
| `Dropdown` | Class (extends Component) | Dropdown menu |

**Constructor:** `new Dropdown(triggerEl, opts)`

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `items` | Array | `[]` | `[{ id, label, icon?, divider?, disabled?, danger? }]` |
| `onSelect` | Function | -- | Callback `(item)` on selection |
| `searchable` | boolean | `false` | Show search filter |
| `position` | string | `'auto'` | `'below'`, `'above'`, `'auto'` |
| `className` | string | -- | Additional CSS class |
| `maxHeight` | number | `300` | Max dropdown height in px |

**API:**

| Method | Description |
|--------|-------------|
| `open()` | Open the dropdown |
| `close()` | Close the dropdown |
| `toggle()` | Toggle open/close |
| `isOpen` | Getter: whether open |
| `setItems(items)` | Replace items dynamically |

**Behavior:** Menu is appended to `document.body` with `position: fixed` and `z-index: 9999`. Repositions on window resize/scroll. Click outside closes. Search input auto-focuses on open.

---

### card.js

**Path:** `public/ui/components/card.js`

**Purpose:** Factory for standardized cards across the UI.

**Key Export:**

| Export | Type | Description |
|--------|------|-------------|
| `Card` | Class (static methods) | Card factory |

**Static API:**

| Method | Description |
|--------|-------------|
| `Card.create(type, data, options)` | Create a card element |

**Types:**

| Type | Builder | Data Fields |
|------|---------|-------------|
| `'agent'` | `_buildAgent` | `name`, `status`, `badge`, `role`, `currentTask`, `capabilities[]` |
| `'task'` | `_buildTask` | `id`, `title`, `description`, `completed`, `status`, `priority`, `assignee`, `created` |
| `'recommendation'` | `_buildRecommendation` | `title`, `description` |
| `'milestone'` | `_buildMilestone` | `title`, `description`, `status`, `progress` |
| `'kanban'` | `_buildKanban` | `title`, `assignee`, `priority` |
| `'generic'` | `_buildGeneric` | `title`, `body` (string or Node), `footer` |

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `variant` | string | `'glass'` | `'glass'`, `'solid'`, `'outlined'` |
| `className` | string | `''` | Additional CSS class |
| `actions` | object | `{}` | `{ label: handler(data, card) }` |

---

### table.js

**Path:** `public/ui/components/table.js`

**Purpose:** Styled table renderer. Hooks into marked.js to auto-style markdown tables.

**Key Export:**

| Export | Type | Description |
|--------|------|-------------|
| `Table` | Class (static methods) | Table renderer |

**Static API:**

| Method | Description |
|--------|-------------|
| `Table.render(data, columns, opts)` | Create a styled table from data. Returns a `.table-wrapper` div |
| `Table.styleMarkdownTables(el)` | Post-process element to add Overlord styles to all `<table>` elements |
| `Table.configureMarked(marked)` | Configure marked.js to auto-style tables |

**Options for `Table.render()`:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `striped` | boolean | `true` | Alternating row colors |
| `hoverable` | boolean | `true` | Highlight rows on hover |
| `compact` | boolean | `false` | Reduced padding |
| `className` | string | `''` | Additional CSS class |

**Column Definition:** `{ key, label, align?, width? }`

---

### drill-item.js

**Path:** `public/ui/components/drill-item.js`

**Purpose:** Generic drillable list item used by Log, Activity, Project, and other panels. Provides accordion expand on click and bottom sheet / modal on long-press.

**Key Export:**

| Export | Type | Description |
|--------|------|-------------|
| `DrillItem` | Class (static methods) | Drillable list item factory |

**Static API:**

| Method | Description |
|--------|-------------|
| `DrillItem.create(type, data, config)` | Create a drill item element |

**Config Object:**

| Property | Type | Description |
|----------|------|-------------|
| `summary` | Function or string | Main summary text. Function receives `data` |
| `badge` | Function or object | Badge `{ text, color }` or string |
| `icon` | Function or string | Icon (emoji/text) |
| `meta` | Function or string | Right-side metadata text |
| `detail` | Array | `[{ label, key?, value?, format? }]` -- inline detail fields |
| `actions` | Function or Array | `[{ label, onClick, variant? }]` |
| `sheet` | Function | Custom DOM element for bottom sheet content |
| `sheetDetail` | Array | Override detail fields for sheet mode |
| `detailRender` | Function | Custom detail renderer, returns HTMLElement |

**Detail Field Formats:** `'date'`, `'duration'`, `'json'`

**Behaviors:**

- **Click** summary row: inline accordion expand (siblings collapse).
- **Long-press** (500ms) or click the three-dot button: opens bottom sheet (mobile, `position: 'bottom-sheet'`) or center modal (desktop).
- DOM attributes: `data-drill-type`, `data-drill-id`, `data-expanded` (`'0'` or `'1'`).

---

## Panels

All panels extend `PanelComponent` (which extends `Component`).

### log.js

**Path:** `public/ui/panels/log.js`

**Purpose:** System log with drillable entries showing infrastructure events.

**Class:** `LogPanel extends PanelComponent`

**Features:**
- DrillItem-based entries with inline expand for multiline messages.
- Filter chips: All, Info, Warn, Errors.
- Auto-scroll toggle.
- Max 500 entries (FIFO).
- Timestamped, type-colored entries with icons (info, success, warning, error, debug).

**Engine Events Subscribed:** `log`

**Store Keys Read:** (none directly -- receives data via engine events)

**DOM Elements Managed:** `#log` or `.panel-content` (entry list), `.activity-filter-bar` (filter chips)

**Actions:**
- `data-action="clear-log"`: Clear all entries.
- `data-action="toggle-autoscroll"`: Toggle auto-scroll behavior.

---

### orchestration.js

**Path:** `public/ui/panels/orchestration.js`

**Purpose:** Full orchestration dashboard with pipeline status, strategy controls, agent fleet management, and task recommendations.

**Class:** `OrchestrationPanel extends PanelComponent`

**Sections:**

1. **Pipeline** -- Status label, cycle gauge, context gauge, perception readout (chain depth, hot-inject count, strategy, active agents).
2. **Strategy** -- Selector buttons (Auto / Supervised / Autonomous) + overlay controls (Planning / PM / None).
3. **Agent Fleet** -- Cards per active agent with status dot, task snippet, pause/resume/kill buttons. Max Parallel Agents slider (1-8).
4. **Execution Timeline** -- Last 20 tool calls with tier badges, agent names, durations.
5. **Configuration** -- Max Cycles slider (1-100 + unlimited checkbox), Auto QA toggle, Orchestrator Guardrails (display-only), AI Context Summarization toggle, approval/QA stats, session notes count.
6. **Recommendations** -- Task recommendation cards with approve/reject buttons.

**Store Keys Subscribed:** `orchestration.dashboard`, `orchestration.state`, `orchestration.recommendations`

**Socket Emits:**

| Emit | Payload |
|------|---------|
| `set_strategy` | `{ strategy }` |
| `set_overlay` | `{ overlay }` |
| `set_max_cycles` | `{ value }` |
| `set_max_agents` | `{ value }` |
| `set_auto_qa` | `{ enabled }` |
| `set_ai_summarization` | `{ enabled }` |
| `pause_agent` | `{ agent }` |
| `resume_agent` | `{ agent }` |
| `kill_agent` | `{ agent }` |
| `clear_tool_history` | -- |
| `approve_recommendation` | `{ id }` |
| `reject_recommendation` | `{ id }` |
| `get_orch_dashboard` | `{}` (callback) |

**DOM Elements Managed:** `#orch-pipeline-status`, `#orch-cycle-gauge`, `#orch-context-gauge`, `#orch-strategy-selector`, `#orch-overlay-controls`, `#orch-agent-list`, `#orch-parallel-slider`, `#orch-tool-timeline`, `#orch-config-controls`, `#orch-rec-list`, `#rec-badge`, `#orch-status-dot`, `#orch-perception-readout`

---

### team.js

**Path:** `public/ui/panels/team.js`

**Purpose:** Agent roster with real-time status, sparklines, chat/room controls.

**Class:** `TeamPanel extends PanelComponent`

**Features:**
- Agent cards with status dots (working/on_deck/paused/idle), scope badges (P/G), task count badges, inbox badges, sparkline SVGs, message stats.
- Filter tabs: All / Active / On Deck / Idle (via Tabs component).
- Sort order: Orchestrator first, then Active, On Deck, Idle.
- Chat rooms section: active room cards with participant list, message count, Open Room / End buttons, meeting notes access.
- Sparkline refresh interval (1s).
- Processing heartbeat tickers (600ms) for active agents.

**Store Keys Subscribed:** `team.agents`, `agents.sessions`

**Engine Events Subscribed:** `agent_activity`, `agent_message`, `agent_session_state`, `agent_room_opened`, `agent_room_message`, `agent_room_closed`, `room_participant_joined`, `room_participant_left`, `room_user_joined`, `meeting_notes_generated`

**Engine Events Dispatched:** `open_agent_chat`, `open_room_view`

**Socket Emits:** `pause_agent`, `resume_agent`, `create_chat_room`, `list_chat_rooms`, `get_chat_room`, `end_chat_room`, `pull_agent_into_room`, `user_join_room`, `user_leave_room`, `end_meeting`

**DOM Elements Managed:** `#team` or `.panel-content`, `.team-filter-bar`

**Data-Action Attributes:** `agent-chat`, `agent-pause`, `start-room`

---

### tasks.js

**Path:** `public/ui/panels/tasks.js`

**Purpose:** Task management panel with list, tree, and kanban views.

**Class:** `TasksPanel extends PanelComponent`

**Features:**
- Three views: List (flat), Tree (parent-child hierarchy), Kanban (delegates to full-screen overlay).
- View switching via Tabs component. Kanban view is never auto-restored on startup.
- Drag-to-reorder within list view (emits `tasks_reorder` via socket).
- Task items: checkbox, priority dot, title, assignee badges, skip/delete buttons, description, dependency info, metadata.
- Tree view: collapsible branches, persisted collapse state.
- Click title to drill into task detail.

**Store Keys Subscribed:** `tasks.list`

**Store Keys Read:** `tasks.view`, `tasks.treeCollapsed`

**Store Keys Written:** `tasks.view`, `tasks.treeCollapsed`

**Engine Events Dispatched:** `open_add_task_modal`, `open_task_detail`, `task_action`, `open_kanban`

**Socket Emits:** `tasks_reorder` (via socket passed in opts)

**DOM Elements Managed:** `#tasks` or `.panel-content`, `.task-view-tabs`

---

### activity.js

**Path:** `public/ui/panels/activity.js`

**Purpose:** Rich execution feed showing all agent activity with drill-down detail.

**Class:** `ActivityPanel extends PanelComponent`

**Features:**
- DrillItem-based entries with type-specific icons and color-coded borders.
- Filter chips: All / Tools / Thinking / Errors.
- Max 100 items (FIFO, newest first).
- Rich detail: agent, tool, input summary, output preview (500 chars), duration, tier, file, task, tool ID.
- Tier badges with color coding (T1=green, T2=cyan, T3=orange, T4=red).

**Store Keys Subscribed:** `activity.items`

**DOM Elements Managed:** `.activity-feed` or `.panel-content`, `.activity-filter-bar`

**Type Icons:**

| Type | Icon |
|------|------|
| `tool_start` | gear |
| `tool_complete` | checkmark |
| `tool_error` | x mark |
| `agent_thinking_start` | brain |
| `agent_thinking` | thought bubble |
| `qa_suggested` | clipboard |
| `context_recovery` | warning |
| `issue_created` | link |
| `milestone_launched` | rocket |

---

### project.js

**Path:** `public/ui/panels/project.js`

**Purpose:** Project dashboard with KPIs, milestone progress, burndown chart, and roadmap items.

**Class:** `ProjectPanel extends PanelComponent`

**Features:**
- Drillable KPI cards: Done/Active/Agents/Blocked/Milestones. Click to see filtered task list in modal.
- Active milestone progress bar.
- SVG ring burndown chart per milestone (circumference-based progress ring).
- Roadmap DrillItems with status badges and progress percentages.

**Store Keys Subscribed:** `roadmap.items`, `tasks.list`

**Store Keys Read:** `tasks.list`, `team.agents`

**DOM Elements Managed:** `.panel-content` or `#roadmap`

---

### tools.js

**Path:** `public/ui/panels/tools.js`

**Purpose:** Tool execution log showing individual tool calls with status and output.

**Class:** `ToolsPanel extends PanelComponent`

**Features:**
- Tool entries with name, timing, and success/error status.
- Output preview (truncated to 200 chars).
- Click entry to open tool inspector.
- Max 100 entries (FIFO).

**Engine Events Subscribed:** `tool_result`

**Engine Events Dispatched:** `open_tool_inspector`

**DOM Elements Managed:** `#tools` or `.panel-content`

---

## Views

### chat.js

**Path:** `public/ui/views/chat.js`

**Purpose:** Main chat interface for the primary conversation with the AI.

**Class:** `ChatView extends Component`

**Features:**
- Message rendering with "Overlord" label for AI messages.
- Real-time streaming with token-by-token updates.
- Plan approval UI (approve/reject/cancel with variant switching).
- Thought bubbles (neural thoughts with timing indicators).
- Tool chips showing tool execution status inline.
- Image and audio rendering in messages.
- Input area with mode selector (auto/plan/pm/ask), attach button for images, hot inject indicator.
- Scroll lock with threshold detection (150px).
- Delegation request handling.

**Engine Events Subscribed:** `message_add`, `stream_start`, `stream_update`, `neural_thought`, `thinking_done`, `plan_ready`, `plan_variant_switched`, `plan_cancelled_ack`, `plan_approved_ack`, `plan_timeout`, `plan_bypass_approved`, `tool_result`, `images_generated`, `audio_ready`, `file_diff`, `show_chart`, `approval_request`, `approval_timeout`, `approval_resolved`, `messages_cleared`, `conversation_loaded`, `conversation_new`, `request_start`, `request_end`, `status_update`, `hot_inject_pending`, `hot_inject_applied`, `delegation_request`, `context_warning`, `summarization_start`, `summarization_complete`, `file_write_start`, `file_write_chunk`, `file_write_end`, `screenshot_taken`, `approval_request_notice`, `role_block`

**DOM Elements Managed:** `.chat-messages` or `#messages`, `#chat-input` or `textarea`

---

### settings.js

**Path:** `public/ui/views/settings.js`

**Purpose:** Modal-based settings manager with six tabs.

**Class:** `SettingsView extends Component`

**Tabs:**
1. **General** -- Model selection, working directory, custom instructions, project memory.
2. **AI** -- Max AI cycles, thinking level, long-running mode.
3. **Tools** -- MCP server management (list, enable/disable, add, presets, reconnect).
4. **Display** -- Theme (dark/light), notification preferences.
5. **GitOps** -- Git/GitHub integration settings.
6. **Prompt** -- System prompt inspector (read-only), context viewer (auto-updates on API calls).

**Store Keys Read:** `settings.config`, `settings.aiSetKeys`, `settings.longRunning`, `settings.notifications`, `ui.theme`

**Engine Events Subscribed:** `config_data`, `config_updated`, `config_updated_by_ai`, `mcp_servers_updated`, `context_info`

**Modal ID:** `settings-modal`

---

### agent-manager.js

**Path:** `public/ui/views/agent-manager.js`

**Purpose:** Modal for managing agents and agent groups.

**Class:** `AgentManagerView extends Component`

**Two Tabs:**

1. **Agents** -- Sidebar list + editor panel. Fields: name, role, description, instructions, security role, group, tool permissions. AI Fill feature for auto-populating fields.
2. **Groups** -- List with members, collaboration mode, color. Inline create/edit/delete form.

**Security Roles:** `full-access`, `implementer`, `contributor`, `reviewer`, `coordinator`, `observer` (server-provided at runtime via `get_security_roles`).

**Socket Emits:** `add_agent`, `update_agent`, `delete_agent`, `get_agents`, `get_security_roles`, `get_tool_categories`, `ai_fill_agent_field`, `create_agent_group`, `update_agent_group`, `delete_agent_group`, `get_agent_groups`

**Modal ID:** `agent-manager`

---

### agent-chat.js

**Path:** `public/ui/views/agent-chat.js`

**Purpose:** Overlay for direct 1:1 messaging with individual sub-agents.

**Class:** `AgentChatView extends Component`

**Features:**
- Agent header with name, role, status dot (idle/working/paused).
- Per-agent message history with timestamps.
- Text input with send button.
- Pause/resume agent controls.
- Open/close overlay lifecycle (slide-in animation).

**Engine Events Subscribed:** `agent_message`, `agent_session_state`, `agent_paused`, `agent_resumed`, `open_agent_chat`

**Internal State:** `_messages` (Map: agentName -> message array), `_currentAgent`, `_visible`

**DOM Elements Managed:** `.agent-chat-overlay` (root element)

---

### kanban.js

**Path:** `public/ui/views/kanban.js`

**Purpose:** Full-screen kanban board overlay.

**Class:** `KanbanView extends Component`

**Columns:**

| Status | Label | Icon |
|--------|-------|------|
| `pending` | To Do | clipboard |
| `in_progress` | In Progress | lightning |
| `plan_pending` | Plan Pending | magnifier |
| `blocked` | Blocked | no-entry |
| `completed` | Done | checkmark |
| `skipped` | Skipped | skip |

**Status Aliases:** `running` -> `in_progress`, `done` -> `completed`

**Features:**
- Horizontal scrolling column layout.
- Task cards with priority dots, assignee badges, dependency tags (uses Card component, kanban variant).
- Drag-and-drop between columns (emits `update_task` via socket).
- Live re-render on `tasks_update` engine event.
- Task click dispatches `open_task_detail`.
- Escape key / close button to dismiss.

**Engine Events Subscribed:** `tasks_update`, `open_kanban`

**Engine Events Dispatched:** `open_task_detail`

**DOM Elements Managed:** Full-screen overlay element (`.kanban-overlay`)

---

### room-view.js

**Path:** `public/ui/views/room-view.js`

**Purpose:** Full-screen overlay for multi-agent meeting rooms.

**Class:** `RoomView extends Component`

**Features:**
- Full transcript with per-agent color-coded messages.
- Pull-in controls: Orchestrator, Project Manager, any custom agent from the team roster.
- User message input (broadcast to all room agents via socket).
- User join/leave room capability.
- Leave / End / End Meeting buttons.
- Live meeting badge when orchestrator/PM is present.
- Meeting notes panel when available (generated by server).
- Thinking indicator for agents currently processing.

**Store Keys Read:** `team.agents`

**Engine Events Subscribed:** `open_room_view`, `agent_room_message`, `room_participant_joined`, `room_participant_left`, `room_user_joined`, `meeting_notes_generated`, `agent_room_closed`

**Socket Emits:** `get_chat_room`, `send_room_message`, `pull_agent_into_room`, `user_join_room`, `user_leave_room`, `end_chat_room`, `end_meeting`

**DOM Elements Managed:** `.room-view-overlay` (root element)

**Meeting Agents (special handling):** `orchestrator`, `project-manager`
