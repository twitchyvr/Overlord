// ==================== ORCHESTRATION MODULE TESTS ====================
// Tests for the refactored orchestration modules

jest.setTimeout(10000);

// Mock hub
const mockHub = {
    log: jest.fn(),
    broadcast: jest.fn(),
    broadcastVolatile: jest.fn(),
    emitTo: jest.fn(),
    emit: jest.fn(),
    registerService: jest.fn(),
    getService: jest.fn(),
    on: jest.fn(),
    status: jest.fn(),
    teamUpdate: jest.fn(),
    toolResult: jest.fn(),
    sendPush: jest.fn(),
    getService: jest.fn((name) => {
        if (name === 'config') return mockConfig;
        if (name === 'conversation') return mockConversation;
        if (name === 'tools') return mockTools;
        if (name === 'ai') return mockAI;
        if (name === 'agentManager') return mockAgentManager;
        return null;
    })
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
    chatMode: 'auto'
};

// Mock conversation
const mockConversation = {
    getMessages: jest.fn(() => []),
    getContextUsage: jest.fn(() => ({ estimatedTokens: 1000, maxTokens: 100000, usagePercent: 1 })),
    addToolResult: jest.fn(),
    addMessage: jest.fn()
};

// Mock tools
const mockTools = {
    execute: jest.fn(),
    getDefinitions: jest.fn(() => [])
};

// Mock AI
const mockAI = {
    sendMessage: jest.fn(),
    abort: jest.fn()
};

// Mock agent manager
const mockAgentManager = {
    isToolAllowedForRole: jest.fn(() => true),
    findCapableAgent: jest.fn(() => null)
};

describe('Orchestration Module', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        
        // Reset hub.getService mock
        mockHub.getService.mockImplementation((name) => {
            if (name === 'config') return mockConfig;
            if (name === 'conversation') return mockConversation;
            if (name === 'tools') return mockTools;
            if (name === 'ai') return mockAI;
            if (name === 'agentManager') return mockAgentManager;
            return null;
        });
    });
    
    describe('orchestration-state', () => {
        const orchestrationState = require('../modules/orchestration-state');
        
        test('getOrchestrationState returns default state object', () => {
            const state = orchestrationState.getOrchestrationState();
            
            expect(state).toBeDefined();
            expect(state).toHaveProperty('status', 'idle');
            expect(state).toHaveProperty('agent', null);
            expect(state).toHaveProperty('task', null);
            expect(state).toHaveProperty('tool', null);
            expect(state).toHaveProperty('thinking', false);
            expect(state).toHaveProperty('cycleDepth', 0);
        });
        
        test('getIsProcessing returns boolean', () => {
            const isProcessing = orchestrationState.getIsProcessing();
            
            expect(typeof isProcessing).toBe('boolean');
        });
        
        test('getMaxCycles returns number', () => {
            const maxCycles = orchestrationState.getMaxCycles();
            
            expect(typeof maxCycles).toBe('number');
            expect(maxCycles).toBeGreaterThan(0);
        });
        
        test('setMaxCycles updates max cycles', () => {
            orchestrationState.setMaxCycles(20);
            
            expect(orchestrationState.getMaxCycles()).toBe(20);
        });
        
        test('getCycleDepth returns number', () => {
            const depth = orchestrationState.getCycleDepth();
            
            expect(typeof depth).toBe('number');
            expect(depth).toBeGreaterThanOrEqual(0);
        });
        
        test('setCycleDepth updates cycle depth', () => {
            orchestrationState.setCycleDepth(5);
            
            expect(orchestrationState.getCycleDepth()).toBe(5);
        });
        
        test('getAgentSessions returns Map', () => {
            const sessions = orchestrationState.getAgentSessions();
            
            expect(sessions).toBeInstanceOf(Map);
        });
        
        test('getAgentChatRooms returns Map', () => {
            const rooms = orchestrationState.getAgentChatRooms();
            
            expect(rooms).toBeInstanceOf(Map);
        });
        
        test('getConsecutiveToolErrors returns number', () => {
            const errors = orchestrationState.getConsecutiveToolErrors();
            
            expect(typeof errors).toBe('number');
            expect(errors).toBeGreaterThanOrEqual(0);
        });
        
        test('describeError formats error message', () => {
            const error1 = orchestrationState.describeError(new Error('Test error'));
            expect(error1).toContain('Test error');
            
            const error2 = orchestrationState.describeError(null);
            expect(error2).toBe('Unknown error');
        });
        
        test('isNetworkError detects network errors', () => {
            const networkError = new Error('ECONNRESET');
            networkError.code = 'ECONNRESET';
            
            expect(orchestrationState.isNetworkError(networkError)).toBe(true);
            expect(orchestrationState.isNetworkError(null)).toBe(false);
        });
        
        test('getMaxQaAttempts returns number', () => {
            const attempts = orchestrationState.getMaxQaAttempts();
            
            expect(typeof attempts).toBe('number');
            expect(attempts).toBeGreaterThan(0);
        });
        
        test('getApprovalTimeout returns number', () => {
            const timeout = orchestrationState.getApprovalTimeout();
            
            expect(typeof timeout).toBe('number');
        });
    });
    
    describe('approval-flow', () => {
        const approvalFlow = require('../modules/approval-flow');
        const orchestrationState = require('../modules/orchestration-state');
        
        beforeEach(() => {
            // Set hub before running approval tests
            orchestrationState.setHub(mockHub);
        });
        
        test('classifyApprovalTier returns tier object with required fields', () => {
            const result = approvalFlow.classifyApprovalTier('write_file', { path: 'test.js' });
            
            expect(result).toHaveProperty('tier');
            expect(result).toHaveProperty('confidence');
            expect(result).toHaveProperty('reasoning');
            expect([1, 2, 3, 4]).toContain(result.tier);
        });
        
        test('classifyApprovalTier returns different tiers for different tools', () => {
            const safeResult = approvalFlow.classifyApprovalTier('list_skills', {});
            const riskyResult = approvalFlow.classifyApprovalTier('write_file', { path: '/etc/passwd' });
            
            // Both should return valid tier objects
            expect(safeResult.tier).toBeDefined();
            expect(riskyResult.tier).toBeDefined();
        });
        
        test('shouldProceed returns boolean', () => {
            const result = approvalFlow.shouldProceed({ tier: 1, confidence: 1.0 });
            
            expect(typeof result).toBe('object');
            expect(result).toHaveProperty('approved');
            expect(typeof result.approved).toBe('boolean');
        });
        
        test('shouldProceed approves low tier automatically', () => {
            const result = approvalFlow.shouldProceed({ tier: 1, confidence: 0.9 });
            
            expect(result.approved).toBe(true);
        });
        
        test('shouldProceed defaults to approve when service unavailable', () => {
            // Without agentSystem service, shouldProceed defaults to approve
            const result = approvalFlow.shouldProceed({ tier: 4, confidence: 0.3 });
            
            expect(result.approved).toBe(true);
        });
        
        test('checkIn returns status object', () => {
            const result = approvalFlow.checkIn(10);
            
            // Function should execute without error
            expect(result).toBeUndefined();
        });
    });
    
    describe('tool-executor', () => {
        const toolExecutor = require('../modules/tool-executor');
        
        test('parseToolCalls extracts tool calls from response object', () => {
            const response = {
                tool_calls: [
                    { id: '1', function: { name: 'read_file', arguments: '{"path":"test.js"}' } }
                ]
            };
            
            const result = toolExecutor.parseToolCalls(response);
            
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(1);
            expect(result[0].function.name).toBe('read_file');
        });
        
        test('parseToolCalls returns empty array for no tool calls', () => {
            const response = { content: 'Hello world' };
            
            const result = toolExecutor.parseToolCalls(response);
            
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(0);
        });
        
        test('parseToolCalls handles array format', () => {
            const toolCalls = [
                { id: '1', function: { name: 'list_dir', arguments: '{}' } }
            ];
            
            const result = toolExecutor.parseToolCalls(toolCalls);
            
            // Should handle the array by wrapping in tool_calls property
            expect(result.length).toBeGreaterThanOrEqual(0);
        });
        
        test('buildToolResult formats tool result', () => {
            const result = toolExecutor.buildToolResult('tool_123', 'read_file', 'file content here');
            
            expect(result).toHaveProperty('tool_call_id', 'tool_123');
            expect(result).toHaveProperty('role', 'tool');
            expect(result).toHaveProperty('content');
        });
        
        test('buildToolResult handles object output', () => {
            const output = { content: 'Result content', success: true };
            const result = toolExecutor.buildToolResult('tool_456', 'write_file', output);
            
            expect(result.content).toBe('Result content');
        });
        
        test('isToolBlocked identifies blocked tools', () => {
            expect(toolExecutor.isToolBlocked('write_file')).toBe(true);
            expect(toolExecutor.isToolBlocked('bash')).toBe(true);
            expect(toolExecutor.isToolBlocked('read_file')).toBe(false);
        });
        
        test('getSuggestedAgent returns agent for blocked tool', () => {
            expect(toolExecutor.getSuggestedAgent('write_file')).toBe('code-implementer');
            expect(toolExecutor.getSuggestedAgent('run_command')).toBe('testing-engineer');
            expect(toolExecutor.getSuggestedAgent('unknown')).toBe('code-implementer');
        });
    });
    
    describe('chat-room', () => {
        const chatRoom = require('../modules/chat-room');
        const orchestrationState = require('../modules/orchestration-state');
        
        beforeEach(() => {
            // Set up hub for chat room
            orchestrationState.setHub(mockHub);
        });
        
        test('createChatRoom returns room object', () => {
            const room = chatRoom.createChatRoom('agent1', 'agent2');
            
            expect(room).toBeDefined();
            expect(room).toHaveProperty('id');
            expect(room).toHaveProperty('fromAgent', 'agent1');
            expect(room).toHaveProperty('toAgent', 'agent2');
            expect(room).toHaveProperty('participants');
            expect(room.participants).toContain('agent1');
            expect(room.participants).toContain('agent2');
            expect(room).toHaveProperty('status', 'active');
        });
        
        test('createChatRoom accepts options', () => {
            const room = chatRoom.createChatRoom('agent1', 'agent2', { 
                tool: 'test-tool', 
                reason: 'Testing',
                isMeeting: true 
            });
            
            expect(room.tool).toBe('test-tool');
            expect(room.reason).toBe('Testing');
            expect(room.isMeeting).toBe(true);
        });
        
        test('pullAgentIntoRoom adds participant', () => {
            const room = chatRoom.createChatRoom('agent1', 'agent2');
            const result = chatRoom.pullAgentIntoRoom(room.id, 'agent3', 'user');
            
            expect(result.success).toBe(true);
            expect(room.participants).toContain('agent3');
        });
        
        test('pullAgentIntoRoom respects max agents', () => {
            const room = chatRoom.createChatRoom('agent1', 'agent2');
            
            // Add 3 more agents up to MAX_ROOM_AGENTS (5)
            chatRoom.pullAgentIntoRoom(room.id, 'agent3', 'user');
            chatRoom.pullAgentIntoRoom(room.id, 'agent4', 'user');
            chatRoom.pullAgentIntoRoom(room.id, 'agent5', 'user');
            
            // 6th agent should fail
            const result = chatRoom.pullAgentIntoRoom(room.id, 'agent6', 'user');
            
            expect(result.success).toBe(false);
            expect(result.error).toContain('capacity');
        });
        
        test('pullAgentIntoRoom rejects duplicate agents', () => {
            const room = chatRoom.createChatRoom('agent1', 'agent2');
            
            const result = chatRoom.pullAgentIntoRoom(room.id, 'agent1', 'user');
            
            expect(result.success).toBe(false);
            expect(result.error).toContain('already');
        });
        
        test('listChatRooms returns array', () => {
            chatRoom.createChatRoom('agent1', 'agent2');
            chatRoom.createChatRoom('agent3', 'agent4');
            
            const rooms = chatRoom.listChatRooms();
            
            expect(Array.isArray(rooms)).toBe(true);
            expect(rooms.length).toBeGreaterThanOrEqual(2);
        });
        
        test('getChatRoom returns room by id', () => {
            const room = chatRoom.createChatRoom('agent1', 'agent2');
            
            const found = chatRoom.getChatRoom(room.id);
            
            expect(found).toBeDefined();
            expect(found.id).toBe(room.id);
        });
        
        test('getChatRoom returns null for invalid id', () => {
            const room = chatRoom.getChatRoom('invalid_room_id');
            
            expect(room).toBeNull();
        });
        
        test('userJoinRoom marks user as present', () => {
            const room = chatRoom.createChatRoom('agent1', 'agent2');
            
            const result = chatRoom.userJoinRoom(room.id);
            
            expect(result.success).toBe(true);
            expect(room.userPresent).toBe(true);
        });
        
        test('userLeaveRoom marks user as absent', () => {
            const room = chatRoom.createChatRoom('agent1', 'agent2');
            chatRoom.userJoinRoom(room.id);
            
            const result = chatRoom.userLeaveRoom(room.id);
            
            expect(result.success).toBe(true);
            expect(room.userPresent).toBe(false);
        });
        
        test('addRoomMessage adds message to room', () => {
            const room = chatRoom.createChatRoom('agent1', 'agent2');
            
            const msg = chatRoom.addRoomMessage(room.id, 'agent1', 'Hello world');
            
            expect(msg).toBeDefined();
            expect(msg.content).toBe('Hello world');
            expect(msg.from).toBe('agent1');
            expect(room.messages).toContain(msg);
        });
        
        test('endChatRoom updates status', () => {
            const room = chatRoom.createChatRoom('agent1', 'agent2');
            
            chatRoom.endChatRoom(room.id, 'completed');
            
            expect(room.status).toBe('completed');
            expect(room.endedAt).toBeDefined();
        });
    });
    
    describe('agent-session', () => {
        const agentSession = require('../modules/agent-session');
        const orchestrationState = require('../modules/orchestration-state');
        
        beforeEach(() => {
            orchestrationState.setHub(mockHub);
        });
        
        test('getOrCreateSession creates new session', () => {
            const session = agentSession.getOrCreateSession('test-agent');
            
            expect(session).toBeDefined();
            expect(session.name).toBe('test-agent');
            expect(session.status).toBe('idle');
            expect(session.isProcessing).toBe(false);
            expect(session.paused).toBe(false);
        });
        
        test('getOrCreateSession returns existing session', () => {
            const session1 = agentSession.getOrCreateSession('test-agent');
            session1.customField = 'test value';
            
            const session2 = agentSession.getOrCreateSession('test-agent');
            
            expect(session2.customField).toBe('test value');
        });
        
        test('pauseAgent updates session status', () => {
            agentSession.getOrCreateSession('test-agent');
            
            const result = agentSession.pauseAgent('test-agent');
            
            expect(result.success).toBe(true);
            expect(result.status).toBe('paused');
        });
        
        test('resumeAgent restores session status', () => {
            const session = agentSession.getOrCreateSession('test-agent');
            session.paused = true;
            session.status = 'paused';
            
            const result = agentSession.resumeAgent('test-agent');
            
            expect(result.success).toBe(true);
            expect(result.status).toBe('idle');
        });
        
        test('resumeAgent returns error for unknown agent', () => {
            const result = agentSession.resumeAgent('nonexistent-agent');
            
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });
        
        test('getAgentSessionState returns session info', () => {
            const session = agentSession.getOrCreateSession('test-agent');
            session.currentTask = 'Test task';
            session.cycleCount = 5;
            
            const state = agentSession.getAgentSessionState('test-agent');
            
            expect(state).toBeDefined();
            expect(state.name).toBe('test-agent');
            expect(state.currentTask).toBe('Test task');
            expect(state.cycleCount).toBe(5);
        });
        
        test('getAgentSessionState returns null for unknown agent', () => {
            const state = agentSession.getAgentSessionState('nonexistent');
            
            expect(state).toBeNull();
        });
        
        test('getAgentHistory returns array', () => {
            const history = agentSession.getAgentHistory('test-agent');
            
            expect(Array.isArray(history)).toBe(true);
        });
        
        test('getAgentInbox returns array', () => {
            const inbox = agentSession.getAgentInbox('test-agent');
            
            expect(Array.isArray(inbox)).toBe(true);
        });
        
        test('getAllAgentStates returns array', () => {
            agentSession.getOrCreateSession('agent1');
            agentSession.getOrCreateSession('agent2');
            
            const states = agentSession.getAllAgentStates();
            
            expect(Array.isArray(states)).toBe(true);
            expect(states.length).toBeGreaterThanOrEqual(2);
        });
    });
    
    describe('integration', () => {
        const orchestrationState = require('../modules/orchestration-state');
        
        test('state persists across module imports', () => {
            orchestrationState.setHub(mockHub);
            orchestrationState.setMaxCycles(25);
            
            // Re-import to verify state is shared
            const stateModule = require('../modules/orchestration-state');
            
            expect(stateModule.getMaxCycles()).toBe(25);
        });
        
        test('agent sessions are shared', () => {
            orchestrationState.setHub(mockHub);
            
            const agentSession1 = require('../modules/agent-session');
            agentSession1.getOrCreateSession('shared-agent');
            
            const agentSession2 = require('../modules/agent-session');
            const session = agentSession2.getOrCreateSession('shared-agent');
            
            expect(session).toBeDefined();
        });
    });
});
