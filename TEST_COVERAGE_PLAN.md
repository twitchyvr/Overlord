# Comprehensive Test Coverage Improvement Plan
## Overlord-Web v1.2.0

**Generated:** 2026-02-28
**Project:** Browser-based AI Coding Assistant (Node.js + Tauri)

---

## Executive Summary

| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| Test Files | 5 | 15+ | +10 |
| Test Cases | 94 | 250+ | +156 |
| Coverage | 8.85% | 40% | -31.15% |
| Modules Tested | 2/31 | 20/31 | +18 |

**Timeline:** 8 weeks (1 file per week + integration)

---

## Part 1: Current State Analysis

### 1.1 Existing Test Files

| File | Module | Lines | Coverage |
|------|--------|-------|----------|
| `tests/token-manager.test.js` | token-manager-module | 400+ | 78.22% |
| `tests/skills.test.js` | skills-module | 300+ | 7.46% |
| `tests/approval.test.js` | agent-system-module | 200+ | - |
| `tests/integration/module-loading.test.js` | All modules | 100+ | - |
| `tests/integration/tool-execution.test.js` | tools-v5 | 150+ | - |

### 1.2 Modules by Priority

```
PRIORITY 1 - CRITICAL (No tests, core functionality)
├── orchestration-module.js     927 lines  ← START HERE
├── ai-module.js                 495 lines
├── tools-v5.js                1,175 lines
├── conversation-module.js       447 lines

PRIORITY 2 - HIGH (Partial tests, need expansion)
├── guardrail-module.js          357 lines
├── config-module.js             139 lines
├── agent-system-module.js       356 lines
├── agent-manager-module.js       723 lines

PRIORITY 3 - MEDIUM (Supporting modules)
├── database-module.js           268 lines
├── file-tools-module.js         377 lines
├── git-module.js               263 lines
├── notes-module.js             309 lines
├── mcp-module.js               621 lines
├── mcp-manager-module.js        479 lines

PRIORITY 4 - LOW (Infrastructure)
├── summarization-module.js      180 lines
├── character-normalization.js   189 lines
├── markdown-module.js            95 lines
├── test-server-module.js        424 lines
├── minimax-*.js                 3 files
└── agents/*.js                   2 files
```

---

## Part 2: Implementation Plan

### Phase 1: Core Flow (Weeks 1-2)

#### Week 1: Orchestration Module

**File:** `tests/orchestration.test.js` (NEW)

```
describe('Orchestration Module')
├── handleUserMessage()
│   ├── parses agent commands ("agent: task")
│   ├── handles direct messages
│   ├── manages isProcessing state
│   └── triggers AI cycle
├── executeToolsWithApproval()
│   ├── classifies approval tiers (T1-T4)
│   ├── executes approved tools
│   ├── handles escalation
│   └── broadcasts activities
├── runAutoQA()
│   ├── runs lint on file writes
│   ├── runs type check on TS files
│   ├── injects errors into history
│   └── skips non-code files
├── runAICycle()
│   ├── streams AI responses
│   ├── extracts tool calls
│   └── handles thinking blocks
└── State Management
    ├── orchestrationState updates
    ├── broadcastActivity()
    └── setOrchestratorState()
```

**Test Cases:** 25-30
**Lines of Test Code:** ~400

---

#### Week 2: AI Module

**File:** `tests/ai-module.test.js` (NEW)

```
describe('AI Module')
├── init()
│   ├── registers service
│   ├── loads config
│   └── sets up MiniMax client
├── chat()
│   ├── sends proper message format
│   ├── includes tools in request
│   ├── handles system prompt
│   └── respects maxTokens/temperature
├── chatStream()
│   ├── parses delta events
│   ├── extracts text_delta
│   ├── extracts thinking_delta
│   ├── extracts input_json_delta
│   └── handles content_block_stop
├── Message Construction
│   ├── builds user messages
│   ├── builds assistant messages
│   ├── includes tool_use blocks
│   └── includes tool_result blocks
├── Error Handling
│   ├── API errors
│   ├── Rate limiting
│   ├── Timeout handling
│   └── Invalid JSON responses
└── Tool Integration
    ├── extracts tool definitions
    ├── parses tool calls
    └── maps tool results
```

**Test Cases:** 20-25
**Lines of Test Code:** ~350

---

### Phase 2: Tools & Conversation (Weeks 3-4)

#### Week 3: Tools Module

**File:** `tests/tools.test.js` (NEW)

```
describe('Tools Module')
├── Shell Execution
│   ├── runBash() - basic commands
│   ├── runBash() - long-running commands (timeout)
│   ├── runBash() - working directory
│   ├── runBash() - error handling
│   ├── runPS() - PowerShell on Windows
│   └── runCmd() - CMD on Windows
├── File Operations
│   ├── readFile() - success
│   ├── readFile() - file not found
│   ├── readFile() - file too large
│   ├── readFileLines() - partial read
│   ├── readFileLines() - bounds handling
│   ├── writeFile() - create new
│   ├── writeFile() - overwrite existing
│   ├── writeFile() - creates directories
│   ├── writeFile() - sanitizes filename
│   ├── patchFile() - success
│   ├── patchFile() - search not found
│   ├── appendFile() - add to file
│   └── listDir() - sorting (dirs first)
├── Path Resolution
│   ├── relative paths resolved
│   ├── absolute paths work
│   ├── default to working dir
│   └── handles .. traversal
├── System Tools
│   ├── system_info() - returns OS info
│   ├── get_working_dir()
│   ├── set_working_dir()
│   └── set_thinking_level()
├── Agent Tools
│   ├── list_agents()
│   ├── get_agent_info()
│   └── assign_task()
├── QA Tools (mock npm)
│   ├── qa_run_tests()
│   ├── qa_check_lint()
│   ├── qa_check_types()
│   ├── qa_check_coverage()
│   └── qa_audit_deps()
├── MCP Tools
│   ├── web_search() - success
│   └── understand_image() - success
├── Error Handling
│   ├── unknown tool
│   ├── tool timeout
│   ├── invalid input
│   └── permission denied
└── Result Handling
    ├── truncation at 32K chars
    ├── success/failure format
    └── null/undefined handling
```

**Test Cases:** 40-50
**Lines of Test Code:** ~600

---

#### Week 4: Conversation Module

**File:** `tests/conversation.test.js` (NEW)

```
describe('Conversation Module')
├── Initialization
│   ├── creates new conversation ID
│   ├── loads from database if exists
│   └── initializes empty history
├── Message Management
│   ├── addUserMessage()
│   ├── addAssistantMessage()
│   ├── addToolResult()
│   ├── getHistory()
│   └── clearHistory()
├── Working Directory
│   ├── getWorkingDirectory()
│   ├── setWorkingDirectory()
│   └── persists across sessions
├── Roadmap
│   ├── addRoadmapItem()
│   ├── getRoadmap()
│   └── updateRoadmapItem()
├── Tasks
│   ├── addTask()
│   ├── toggleTask()
│   ├── deleteTask()
│   └── getTasks()
├── Context Usage
│   ├── getContextUsage()
│   ├── calculates token count
│   └── triggers warning at threshold
├── Persistence
│   ├── saves to database
│   ├── loads from database
│   └── handles corrupted data
└── Validation
    ├── sanitizeHistory()
    └── validateHistory()
```

**Test Cases:** 25-30
**Lines of Test Code:** ~400

---

### Phase 3: Services (Weeks 5-6)

#### Week 5: Guardrail & Config

**File:** `tests/guardrail.test.js` (NEW)

```
describe('Guardrail Module')
├── Input Filtering
│   ├── blocks sensitive data (API keys)
│   ├── blocks dangerous commands
│   ├── sanitizes user input
│   └── handles regex patterns
├── Output Filtering
│   ├── removes error stack traces
│   ├── limits output length
│   └── sanitizes responses
├── Pattern Matching
│   ├── detects PII patterns
│   ├── detects credentials
│   ├── detects file paths
│   └── custom patterns
└── Configuration
    ├── enable/disable filters
    ├── custom rules
    └── whitelist patterns
```

**File:** `tests/config.test.js` (NEW)

```
describe('Config Module')
├── Load/Save
│   ├── loads from .env
│   ├── loads from config file
│   ├── merges defaults
│   └── saves changes
├── API Configuration
│   ├── apiKey handling (masked)
│   ├── baseUrl selection
│   ├── model selection
│   └── timeout settings
├── Model Spec
│   ├── contextWindow
│   ├── maxOutput
│   └── thinking levels
└── Environment
    ├── PORT
    ├── NODE_ENV
    └── custom env vars
```

**Test Cases:** 20-25 each
**Lines of Test Code:** ~300 each

---

#### Week 6: Agent System

**File:** `tests/agent-system.test.js` (NEW)

```
describe('Agent System Module')
├── Approval Classification
│   ├── classifyApprovalTier() - T1 (read-only)
│   ├── classifyApprovalTier() - T2 (code changes)
│   ├── classifyApprovalTier() - T3 (packages)
│   ├── classifyApprovalTier() - T4 (destructive)
│   └── learns from overrides
├── Should Proceed
│   ├── T1 always approved
│   ├── T2 auto-approve if confidence ≥ 0.7
│   ├── T3 requires human
│   └── T4 requires human + sign-off
├── Decision Recording
│   ├── records decisions
│   ├── saves to history file
│   ├── updates learned patterns
│   └── handles escalation
├── Check-ins
│   ├── triggers every 10 actions
│   ├── summarizes decisions
│   └── broadcasts status
└── Pattern Learning
    ├── auto-escalate after 3 overrides
    ├── auto-approve after 5 approvals
    └── persists across restarts
```

**File:** `tests/agent-manager.test.js` (NEW)

```
describe('Agent Manager')
├── Agent Loading
│   ├── loads built-in agents
│   ├── loads team agents from disk
│   └── handles missing directories
├── Agent Execution
│   ├── assignTask() - queues task
│   ├── processQueue() - runs sequentially
│   ├── handles agent errors
│   └── restores working directory
├── Status Tracking
│   ├── currentAgent state
│   ├── queue length
│   └── isRunning flag
└── Team Management
    ├── getAgentList()
    ├── formatAgentList()
    └── formatAgentInfo()
```

**Test Cases:** 30-35
**Lines of Test Code:** ~450

---

### Phase 4: Integration (Weeks 7-8)

#### Week 7: MCP Integration

**File:** `tests/mcp.test.js` (NEW)

```
describe('MCP Integration')
├── MCP Client
│   ├── connects to server
│   ├── handles connection errors
│   ├── maintains session
│   └── reconnects on failure
├── Tool Forwarding
│   ├── forwards tool calls to MCP
│   ├── parses responses
│   └── handles timeouts
├── web_search Tool
│   ├── sends query to MCP
│   ├── returns formatted results
│   └── handles no results
└── understand_image Tool
    ├── sends image to MCP
    ├── receives description
    └── handles invalid images
```

---

#### Week 8: Full Integration

**File:** `tests/integration/full-flow.test.js` (NEW)

```
describe('Full User Flow Integration')
├── Single Request Cycle
│   ├── user sends message
│   ├── AI receives and processes
│   ├── tools execute if needed
│   ├── results returned to AI
│   ├── final response displayed
│   └── history updated
├── Multi-Turn Conversation
│   ├── maintains context
│   ├── truncates when needed
│   ├── preserves tool pairs
│   └── saves to database
├── Agent Delegation
│   ├── user calls agent
│   ├── agent executes task
│   ├── results returned
│   └── main conversation continues
├── Error Recovery
│   ├── API failure handling
│   ├── tool failure handling
│   ├── graceful degradation
│   └── user notification
└── Context Management
│   ├── warning at 85% capacity
│   ├── truncation at limit
│   ├── compaction tracking
    └── history integrity
```

---

## Part 3: File Implementation Checklist

### New Test Files to Create

```
tests/
├── [NEW] orchestration.test.js          # Week 1
├── [NEW] ai-module.test.js              # Week 2
├── [NEW] tools.test.js                  # Week 3
├── [NEW] conversation.test.js            # Week 4
├── [NEW] guardrail.test.js              # Week 5
├── [NEW] config.test.js                  # Week 5
├── [NEW] agent-system.test.js           # Week 6
├── [NEW] agent-manager.test.js          # Week 6
├── [NEW] mcp.test.js                    # Week 7
├── [NEW] database.test.js                # Week 7
├── [NEW] integration/full-flow.test.js  # Week 8
│
├── [EXISTS] token-manager.test.js       # Already good (78%)
├── [EXISTS] skills.test.js               # Needs expansion
├── [EXISTS] approval.test.js             # Needs expansion
├── [EXISTS] integration/module-loading.test.js
└── [EXISTS] integration/tool-execution.test.js
```

---

## Part 4: Effort & Coverage Estimates

### Per-File Breakdown

| Test File | Test Cases | Coverage Target | Effort |
|-----------|------------|-----------------|--------|
| orchestration.test.js | 25 | +6% | 4 hrs |
| ai-module.test.js | 20 | +5% | 3 hrs |
| tools.test.js | 45 | +10% | 6 hrs |
| conversation.test.js | 25 | +5% | 3 hrs |
| guardrail.test.js | 15 | +3% | 2 hrs |
| config.test.js | 15 | +2% | 2 hrs |
| agent-system.test.js | 20 | +4% | 3 hrs |
| agent-manager.test.js | 15 | +2% | 2 hrs |
| mcp.test.js | 15 | +2% | 2 hrs |
| database.test.js | 10 | +1% | 1 hr |
| integration tests | 20 | +3% | 3 hrs |
| **TOTAL** | **225** | **43%** | **31 hrs** |

### Weekly Milestones

| Week | Goal | Cumulative Coverage |
|------|------|---------------------|
| 1 | orchestration | ~15% |
| 2 | ai-module | ~20% |
| 3 | tools | ~30% |
| 4 | conversation | ~35% |
| 5 | guardrail + config | ~40% |
| 6 | agent modules | ~42% |
| 7 | mcp + database | ~43% |
| 8 | integration | 45%+ |

---

## Part 5: Test Standards

### Mock Patterns

```javascript
// Hub mock (standard)
const createMockHub = () => ({
    log: jest.fn(),
    broadcast: jest.fn(),
    emitTo: jest.fn(),
    registerService: jest.fn(),
    getService: jest.fn(() => mockService),
    on: jest.fn(),
    status: jest.fn(),
    teamUpdate: jest.fn(),
    toolResult: jest.fn()
});

// Config mock
const mockConfig = {
    model: 'MiniMax-M2.5-highspeed',
    baseUrl: 'https://api.minimax.io',
    apiKey: 'test-key',
    maxTokens: 66000,
    temperature: 0.7,
    baseDir: '/tmp/test'
};
```

### Test Categories

```javascript
describe('ModuleName', () => {
    describe('primaryFunction()', () => {
        test('success case', () => { });
        test('handles null input', () => { });
        test('handles empty input', () => { });
        test('throws on invalid input', () => { });
    });
    
    describe('error cases', () => {
        test('API error propagation', () => { });
        test('timeout handling', () => { });
        test('rate limiting', () => { });
    });
});
```

---

## Part 6: Validation

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific file
npm test -- tests/orchestration.test.js

# Watch mode
npm run test:watch

# Lint
npm run lint
```

### Success Criteria

- [ ] 11 new test files created
- [ ] 225+ test cases total
- [ ] Coverage ≥ 40%
- [ ] All 94 existing tests still pass
- [ ] No lint errors
- [ ] Each critical module (tools, orchestration, AI) ≥ 50% covered

---

## Part 7: Quick Start

### Week 1: Orchestration (Start Here)

```
1. Create tests/orchestration.test.js
2. Copy template from Part 5
3. Add tests for:
   - handleUserMessage()
   - executeToolsWithApproval()
   - runAutoQA()
   - runAICycle()
4. Run: npm run test:coverage
5. Expect: ~15% total coverage
```

---

## Appendix: Module Dependencies

```
server.js
├── hub.js
├── modules/
│   ├── config-module.js
│   ├── token-manager-module.js ✓ tested
│   ├── conversation-module.js
│   ├── ai-module.js
│   ├── tools-v5.js
│   ├── orchestration-module.js
│   ├── guardrail-module.js
│   ├── agent-system-module.js
│   ├── agent-manager-module.js
│   ├── skills-module.js ✓ tested
│   ├── mcp-module.js
│   ├── database-module.js
│   └── ... (others)
```
