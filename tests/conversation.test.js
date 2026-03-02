/**
 * Conversation Module Tests
 * Tests for conversation loading, sanitization, and history management
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock hub for testing
const createMockHub = () => ({
    log: jest.fn(),
    broadcast: jest.fn(),
    emitTo: jest.fn(),
    registerService: jest.fn(),
    getService: jest.fn(),
    status: jest.fn(),
    teamUpdate: jest.fn(),
    toolResult: jest.fn()
});

// Mock config
const createMockConfig = (baseDir) => ({
    baseDir: baseDir || '/tmp/test-overlord',
    model: 'MiniMax-M2.5',
    apiKey: 'test-key',
    maxTokens: 66000
});

describe('Conversation Module', () => {
    let tmpDir;
    let mockHub;
    let mockConfig;
    
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlord-conv-test-'));
        mockHub = createMockHub();
        mockConfig = createMockConfig(tmpDir);
        
        // Ensure .overlord/conversations directory exists
        const convDir = path.join(tmpDir, '.overlord', 'conversations');
        fs.mkdirSync(convDir, { recursive: true });
    });
    
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    
    describe('sanitizeHistory (conversation module)', () => {
        // This is the simplified sanitize in conversation-module.js
        function sanitizeHistory(h) {
            if (!Array.isArray(h) || h.length === 0) return [];
            
            const clean = [];
            const msgs = [...h];
            
            for (let i = 0; i < msgs.length; i++) {
                const msg = msgs[i];
                if (msg.role !== 'assistant' || !Array.isArray(msg.content)) {
                    clean.push(msg);
                    continue;
                }
                
                const hasToolUse = msg.content.some(c => c.type === 'tool_use');
                if (!hasToolUse) {
                    clean.push(msg);
                    continue;
                }
                
                const nextMsg = msgs[i + 1];
                const hasNextResult = nextMsg && nextMsg.role === 'user' && Array.isArray(nextMsg.content) &&
                    nextMsg.content.some(c => c.type === 'tool_result');
                
                if (hasNextResult) clean.push(msg);
            }
            
            return clean;
        }
        
        test('preserves complete tool_use + tool_result pairs', () => {
            const history = [
                { role: 'user', content: 'Hello' },
                { role: 'assistant', content: [{ type: 'tool_use', id: 'tool1', name: 'bash' }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool1', content: 'result' }] }
            ];
            
            const result = sanitizeHistory(history);
            expect(result.length).toBe(3);
        });
        
        test('removes orphaned tool_use without tool_result', () => {
            const history = [
                { role: 'user', content: 'Hello' },
                { role: 'assistant', content: [{ type: 'tool_use', id: 'tool1', name: 'bash' }] }
                // Missing tool_result!
            ];
            
            const result = sanitizeHistory(history);
            expect(result.length).toBe(1); // Only user message kept
        });
        
        test('handles conversation with orphaned tool_result from compaction', () => {
            // This simulates what happens after context compaction
            // The tool_use was removed but tool_result remained
            const history = [
                { role: 'user', content: 'Hello' },
                { role: 'assistant', content: 'Some response' },
                // This orphaned tool_result references an ID that no longer exists
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_function_abx2ah2ewtjz_1', content: 'old result' }] }
            ];
            
            const result = sanitizeHistory(history);
            
            // The conversation module's sanitize is simplified and focuses on 
            // removing assistant messages that have tool_use but no following tool_result.
            // It won't catch orphaned tool_results in user messages.
            // This is why the token-manager sanitize is used as backup.
            expect(result.length).toBeGreaterThanOrEqual(2);
        });
    });
    
    describe('Integration: token-manager sanitize vs conversation sanitize', () => {
        test('token-manager sanitize catches orphaned tool_results that conversation misses', () => {
            // Load token-manager's sanitize
            const tm = require('../modules/token-manager-module');
            
            const history = [
                { role: 'user', content: 'Hello' },
                // Orphaned tool_result - tool_use was removed during compaction
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_function_abx2ah2ewtjz_1', content: 'old result' }] }
            ];
            
            const result = tm.sanitizeHistory(history);
            
            // token-manager's sanitize should remove this
            expect(result.length).toBe(1);
            expect(result[0].content).toBe('Hello');
        });
    });
    
    describe('validateHistory catches broken chains', () => {
        test('validateHistory detects orphan tool_result', () => {
            const tm = require('../modules/token-manager-module');
            
            const history = [
                { role: 'user', content: 'Hello' },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'unknown_id', content: 'result' }] }
            ];
            
            const result = tm.validateHistory(history);
            
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('unknown id'))).toBe(true);
        });
        
        test('validateHistory passes valid history', () => {
            const tm = require('../modules/token-manager-module');
            
            const history = [
                { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'bash', input: {} }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }
            ];
            
            const result = tm.validateHistory(history);
            
            expect(result.valid).toBe(true);
            expect(result.errors).toEqual([]);
        });
    });
});
