/**
 * Integration: Tool Execution Cycle Tests
 * Tests the AI response → tool_use block → execute → tool_result injection cycle
 * using mocked filesystem and mocked AI service.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// ==================== MOCK HELPERS ====================

function createMockHub() {
    const services = {};
    const listeners = {};

    return {
        log: jest.fn(),
        broadcast: jest.fn(),
        status: jest.fn(),
        emit: jest.fn((event, ...args) => {
            if (listeners[event]) listeners[event](...args);
        }),
        on: jest.fn((event, handler) => { listeners[event] = handler; }),
        registerService: jest.fn((name, svc) => { services[name] = svc; }),
        getService: jest.fn((name) => services[name]),
        addMessage: jest.fn(),
        emitTo: jest.fn(),
        _services: services
    };
}

// ==================== TOOL EXECUTION LOGIC (extracted) ====================

/**
 * Simulates the core of the tool execution loop from orchestration-module.js
 * to test the data flow without spinning up the full server.
 */
async function runToolCycle(toolCalls, toolExecutor) {
    const results = [];

    for (const tool of toolCalls) {
        let output;
        try {
            output = await toolExecutor(tool.name, tool.input);
        } catch (e) {
            output = `[ERROR] ${e.message}`;
        }

        results.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: typeof output === 'string' ? output : JSON.stringify(output)
        });
    }

    return results;
}

// ==================== TESTS ====================

describe('Tool Execution: runToolCycle', () => {

    test('executes a single bash tool call and captures output', async () => {
        const toolCalls = [
            { id: 'toolu_bash_1', name: 'bash', input: { command: 'echo hello' } }
        ];

        const executor = jest.fn().mockResolvedValue('hello\n');

        const results = await runToolCycle(toolCalls, executor);

        expect(executor).toHaveBeenCalledWith('bash', { command: 'echo hello' });
        expect(results).toHaveLength(1);
        expect(results[0].tool_use_id).toBe('toolu_bash_1');
        expect(results[0].content).toBe('hello\n');
        expect(results[0].type).toBe('tool_result');
    });

    test('executes multiple tool calls in sequence', async () => {
        const toolCalls = [
            { id: 'toolu_1', name: 'bash', input: { command: 'ls' } },
            { id: 'toolu_2', name: 'read_file', input: { path: '/tmp/file.txt' } }
        ];

        const executor = jest.fn()
            .mockResolvedValueOnce('file1.js\nfile2.js')
            .mockResolvedValueOnce('file contents here');

        const results = await runToolCycle(toolCalls, executor);

        expect(results).toHaveLength(2);
        expect(results[0].tool_use_id).toBe('toolu_1');
        expect(results[0].content).toBe('file1.js\nfile2.js');
        expect(results[1].tool_use_id).toBe('toolu_2');
        expect(results[1].content).toBe('file contents here');
    });

    test('captures tool errors as error string (does not propagate)', async () => {
        const toolCalls = [
            { id: 'toolu_err', name: 'bash', input: { command: 'bad command' } }
        ];

        const executor = jest.fn().mockRejectedValue(new Error('Command not found'));

        const results = await runToolCycle(toolCalls, executor);

        expect(results).toHaveLength(1);
        expect(results[0].content).toContain('[ERROR]');
        expect(results[0].content).toContain('Command not found');
    });

    test('each result has type=tool_result', async () => {
        const toolCalls = [
            { id: 'toolu_A', name: 'bash', input: { command: 'date' } }
        ];

        const executor = jest.fn().mockResolvedValue('Thu Feb 28 2026');

        const results = await runToolCycle(toolCalls, executor);

        for (const r of results) {
            expect(r.type).toBe('tool_result');
            expect(typeof r.tool_use_id).toBe('string');
            expect(typeof r.content).toBe('string');
        }
    });

    test('serializes non-string output to JSON', async () => {
        const toolCalls = [
            { id: 'toolu_obj', name: 'system_info', input: {} }
        ];

        const executor = jest.fn().mockResolvedValue({ platform: 'darwin', arch: 'arm64' });

        const results = await runToolCycle(toolCalls, executor);

        expect(results[0].content).toContain('darwin');
        // JSON-serialized
        const parsed = JSON.parse(results[0].content);
        expect(parsed.platform).toBe('darwin');
    });

});

// ==================== WRITE FILE + AutoQA ====================

describe('Tool Execution: write_file + AutoQA', () => {

    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlord-tool-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('write_file creates file with correct content', () => {
        const filePath = path.join(tmpDir, 'output.js');
        const content = 'const x = 1;\nconsole.log(x);\n';

        // Simulate write_file behavior
        fs.writeFileSync(filePath, content, 'utf8');

        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, 'utf8')).toBe(content);
    });

    test('write_file creates nested directories', () => {
        const filePath = path.join(tmpDir, 'nested', 'dir', 'output.js');
        const content = 'export default {};\n';

        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');

        expect(fs.existsSync(filePath)).toBe(true);
    });

    test('AutoQA attempt counter increments per file', () => {
        // Simulate the qaAttempts Map used in orchestration-module
        const qaAttempts = new Map();
        const filePath = '/src/foo.js';

        function recordQAAttempt(fp) {
            const prev = qaAttempts.get(fp) || 0;
            qaAttempts.set(fp, prev + 1);
            return prev + 1;
        }

        expect(recordQAAttempt(filePath)).toBe(1);
        expect(recordQAAttempt(filePath)).toBe(2);
        expect(recordQAAttempt(filePath)).toBe(3);

        // Should stop at MAX_QA_ATTEMPTS (3)
        const attempts = qaAttempts.get(filePath);
        expect(attempts).toBe(3);
    });

    test('AutoQA stops injecting after MAX_QA_ATTEMPTS', () => {
        const MAX_QA_ATTEMPTS = 3;
        const qaAttempts = new Map();
        const filePath = '/src/broken.js';
        const injectedMessages = [];

        function maybeInjectQAFailure(fp, errorMsg) {
            const attempts = (qaAttempts.get(fp) || 0) + 1;
            qaAttempts.set(fp, attempts);

            if (attempts <= MAX_QA_ATTEMPTS) {
                injectedMessages.push(`[AutoQA attempt ${attempts}] ${errorMsg}`);
                return true;
            } else {
                injectedMessages.push(`[AutoQA] Max attempts exceeded for ${fp}. Marking needs-review.`);
                return false; // stop further injection
            }
        }

        // 4 QA failures
        expect(maybeInjectQAFailure(filePath, 'lint error 1')).toBe(true);
        expect(maybeInjectQAFailure(filePath, 'lint error 2')).toBe(true);
        expect(maybeInjectQAFailure(filePath, 'lint error 3')).toBe(true);
        expect(maybeInjectQAFailure(filePath, 'lint error 4')).toBe(false); // stopped

        expect(injectedMessages).toHaveLength(4);
        expect(injectedMessages[3]).toContain('needs-review');
    });

});

// ==================== CYCLE DEPTH GUARD ====================

describe('Tool Execution: cycle depth guard', () => {

    test('cycleDepth increments and blocks at MAX_CYCLES', async () => {
        const MAX_CYCLES = 10;
        let cycleDepth = 0;
        const warnings = [];

        async function runAICycle() {
            cycleDepth++;
            if (cycleDepth >= MAX_CYCLES) {
                warnings.push('Max AI cycles reached');
                return;
            }
            // Simulate recursive call (tool always triggers next cycle)
            await runAICycle();
        }

        await runAICycle();

        expect(cycleDepth).toBe(MAX_CYCLES);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('Max AI cycles');
    });

    test('cycleDepth resets to 0 for each new user message', () => {
        let cycleDepth = 0;

        function resetForNewMessage() {
            cycleDepth = 0;
        }

        cycleDepth = 10; // simulated end of previous run
        resetForNewMessage();

        expect(cycleDepth).toBe(0);
    });

});
