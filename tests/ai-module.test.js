// ==================== AI MODULE TESTS ====================
// Tests for the refactored AI modules

jest.setTimeout(10000);

// Mock hub
const mockHub = {
    log: jest.fn(),
    broadcast: jest.fn(),
    broadcastVolatile: jest.fn(),
    emitTo: jest.fn(),
    emit: jest.fn(),
    registerService: jest.fn(),
    getService: jest.fn((name) => {
        if (name === 'config') return mockConfig;
        if (name === 'conversation') return mockConversation;
        if (name === 'tools') return mockTools;
        return null;
    }),
    on: jest.fn(),
    status: jest.fn()
};

// Mock config
const mockConfig = {
    model: 'MiniMax-M2.5-highspeed',
    maxTokens: 66000,
    temperature: 0.7,
    baseUrl: 'https://api.minimax.chat',
    apiKey: 'test-key',
    maxAICycles: 10,
    thinkingEnabled: false,
    thinkingBudget: 2048,
    requestTimeoutMs: 300000
};

// Mock conversation
const mockConversation = {
    getMessages: jest.fn(() => []),
    getWorkingDirectory: jest.fn(() => '/test/dir'),
    getContextUsage: jest.fn(() => ({ estimatedTokens: 1000, maxTokens: 100000, usagePercent: 1 }))
};

// Mock tools
const mockTools = {
    getDefinitions: jest.fn(() => [
        { name: 'read_file', category: 'files', description: 'Read a file', input_schema: { properties: { path: { type: 'string' } } } },
        { name: 'write_file', category: 'files', description: 'Write a file', input_schema: { properties: { path: { type: 'string' }, content: { type: 'string' } } } },
        { name: 'list_dir', category: 'files', description: 'List directory', input_schema: { properties: {} } }
    ])
};

describe('AI Module', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        
        mockHub.getService.mockImplementation((name) => {
            if (name === 'config') return mockConfig;
            if (name === 'conversation') return mockConversation;
            if (name === 'tools') return mockTools;
            return null;
        });
    });
    
    describe('ai-client', () => {
        const aiClient = require('../modules/ai-client');
        
        test('sanitizes unicode for JSON parsing', () => {
            const result = aiClient.sanitizeForJSON('Hello world');
            expect(result).toBeDefined();
            expect(typeof result).toBe('string');
        });
        
        test('sanitizes control characters', () => {
            const result = aiClient.sanitizeForJSON('Test characters');
            expect(result).toBeDefined();
        });
        
        test('safeJSONParse handles valid JSON', () => {
            const result = aiClient.safeJSONParse('{"key": "value"}');
            expect(result.success).toBe(true);
            expect(result.data.key).toBe('value');
        });
        
        test('safeJSONParse handles invalid JSON', () => {
            const result = aiClient.safeJSONParse('invalid json');
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });
        
        test('safeJSONParse handles unicode issues', () => {
            const result = aiClient.safeJSONParse('{"text": "hello"}');
            expect(result.success).toBe(true);
        });
        
        test('safeJSONParse returns error for non-string input', () => {
            const result = aiClient.safeJSONParse({ not: 'a string' });
            expect(result.success).toBe(false);
        });
        
        test('_effectiveModel returns default model', () => {
            const result = aiClient._effectiveModel(null);
            expect(result).toBe('MiniMax-M2.5-highspeed');
        });
        
        test('_effectiveModel uses config model', () => {
            const result = aiClient._effectiveModel({ model: 'custom-model' });
            expect(result).toBe('custom-model');
        });
        
        test('_effectiveModel switches to pmModel in pm mode', () => {
            const cfg = { model: 'base-model', autoModelSwitch: true, chatMode: 'pm', pmModel: 'pm-model' };
            const result = aiClient._effectiveModel(cfg);
            expect(result).toBe('pm-model');
        });
        
        test('_effectiveModel ignores pmModel in auto mode', () => {
            const cfg = { model: 'base-model', autoModelSwitch: true, chatMode: 'auto', pmModel: 'pm-model' };
            const result = aiClient._effectiveModel(cfg);
            expect(result).toBe('base-model');
        });
        
        test('handles API errors gracefully - null input', () => {
            const result = aiClient.safeJSONParse(null);
            expect(result.success).toBe(false);
        });
        
        test('handles API errors gracefully - undefined input', () => {
            const result = aiClient.safeJSONParse(undefined);
            expect(result.success).toBe(false);
        });
    });
    
    describe('chat-stream', () => {
        const chatStream = require('../modules/chat-stream');
        
        test('parseDelta returns null for invalid event', () => {
            const result = chatStream.parseDelta(null);
            expect(result).toBeNull();
        });
        
        test('parseDelta handles message_start event', () => {
            const event = { type: 'message_start', message: { id: 'msg1', role: 'assistant' } };
            const result = chatStream.parseDelta(event);
            expect(result).toBeDefined();
            expect(result.type).toBe('message_start');
            expect(result.message.id).toBe('msg1');
        });
        
        test('parseDelta handles content_block_start', () => {
            const event = { type: 'content_block_start', content_block: { type: 'text', index: 0 } };
            const result = chatStream.parseDelta(event);
            expect(result).toBeDefined();
            expect(result.type).toBe('content_block_start');
            expect(result.contentBlock.type).toBe('text');
        });
        
        test('parseDelta parses text_delta events', () => {
            const event = { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
            const result = chatStream.parseDelta(event);
            expect(result).toBeDefined();
            expect(result.type).toBe('content_block_delta');
            expect(result.text).toBe('Hello');
        });
        
        test('parseDelta parses input_json_delta events', () => {
            const event = { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"path":' } };
            const result = chatStream.parseDelta(event);
            expect(result).toBeDefined();
            expect(result.json).toBe('{"path":');
        });
        
        test('parseDelta handles content_block_stop', () => {
            const event = { type: 'content_block_stop' };
            const result = chatStream.parseDelta(event);
            expect(result).toBeDefined();
            expect(result.type).toBe('content_block_stop');
        });
        
        test('parseDelta handles message_delta', () => {
            const event = { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 100 } };
            const result = chatStream.parseDelta(event);
            expect(result).toBeDefined();
            expect(result.type).toBe('message_delta');
            expect(result.delta.stop_reason).toBe('end_turn');
        });
        
        test('parseDelta handles message_stop', () => {
            const event = { type: 'message_stop' };
            const result = chatStream.parseDelta(event);
            expect(result).toBeDefined();
            expect(result.type).toBe('message_stop');
        });
        
        test('parseDelta handles error events', () => {
            const event = { type: 'error', error: { type: 'invalid_request', message: 'Bad request' } };
            const result = chatStream.parseDelta(event);
            expect(result).toBeDefined();
            expect(result.type).toBe('error');
            expect(result.error.message).toBe('Bad request');
        });
        
        test('formatDuration formats milliseconds', () => {
            expect(chatStream.formatDuration(500)).toBe('500ms');
        });
        
        test('formatDuration formats seconds', () => {
            expect(chatStream.formatDuration(5500)).toBe('5.5s');
        });
        
        test('formatDuration formats minutes', () => {
            expect(chatStream.formatDuration(125000)).toBe('2m 5s');
        });
    });
    
    describe('message-builder', () => {
        const messageBuilder = require('../modules/message-builder');
        
        // Initialize module with hub
        messageBuilder.init(mockHub, mockConfig);
        
        test('buildUserMessage creates correct format', () => {
            const result = messageBuilder.buildUserMessage('Hello world');
            expect(result).toBeDefined();
            expect(result.role).toBe('user');
            expect(result.content).toBe('Hello world');
        });
        
        test('buildUserMessage handles different content types', () => {
            const result = messageBuilder.buildUserMessage({ complex: 'object' });
            expect(result.role).toBe('user');
            expect(result.content).toEqual({ complex: 'object' });
        });
        
        test('buildAssistantMessage creates correct format', () => {
            const result = messageBuilder.buildAssistantMessage('Response text');
            expect(result).toBeDefined();
            expect(result.role).toBe('assistant');
            expect(result.content).toBe('Response text');
        });
        
        test('buildAssistantMessage includes tool calls', () => {
            const toolCalls = [{ id: '1', function: { name: 'test' } }];
            const result = messageBuilder.buildAssistantMessage('Using tool', toolCalls);
            expect(result.tool_calls).toEqual(toolCalls);
        });
        
        test('buildToolBlock formats tool use', () => {
            const result = messageBuilder.buildToolBlock('read_file', 'tool_123', { path: 'test.js' });
            expect(result).toBeDefined();
            expect(result.type).toBe('tool_use');
            expect(result.name).toBe('read_file');
            expect(result.id).toBe('tool_123');
        });
        
        test('buildToolResultBlock formats results', () => {
            const result = messageBuilder.buildToolResultBlock('tool_123', 'File content');
            expect(result).toBeDefined();
            expect(result.type).toBe('tool_result');
            expect(result.tool_use_id).toBe('tool_123');
            expect(result.content).toBe('File content');
        });
    });
    
    describe('tool-parser', () => {
        const toolParser = require('../modules/tool-parser');
        
        test('extractToolDefinitions returns string with tool names', () => {
            const toolDefs = [{ name: 'test', description: 'A test tool', input_schema: { properties: {} } }];
            const result = toolParser.extractToolDefinitions(toolDefs);
            expect(result).toBeDefined();
            expect(typeof result).toBe('string');
            expect(result).toContain('test');
        });
        
        test('extractToolDefinitions handles empty array', () => {
            const result = toolParser.extractToolDefinitions([]);
            expect(result).toBeDefined();
            expect(result).toContain('AVAILABLE TOOLS');
        });
        
        test('extractToolDefinitions handles null input', () => {
            const result = toolParser.extractToolDefinitions(null);
            expect(result).toBe('');
        });
        
        test('parseToolCalls extracts from response object', () => {
            const response = { tool_calls: [{ id: '1', function: { name: 'read_file', arguments: '{}' } }] };
            const result = toolParser.parseToolCalls(response);
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(1);
            expect(result[0].function.name).toBe('read_file');
        });
        
        test('parseToolCalls returns empty array for no tool calls', () => {
            const response = { content: 'Hello world' };
            const result = toolParser.parseToolCalls(response);
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(0);
        });
        
        test('parseToolCalls handles array format', () => {
            const toolCalls = [{ id: '1', function: { name: 'test', arguments: '{}' } }];
            const result = toolParser.parseToolCalls(toolCalls);
            expect(Array.isArray(result)).toBe(true);
        });
        
        test('normalizeToolCall handles function format', () => {
            const tc = { id: '1', function: { name: 'test', arguments: '{}' } };
            const result = toolParser.normalizeToolCall(tc);
            expect(result.function.name).toBe('test');
        });
        
        test('mapToolResults adds to history', () => {
            const messages = [{ role: 'user', content: 'Use a tool' }];
            const toolResults = [{ tool_call_id: '1', content: 'Tool result' }];
            const result = toolParser.mapToolResults(toolResults, messages);
            expect(result.length).toBe(1);
        });
        
        test('formatToolResult handles string input', () => {
            const result = toolParser.formatToolResult('Simple string');
            expect(result).toBe('Simple string');
        });
        
        test('formatToolResult handles error object', () => {
            const result = toolParser.formatToolResult({ error: 'Something went wrong' });
            expect(result).toBe('Error: Something went wrong');
        });
        
        test('formatToolResult handles object with content', () => {
            const result = toolParser.formatToolResult({ content: 'Result content' });
            expect(result).toBe('Result content');
        });
    });
});
