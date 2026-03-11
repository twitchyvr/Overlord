const fs = require('fs');
const path = require('path');

const filePath = './modules/orchestration-module.js';
const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n');

// Find all major exported functions and their line numbers
const exports = [];
const moduleExportsStart = lines.findIndex(l => l.includes('module.exports'));

console.log('=== module.exports section ===');
for (let i = moduleExportsStart; i < lines.length && i < moduleExportsStart + 30; i++) {
    console.log(`Line ${i + 1}: ${lines[i]}`);
}

// Find key function definitions for each module
const keyFunctions = {
    orchestrationCore: ['handleUserMessage', 'runAICycle', 'runAutoQA', 'orchestrationState', 'setOrchestratorState'],
    agentSession: ['runAgentSession', 'runAgentCycle', 'runAgentAICycle', 'pauseAgent', 'resumeAgent', 'getAgentSessionState', 'getAgentHistory', 'getAgentInbox', 'agentSessions'],
    chatRoom: ['createChatRoom', 'addRoomMessage', 'endChatRoom', 'listChatRooms', 'getChatRoom', 'pullAgentIntoRoom', 'userLeaveRoom', 'userJoinRoom', 'generateMeetingNotes', 'endMeeting', 'agentChatRooms'],
    toolExecutor: ['executeToolsWithApproval', 'executeToolCall', 'parseToolCalls', 'buildToolResult', 'handleToolError', 'handleToolException'],
    approvalFlow: ['waitForApproval', 'classifyApprovalTier', 'shouldProceed', 'checkIn', 'handleApprovalResponse', 'pendingApproval', 'pendingApprovalResolvers']
};

console.log('\n=== Finding function locations ===');
lines.forEach((line, idx) => {
    for (const [module, funcs] of Object.entries(keyFunctions)) {
        for (const func of funcs) {
            if (line.match(new RegExp(`^\\s*(async\\s+)?function\\s+${func}\\s*\\(`))) {
                console.log(`${module}: ${func} at line ${idx + 1}`);
            }
        }
    }
});

// Get line ranges for each section
console.log('\n=== Section line ranges ===');

// Find runAgentSession section (agent session logic)
let agentStart = lines.findIndex(l => l.includes('function runAgentSession'));
let agentEnd = lines.findIndex(l => l.includes('function getAgentInbox'));
console.log(`Agent session: lines ${agentStart + 1} to ${agentEnd + 50}`);

// Find chat room section
let roomStart = lines.findIndex(l => l.includes('function createChatRoom'));
let roomEnd = lines.findIndex(l => l.includes('function endMeeting'));
console.log(`Chat room: lines ${roomStart + 1} to ${roomEnd + 50}`);

// Find approval flow
let approvalStart = lines.findIndex(l => l.includes('function waitForApproval'));
console.log(`Approval flow starts at: ${approvalStart + 1}`);

// Find tool execution
let toolStart = lines.findIndex(l => l.includes('function executeToolsWithApproval'));
console.log(`Tool execution starts at: ${toolStart + 1}`);
