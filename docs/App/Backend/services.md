# Overlord Service Registry Reference

All services are registered via `hub.registerService(name, api)` and consumed via
`hub.getService(name)`. This document lists every registered service, the module that
owns it, the key methods exposed, and which modules consume it.

---

## Service Index

| # | Service Name | Registered By | Consumed By |
|---|-------------|---------------|-------------|
| 1 | `config` | config-module | Nearly all modules |
| 2 | `markdown` | markdown-module | ai-module, conversation-module |
| 3 | `guardrail` | guardrail-module | ai-module, tools-v5, file-tools-module |
| 4 | `tokenManager` | token-manager-module | orchestration-module, ai-module, conversation-module, hub.js |
| 5 | `contextTracker` | context-tracker-module | orchestration-module, hub.js, conversation-module |
| 6 | `mcp` | mcp-module | tools-v5 |
| 7 | `mcpManager` | mcp-manager-module | tools-v5, orchestration-module |
| 8 | `database` | database-module | conversation-module, agent-manager-module |
| 9 | `notes` | notes-module | tools-v5 (record_note/recall_notes), ai-module (system prompt) |
| 10 | `skills` | skills-module | ai-module (system prompt injection) |
| 11 | `tools` | tools-v5 | orchestration-module, agent-system-module, file-tools-module, obsidian-vault-module, screenshot-module, minimax-*-modules |
| 12 | `agentSystem` | agent-system-module | orchestration-module |
| 13 | `agents` | agent-system-module | orchestration-module (alias for agentSystem) |
| 14 | `agentManager` | agent-manager-module | orchestration-module, hub.js (socket handlers) |
| 15 | `ai` | ai-module | orchestration-module, summarization-module |
| 16 | `summarizer` | summarization-module | conversation-module, orchestration-module |
| 17 | `testServer` | test-server-module | hub.js (socket handlers) |
| 18 | `fileTools` | file-tools-module | tools-v5 (dynamic tools) |
| 19 | `imageGen` | minimax-image-module | tools-v5 (dynamic tool) |
| 20 | `tts` | minimax-tts-module | tools-v5 (dynamic tool), orchestration-module |
| 21 | `minimaxFiles` | minimax-files-module | tools-v5 (dynamic tools) |
| 22 | `projects` | project-module | hub.js (socket handlers), conversation-module |
| 23 | `obsidian` | obsidian-vault-module | tools-v5 (dynamic tools) |
| 24 | `conversation` | conversation-module | orchestration-module, hub.js, tasks-engine, project-module, token-manager-module |
| 25 | `tasks` | tasks-engine | orchestration-module, hub.js (socket handlers) |
| 26 | `git` | git-module | orchestration-module, hub.js (socket handlers) |
| 27 | `orchestration` | orchestration-module | hub.js (socket handlers) |

---

## Detailed Service APIs

### 1. `config`

**Module:** config-module.js

**Purpose:** Runtime configuration with environment variable loading and settings persistence.

```
config.baseUrl          : string    -- API base URL
config.apiKey           : string    -- MiniMax/Anthropic API key
config.model            : string    -- Model name
config.modelSpec        : object    -- { contextWindow, maxOutput }
config.maxTokens        : number    -- Max output tokens
config.temperature      : number    -- Sampling temperature
config.thinkingLevel    : number    -- Thinking level (1-5)
config.thinkingBudget   : number    -- Thinking token budget
config.baseDir          : string    -- Project root directory
config.chatMode         : string    -- 'auto' | 'plan' | 'ask' | 'pm'
config.maxAICycles      : number    -- Max AI-tool cycles per message
config.platform         : string    -- OS platform
config.isWindows        : boolean   -- Windows detection
config.isMac            : boolean   -- macOS detection
config.isLinux          : boolean   -- Linux detection
config.shell            : string    -- System shell path
config.shellArgs        : string[]  -- Shell invocation args
config.save()           : function  -- Persist settings to disk
config.setThinkingLevel(n) : function -- Set thinking budget
```

**Consumed by:** Every module that reads configuration (essentially all of them).

---

### 2. `markdown`

**Module:** markdown-module.js

```
markdown.parse(text)       : string  -- Markdown to HTML
markdown.toPlainText(text) : string  -- Strip markdown formatting
markdown.escape(text)      : string  -- HTML entity escaping
```

---

### 3. `guardrail`

**Module:** guardrail-module.js

```
guardrail.sanitizeForOutput(str)        : string   -- Clean for safe output
guardrail.sanitizeForSearch(str)        : string   -- Normalize for search
guardrail.sanitizePath(path)            : string   -- Validate file path
guardrail.detectInjection(input)        : boolean  -- Check for injection
guardrail.detectDangerousCommand(cmd)   : boolean  -- Check dangerous shell cmd
guardrail.safeWriteFile(path, content)  : void     -- Write with validation
guardrail.safeReadFile(path)            : string   -- Read with validation
guardrail.validatePatch(orig, patch)    : boolean  -- Validate patch
guardrail.safePatch(path, search, repl) : void     -- Apply validated patch
guardrail.CHAR_MAP                      : object   -- Character sanitization map
guardrail.HTML_ENTITIES                 : object   -- HTML entity decode map
guardrail.INJECTION_PATTERNS            : array    -- Injection detection patterns
guardrail.DANGEROUS_PATTERNS            : array    -- Shell danger patterns
```

---

### 4. `tokenManager`

**Module:** token-manager-module.js

```
tokenManager.estimateTokens(text)                  : number   -- Char-based token estimate
tokenManager.estimateMessageTokens(msg)             : number   -- Message token estimate
tokenManager.calculateHistoryTokens(history)        : number   -- Total history tokens
tokenManager.truncateHistory(history, maxTokens?)   : array    -- Smart truncation (preserves tool pairs)
tokenManager.needsTruncation(history)               : boolean  -- Check if over budget
tokenManager.truncateFileContent(content, maxChars?) : string  -- Truncate file content
tokenManager.truncateToolResult(result, maxChars?)  : string   -- Truncate tool output
tokenManager.sanitizeHistory(history)               : array    -- Fix broken tool chains
tokenManager.stripScreenshots(history)              : array    -- Remove base64 images
tokenManager.hasStrippableScreenshots(history)      : boolean  -- Check for screenshots
tokenManager.getStats()                             : object   -- Token statistics
tokenManager.validateHistory(history)               : object   -- Validate structure
tokenManager.CONFIG                                 : object   -- Token limit constants
```

---

### 5. `contextTracker`

**Module:** context-tracker-module.js

```
contextTracker.recordRequestStart()    : number   -- Mark request start, return timestamp
contextTracker.recordRequestEnd()      : void     -- Calculate duration
contextTracker.getLastRequestDuration(): number   -- Last request ms
contextTracker.recordCompaction(data)  : void     -- Log compaction event
contextTracker.getCompactionStats()    : object   -- { totalCompactions, lastTime, lastSize }
contextTracker.getContextInfo()        : object   -- Full context state for clients
contextTracker.getFullStatus()         : object   -- Extended status with history
contextTracker.recordApiTokens(i, o)   : void     -- Record actual API token counts
contextTracker.getApiTokens()          : object   -- { lastInput, lastOutput, totalInput, totalOutput }
contextTracker.resetChat()             : void     -- Reset all state
contextTracker.getState()              : object   -- Raw state snapshot
```

---

### 6. `mcp`

**Module:** mcp-module.js

```
mcp.understandImage(imagePath, prompt, cfg) : object  -- Analyze image via MCP
mcp.webSearch(query)                        : object  -- Web search via MCP subprocess
mcp.chatWithTools(messages, tools)          : object  -- Chat completion with MCP tools
mcp.getToolDefinitions()                    : array   -- MCP tool schemas
mcp.getMcpClient()                          : object  -- Direct subprocess client access
```

---

### 7. `mcpManager`

**Module:** mcp-manager-module.js

```
mcpManager.listServers()                              : array   -- All server statuses
mcpManager.enableServer(name)                         : void    -- Enable and connect
mcpManager.disableServer(name)                        : void    -- Disable and disconnect
mcpManager.getServer(name)                            : object  -- McpServerConnection
mcpManager.callServerTool(serverName, toolName, args) : object  -- Call tool on server
```

---

### 8. `database`

**Module:** database-module.js

```
database.getConversation(id)       : object  -- Get conversation by ID
database.saveConversation(data)    : void    -- Upsert conversation
database.listConversations()       : array   -- List all conversations
database.deleteConversation(id)    : void    -- Delete conversation
database.getTasks(convId)          : array   -- Get tasks for conversation
database.saveTask(task)            : void    -- Insert/update task
database.deleteTask(id)            : void    -- Delete task
database.updateTask(id, updates)   : void    -- Partial update
database.reorderTasks(ids)         : void    -- Update sort orders
database.getWorkingDir()           : string  -- Persisted working directory
database.setWorkingDir(dir)        : void    -- Persist working directory
database.query(sql, params)        : array   -- Raw SQL query
database.run(sql, params)          : object  -- Raw SQL execute
```

---

### 9. `notes`

**Module:** notes-module.js

```
notes.recordNote(content, category) : void    -- Save timestamped note
notes.recallNotes(category?)        : array   -- Retrieve notes, optional filter
notes.getNotesCount()               : number  -- Count of stored notes
notes.clearNotes()                  : void    -- Delete all notes
notes.getNotesFilePath()            : string  -- Path to notes file
```

---

### 10. `skills`

**Module:** skills-module.js

```
skills.loadSkills()              : void    -- Scan and load skill files
skills.getSkill(name)            : object  -- Full skill content
skills.listSkills()              : array   -- Skill summaries
skills.getSkillsPrompt()         : string  -- Combined prompt for active skills
skills.getSkillsMetadataPrompt() : string  -- Skill list for system prompt
skills.activateSkill(name)       : void    -- Activate skill
skills.deactivateSkill(name)     : void    -- Deactivate skill
skills.getActiveSkills()         : array   -- Currently active skills
skills.reloadSkills()            : void    -- Re-scan skills directory
```

---

### 11. `tools`

**Module:** tools-v5.js

```
tools.execute(toolName, args)         : object    -- Execute tool (resolves aliases)
tools.getDefinitions()                : array     -- All tool definitions (native + dynamic)
tools.getCategorizedTools()           : object    -- Tools grouped by category
tools.startTask(dir)                  : void      -- Enter task mode
tools.endTask()                       : void      -- Exit task mode
tools.registerTool(def, handler)      : void      -- Register dynamic tool
```

---

### 12/13. `agentSystem` / `agents`

**Module:** agent-system-module.js (registered under both names)

```
agents.getAgentList()                : array    -- All agent summaries
agents.getAgent(name)                : object   -- Agent definition
agents.executeTask(name, task, ctx)  : object   -- Execute task via agent
agents.assignTask(name, task)        : void     -- Queue task for agent
agents.getStatus()                   : object   -- { current, queueLength, isRunning, agents }
agents.getCurrent()                  : object   -- Currently executing agent
agents.getQueue()                    : array    -- Pending tasks
agents.cancel()                      : object   -- Cancel current agent
agents.reloadAgents()                : void     -- Reload from disk
agents.classifyApprovalTier(tool, a) : number   -- Tool approval tier (1-4)
agents.shouldProceed(tier, tool, a)  : boolean  -- Check learned patterns
agents.recordDecision(tool, a, d)    : void     -- Record for learning
agents.getLearnedPatterns()          : object   -- All learned patterns
agents.getActionCount()              : number   -- Actions since check-in
agents.maybeCheckIn()                : boolean  -- Trigger check-in if due
agents.APPROVAL_TIERS                : object   -- Tier constants
agents.getToolRegistry()             : object   -- Tool tier registry copy
agents.TOOL_TIER_REGISTRY            : object   -- Direct registry reference
```

---

### 14. `agentManager`

**Module:** agent-manager-module.js

```
agentManager.createAgent(data)              : object  -- Create agent
agentManager.getAgent(id)                   : object  -- Get by ID
agentManager.updateAgent(id, data)          : object  -- Update agent
agentManager.deleteAgent(id)                : boolean -- Delete agent
agentManager.listAgents(filter?)            : array   -- List agents
agentManager.createGroup(data)              : object  -- Create group
agentManager.getGroup(id)                   : object  -- Get group
agentManager.updateGroup(id, data)          : object  -- Update group
agentManager.deleteGroup(id)                : boolean -- Delete group
agentManager.listGroups()                   : array   -- List groups
agentManager.getAgentTools(agentId)         : array   -- Agent's allowed tools
agentManager.isToolAllowedForRole(tool, r)  : boolean -- Check permission
agentManager.findCapableAgent(task)         : object  -- Match agent to task
agentManager.TOOL_CATEGORIES                : object  -- Category definitions
agentManager.PROGRAMMING_LANGUAGES          : array   -- Language list
agentManager.SECURITY_ROLES                 : object  -- Role definitions
```

---

### 15. `ai`

**Module:** ai-module.js

```
ai.chatStream(messages, tools, system, callbacks) : object  -- Streaming chat completion
ai.abort()                                        : boolean -- Abort active request
ai.quickComplete(messages, system)                : object  -- Fast internal completion
ai.buildSystemPrompt()                            : string  -- Constructed system prompt
ai.getLastContext()                                : object  -- Last API context snapshot
```

---

### 16. `summarizer`

**Module:** summarization-module.js

```
summarizer.compactHistory(history) : array    -- Compact via AI summarization
summarizer.canCompact(history)     : boolean  -- Check if compaction is viable
```

---

### 17. `testServer`

**Module:** test-server-module.js

```
testServer.start()     : void    -- Start test server
testServer.stop()      : void    -- Stop test server
testServer.status()    : object  -- { isRunning, port, logs }
testServer.getLogs()   : array   -- Accumulated log entries
testServer.setPort(n)  : void    -- Set test port
testServer.getPort()   : number  -- Get test port
testServer.dockerStart(): void   -- Start Docker container
testServer.dockerStop() : void   -- Stop Docker container
```

---

### 18. `fileTools`

**Module:** file-tools-module.js

```
fileTools.readChunked(path, opts)          : string  -- Read file in chunks
fileTools.writeChunked(path, content, opts): void    -- Write in chunks
fileTools.appendToFile(path, content)      : void    -- Append to file
fileTools.insertInFile(path, pos, content) : void    -- Insert at position
fileTools.patchFile(path, search, replace) : void    -- Search and replace
fileTools.createFile(path, content)        : void    -- Create with dirs
fileTools.deleteFile(path)                 : void    -- Delete file
fileTools.listDirectory(path)              : array   -- List contents
fileTools.getFileInfo(path)                : object  -- File metadata
fileTools.searchInFile(path, pattern)      : array   -- Search file
fileTools.replaceInFile(path, s, r)        : void    -- Replace in file
fileTools.readFileLines(path, start, end)  : string  -- Read line range
fileTools.ensureDirectory(path)            : void    -- Create directory
```

---

### 19. `imageGen`

**Module:** minimax-image-module.js

```
imageGen.generateImage(prompt, options)     : object  -- Generate image(s)
imageGen.handleGenerateImage(data, socket)  : void    -- Socket handler
```

---

### 20. `tts`

**Module:** minimax-tts-module.js

```
tts.synthesize(text, options)        : object  -- Generate speech
tts.handleSpeak(data, socket)        : void    -- Socket handler
tts.getVoices()                      : object  -- Available voice map
```

---

### 21. `minimaxFiles`

**Module:** minimax-files-module.js

```
minimaxFiles.uploadFile(filePath, purpose) : object  -- Upload to MiniMax
minimaxFiles.listFiles()                   : array   -- List uploaded files
minimaxFiles.getFile(fileId)               : object  -- Get file metadata
minimaxFiles.deleteFile(fileId)            : boolean -- Delete file
```

---

### 22. `projects`

**Module:** project-module.js

```
projects.listProjects()                 : array   -- All projects
projects.getProject(id)                 : object  -- Project metadata
projects.createProject(data)            : object  -- Create project
projects.updateProject(id, data)        : object  -- Update project
projects.deleteProject(id)              : boolean -- Delete project
projects.switchProject(id)              : void    -- Switch active project
projects.getActiveProject()             : object  -- Active project
projects.getActiveProjectId()           : string  -- Active project ID
projects.linkProjects(id1, id2)         : void    -- Link two projects
projects.unlinkProjects(id1, id2)       : void    -- Unlink projects
projects.getProjectData(id)             : object  -- Project-specific data
projects.saveProjectData(id, data)      : void    -- Save project data
projects.saveCurrentProjectState()      : void    -- Save current state
projects.listProjectAgents(id)          : array   -- Project-scoped agents
projects.addProjectAgent(id, agent)     : void    -- Add agent to project
projects.removeProjectAgent(id, aId)    : void    -- Remove agent
```

---

### 23. `obsidian`

**Module:** obsidian-vault-module.js

```
obsidian.discoverVaults()     : array   -- Scan for Obsidian vaults
obsidian.getVaultPath()       : string  -- Configured vault path
obsidian.listNotes(folder?)   : array   -- List markdown files
```

---

### 24. `conversation`

**Module:** conversation-module.js

```
conversation.getId()                    : string   -- Current conversation ID
conversation.getHistory()               : array    -- Message history
conversation.getRoadmap()               : array    -- Roadmap items
conversation.getMilestones()            : array    -- Milestones only
conversation.getWorkingDirectory()      : string   -- Working directory
conversation.setWorkingDirectory(dir)   : void     -- Change working dir
conversation.getTasks()                 : array    -- Task list
conversation.addTask(task)              : void     -- Add task
conversation.toggleTask(id)             : void     -- Toggle completion
conversation.deleteTask(id)             : void     -- Delete task
conversation.updateTask(id, updates)    : void     -- Update task
conversation.reorderTasks(ids)          : void     -- Reorder tasks
conversation.addMilestone(ms)           : void     -- Add milestone
conversation.updateMilestone(id, u)     : void     -- Update milestone
conversation.deleteMilestone(id)        : void     -- Delete milestone
conversation.launchMilestone(id)        : void     -- Launch milestone
conversation.addUserMessage(text)       : void     -- Append user message
conversation.addAssistantMessage(c)     : void     -- Append assistant msg
conversation.addToolResult(result)      : void     -- Append tool result
conversation.addRoadmapItem(item)       : void     -- Add roadmap item
conversation.checkpoint()               : void     -- Save state
conversation.sanitize()                 : array    -- Clean history
conversation.save()                     : void     -- Persist to disk
conversation.new()                      : void     -- New conversation
conversation.getState()                 : object   -- Full state snapshot
conversation.listConversations()        : array    -- All conversations
conversation.loadConversation(id)       : void     -- Load by ID
conversation.getContextUsage()          : object   -- Context usage stats
conversation.shouldWarnContext()         : boolean  -- Warning needed
conversation.isContextCritical()        : boolean  -- Critical threshold
conversation.clearHistory()             : void     -- Clear for new chat
conversation.replaceHistory(h)          : void     -- Replace history
conversation.archiveCurrentAndNew()     : void     -- Archive and start new
conversation.loadProjectData(data)      : void     -- Load project data
conversation.getChildren(taskId)        : array    -- Child tasks
conversation.getDescendants(taskId)     : array    -- All descendants
conversation.getAncestors(taskId)       : array    -- Ancestor chain
conversation.getBreadcrumb(taskId)      : array    -- Breadcrumb path
conversation.getTaskTree()              : array    -- Hierarchical tree
conversation.summarizeAndCompact()      : void     -- Trigger compaction
conversation.saveSessionNote(note)      : void     -- Save note
conversation.recallSessionNotes(f)      : array    -- Recall notes
```

---

### 25. `tasks`

**Module:** tasks-engine.js

```
tasks.getTasks()                     : array   -- All tasks
tasks.addTask(task)                  : void    -- Add and broadcast
tasks.updateTask(id, updates)        : void    -- Update and broadcast
tasks.deleteTask(id, cascade?)       : void    -- Delete and broadcast
tasks.toggleTask(id)                 : void    -- Toggle and broadcast
tasks.reorderTasks(ids)              : void    -- Reorder and broadcast
tasks.addMilestone(ms)               : void    -- Add milestone
tasks.updateMilestone(id, updates)   : void    -- Update milestone
tasks.deleteMilestone(id)            : void    -- Delete milestone
tasks.launchMilestone(id)            : void    -- Launch milestone
tasks.getMilestones()                : array   -- Milestones only
tasks.getRoadmap()                   : array   -- Full roadmap
tasks.getChildren(taskId)            : array   -- Direct children
tasks.getDescendants(taskId)         : array   -- All descendants
tasks.getAncestors(taskId)           : array   -- Ancestor chain
tasks.getBreadcrumb(taskId)          : array   -- Breadcrumb path
tasks.getTaskTree()                  : array   -- Full tree
tasks.addChildTask(parentId, task)   : object  -- Add child task
tasks.reparentTask(taskId, parentId) : object  -- Move task
tasks.broadcastSnapshot()            : void    -- Push task list
tasks.broadcastTree()                : void    -- Push task tree
```

---

### 26. `git`

**Module:** git-module.js

```
git.commit(message)                    : object  -- Create git commit
git.commitAndPush(message)             : object  -- Commit and push
git.getStatus()                        : object  -- Git status
git.createIssue(title, body)           : object  -- Create GitHub issue
git.createPR(title, body)              : object  -- Create pull request
git.getIssues()                        : array   -- List issues
git.getPullRequests()                  : array   -- List PRs
git.linkIssueToCommit(issue, sha)      : void    -- Link issue
git.checkoutBranch(name)               : object  -- Checkout branch
git.mergeBranch(source, target)        : object  -- Merge branches
git.triggerAutoCommit()                : void    -- Force auto-commit
```

---

### 27. `orchestration`

**Module:** orchestration-module.js

```
orchestration.isProcessing()              : boolean -- AI loop active
orchestration.checkpoint()                : void    -- Save state
orchestration.getState()                  : object  -- State snapshot
orchestration.getDashboard()              : object  -- Dashboard data
orchestration.broadcastDashboard()        : void    -- Push dashboard
orchestration._updateLimits(cfg)          : void    -- Update runtime limits
orchestration.runAgentSession(...)        : object  -- Start agent session
orchestration.runAgentSessionInRoom(...)  : object  -- Agent in room
orchestration.pauseAgent(name)            : void    -- Pause agent
orchestration.resumeAgent(name)           : void    -- Resume agent
orchestration.getAgentSessionState(name)  : object  -- Agent state
orchestration.getAgentHistory(name)       : array   -- Agent history
orchestration.getAgentInbox(name)         : array   -- Agent messages
orchestration.getOrchestratorState()      : object  -- Full state
orchestration.getAllAgentStates()          : object  -- All agent states
orchestration.createChatRoom(...)         : object  -- Create room
orchestration.addRoomMessage(...)         : void    -- Add room message
orchestration.endChatRoom(roomId)         : void    -- Close room
orchestration.listChatRooms()             : array   -- List rooms
orchestration.getChatRoom(roomId)         : object  -- Get room
orchestration.pullAgentIntoRoom(...)      : void    -- Add agent to room
orchestration.userJoinRoom(roomId)        : void    -- User joins
orchestration.userLeaveRoom(roomId)       : void    -- User leaves
orchestration.endMeeting(roomId)          : void    -- End meeting
orchestration.generateMeetingNotes(rId)   : string  -- AI meeting notes
orchestration.clearRoomAgentCallbacks(rId): void    -- Clear callbacks
```
