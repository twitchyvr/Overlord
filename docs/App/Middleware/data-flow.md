# Data Flow

How data flows through the Overlord middleware layer, from user input to UI
update, through agent delegation, state synchronization, and supporting
subsystems.

---

## 1. User Input Path

The primary request/response cycle from user keystroke to rendered AI response.

```
Browser (chat input)
  |
  | socket.emit('user_input', text)
  v
hub.js :: socket.on('user_input')
  |
  |-- Rate limit check (token bucket: 20 tokens, refills 4/sec)
  |     |-- THROTTLED: socket.emit('log', { type: 'warning' })  --> stop
  |     |-- ALLOWED: continue
  |
  |-- hub.emit('user_message', text, socket)    [internal EventEmitter]
  v
orchestration-module.js :: hub.on('user_message')
  |
  |-- Is AI busy?
  |     |-- YES: hub.queueUserMessage(text) --> broadcast('queue_updated')
  |     |                                       --> message waits in queue
  |     |-- NO: continue
  |
  |-- hub.broadcast('status_update', { status: 'thinking' })
  |-- hub.broadcast('request_start')
  |-- hub.broadcast('stream_start')
  |
  |-- Conversation history append (user message)
  |-- Build system prompt (ai-module)
  |-- Inject hot-inject messages at cycle boundary
  |
  v
AI Loop (orchestration-module)
  |
  |-- ai-module.chatStream(messages, onEvent, onDone, onError, systemPrompt)
  |     |
  |     |-- onEvent('content_block_delta') --> hub.streamUpdate(text)
  |     |     --> broadcastVolatile('stream_update', text)
  |     |         --> socket-bridge: engine.dispatch('stream_update')
  |     |
  |     |-- onEvent('thinking') --> hub.neural(thought)
  |     |     --> broadcast('neural_thought')
  |     |
  |     |-- onDone --> parse response for tool calls
  |
  |-- Tool calls detected?
  |     |-- YES: for each tool call:
  |     |     |-- Approval required? (based on chat mode)
  |     |     |     |-- YES: broadcast('approval_request', { toolId, toolName, args })
  |     |     |     |        --> wait for 'approval_response' or timeout
  |     |     |     |-- NO: execute immediately
  |     |     |
  |     |     |-- Execute tool (tools-v5.js dispatcher)
  |     |     |-- hub.broadcast('tool_result', { tool, result, duration })
  |     |     |-- Append tool result to conversation history
  |     |     |
  |     |     |-- Check for hot-inject messages (hub.consumeHotInject())
  |     |     |     |-- If found: inject into conversation, broadcast('hot_inject_applied')
  |     |     |
  |     |     |-- Loop back to AI with tool results
  |     |
  |     |-- NO: response is final text
  |           |-- hub.broadcast('message_add', { role: 'assistant', content })
  |           |-- hub.broadcast('status_update', { status: 'idle' })
  |           |-- hub.broadcast('request_end')
  |           |-- hub.broadcastContextInfo()  (token usage update)
  |           |
  |           |-- Drain message queue: hub.drainMessageQueue()
  |                 |-- 'consolidated': join all queued messages, emit 'user_message'
  |                 |-- 'sequential': dequeue one, emit 'user_message'
  |
  v
socket-bridge.js (browser)
  |
  |-- 'stream_update' --> engine.dispatch('stream_update')
  |     --> chat.js renders streaming text in real time
  |
  |-- 'message_add' --> engine.dispatch('message_add')
  |     --> chat.js renders final message with markdown
  |
  |-- 'status_update' --> store.set('ui.processing', ...)
  |     --> send button enables/disables, aurora effect
  |
  |-- 'request_end' --> store.set('ui.processing', false)
  |     --> stop button hides, send button re-enables
  |
  |-- 'tool_result' --> engine.dispatch('tool_result')
  |     --> tools panel renders result card
  |
  |-- 'context_info' --> store.set('context.info', ...)
  |     --> context usage meter updates
```

---

## 2. Agent Delegation Path

How the orchestrator delegates work to specialized agents.

```
orchestration-module :: AI response contains delegate_to_agent tool call
  |
  |-- Parse delegation: { agentName, task, context }
  |-- hub.broadcast('delegation_request', { from, to, task, reason })
  |-- hub.broadcast('agent_activity', { type: 'delegation', ... })
  |
  v
orchestration-module :: runAgentSession(agentName, task)
  |
  |-- Look up agent definition (agentManager service)
  |-- Apply security role constraints (tool filtering)
  |-- hub.broadcast('agent_session_state', { agentName, status: 'active' })
  |
  |-- Build agent-specific system prompt
  |     (agent instructions + tool definitions + conversation context)
  |
  v
Agent AI Loop (similar to main loop but agent-scoped)
  |
  |-- ai-module.chatStream(agentMessages, ...)
  |     |-- Stream deltas --> hub.broadcast('agent_message', { agentName, content })
  |     |-- Tool calls --> execute with agent's allowed tools only
  |     |     |-- Security role blocks disallowed tool?
  |     |           --> hub.broadcast('role_block', { agentName, tool, role })
  |     |           --> agent can use request_tool_exception tool
  |     |
  |     |-- Tool results appended to agent's conversation
  |     |-- Loop continues until agent signals completion
  |
  |-- Agent completes:
  |     |-- hub.broadcast('agent_session_state', { agentName, status: 'idle' })
  |     |-- Result returned to orchestrator's conversation
  |     |-- Orchestrator AI loop continues with agent's output
  |
  v
Backchannel (parallel to agent execution):
  |
  |-- Agent calls message_agent tool --> hub.emit('backchannel_push', msg)
  |     --> hub broadcasts 'backchannel_msg' to room
  |     --> socket-bridge appends to store 'backchannel.messages'
  |
  |-- User sends via orchestrator_send socket event
  |     --> hub stores in _backchannelHistory (cap 500)
  |     --> routes to agent session as [Orchestrator]: message
```

---

## 3. State Sync Path

How backend state changes propagate to all connected UI clients.

```
Backend Module (e.g., tasks-engine, conversation, orchestration)
  |
  |-- Module calls hub.broadcast('event_name', data)
  |     |-- hub determines scope:
  |     |     broadcast()        --> conv:{id} room only
  |     |     broadcastAll()     --> all sockets
  |     |     broadcastVolatile() --> conv:{id} room, volatile flag
  |
  v
Socket.IO transport
  |
  v
socket-bridge.js (each connected client)
  |
  |-- store.set('key', data)          [persistent reactive state]
  |     |-- Store notifies all subscribers of 'key'
  |     |     |-- Component A: store.subscribe('key', this.render.bind(this))
  |     |     |-- Component B: store.subscribe('key', this.update.bind(this))
  |     |
  |     |-- localStorage persistence (selected keys survive page refresh)
  |
  |-- engine.dispatch('event_name', data)   [transient event bus]
  |     |-- OverlordUI.subscribe('event_name', handler)
  |     |     |-- Toast notification
  |     |     |-- Modal open/close
  |     |     |-- One-time DOM update
```

### Key Store Keys and Their Subscribers

| Store Key | Updated By | Consumed By |
|-----------|-----------|-------------|
| `ui.connected` | connect/disconnect | Connection indicator |
| `ui.processing` | status_update, request_start/end | Stop button, send button, aurora effect |
| `ui.streaming` | stream_start, request_end | Stream renderer |
| `ui.status` | status_update | Status bar |
| `ui.workingDir` | working_dir_update | Folder display |
| `ui.presenceCount` | presence_update | Presence badge |
| `chat.mode` | mode_changed, init, process_state | Mode selector, plan bar |
| `team.agents` | team_update | Team panel |
| `agents.sessions` | agent_session_state, agent_paused/resumed, all_agent_states | Team panel, orchestration panel |
| `tasks.list` | tasks_update | Tasks panel, kanban |
| `tasks.tree` | task_tree_update | Kanban hierarchy |
| `roadmap.items` | roadmap_update | Roadmap display |
| `activity.items` | agent_activity (cap 50) | Activity panel |
| `queue.messages` | queue_updated | Message queue UI |
| `backchannel.messages` | backchannel_msg (cap 500) | Backchannel panel |
| `mcp.servers` | mcp_servers_updated | MCP settings section |
| `context.info` | context_info | Context usage meter |
| `settings.config` | config_data, config_updated | Settings modal |
| `conversations.list` | conversations_list | Conversation list |
| `conversations.current` | conversation_loaded, init | Active conversation tracker |
| `orchestration.state` | orchestration_state | Orchestration panel |
| `orchestration.dashboard` | orchestrator_dashboard | Orchestration panel |
| `orchestration.recommendations` | task_recommendations_update | Task recommendation UI |
| `projects.list` | projects_updated | Project panel |
| `obsidian.vaults` | vaults_discovered | Obsidian settings section |

---

## 4. Reconnection and State Hydration

When a client connects or reconnects, socket-bridge.js initiates a full state
sync by emitting several request events:

```
socket.on('connect')
  |
  |-- socket.emit('get_process_state')      --> process_state
  |-- socket.emit('get_config')             --> config_data
  |-- socket.emit('get_team')               --> team_update
  |-- socket.emit('list_conversations')     --> conversations_list
  |-- socket.emit('get_context_info')       --> context_info
  |-- socket.emit('get_orch_dashboard')     --> callback sets orchestration.dashboard
  |-- socket.emit('get_all_agent_states')   --> all_agent_states
  |
  |-- If conversations.current exists:
  |     socket.emit('join_conversation', id)
  |       --> conversation_loaded (full history replay)
  |       --> context_warning
  |       --> orchestration_state (from joinConversationRoom)
  |       --> all_agent_states (from joinConversationRoom)
  |
  |-- If not socket.recovered (not a transparent reconnect):
  |     socket.emit('get_message_queue')    --> callback sets queue.messages
  |     socket.emit('get_backchannel')      --> callback sets backchannel.messages
```

This ensures the UI is fully populated even after a hard refresh while agents
are actively working in the background.

---

## 5. Rate Limiting

### Token Bucket Algorithm

Each socket maintains a rate bucket initialized in Socket.IO middleware:

```
bucket = { tokens: 20, lastRefill: Date.now() }
```

On each `user_input` event:

1. Calculate elapsed time since last refill
2. Add `elapsed * refillRate` tokens (default 4/sec), capped at `maxTokens`
3. If tokens >= 1: consume one token, allow the event
4. If tokens < 1: reject with a warning log to the client

Configuration via `update_config`:

- `rateLimitTokens` -- bucket size (1-100, default 40)
- `rateLimitRefillRate` -- tokens per second (0.5-20, default 8)

Rate limiting only applies to `user_input`. Other socket events (config,
agents, tasks, etc.) are not rate-limited.

---

## 6. Message Queuing

### Regular Queue

When AI is processing and a `user_input` arrives:

```
user_input --> rate limit OK --> orchestration.isProcessing? --> YES
  |
  v
hub.queueUserMessage(text)
  |-- Creates item: { id: 'mq_<timestamp>_<rand>', text, queuedAt }
  |-- Appends to _msgQueue (cap: config.messageQueueSize, default 10)
  |-- If full: drops oldest message
  |
  v
broadcast('queue_updated', _msgQueue)
  --> socket-bridge sets store 'queue.messages'
  --> Queue UI component renders
```

When AI finishes processing:

```
orchestration-module :: request complete
  |
  v
hub.drainMessageQueue()
  |
  |-- mode === 'consolidated' && queue.length > 1:
  |     Join all messages with '\n\n---\n\n'
  |     Clear queue
  |     hub.emit('user_message', combined)
  |
  |-- mode === 'sequential' || queue.length === 1:
  |     Shift first item
  |     hub.emit('user_message', item.text)
  |     (remaining items stay queued for next drain)
```

### Hot Chat Injection

Hot injections are consumed during the AI loop, not after it:

```
hot_inject --> AI busy? --> YES
  |
  v
hub.hotInject(text)
  |-- Creates item: { id: 'hi_<timestamp>_<rand>', text, injectedAt }
  |-- Appends to _hotInjectBuffer
  |-- broadcast('hot_inject_pending', { count, preview })
```

```
orchestration-module :: between tool result and next AI call
  |
  v
hub.consumeHotInject()
  |-- Returns first buffered item (FIFO)
  |-- Injects into conversation as a user message
  |-- broadcast('hot_inject_pending', { count: remaining })
  |-- hub.broadcastHotInjectApplied(item)
  |     --> broadcast('hot_inject_applied', { id, text })
```

If AI is idle when `hot_inject` arrives, it is treated as a regular
`user_message` and processed immediately.

---

## 7. Room Scoping

### Conversation Rooms

```
Room name format: conv:{conversationId}
```

- Clients auto-join on connection (server pushes active conv)
- Clients explicitly join via `join_conversation` event
- `joinConversationRoom()` handles room switching:
  - Leaves previous conv room if different
  - Joins new room
  - Sends orchestration state + agent states to the joining socket
  - Broadcasts `presence_update` to the room with updated count

### Broadcast Routing Decision

```
hub.broadcast(event, data)
  |
  |-- conv = hub.getService('conversation')
  |-- convId = conv.getId()
  |
  |-- convId exists?
  |     |-- YES: io.to('conv:' + convId).emit(event, data)
  |     |-- NO:  io.emit(event, data)   [fallback: all sockets]
```

### Event Scope by Type

| Scope | Method | Examples |
|-------|--------|---------|
| Conversation room | `broadcast()` | message_add, stream_update, tool_result, status_update, agent_message |
| Conversation room (volatile) | `broadcastVolatile()` | stream_update (delta text), agent_activity |
| Server-wide | `broadcastAll()` | team_update, projects_updated, mode_changed, log, config events |
| Specific socket | `socket.emit()` | config_data, process_state, conversations_list, conversation_loaded |
| Named room | `broadcastToRoom()` | Agent chat room events |

---

## 8. Service Registry Pattern

Backend modules register themselves with the hub during server initialization:

```
server.js
  |
  |-- hub.registerService('config', configModule)
  |-- hub.registerService('conversation', conversationModule)
  |-- hub.registerService('orchestration', orchestrationModule)
  |-- hub.registerService('ai', aiModule)
  |-- hub.registerService('tools', toolsModule)
  |-- hub.registerService('agentManager', agentSystemModule)
  |-- hub.registerService('projects', projectModule)
  |-- hub.registerService('git', gitModule)
  |-- hub.registerService('contextTracker', contextTrackerModule)
  |-- hub.registerService('summarizer', summarizationModule)
  |-- hub.registerService('orchestrator', orchestrationModule)  [alias]
  |-- ...
```

Any module can access any other through the hub:

```javascript
const config = hub.getService('config');
const orch   = hub.getService('orchestration');
const ai     = hub.getService('ai');
```

This provides loose coupling: modules never import each other directly. The hub
acts as a dependency injection container.

### Service Access in Socket Handlers

Socket handlers in `hub.js` use `this.getService()` extensively. For example,
the `update_config` handler accesses both the config service and the
orchestration service to propagate limits:

```javascript
const config = this.getService('config');
config.model = data.model;
// ...
const orch = this.getService('orchestration');
if (orch && orch._updateLimits) orch._updateLimits(config);
config.save();
```

---

## 9. Agent Chat Room Discussion Rounds

When a user sends a message to a chat room, a multi-round agent discussion
is triggered:

```
send_room_message({ roomId, message })
  |
  |-- Stop any existing discussion for this room
  |     (clear timer + agent callbacks)
  |
  |-- Add user message to room transcript
  |
  |-- Start triggerRound(0)
  |     |
  |     |-- For each agent in room (sequential):
  |     |     |-- Build prompt from last 40 messages in transcript
  |     |     |-- broadcast('room_agent_thinking', { roomId, agentName })
  |     |     |-- orch.runAgentSessionInRoom(agentName, prompt, roomId, onComplete)
  |     |     |-- Agent responds --> added to transcript
  |     |     |-- Next agent triggered via onComplete callback
  |     |
  |     |-- All agents done --> schedule next round (1.5s delay)
  |
  |-- triggerRound(1) ... triggerRound(MAX_ROUNDS-1)
  |     Same pattern, but prompts encourage autonomous discussion:
  |     "Continue the discussion", "Build on ideas", "Challenge assumptions"
  |
  |-- After MAX_ROUNDS (4 total): discussion stops naturally
```

The user can stop the discussion at any time via `stop_room_agents`.

---

## 10. Metrics Pipeline

A separate Socket.IO namespace streams server performance data:

```
hub.js :: setInterval(3000)
  |
  |-- Collect: CPU usage, heap memory, RSS, socket count, uptime
  |-- Measure: event loop lag via setImmediate timing
  |
  v
metricsNs.volatile.emit('tick', {
    cpu:      <percent>,
    heapMB:   <number>,
    rssMB:    <number>,
    sockets:  <number>,
    uptime:   <seconds>,
    loopLag:  <ms>,
    ts:       <timestamp>
})
```

New `/metrics` connections receive the last tick immediately for instant
dashboard rendering.
