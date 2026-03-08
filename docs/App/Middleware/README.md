# Middleware Layer

The middleware layer is the communication backbone of Overlord. It connects the
backend modules (orchestration, AI, tasks, agents, projects) to the frontend UI
through an event-driven architecture built on Socket.IO and a Node.js
EventEmitter hub.

---

## Core Components

### hub.js -- Central Event Bus

`hub.js` is a singleton `EventEmitter` subclass that serves three roles:

1. **Service Registry** -- Backend modules register themselves via
   `hub.registerService(name, service)`. Any module can retrieve another via
   `hub.getService(name)`. This removes hard coupling between modules.

2. **Socket.IO Bridge** -- Every client Socket.IO event is received inside
   `setupSocketBridge()` and either handled inline (config, conversations,
   agents, projects) or translated to a hub EventEmitter event
   (`hub.emit('user_message', ...)`) for consumption by backend modules.

3. **Broadcast Router** -- Four broadcast methods control how server events
   reach clients:

   | Method | Scope | Use Case |
   |--------|-------|----------|
   | `broadcast(event, data)` | Active conversation room (`conv:{id}`) | Most events: messages, tools, streaming, status |
   | `broadcastVolatile(event, data)` | Active conversation room (volatile) | High-frequency: `stream_update`, `agent_activity` |
   | `broadcastAll(event, data)` | Every connected socket | Server-wide: restarts, config changes, team updates |
   | `broadcastToRoom(room, event, data)` | Named room | Agent chat rooms, meeting rooms |

### socket-bridge.js -- Client-Side Normalizer

`public/ui/socket-bridge.js` is the frontend counterpart. It maps all ~83
incoming Socket.IO events to two targets:

- **Store updates** -- `store.set('key', data)` feeds the reactive state tree.
  Components that subscribe to a store key re-render automatically.
- **Engine dispatches** -- `engine.dispatch('event', data)` fires the UI event
  bus so components can react to transient events (toasts, streaming deltas,
  approval prompts) without polluting persistent state.

```
Server module
  --> hub.broadcast('event', data)
    --> Socket.IO emit to room
      --> socket-bridge.js
        --> store.set('key', data)       // persistent state
        --> engine.dispatch('event')     // transient event
          --> Component.onEvent(data)    // UI update
```

### Room Architecture

Socket.IO rooms scope events to specific conversations:

- **`conv:{conversationId}`** -- Each conversation gets a room. Clients
  auto-join on connect (server pushes the active conversation) and explicitly
  join via `join_conversation`.
- **`broadcast()`** falls back to global emit when no conversation is loaded.
- **Presence tracking** -- `presence_update` is emitted to the room whenever a
  socket joins or disconnects.
- **State replay on join** -- When a socket joins a room, the hub sends
  `orchestration_state` and `all_agent_states` for immediate UI hydration.

### Rate Limiting

A per-socket token bucket rate limiter protects the `user_input` handler:

- **Bucket size**: 20 tokens (configurable via `config.rateLimitTokens`)
- **Refill rate**: 4 tokens/sec (configurable via `config.rateLimitRefillRate`)
- Throttled messages receive a `log` warning; they are not queued.

### Message Queue

When the AI is busy processing, incoming `user_input` messages are queued
(up to `config.messageQueueSize`, default 10). On completion the queue drains
automatically in one of two modes:

- **consolidated** (default) -- All queued messages are joined with `---`
  separators and sent as a single prompt.
- **sequential** -- Messages are sent one at a time.

Users can manage the queue in real time: reorder, edit, remove, clear, or
force-dequeue individual items.

### Hot Chat Injection

Hot injections bypass the regular queue. They are inserted into the
orchestrator's context at the next safe cycle boundary (after tool results,
before the next AI call). If the AI is idle, a hot injection is routed as a
regular `user_message` immediately.

### Metrics Namespace

A separate Socket.IO namespace (`/metrics`) streams server performance data
every 3 seconds (volatile):

- CPU usage percentage
- Heap and RSS memory
- Connected socket count
- Event loop lag
- Uptime

---

## Section Documents

| Document | Contents |
|----------|----------|
| [event-catalog.md](event-catalog.md) | Complete catalog of all events organized by category |
| [socket-handlers.md](socket-handlers.md) | Reference of all 149 socket.on() handlers in hub.js |
| [data-flow.md](data-flow.md) | End-to-end data flow diagrams and patterns |
