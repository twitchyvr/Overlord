// ==================== AGENTS TEST SUITE ====================
// Tests all 6 built-in agents with mocked tools.execute()
// Verifies task routing, output structure, and edge cases

const { AGENTS, AgentManager } = require('../modules/agents/index.js');

// ──────────────────────────────────────────────
// Shared mock factory
// ──────────────────────────────────────────────

function makeMockTools(overrides = {}) {
    const calls = [];
    const execute = jest.fn(async (toolName, args) => {
        calls.push({ tool: toolName, args });
        if (overrides[toolName]) return overrides[toolName](args);
        return { success: true, content: `mock output for ${toolName}` };
    });
    return { execute, calls };
}

function makeContext(toolOverrides = {}) {
    const mock = makeMockTools(toolOverrides);
    return { context: { tools: mock }, mock };
}

// ──────────────────────────────────────────────
// Utility: run an agent
// ──────────────────────────────────────────────

async function runAgent(agentName, task, toolOverrides = {}) {
    const agent = AGENTS[agentName];
    expect(agent).toBeDefined();
    const { context, mock } = makeContext(toolOverrides);
    const result = await agent.execute(task, context);
    return { result, mock };
}

// ══════════════════════════════════════════════
// GIT-KEEPER
// ══════════════════════════════════════════════

describe('git-keeper agent', () => {
    it('is defined and has required fields', () => {
        expect(AGENTS['git-keeper']).toBeDefined();
        expect(AGENTS['git-keeper'].name).toBe('git-keeper');
        expect(AGENTS['git-keeper'].execute).toBeInstanceOf(Function);
    });

    it('runs a plain git status command', async () => {
        const { result, mock } = await runAgent('git-keeper', 'git status');
        expect(mock.calls[0].tool).toBe('bash');
        expect(mock.calls[0].args.command).toContain('git');
        expect(result.agent).toBe('git-keeper');
        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('output');
    });

    it('prepends "git " when missing', async () => {
        const { mock } = await runAgent('git-keeper', 'log --oneline -5');
        const cmd = mock.calls[0].args.command;
        expect(cmd).toContain('git');
        expect(cmd).toContain('log');
    });

    it('handles "commit all changes" task', async () => {
        const { mock } = await runAgent('git-keeper', 'commit all changes');
        const cmd = mock.calls[0].args.command;
        expect(cmd).toContain('commit');
    });

    it('handles "check git status" by stripping the "check" prefix', async () => {
        const { mock } = await runAgent('git-keeper', 'check git status');
        const cmd = mock.calls[0].args.command;
        expect(cmd).toContain('git status');
    });

    it('returns failure when bash tool returns error', async () => {
        const { result } = await runAgent('git-keeper', 'git push', {
            bash: async () => ({ success: false, error: 'not a git repo' })
        });
        expect(result.success).toBe(false);
        expect(result.output).toContain('not a git repo');
    });

    it('returns correct result shape', async () => {
        const { result } = await runAgent('git-keeper', 'git status');
        expect(result).toMatchObject({
            agent: 'git-keeper',
            task: 'git status',
            success: expect.any(Boolean)
        });
    });
});

// ══════════════════════════════════════════════
// TESTING-ENGINEER
// ══════════════════════════════════════════════

describe('testing-engineer agent', () => {
    it('is defined and has required fields', () => {
        expect(AGENTS['testing-engineer']).toBeDefined();
        expect(AGENTS['testing-engineer'].execute).toBeInstanceOf(Function);
    });

    it('runs lint when task includes "lint"', async () => {
        const { mock } = await runAgent('testing-engineer', 'run lint');
        const cmd = mock.calls[0].args.command;
        expect(cmd).toContain('lint');
    });

    it('runs tsc when task includes "tsc"', async () => {
        const { mock } = await runAgent('testing-engineer', 'run tsc');
        const cmd = mock.calls[0].args.command;
        expect(cmd).toContain('tsc');
    });

    it('runs unit tests when task includes "unit"', async () => {
        const { mock } = await runAgent('testing-engineer', 'run unit tests');
        const cmd = mock.calls[0].args.command;
        expect(cmd).toContain('test');
    });

    it('falls back to npm test for generic test task', async () => {
        const { mock } = await runAgent('testing-engineer', 'run all tests');
        const cmd = mock.calls[0].args.command;
        expect(cmd).toContain('npm test');
    });

    it('returns correct result shape', async () => {
        const { result } = await runAgent('testing-engineer', 'run tests');
        expect(result).toMatchObject({
            agent: 'testing-engineer',
            success: expect.any(Boolean)
        });
    });
});

// ══════════════════════════════════════════════
// CODE-IMPLEMENTER
// ══════════════════════════════════════════════

describe('code-implementer agent', () => {
    it('is defined and has required fields', () => {
        expect(AGENTS['code-implementer']).toBeDefined();
        expect(AGENTS['code-implementer'].execute).toBeInstanceOf(Function);
    });

    it('calls write_file when creating a file with content', async () => {
        const { mock, result } = await runAgent(
            'code-implementer',
            'create file src/foo.js with console.log("hello")'
        );
        const writeCall = mock.calls.find(c => c.tool === 'write_file');
        expect(writeCall).toBeDefined();
        expect(writeCall.args.path).toContain('src/foo.js');
        expect(writeCall.args.content).toContain('console.log');
        expect(result.agent).toBe('code-implementer');
    });

    it('falls back to bash when no file path found', async () => {
        const { mock } = await runAgent('code-implementer', 'echo hello world');
        const bashCall = mock.calls.find(c => c.tool === 'bash');
        expect(bashCall).toBeDefined();
    });

    it('handles "write file to path with content" syntax', async () => {
        const { mock } = await runAgent(
            'code-implementer',
            'write file to lib/utils.js with module.exports = {}'
        );
        const writeCall = mock.calls.find(c => c.tool === 'write_file');
        expect(writeCall).toBeDefined();
        expect(writeCall.args.path).toBe('lib/utils.js');
    });

    it('returns correct result shape', async () => {
        const { result } = await runAgent('code-implementer', 'echo test');
        expect(result).toMatchObject({
            agent: 'code-implementer',
            success: expect.any(Boolean)
        });
    });
});

// ══════════════════════════════════════════════
// UI-EXPERT
// ══════════════════════════════════════════════

describe('ui-expert agent', () => {
    it('is defined and has required fields', () => {
        expect(AGENTS['ui-expert']).toBeDefined();
        expect(AGENTS['ui-expert'].execute).toBeInstanceOf(Function);
    });

    it('runs grep checks when task is "analyze index.html"', async () => {
        const { mock, result } = await runAgent('ui-expert', 'analyze index.html');
        expect(mock.calls.length).toBeGreaterThan(0);
        expect(mock.calls.every(c => c.tool === 'bash')).toBe(true);
        expect(result.output).toContain('UI Audit');
        expect(result.agent).toBe('ui-expert');
        expect(result.success).toBe(true);
    });

    it('checks CSS structure when task includes "css"', async () => {
        const { mock, result } = await runAgent('ui-expert', 'check css structure');
        const cmds = mock.calls.map(c => c.args.command);
        expect(cmds.some(cmd => cmd.includes('.css'))).toBe(true);
        expect(result.output).toContain('CSS');
    });

    it('checks ARIA/accessibility when task includes "a11y"', async () => {
        const { mock, result } = await runAgent('ui-expert', 'audit a11y compliance');
        const cmds = mock.calls.map(c => c.args.command);
        expect(cmds.some(cmd => cmd.includes('aria') || cmd.includes('role'))).toBe(true);
        expect(result.output).toContain('Accessibility');
    });

    it('returns fallback help when task is unrecognized', async () => {
        const { result } = await runAgent('ui-expert', 'something unrelated');
        expect(result.output).toContain('UI File Count');
        expect(result.success).toBe(true);
    });

    it('returns failure when context.tools is missing', async () => {
        const agent = AGENTS['ui-expert'];
        const result = await agent.execute('analyze', null);
        expect(result.success).toBe(false);
        expect(result.output).toContain('context missing');
    });

    it('returns correct result shape', async () => {
        const { result } = await runAgent('ui-expert', 'review interface');
        expect(result).toMatchObject({
            agent: 'ui-expert',
            success: expect.any(Boolean),
            output: expect.any(String)
        });
    });
});

// ══════════════════════════════════════════════
// UI-TESTER
// ══════════════════════════════════════════════

describe('ui-tester agent', () => {
    it('is defined and has required fields', () => {
        expect(AGENTS['ui-tester']).toBeDefined();
        expect(AGENTS['ui-tester'].execute).toBeInstanceOf(Function);
    });

    it('runs accessibility checks when task includes "accessibility"', async () => {
        const { mock, result } = await runAgent('ui-tester', 'run accessibility tests');
        expect(mock.calls.length).toBeGreaterThan(0);
        expect(result.output).toContain('Accessibility');
        expect(result.success).toBe(true);
    });

    it('runs testability coverage for generic test tasks', async () => {
        const { result } = await runAgent('ui-tester', 'check test coverage');
        expect(result.output).toContain('Testability');
    });

    it('checks for Playwright when task includes "visual"', async () => {
        const { mock, result } = await runAgent('ui-tester', 'run visual regression tests');
        const cmds = mock.calls.map(c => c.args.command);
        expect(cmds.some(cmd => cmd.includes('playwright'))).toBe(true);
        expect(result.output).toContain('Visual');
    });

    it('returns failure when context is missing', async () => {
        const agent = AGENTS['ui-tester'];
        const result = await agent.execute('test', null);
        expect(result.success).toBe(false);
        expect(result.output).toContain('context missing');
    });

    it('returns correct result shape', async () => {
        const { result } = await runAgent('ui-tester', 'run tests');
        expect(result).toMatchObject({
            agent: 'ui-tester',
            success: expect.any(Boolean),
            output: expect.any(String)
        });
    });
});

// ══════════════════════════════════════════════
// REGEX-EXPERT
// ══════════════════════════════════════════════

describe('regex-expert agent', () => {
    it('is defined and has required fields', () => {
        expect(AGENTS['regex-expert']).toBeDefined();
        expect(AGENTS['regex-expert'].execute).toBeInstanceOf(Function);
    });

    it('tests /\\d+/ against "abc123" in-process (no bash)', async () => {
        const { mock, result } = await runAgent(
            'regex-expert',
            'test /\\d+/ against "abc123"'
        );
        // regex-expert tests patterns in-process using Node's RegExp, not bash
        expect(result.output).toContain('MATCH');
        expect(result.output).toContain('abc123');
        expect(result.agent).toBe('regex-expert');
        expect(result.success).toBe(true);
    });

    it('returns no match for non-matching string', async () => {
        const { result } = await runAgent(
            'regex-expert',
            'test /^\\d+$/ against "hello world"'
        );
        expect(result.output).toContain('no match');
    });

    it('handles invalid regex gracefully', async () => {
        const { result } = await runAgent(
            'regex-expert',
            'test /[invalid/ against "test"'
        );
        // Should either catch the error or return fallback
        expect(result.success).toBe(true);
        expect(result.output).toBeDefined();
    });

    it('explains pattern tokens when task includes "explain"', async () => {
        const { result } = await runAgent('regex-expert', 'explain /^\\d+$/');
        expect(result.output).toContain('Explanation');
        expect(result.output).toContain('\\d');
    });

    it('generates email regex when asked', async () => {
        const { result } = await runAgent('regex-expert', 'generate email regex');
        expect(result.output).toContain('email');
        expect(result.output).toContain('@');
    });

    it('generates uuid pattern when asked', async () => {
        const { result } = await runAgent('regex-expert', 'generate uuid regex');
        expect(result.output).toContain('uuid');
    });

    it('returns available patterns when asked to generate unknown type', async () => {
        const { result } = await runAgent('regex-expert', 'generate unknown regex');
        expect(result.output).toContain('Available');
    });

    it('returns failure when context is missing', async () => {
        const agent = AGENTS['regex-expert'];
        const result = await agent.execute('test', null);
        expect(result.success).toBe(false);
        expect(result.output).toContain('context missing');
    });

    it('returns correct result shape', async () => {
        const { result } = await runAgent('regex-expert', 'explain /\\w+/');
        expect(result).toMatchObject({
            agent: 'regex-expert',
            success: expect.any(Boolean),
            output: expect.any(String)
        });
    });
});

// ══════════════════════════════════════════════
// AGENTMANAGER CLASS
// ══════════════════════════════════════════════

describe('AgentManager class', () => {
    let mockHub;

    beforeEach(() => {
        mockHub = {
            log: jest.fn(),
            getService: jest.fn((name) => {
                if (name === 'tools') {
                    return {
                        execute: jest.fn(async () => ({ success: true, content: 'ok' })),
                        startTask: jest.fn(),
                        endTask: jest.fn()
                    };
                }
                if (name === 'config') return { baseDir: '/tmp/test' };
                return null;
            }),
            teamUpdate: jest.fn(),
            toolResult: jest.fn(),
            addMessage: jest.fn()
        };
    });

    it('creates an instance with all 6 built-in agents', () => {
        const mgr = new AgentManager(mockHub);
        const list = mgr.getAgentList();
        const names = list.map(a => a.name);
        expect(names).toContain('git-keeper');
        expect(names).toContain('testing-engineer');
        expect(names).toContain('code-implementer');
        expect(names).toContain('ui-expert');
        expect(names).toContain('ui-tester');
        expect(names).toContain('regex-expert');
    });

    it('getAgentList returns correct shape for each agent', () => {
        const mgr = new AgentManager(mockHub);
        const list = mgr.getAgentList();
        for (const agent of list) {
            expect(agent).toHaveProperty('name');
            expect(agent).toHaveProperty('role');
            expect(agent).toHaveProperty('status');
        }
    });

    it('assignTask queues a task and returns confirmation', async () => {
        const mgr = new AgentManager(mockHub);
        const result = await mgr.assignTask('git-keeper', 'git status');
        expect(result).toContain('✅');
        expect(result).toContain('git-keeper');
    });

    it('assignTask returns error for unknown agent', async () => {
        const mgr = new AgentManager(mockHub);
        const result = await mgr.assignTask('nonexistent', 'do something');
        expect(result).toContain('ERROR');
        expect(result).toContain('nonexistent');
    });

    it('formatAgentInfo returns info for a known agent', () => {
        const mgr = new AgentManager(mockHub);
        const info = mgr.formatAgentInfo('git-keeper');
        expect(info).toContain('git-keeper');
        expect(info).toContain('Role');
    });

    it('formatAgentInfo returns error for unknown agent', () => {
        const mgr = new AgentManager(mockHub);
        const info = mgr.formatAgentInfo('nobody');
        expect(info).toContain('ERROR');
    });

    it('processQueue executes a task and calls addMessage', async () => {
        const mgr = new AgentManager(mockHub);
        mgr.queue.push({ agent: 'git-keeper', task: 'git status', timestamp: Date.now() });
        await mgr.processQueue();
        expect(mockHub.addMessage).toHaveBeenCalled();
    });
});
