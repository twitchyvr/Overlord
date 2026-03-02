/**
 * Token Manager Module Tests
 * Tests for sanitizeHistory, truncateHistory, and validateHistory functions
 */

const path = require('path');

// Mock hub for testing
const createMockHub = () => ({
    log: jest.fn(),
    registerService: jest.fn()
});

// Load the module
const tm = require('../modules/token-manager-module');

describe('Token Manager Module', () => {
    
    describe('sanitizeHistory', () => {
        
        test('preserves complete tool_use + tool_result pairs', () => {
            const history = [
                { role: 'user', content: 'Hello' },
                { 
                    role: 'assistant', 
                    content: [{ type: 'tool_use', id: 'tool1', name: 'bash', input: { command: 'ls' } }] 
                },
                { 
                    role: 'user', 
                    content: [{ type: 'tool_result', tool_use_id: 'tool1', content: 'files' }] 
                }
            ];
            
            const result = tm.sanitizeHistory(history);
            expect(result.length).toBe(3);
            expect(result[1].content[0].id).toBe('tool1');
        });
        
        test('removes orphan tool_use without matching tool_result', () => {
            const history = [
                { 
                    role: 'assistant', 
                    content: [{ type: 'tool_use', id: 'tool1', name: 'bash', input: { command: 'ls' } }] 
                }
                // No tool_result!
            ];
            
            const result = tm.sanitizeHistory(history);
            expect(result.length).toBe(0);
        });
        
        test('removes orphan tool_result without matching tool_use', () => {
            const history = [
                { 
                    role: 'user', 
                    content: [{ type: 'tool_result', tool_use_id: 'unknown_id', content: 'result' }] 
                }
            ];
            
            const result = tm.sanitizeHistory(history);
            expect(result.length).toBe(0);
        });
        
        test('preserves multiple tool pairs in sequence', () => {
            const history = [
                { 
                    role: 'assistant', 
                    content: [
                        { type: 'tool_use', id: 't1', name: 'bash', input: { command: 'ls' } },
                        { type: 'tool_use', id: 't2', name: 'read_file', input: { path: 'file.txt' } }
                    ] 
                },
                { 
                    role: 'user', 
                    content: [
                        { type: 'tool_result', tool_use_id: 't1', content: 'files' },
                        { type: 'tool_result', tool_use_id: 't2', content: 'content' }
                    ] 
                }
            ];
            
            const result = tm.sanitizeHistory(history);
            expect(result.length).toBe(2);
        });
        
        test('handles messages without content arrays', () => {
            const history = [
                { role: 'user', content: 'Hello world' },
                { role: 'assistant', content: 'Response text' }
            ];
            
            const result = tm.sanitizeHistory(history);
            expect(result.length).toBe(2);
        });
        
        test('returns empty array for empty input', () => {
            expect(tm.sanitizeHistory([])).toEqual([]);
            expect(tm.sanitizeHistory(null)).toEqual([]);
            expect(tm.sanitizeHistory(undefined)).toEqual([]);
        });
        
        test('partial pair: tool_use present but missing tool_result removes both', () => {
            const history = [
                { role: 'user', content: 'First message' },
                { 
                    role: 'assistant', 
                    content: [{ type: 'tool_use', id: 't1', name: 'bash', input: { command: 'ls' } }] 
                },
                { role: 'user', content: 'Message after orphan tool_use' }
            ];
            
            const result = tm.sanitizeHistory(history);
            // Should only preserve the messages without broken tool chains
            expect(result.length).toBe(2);
        });
        
        // FIX VERIFICATION TEST: This is the exact scenario from the bug
        test('REMOVES orphaned tool_result referencing unknown ID (the bug fix)', () => {
            // This is the exact error: "Message 2: tool_result references unknown id call_function_abx2ah2ewtjz_1"
            const history = [
                { role: 'user', content: 'Some message' },
                { 
                    role: 'user', 
                    content: [{ type: 'tool_result', tool_use_id: 'call_function_abx2ah2ewtjz_1', content: 'result' }] 
                }
                // Note: NO matching tool_use with id "call_function_abx2ah2ewtjz_1" exists!
            ];
            
            const result = tm.sanitizeHistory(history);
            
            // The orphaned tool_result should be removed
            expect(result.length).toBe(1);
            expect(result[0].content).toBe('Some message');
        });
        
        test('handles mixed valid pairs and orphaned entries', () => {
            const history = [
                { role: 'user', content: 'Hello' },
                // Valid pair
                { role: 'assistant', content: [{ type: 'tool_use', id: 'valid1', name: 'bash', input: { command: 'ls' } }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'valid1', content: 'files' }] },
                // Orphaned tool_result (no matching tool_use)
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'orphan_id', content: 'orphan result' }] },
                { role: 'assistant', content: 'Regular response' }
            ];
            
            const result = tm.sanitizeHistory(history);
            
            // Should keep: user msg, valid pair (2 msgs), regular response
            // Should remove: orphaned tool_result
            expect(result.length).toBe(4);
            
            // Verify the valid pair is preserved
            const hasValidPair = result.some(m => 
                m.content && Array.isArray(m.content) && 
                m.content.some(c => c.type === 'tool_use' && c.id === 'valid1')
            );
            expect(hasValidPair).toBe(true);
        });
        
    });
    
    describe('truncateHistory', () => {
        
        test('preserves complete tool pairs when truncating', () => {
            // Token cost breakdown (ESTIMATE_TOKENS_MULTI=0.25, +20 overhead per message):
            //   msg[0] first-message  ~153 chars → ceil(153*0.25)+20 = 59 tokens  ← "system"
            //   msg[1] big-response   ~122 chars → ceil(122*0.25)+20 = 51 tokens  ← gets DROPPED
            //   msg[2] tool_use       input 17ch → ceil(17*0.25)+20  = 25 tokens  ← KEPT (pair)
            //   msg[3] tool_result    'result' 6c→ ceil(6*0.25)+20   = 22 tokens  ← KEPT (pair)
            //   msg[4] last-message   12 chars   → ceil(12*0.25)+20  = 23 tokens  ← KEPT (recent)
            // Total = 180 tokens.
            // maxTokens=150: system(59) + pair(47) + last(23) = 129 fits; response(51) is dropped.
            const history = [
                { role: 'user', content: 'First message with lots of text to make it larger First message with lots of text to make it larger First message with lots of text to make it larger' },
                { role: 'assistant', content: 'Response with lots of text too Response with lots of text too Response with lots of text too Response with lots of text too' },
                {
                    role: 'assistant',
                    content: [{ type: 'tool_use', id: 't1', name: 'bash', input: { command: 'ls' } }]
                },
                {
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: 't1', content: 'result' }]
                },
                { role: 'user', content: 'Last message' }
            ];

            // 150 tokens: forces truncation (total=180) but fits system+pair+last=129.
            // 100 was too small — even system alone costs 59, leaving only 41 for a 47-token pair.
            const result = tm.truncateHistory(history, 150);

            // The large response (51 tokens) is dropped; the tool pair must be preserved intact.
            const hasToolUse = result.some(m =>
                m.content && Array.isArray(m.content) &&
                m.content.some(c => c.type === 'tool_use')
            );
            const hasToolResult = result.some(m =>
                m.content && Array.isArray(m.content) &&
                m.content.some(c => c.type === 'tool_result')
            );

            expect(hasToolUse).toBe(true);
            expect(hasToolResult).toBe(true);
        });
        
        test('returns copy when under limit', () => {
            const history = [
                { role: 'user', content: 'Hi' },
                { role: 'assistant', content: 'Hello' }
            ];
            
            const result = tm.truncateHistory(history, 10000);
            expect(result.length).toBe(2);
        });
        
        test('always preserves first message (system)', () => {
            const history = [
                { role: 'system', content: 'You are a helpful assistant' },
                { role: 'user', content: 'Message 1' },
                { role: 'assistant', content: 'Response 1' },
                { role: 'user', content: 'Message 2' },
                { role: 'assistant', content: 'Response 2' }
            ];
            
            const result = tm.truncateHistory(history, 50);
            expect(result[0].role).toBe('system');
        });
        
        test('returns empty array for empty input', () => {
            expect(tm.truncateHistory([])).toEqual([]);
            expect(tm.truncateHistory(null)).toEqual([]);
        });
        
    });
    
    describe('validateHistory', () => {
        
        test('valid history passes validation', () => {
            const history = [
                { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'bash', input: {} }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }
            ];
            
            const result = tm.validateHistory(history);
            expect(result.valid).toBe(true);
            expect(result.errors).toEqual([]);
        });
        
        test('orphan tool_result fails validation', () => {
            const history = [
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't99', content: 'ok' }] }
            ];
            
            const result = tm.validateHistory(history);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('unknown id'))).toBe(true);
        });
        
        test('orphan tool_use fails validation', () => {
            const history = [
                { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'bash', input: {} }] }
            ];
            
            const result = tm.validateHistory(history);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('no matching tool_result'))).toBe(true);
        });
        
        test('tool_use without id fails validation', () => {
            const history = [
                { role: 'assistant', content: [{ type: 'tool_use', name: 'bash', input: {} }] }
            ];
            
            const result = tm.validateHistory(history);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('without id'))).toBe(true);
        });
        
        test('tool_result without tool_use_id fails validation', () => {
            const history = [
                { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] }
            ];
            
            const result = tm.validateHistory(history);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('without tool_use_id'))).toBe(true);
        });
        
        test('non-array content passes validation', () => {
            const history = [
                { role: 'user', content: 'Hello world' },
                { role: 'assistant', content: 'Response text' }
            ];
            
            const result = tm.validateHistory(history);
            expect(result.valid).toBe(true);
        });
        
    });
    
    describe('estimateTokens', () => {
        
        test('estimates tokens correctly', () => {
            // 4 chars ≈ 1 token
            expect(tm.estimateTokens('abcd')).toBe(1);
            expect(tm.estimateTokens('a')).toBe(1);
            expect(tm.estimateTokens('abcdefgh')).toBe(2);
        });
        
        test('handles empty/null input', () => {
            expect(tm.estimateTokens('')).toBe(0);
            expect(tm.estimateTokens(null)).toBe(0);
            expect(tm.estimateTokens(undefined)).toBe(0);
        });
        
    });
    
    describe('getStats', () => {
        
        test('returns correct stats structure', () => {
            const history = [
                { role: 'user', content: 'Hello' },
                { role: 'assistant', content: 'Hi there!' }
            ];
            
            const stats = tm.getStats(history);
            
            expect(stats).toHaveProperty('messages');
            expect(stats).toHaveProperty('estimatedTokens');
            expect(stats).toHaveProperty('maxTokens');
            expect(stats).toHaveProperty('usagePercent');
            expect(stats).toHaveProperty('needsTruncation');
            expect(stats.messages).toBe(2);
        });
        
        test('handles empty history', () => {
            const stats = tm.getStats([]);
            expect(stats.messages).toBe(0);
            expect(stats.estimatedTokens).toBe(0);
        });
        
    });
    
});



// Additional tests for exported functions

describe('calculateHistoryTokens', () => {
    
    test('calculates tokens for simple messages', () => {
        const history = [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there' }
        ];
        
        const tokens = tm.calculateHistoryTokens(history);
        expect(tokens).toBeGreaterThan(0);
    });
    
    test('returns 0 for empty history', () => {
        expect(tm.calculateHistoryTokens([])).toBe(0);
        expect(tm.calculateHistoryTokens(null)).toBe(0);
    });
    
    test('handles messages without content', () => {
        const history = [
            { role: 'user' }
        ];
        
        const tokens = tm.calculateHistoryTokens(history);
        expect(tokens).toBeGreaterThanOrEqual(0);
    });
    
});

describe('needsTruncation', () => {
    
    test('returns true when over limit', () => {
        // Create a history with many tokens to exceed MAX_HISTORY_TOKENS
        const longContent = 'a'.repeat(500000); // ~125000 tokens (exceeds 83800 limit)
        const history = [{ role: 'user', content: longContent }];
        
        expect(tm.needsTruncation(history)).toBe(true);
    });
    
    test('returns false when under limit', () => {
        const history = [
            { role: 'user', content: 'Hello' }
        ];
        
        expect(tm.needsTruncation(history)).toBe(false);
    });
    
});

describe('stripScreenshots', () => {
    
    test('handles empty and null input', () => {
        expect(tm.stripScreenshots([])).toEqual([]);
        expect(tm.stripScreenshots(null)).toBe(null);
    });
    
    test('preserves messages without array content', () => {
        const history = [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Regular response' }
        ];
        
        const result = tm.stripScreenshots(history);
        expect(result.length).toBe(2);
        expect(result[1].content).toBe('Regular response');
    });
    
    test('strips screenshot base64 data and keeps placeholder', () => {
        const history = [
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'img1', content: '{"base64":"abc123","success":true,"sizeKB":100}' }] }
        ];
        
        // Use keepLast=0 to force stripping
        const result = tm.stripScreenshots(history, 0);
        expect(result[0].content[0].content).toContain('[stripped');
    });
    
    test('keeps most recent screenshot when keepLast=1', () => {
        const history = [
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'img1', content: '{"base64":"old","success":true}' }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'img2', content: '{"base64":"new","success":true}' }] }
        ];
        
        const result = tm.stripScreenshots(history, 1);
        // Last one should still have base64
        expect(result[1].content[0].content).toContain('"base64":"new"');
        // First should be stripped
        expect(result[0].content[0].content).toContain('[stripped');
    });
    
    test('strips all screenshots when keepLast=0', () => {
        const history = [
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'img1', content: '{"base64":"old","success":true}' }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'img2', content: '{"base64":"new","success":true}' }] }
        ];
        
        const result = tm.stripScreenshots(history, 0);
        // All should be stripped
        expect(result[0].content[0].content).toContain('[stripped');
        expect(result[1].content[0].content).toContain('[stripped');
    });
    
});

describe('hasStrippableScreenshots', () => {
    
    test('returns true when multiple screenshots present', () => {
        const history = [
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'img1', content: '{"base64":"abc","success":true}' }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'img2', content: '{"base64":"def","success":true}' }] }
        ];
        
        expect(tm.hasStrippableScreenshots(history)).toBe(true);
    });
    
    test('returns false when only one screenshot with default keepLast=1', () => {
        const history = [
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'img1', content: '{"base64":"abc","success":true}' }] }
        ];
        
        expect(tm.hasStrippableScreenshots(history)).toBe(false);
    });
    
    test('returns true when one screenshot and keepLast=0', () => {
        const history = [
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'img1', content: '{"base64":"abc","success":true}' }] }
        ];
        
        expect(tm.hasStrippableScreenshots(history, 0)).toBe(true);
    });
    
    test('returns false when no screenshots', () => {
        const history = [
            { role: 'user', content: 'Hello world' }
        ];
        
        expect(tm.hasStrippableScreenshots(history)).toBe(false);
    });
    
    test('handles empty history', () => {
        expect(tm.hasStrippableScreenshots([])).toBe(false);
        expect(tm.hasStrippableScreenshots(null)).toBe(false);
    });
    
});