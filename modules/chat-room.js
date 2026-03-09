// ==================== CHAT ROOM MODULE ====================
// Handles chat rooms and meetings between agents.
// Includes room creation, participant management, and meeting notes.
//
// Required by: orchestration-core

const {
    getHub,
    getAgentChatRooms,
    getNextRoomId,
    MAX_ROOM_AGENTS
} = require('./orchestration-state');

// Lazy-require to break circular dependency (orchestration-core → chat-room → orchestration-core)
let _setOrchestratorState = null;
function setOrchestratorState(updates) {
    if (!_setOrchestratorState) {
        try { _setOrchestratorState = require('./orchestration-core').setOrchestratorState; } catch (e) {}
    }
    if (_setOrchestratorState) _setOrchestratorState(updates);
}

// Create a chat room between agents
function createChatRoom(fromAgent, toAgent, opts = {}) {
    const hub = getHub();
    const rooms = getAgentChatRooms();
    
    const roomId = 'room_' + getNextRoomId();
    
    const room = {
        id: roomId,
        fromAgent,
        toAgent,
        participants: [fromAgent, toAgent],
        tool: opts.tool || null,
        reason: opts.reason || null,
        messages: [],
        status: 'active',
        isMeeting: opts.isMeeting || false,
        meetingNotes: null,
        userPresent: false,
        pulledInBy: null,
        createdAt: Date.now()
    };
    
    rooms.set(roomId, room);
    
    hub.log(`[ROOM] Created room ${roomId}: ${fromAgent} ↔ ${toAgent}`, 'info');
    hub.broadcast('room_created', room);
    
    return room;
}

// Add a message to a room
function addRoomMessage(roomId, from, content, type = 'message') {
    const hub = getHub();
    const rooms = getAgentChatRooms();
    
    const room = rooms.get(roomId);
    if (!room) {
        hub.log(`[ROOM] Message to non-existent room: ${roomId}`, 'warn');
        return null;
    }
    
    const message = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        from,
        content,
        type,
        timestamp: Date.now()
    };
    
    room.messages.push(message);
    
    hub.broadcast('room_message', { roomId, message });
    
    return message;
}

// End a chat room
function endChatRoom(roomId, status = 'completed') {
    const hub = getHub();
    const rooms = getAgentChatRooms();
    
    const room = rooms.get(roomId);
    if (!room) {
        return null;
    }
    
    room.status = status;
    room.endedAt = Date.now();
    
    hub.log(`[ROOM] Room ${roomId} ended: ${status}`, 'info');
    hub.broadcast('room_ended', { roomId, status });
    
    return room;
}

// List all chat rooms
function listChatRooms() {
    const rooms = getAgentChatRooms();
    const list = [];
    
    rooms.forEach(room => {
        list.push({
            id: room.id,
            fromAgent: room.fromAgent,
            toAgent: room.toAgent,
            participants: room.participants,
            status: room.status,
            isMeeting: room.isMeeting,
            messageCount: room.messages.length,
            createdAt: room.createdAt
        });
    });
    
    return list;
}

// Get a specific chat room
function getChatRoom(roomId) {
    const rooms = getAgentChatRooms();
    const room = rooms.get(roomId);
    
    if (!room) {
        return null;
    }
    
    return {
        ...room,
        messages: room.messages
    };
}

// Pull an agent into an existing room
function pullAgentIntoRoom(roomId, agentName, pulledBy = 'user') {
    const hub = getHub();
    const rooms = getAgentChatRooms();
    
    const room = rooms.get(roomId);
    if (!room) {
        hub.log(`[ROOM] Cannot pull ${agentName} - room ${roomId} not found`, 'warn');
        return { success: false, error: 'Room not found' };
    }
    
    // Check max participants
    if (room.participants.length >= MAX_ROOM_AGENTS) {
        hub.log(`[ROOM] Cannot pull ${agentName} - room at max capacity`, 'warn');
        return { success: false, error: 'Room at maximum capacity' };
    }
    
    // Check if agent already in room
    if (room.participants.includes(agentName)) {
        hub.log(`[ROOM] ${agentName} already in room ${roomId}`, 'warn');
        return { success: false, error: 'Agent already in room' };
    }
    
    room.participants.push(agentName);
    room.pulledInBy = pulledBy;
    
    hub.log(`[ROOM] ${agentName} pulled into room ${roomId} by ${pulledBy}`, 'info');
    
    // Add system message
    addRoomMessage(roomId, 'system', `${agentName} was pulled into the room by ${pulledBy}`, 'system');
    
    hub.broadcast('room_agent_joined', { roomId, agentName, pulledBy });
    
    return { success: true, room };
}

// User leaves a room
function userLeaveRoom(roomId) {
    const hub = getHub();
    const rooms = getAgentChatRooms();
    
    const room = rooms.get(roomId);
    if (!room) {
        return { success: false, error: 'Room not found' };
    }
    
    room.userPresent = false;
    
    addRoomMessage(roomId, 'system', 'User left the room', 'system');
    
    hub.broadcast('room_user_left', { roomId });
    
    hub.log(`[ROOM] User left room ${roomId}`, 'info');
    
    return { success: true };
}

// User joins a room
function userJoinRoom(roomId) {
    const hub = getHub();
    const rooms = getAgentChatRooms();
    
    const room = rooms.get(roomId);
    if (!room) {
        return { success: false, error: 'Room not found' };
    }
    
    room.userPresent = true;
    
    addRoomMessage(roomId, 'system', 'User joined the room', 'system');
    
    hub.broadcast('room_user_joined', { roomId });
    
    hub.log(`[ROOM] User joined room ${roomId}`, 'info');
    
    return { success: true, room };
}

// Generate meeting notes from room messages
async function generateMeetingNotes(roomId) {
    const hub = getHub();
    const rooms = getAgentChatRooms();
    
    const room = rooms.get(roomId);
    if (!room) {
        return { success: false, error: 'Room not found' };
    }
    
    // Extract key information from messages
    const participants = room.participants.join(', ');
    const messageCount = room.messages.length;
    
    // Group messages by agent
    const agentMessages = {};
    room.messages.forEach(msg => {
        if (msg.type !== 'system') {
            if (!agentMessages[msg.from]) {
                agentMessages[msg.from] = [];
            }
            agentMessages[msg.from].push(msg.content);
        }
    });
    
    // Create summary
    const notes = {
        title: `Meeting: ${room.fromAgent} ↔ ${room.toAgent}`,
        date: new Date().toISOString(),
        participants,
        messageCount,
        summary: `Discussion between ${participants}`,
        toolUsed: room.tool,
        reason: room.reason,
        transcript: room.messages.map(m => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.from}: ${m.content}`).join('\n')
    };
    
    room.meetingNotes = notes;
    
    hub.log(`[MEETING] Generated notes for room ${roomId}`, 'info');
    hub.broadcast('room_meeting_notes', { roomId, notes });
    
    return { success: true, notes };
}

// End a meeting (room)
async function endMeeting(roomId) {
    const hub = getHub();
    const rooms = getAgentChatRooms();
    
    const room = rooms.get(roomId);
    if (!room) {
        return { success: false, error: 'Meeting room not found' };
    }
    
    // Generate final meeting notes
    const notesResult = await generateMeetingNotes(roomId);
    
    // Mark as completed
    room.status = 'completed';
    room.endedAt = Date.now();
    
    hub.log(`[MEETING] Meeting ${roomId} ended`, 'info');
    hub.broadcast('meeting_ended', {
        roomId,
        notes: notesResult.notes,
        participants: room.participants
    });
    
    return {
        success: true,
        room,
        notes: notesResult.notes
    };
}

module.exports = {
    createChatRoom,
    addRoomMessage,
    endChatRoom,
    listChatRooms,
    getChatRoom,
    pullAgentIntoRoom,
    userLeaveRoom,
    userJoinRoom,
    generateMeetingNotes,
    endMeeting,
    MAX_ROOM_AGENTS
};
