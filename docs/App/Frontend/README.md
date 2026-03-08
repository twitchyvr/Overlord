# Overlord Frontend Architecture

This document provides an overview of the Overlord frontend: a modular, vanilla-ES-module UI with no framework dependency. It runs entirely in the browser and communicates with the backend via Socket.IO.

---

## Entry Points

| File | Purpose |
|------|---------|
| `public/index.html` | Active entry point -- modular ES-module build |
| `public/index-ori.html` | Legacy monolith -- read-only reference, never modify |

---

## Directory Layout

```
public/
  index.html                 <- active entry point
  ui/
    engine.js                <- OverlordUI singleton, Component base, h(), DOM helpers
    state.js                 <- Reactive Store with dot-notation keys
    socket-bridge.js         <- Maps 83 Socket.IO events to store + engine
    router.js                <- Layout router (mobile/tablet/desktop)
    components/
      modal.js               <- Unified overlay manager
      panel.js               <- Collapsible/resizable/popout panels
      toast.js               <- Notification toasts
      tabs.js                <- Segmented tabs
      button.js              <- Button factory
      dropdown.js            <- Self-positioning dropdown
      card.js                <- Card factory (agent, task, kanban, etc.)
      table.js               <- Table renderer + marked.js integration
      drill-item.js          <- Drillable list item with accordion + sheet
    panels/
      log.js                 <- System log panel
      orchestration.js       <- Orchestration manager
      team.js                <- Agent fleet panel
      tasks.js               <- Tasks panel (list/tree/kanban)
      activity.js            <- Execution timeline
      project.js             <- Project dashboard + burndown
      tools.js               <- Tool execution entries
    views/
      chat.js                <- Main chat interface
      settings.js            <- Settings modal (6 tabs)
      agent-manager.js       <- Agent CRUD modal
      agent-chat.js          <- 1:1 agent messaging overlay
      kanban.js              <- Full-screen kanban board
      room-view.js           <- Multi-agent meeting room overlay
    css/
      tokens.css             <- Design tokens (colors, spacing, radii, glass)
      base.css               <- Reset, typography, layout grid, focus ring
      components.css         <- All component-level CSS
      chat.css               <- Chat-specific styles
      effects.css            <- Aurora, plasma, animations, keyframes
      responsive.css         <- Breakpoints (mobile/tablet/desktop/landscape)
```

---

## Component Hierarchy

```
OverlordUI (engine singleton)
  |
  |-- Store (reactive state)
  |     |-- 28 initial keys (see store-keys.md)
  |     |-- 11 persisted keys (localStorage)
  |     |-- Subscriptions: key -> Set<fn>
  |     |-- Batch updates, snapshot/restore
  |
  |-- SocketBridge
  |     |-- 83 Socket.IO events -> store.set() + engine.dispatch()
  |
  |-- Router
  |     |-- mobile (<= 768px), tablet (769-1100px), desktop (> 1100px)
  |     |-- Mobile: full-screen view switching via bottom nav
  |
  |-- Component (base class)
        |
        |-- PanelComponent (extends Component)
        |     |-- LogPanel
        |     |-- OrchestrationPanel
        |     |-- TeamPanel
        |     |-- TasksPanel
        |     |-- ActivityPanel
        |     |-- ProjectPanel
        |     |-- ToolsPanel
        |
        |-- ChatView
        |-- SettingsView
        |-- AgentManagerView
        |-- AgentChatView
        |-- KanbanView
        |-- RoomView
```

---

## Data Flow

The frontend follows a unidirectional data flow pattern:

```
                          Socket.IO
Backend  --------->  socket-bridge.js
                          |
                    +-----+-----+
                    |           |
               store.set()  engine.dispatch()
                    |           |
                    v           v
              Store keys    Event Bus
                    |           |
          subscribe()     subscribe()
                    |           |
                    v           v
              Components re-render
                    |
                    v
            DOM updates (h(), setContent(), setTrustedContent())
```

### Detailed flow

1. **Server emits** a Socket.IO event (e.g., `team_update`).
2. **socket-bridge.js** receives it and performs two actions:
   - Calls `store.set('team.agents', data)` to update reactive state.
   - Calls `engine.dispatch('team_update', data)` to notify event-bus listeners.
3. **Components** that subscribed to the `team.agents` store key re-render automatically.
4. **Components** that subscribed to the `team_update` engine event also fire.
5. **User actions** (clicks, input) emit Socket.IO events back to the server, or update the store directly (for local state like panel visibility).

### Store-driven rendering

- Each component subscribes to specific store keys during `mount()`.
- When a key changes, the subscription callback fires with the new value.
- The component calls its `render()` method with the new data.
- DOM is rebuilt using `h()` (hyperscript) or `setContent()`/`setTrustedContent()`.
- Deep cloning on `store.get()` prevents mutation bugs; use `store.peek()` for performance-critical reads.

### Persistence

Eleven store keys are persisted to `localStorage` and hydrated on page load. See `store-keys.md` for the full list.

### Pop-out sync

The `BroadcastChannel('overlord-sync')` protocol synchronizes state between the main window and any popped-out panel windows. Messages include `state_sync`, `theme_changed`, `panel_popped_out`, `panel_pulled_back`, and `popout_closing`.

---

## External Dependencies

| Library | Load method | Purpose |
|---------|-------------|---------|
| Socket.IO | Script tag | Real-time server communication |
| marked.js | Script tag (global) | Markdown rendering in chat |
| vis-network | Script tag (global) | Network graph visualization |

---

## Section Documentation

| Document | Contents |
|----------|----------|
| [components.md](./components.md) | Complete reference for all UI modules |
| [store-keys.md](./store-keys.md) | Every store key, its default, persistence, readers, and writers |
| [css-architecture.md](./css-architecture.md) | Design tokens, theming, responsive breakpoints, visual effects |
