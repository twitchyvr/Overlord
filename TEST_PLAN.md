# Test Coverage Improvement Plan
## Overlord-Web v1.2.0

**Current State:**
- 94 tests passing ✓
- Coverage: 8.85% (need 40%)
- 10,802 lines of code across 31 modules
- Only 1 module (token-manager) has substantial coverage

---

## Phase 1: Critical Core Modules (Target: +20% coverage)

### 1.1 Tools Module (`tools-v5.js`) - Priority 1
**Why:** 35+ tools, most critical module, 4.07% current

```
tests/tools.test.js
├── shell execution (bash, powershell, cmd)
├── file operations (read, write, patch, append, list_dir)
├── path resolution (relative vs absolute)
├── working directory management
├── result truncation
├── error handling (file not found, permission denied)
└── tool routing (unknown tool handling)
```

**Lines to cover:** ~400
**Target coverage increase:** +8%

---

### 1.2 Orchestration Module (`orchestration-module.js`) - Priority 2
**Why:** Main conversation flow, 2.66% current

```
tests/orchestration.test.js
├── user message handling
├── AI cycle execution
├── tool execution with approval
├── state management (thinking, processing)
├── error propagation
└── broadcast events
```

**Lines to cover:** ~500
**Target coverage increase:** +6%

---

### 1.3 AI Module (`ai-module.js`) - Priority 3
**Why:** API integration, 4.24% current

```
tests/ai-module.test.js
├── message construction
├── streaming response parsing
├── thinking block handling
├── tool call extraction
├── error handling (API failures, timeouts)
├── token estimation
└── history formatting
```

**Lines to cover:** ~450
**Target coverage increase:** +5%

---

## Phase 2: Supporting Services (Target: +10% coverage)

### 2.1 Conversation Module
```
tests/conversation.test.js
├── message history management
├── working directory
├── roadmap management
├── task management
└── context usage calculation
```

### 2.2 Guardrail Module  
```
tests/guardrail.test.js
├── input filtering
├── output filtering
├── pattern matching
└── content sanitization
```

### 2.3 Config Module
```
tests/config.test.js
├── load/save config
├── API key handling
├── model spec initialization
└── environment variables
```

**Target coverage increase:** +10%

---

## Phase 3: Integration Tests (Target: +5% coverage)

### 3.1 Module Loading
```
tests/integration/module-loading.test.js ✓ ALREADY EXISTS
```

### 3.2 Tool Execution Flow
```
tests/integration/tool-execution.test.js ✓ ALREADY EXISTS
```

### 3.3 Agent Integration
```
tests/integration/agent-execution.test.js
├── agent task assignment
├── queue processing
├── result formatting
└── error handling
```

### 3.4 MCP Integration
```
tests/integration/mcp.test.js
├── MCP client initialization
├── tool forwarding
├── response handling
└── error recovery
```

**Target coverage increase:** +5%

---

## Coverage Targets Summary

| Phase | Module | Current | Target | Increase |
|-------|--------|---------|--------|----------|
| 1 | tools-v5 | 4% | 25% | +21% |
| 1 | orchestration | 3% | 20% | +17% |
| 1 | ai-module | 4% | 15% | +11% |
| 2 | conversation | 7% | 25% | +18% |
| 2 | guardrail | 11% | 30% | +19% |
| 2 | config | 12% | 35% | +23% |
| 3 | integration | - | +10% | +10% |
| **TOTAL** | | **8.85%** | **40%+** | **+31%** |

---

## Implementation Order

### Week 1: Tools Module
- [ ] `tests/tools.test.js` - 30 test cases
- [ ] Run coverage, expect +8%

### Week 2: Orchestration  
- [ ] `tests/orchestration.test.js` - 25 test cases
- [ ] Run coverage, expect +6%

### Week 3: AI Module
- [ ] `tests/ai-module.test.js` - 20 test cases
- [ ] Run coverage, expect +5%

### Week 4: Supporting Modules
- [ ] `tests/conversation.test.js`
- [ ] `tests/guardrail.test.js`
- [ ] `tests/config.test.js`

### Week 5: Integration
- [ ] `tests/integration/agent-execution.test.js`
- [ ] `tests/integration/mcp.test.js`

### Week 6: Verification
- [ ] Run full coverage check
- [ ] Fix any failing tests
- [ ] Adjust thresholds if needed

---

## Test Template

```javascript
/**
 * [Module Name] Module Tests
 * Tests for [what it does]
 */

const path = require('path');

// Mock hub
const createMockHub = () => ({
    log: jest.fn(),
    broadcast: jest.fn(),
    emitTo: jest.fn(),
    registerService: jest.fn(),
    getService: jest.fn()
});

// Load module
const module = require('../modules/[module-name]');

describe('[Module Name]', () => {
    let hub;
    
    beforeEach(() => {
        hub = createMockHub();
    });
    
    describe('[function/feature]', () => {
        test('[description]', () => {
            // Arrange
            const input = ...;
            
            // Act
            const result = module.functionName(input);
            
            // Assert
            expect(result).toBe(...);
        });
        
        test('[handles edge case]', () => {
            // ...
        });
    });
});
```

---

## Quick Wins (Low Effort, High Impact)

1. **Add `module.exports` coverage tests** - Just verify exports exist
2. **Error path tests** - Test catch blocks (often 0% covered)
3. **Parameter validation** - Test input validation functions
4. **Mock external dependencies** - API calls, file system

---

## Validation Commands

```bash
# Run tests with coverage
npm run test:coverage

# Watch mode during development
npm run test:watch

# Check lint
npm run lint

# Full check
npm run check
```

---

## Success Criteria

- [ ] Coverage ≥ 40% (current threshold)
- [ ] All existing 94 tests still pass
- [ ] No lint errors
- [ ] Each critical module has ≥60% coverage
- [ ] Integration tests cover full user flows
