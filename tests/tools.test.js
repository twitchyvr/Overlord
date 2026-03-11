// ==================== TOOLS MODULE TESTS ====================
// Tests for the refactored tools modules

jest.setTimeout(10000);

const path = require('path');
const fs = require('fs');
const os = require('os');

// Mock hub
const mockHub = {
    log: jest.fn(),
    broadcast: jest.fn(),
    broadcastVolatile: jest.fn(),
    emitTo: jest.fn(),
    emit: jest.fn(),
    registerService: jest.fn(),
    getService: jest.fn(() => mockConfig),
    on: jest.fn(),
    status: jest.fn()
};

// Mock config
const mockConfig = {
    model: 'MiniMax-M2.5-highspeed',
    maxTokens: 66000,
    temperature: 0.7,
    baseDir: process.cwd(),
    maxAICycles: 10,
    maxQAAttempts: 3,
    approvalTimeoutMs: 0,
    maxParallelAgents: 3,
    chatMode: 'auto',
    shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'
};

describe('Tools Module Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    
    describe('Shell Executor', () => {
        const shellExecutor = require('../modules/shell-executor');
        const isWindows = process.platform === 'win32';
        
        test('runBash executes basic command', async () => {
            // Skip on Windows due to shell configuration differences
            if (isWindows) {
                expect(true).toBe(true);
                return;
            }
            const result = await shellExecutor.runBash('echo test');
            expect(result.success).toBe(true);
            expect(result.output).toContain('test');
        });
        
        test('runBash returns error for invalid command', async () => {
            // Skip on Windows
            if (isWindows) {
                expect(true).toBe(true);
                return;
            }
            const result = await shellExecutor.runBash('nonexistentcommand12345');
            expect(result.success).toBe(false);
        });
        
        test('runBash handles command with special characters', async () => {
            // Skip on Windows
            if (isWindows) {
                expect(true).toBe(true);
                return;
            }
            const result = await shellExecutor.runBash('echo "hello world"');
            expect(result.success).toBe(true);
        });
        
        test('runBash captures stderr', async () => {
            // Skip on Windows
            if (isWindows) {
                expect(true).toBe(true);
                return;
            }
            const result = await shellExecutor.runBash('echo error 1>&2');
            expect(result.error).toBeDefined();
        });
        
        test('runBash returns exit code', async () => {
            // Skip on Windows
            if (isWindows) {
                expect(true).toBe(true);
                return;
            }
            const result = await shellExecutor.runBash('exit 0');
            expect(result.code).toBe(0);
        });
        
        test('getShell returns shell based on platform', () => {
            const shell = shellExecutor.getShell();
            expect(shell).toBeDefined();
            expect(typeof shell).toBe('string');
        });
        
        test('getCWD returns current directory', () => {
            const cwd = shellExecutor.getCWD();
            expect(cwd).toBeDefined();
            expect(typeof cwd).toBe('string');
        });
        
        test('resolvePath handles absolute paths', () => {
            const resolved = shellExecutor.resolvePath('/tmp');
            expect(resolved).toContain('tmp');
        });
        
        test('resolvePath handles relative paths', () => {
            const cwd = shellExecutor.getCWD();
            const resolved = shellExecutor.resolvePath('package.json');
            expect(resolved).toContain('package.json');
        });
        
        test('isLongRunning detects npm install', () => {
            expect(shellExecutor.isLongRunning('npm install')).toBe(true);
        });
        
        test('isLongRunning detects yarn install', () => {
            expect(shellExecutor.isLongRunning('yarn install')).toBe(true);
        });
        
        test('isLongRunning returns false for quick commands', () => {
            expect(shellExecutor.isLongRunning('echo hello')).toBe(false);
        });
    });
    
    describe('File Operations', () => {
        const fileOps = require('../modules/file-operations');
        
        test('listDir returns array of entries', () => {
            const result = fileOps.listDir('.');
            expect(typeof result).toBe('string');
            expect(result).toContain('FILE');
            expect(result).toContain('DIR');
        });
        
        test('listDir handles non-existent directory', () => {
            const result = fileOps.listDir('/nonexistent/directory/12345');
            expect(result).toContain('ERROR');
        });
        
        test('readFile returns string', () => {
            const result = fileOps.readFile('package.json');
            expect(typeof result).toBe('string');
            expect(result).toContain('name');
        });
        
        test('readFile handles non-existent file', () => {
            const result = fileOps.readFile('nonexistent-file-12345.json');
            expect(result).toContain('ERROR');
        });
        
        test('readFileLines returns string', () => {
            const result = fileOps.readFileLines('package.json', 1, 5);
            expect(typeof result).toBe('string');
        });
        
        test('readFileLines handles out of range', () => {
            const result = fileOps.readFileLines('package.json', 1000, 2000);
            expect(result).toContain('ERROR');
        });
        
        test('writeFile creates new file', () => {
            const testPath = '.overlord/test-write-' + Date.now() + '.txt';
            const result = fileOps.writeFile(testPath, 'test content');
            expect(result).toContain('Written');
            // Cleanup
            try { fs.unlinkSync(testPath); } catch(e) {}
        });
        
        test('writeFile handles non-existent directory', () => {
            const result = fileOps.writeFile('.overlord/test/nested/test.txt', 'content');
            expect(result).toContain('Written');
            // Cleanup
            try { fs.unlinkSync('.overlord/test/nested/test.txt'); } catch(e) {}
            try { fs.rmdirSync('.overlord/test/nested'); } catch(e) {}
        });
        
        test('patchFile modifies file content', () => {
            const testPath = '.overlord/test-patch-' + Date.now() + '.txt';
            fileOps.writeFile(testPath, 'hello world');
            const result = fileOps.patchFile(testPath, 'world', 'there');
            expect(result).toContain('Patched');
            // Cleanup
            try { fs.unlinkSync(testPath); } catch(e) {}
        });
        
        test('patchFile handles search string not found', () => {
            const testPath = '.overlord/test-patch2-' + Date.now() + '.txt';
            fileOps.writeFile(testPath, 'hello world');
            const result = fileOps.patchFile(testPath, 'nonexistent', 'replacement');
            expect(result).toContain('ERROR');
            // Cleanup
            try { fs.unlinkSync(testPath); } catch(e) {}
        });
        
        test('appendFile adds content to file', () => {
            const testPath = '.overlord/test-append-' + Date.now() + '.txt';
            fileOps.writeFile(testPath, 'line1');
            const result = fileOps.appendFile(testPath, '\nline2');
            expect(result).toContain('Appended');
            // Cleanup
            try { fs.unlinkSync(testPath); } catch(e) {}
        });
        
        test('sanitizeFilename removes invalid characters', () => {
            const result = fileOps.sanitizeFilename('test<file>name.txt');
            expect(result).not.toContain('<');
            expect(result).not.toContain('>');
        });
        
        test('sanitizeFileContent removes null bytes', () => {
            const result = fileOps.sanitizeFileContent('test\x00content');
            expect(result).not.toContain('\x00');
        });
        
        test('resolvePath returns absolute path', () => {
            const result = fileOps.resolvePath('package.json');
            expect(path.isAbsolute(result)).toBe(true);
        });
    });
    
    describe('Web Fetch', () => {
        const webFetch = require('../modules/web-fetch');
        
        test('stripTags removes HTML tags', () => {
            const result = webFetch.stripTags('<p>Hello</p> <b>World</b>');
            expect(result).toBe('Hello World');
        });
        
        test('decodeEntities decodes HTML entities', () => {
            const result = webFetch.decodeEntities('&lt;div&gt;');
            expect(result).toBe('<div>');
        });
        
        test('decodeEntities decodes &amp;', () => {
            const result = webFetch.decodeEntities('foo &amp; bar');
            expect(result).toBe('foo & bar');
        });
        
        test('inlineToMarkdown converts headers', () => {
            const result = webFetch.inlineToMarkdown('<h1>Title</h1>');
            expect(result).toContain('# Title');
        });
        
        test('inlineToMarkdown converts links', () => {
            const result = webFetch.inlineToMarkdown('<a href="http://example.com">Link</a>');
            expect(result).toContain('[Link](http://example.com)');
        });
        
        test('inlineToMarkdown converts bold', () => {
            const result = webFetch.inlineToMarkdown('<strong>bold</strong>');
            expect(result).toContain('**bold**');
        });
        
        test('extractTextFromHtml returns formatted text', () => {
            const html = '<html><body><p>Hello</p></body></html>';
            const result = webFetch.extractTextFromHtml(html, 'http://test.com');
            expect(result).toContain('Hello');
            expect(result).toContain('http://test.com');
        });
        
        test('fetchWebpage rejects non-HTTPS', async () => {
            const result = await webFetch.fetchWebpage('http://example.com');
            expect(result.success).toBe(false);
            expect(result.error).toContain('HTTPS');
        });
    });
    
    describe('System Tools', () => {
        const systemTools = require('../modules/system-tools');
        
        test('systemInfo returns object with OS info', async () => {
            const result = await systemTools.systemInfo();
            expect(result).toHaveProperty('platform');
            expect(result).toHaveProperty('arch');
            expect(result).toHaveProperty('nodeVersion');
            expect(result).toHaveProperty('workingDir');
        });
        
        test('systemInfo includes platform', async () => {
            const result = await systemTools.systemInfo();
            expect([process.platform]).toContain(result.platform);
        });
        
        test('getWorkingDir returns string', () => {
            const result = systemTools.getWorkingDir();
            expect(typeof result).toBe('string');
            expect(result.length).toBeGreaterThan(0);
        });
        
        test('setWorkingDir updates working directory', () => {
            const original = systemTools.getWorkingDir();
            const result = systemTools.setWorkingDir(process.cwd());
            expect(result.success).toBe(true);
        });
        
        test('setWorkingDir rejects non-existent directory', () => {
            const result = systemTools.setWorkingDir('/nonexistent/directory/12345');
            expect(result.success).toBe(false);
        });
        
        test('setThinkingLevel accepts valid level', () => {
            const result = systemTools.setThinkingLevel(3);
            expect(result.success).toBe(true);
            expect(result.level).toBe(3);
        });
        
        test('setThinkingLevel clamps invalid level', () => {
            const result = systemTools.setThinkingLevel(10);
            expect(result.success).toBe(true);
            expect(result.level).toBe(5);
        });
        
        test('setThinkingLevel handles negative level', () => {
            const result = systemTools.setThinkingLevel(-1);
            expect(result.success).toBe(true);
            expect(result.level).toBe(1);
        });
        
        test('truncateResult handles short strings', () => {
            const result = systemTools.truncateResult('short');
            expect(result).toBe('short');
        });
        
        test('truncateResult truncates long strings', () => {
            const long = 'a'.repeat(50000);
            const result = systemTools.truncateResult(long);
            expect(result.length).toBeLessThan(35000);
            expect(result).toContain('truncated');
        });
        
        test('kvSet stores value', () => {
            const result = systemTools.kvSet('test-key-' + Date.now(), 'test value');
            expect(result.success).toBe(true);
        });
        
        test('kvGet retrieves value', () => {
            const key = 'test-get-' + Date.now();
            systemTools.kvSet(key, 'test value');
            const result = systemTools.kvGet(key);
            expect(result.success).toBe(true);
            expect(result.value).toBe('test value');
        });
        
        test('kvGet returns error for non-existent key', () => {
            const result = systemTools.kvGet('nonexistent-key-12345');
            expect(result.success).toBe(false);
        });
        
        test('kvList returns array', () => {
            const result = systemTools.kvList();
            expect(result.success).toBe(true);
            expect(Array.isArray(result.keys)).toBe(true);
        });
        
        test('kvDelete removes key', () => {
            const key = 'test-delete-' + Date.now();
            systemTools.kvSet(key, 'value');
            const result = systemTools.kvDelete(key);
            expect(result.success).toBe(true);
            expect(result.deleted).toBe(1);
        });
        
        test('uiAction validates action', () => {
            const result = systemTools.uiAction({ action: 'invalid_action' });
            expect(result.success).toBe(false);
        });
        
        test('showChart validates type', () => {
            const result = systemTools.showChart({ type: 'invalid' });
            expect(result.success).toBe(false);
        });
        
        test('showChart creates chart with valid data', () => {
            const result = systemTools.showChart({
                type: 'bar',
                labels: ['A', 'B'],
                values: [1, 2]
            });
            expect(result.success).toBe(true);
        });
        
        test('socketPush requires agent_ prefix', () => {
            const result = systemTools.socketPush('invalid_event', {});
            expect(result.success).toBe(false);
        });
        
        test('socketPush accepts agent_ prefix', () => {
            const result = systemTools.socketPush('agent_test_event', { data: 'test' });
            expect(result.success).toBe(true);
        });
    });
    
    describe('QA Tools', () => {
        const qaTools = require('../modules/qa-tools');
        
        test('runTests returns object', async () => {
            const result = await qaTools.runTests('all');
            expect(result).toHaveProperty('success');
            expect(result).toHaveProperty('output');
        });
        
        test('runTests validates type', async () => {
            const result = await qaTools.runTests('invalid_type');
            expect(result.success).toBe(false);
        });
        
        test('runTests accepts unit type', async () => {
            const result = await qaTools.runTests('unit');
            expect(result).toHaveProperty('type', 'unit');
        });
        
        test('checkLint returns object', async () => {
            const result = await qaTools.checkLint();
            expect(result).toHaveProperty('success');
            expect(result).toHaveProperty('output');
        });
        
        test('checkLint accepts path parameter', async () => {
            const result = await qaTools.checkLint('package.json');
            expect(result).toHaveProperty('output');
        });
        
        test('checkTypes returns object', async () => {
            const result = await qaTools.checkTypes();
            expect(result).toHaveProperty('success');
            expect(result).toHaveProperty('output');
        });
        
        test('checkCoverage returns object', async () => {
            const result = await qaTools.checkCoverage();
            expect(result).toHaveProperty('success');
        });
        
        test('checkCoverage accepts threshold', async () => {
            const result = await qaTools.checkCoverage(80);
            expect(result.threshold).toBe(80);
        });
        
        test('auditDeps returns object', async () => {
            const result = await qaTools.auditDeps();
            expect(result).toHaveProperty('success');
            expect(result).toHaveProperty('output');
        });
    });
    
    describe('Integration', () => {
        const shellExecutor = require('../modules/shell-executor');
        const fileOps = require('../modules/file-operations');
        
        test('shell and file operations work together', async () => {
            const isWindows = process.platform === 'win32';
            
            if (isWindows) {
                // On Windows, just test fileOps directly
                const testFile = '.overlord/integration-test-' + Date.now() + '.txt';
                const result = fileOps.writeFile(testFile, 'integration test');
                expect(result).toContain('Written');
                try { fs.unlinkSync(testFile); } catch(e) {}
                return;
            }
            
            // Create file with shell
            const testFile = '.overlord/integration-test-' + Date.now() + '.txt';
            await shellExecutor.runBash('echo "integration test" > ' + testFile);
            
            // Read with fileOps
            const content = fileOps.readFile(testFile);
            expect(content).toContain('integration test');
            
            // Cleanup
            try { fs.unlinkSync(testFile); } catch(e) {}
        });
    });
});
