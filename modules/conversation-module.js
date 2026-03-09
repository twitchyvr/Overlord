// ==================== CONVERSATION MODULE (BACKWARD COMPATIBILITY) ====================
// This file re-exports all conversation modules for backward compatibility.
// New code should import directly from specific modules:
//
// - conversation-store.js: SQLite persistence
// - context-tracker.js: Context management and compaction
// - message-queue.js: Message management

const conversationStore = require('./conversation-store');
const contextTracker = require('./context-tracker');
const messageQueue = require('./message-queue');

let HUB = null;

// Working directory
let WORKING_DIR = process.cwd();

// Conversation state
let currentConversation = null;

// Task management state
let tasks = [];
let roadmap = [];
let milestones = [];

// Re-export functions from sub-modules
module.exports = {
    init: async function(h) {
        HUB = h;
        
        // Initialize sub-modules
        conversationStore.init(h);
        contextTracker.init(h);
        messageQueue.init(h);
        
        // Load last conversation or create new
        currentConversation = conversationStore.loadLastConversation();
        
        if (!currentConversation) {
            currentConversation = {
                id: conversationStore.generateId(),
                workingDir: WORKING_DIR,
                createdAt: Date.now(),
                messages: [],
                tasks: [],
                roadmap: [],
                milestones: []
            };
            conversationStore.saveConversation(currentConversation);
        } else {
            // Restore state from DB
            tasks = currentConversation.tasks || [];
            roadmap = currentConversation.roadmap || [];
            milestones = currentConversation.milestones || [];
            // Restore working directory from saved conversation
            if (currentConversation.workingDir) {
                WORKING_DIR = currentConversation.workingDir;
            }
        }
        
        // Register service — must expose EVERY method hub.js calls on conv
        HUB.registerService('conversation', {
            // Identity
            getId: () => currentConversation?.id,

            // Messages / History
            getMessages: () => currentConversation?.messages || [],
            getHistory: () => currentConversation?.messages || [],
            addMessage: (role, content) => addMessage(role, content),
            replaceHistory: (msgs) => {
                if (currentConversation) currentConversation.messages = msgs;
            },
            clearHistory: () => clearHistoryForNewChat(),

            // Conversations
            listConversations: () => conversationStore.listConversations(),
            loadConversation: (id) => {
                const loaded = conversationStore.loadConversationById(id);
                if (loaded) {
                    currentConversation = loaded;
                    tasks = loaded.tasks || [];
                    roadmap = loaded.roadmap || [];
                    milestones = loaded.milestones || [];
                    return { success: true, conversation: loaded };
                }
                return { success: false, error: 'Not found' };
            },

            // Persistence
            save: () => saveConversation(),
            saveConversation: () => saveConversation(),
            new: () => archiveAndStartNew(),
            archiveCurrentAndNew: () => archiveAndStartNew(),

            // Working directory
            setWorkingDirectory: (dir) => setWorkingDirectory(dir),
            getWorkingDirectory: () => getWorkingDirectory(),

            // Context
            getContextUsage: () => contextTracker.getContextUsage(currentConversation),

            // Tasks
            getTasks: () => tasks,
            addTask: (t) => addTask(t),
            toggleTask: (id) => toggleTask(id),
            deleteTask: (id, cascade) => deleteTask(id, cascade),
            updateTask: (id, updates) => updateTask(id, updates),
            getTaskTree: () => getTaskTree(),

            // Roadmap
            getRoadmap: () => roadmap,
            addRoadmapItem: (text, type) => addRoadmapItem(text, type),

            // Milestones
            getMilestones: () => milestones,
            addMilestone: (data) => addMilestone(data),
            updateMilestone: (id, fields) => updateMilestone(id, fields),
            deleteMilestone: (id) => deleteMilestone(id),
            launchMilestone: (id) => {
                const ms = milestones.find(m => m.id === id);
                if (ms) {
                    ms.status = 'active';
                    ms.launchedAt = Date.now();
                    saveConversation();
                }
                return ms;
            }
        });
        
        HUB.log('✅ Conversation module initialized', 'info');
    },
    
    // Re-export from sub-modules
    estimateTokens: contextTracker.estimateTokens,
    calculateContextUsage: contextTracker.calculateContextUsage,
    broadcastContextWarning: contextTracker.broadcastContextWarning,
    summarizeAndCompact: contextTracker.summarizeAndCompact,
    
    // Message functions
    addUserMessage: (content) => messageQueue.addUserMessage(content),
    addAssistantMessage: (message) => messageQueue.addAssistantMessage(message),
    addToolResult: (toolId, content) => messageQueue.addToolResult(toolId, content),
    getMessages: () => currentConversation?.messages || [],
    replaceHistory: messageQueue.replaceHistory,
    sanitizeHistory: messageQueue.sanitizeHistory,
    
    // Store functions
    listConversations: conversationStore.listConversations,
    loadConversationById: conversationStore.loadConversationById,
    loadLastConversation: conversationStore.loadLastConversation,
    saveConversation: () => saveConversation(),
    clearHistoryForNewChat: () => clearHistoryForNewChat(),
    archiveAndStartNew: () => archiveAndStartNew(),
    
    // Working directory
    getWorkingDirectory: getWorkingDirectory,
    setWorkingDirectory: setWorkingDirectory,
    
    // Tasks
    getTasks: () => tasks,
    addTask: addTask,
    toggleTask: toggleTask,
    deleteTask: deleteTask,
    updateTask: updateTask,
    getTaskTree: getTaskTree,
    
    // Roadmap
    addRoadmapItem: (text, type) => addRoadmapItem(text, type),
    getRoadmap: () => roadmap,
    
    // Milestones
    addMilestone: addMilestone,
    updateMilestone: updateMilestone,
    deleteMilestone: deleteMilestone,
    getMilestones: () => milestones,
    getRoadmap: getRoadmap
};

// Working directory functions
function getWorkingDirectory() {
    return WORKING_DIR;
}

function setWorkingDirectory(dir) {
    if (!dir) return;
    WORKING_DIR = dir;
    if (currentConversation) {
        currentConversation.workingDir = dir;
        // Persist to DB so it survives server restarts
        conversationStore.saveConversation(currentConversation);
    }
}

// Add message to conversation
function addMessage(role, content) {
    if (!currentConversation) {
        currentConversation = {
            id: conversationStore.generateId(),
            workingDir: WORKING_DIR,
            createdAt: Date.now(),
            messages: [],
            tasks: tasks,
            roadmap: roadmap,
            milestones: milestones
        };
    }
    
    let message;
    if (role === 'user') {
        message = messageQueue.addUserMessage(content);
    } else if (role === 'assistant') {
        message = messageQueue.addAssistantMessage(content);
    } else if (role === 'tool') {
        message = messageQueue.addToolResult(content.toolId, content.content);
    }
    
    if (message) {
        currentConversation.messages.push(message);
    }
    
    return message;
}

// Save conversation
function saveConversation() {
    if (!currentConversation) return;
    
    currentConversation.tasks = tasks;
    currentConversation.roadmap = roadmap;
    currentConversation.milestones = milestones;
    
    conversationStore.saveConversation(currentConversation);
}

// Clear history for new chat
function clearHistoryForNewChat() {
    if (!currentConversation) return;
    currentConversation.messages = [];
    tasks = [];
    roadmap = [];
    saveConversation();
}

// Archive and start new
function archiveAndStartNew() {
    saveConversation();
    
    currentConversation = {
        id: conversationStore.generateId(),
        workingDir: WORKING_DIR,
        createdAt: Date.now(),
        messages: [],
        tasks: tasks,
        roadmap: roadmap,
        milestones: milestones
    };
    
    saveConversation();
}

// Task functions
function addTask(task) {
    const newTask = {
        id: task.id || 'task_' + Date.now(),
        title: task.title,
        description: task.description || '',
        status: task.status || 'pending',
        priority: task.priority || 'normal',
        completed: false,
        milestoneId: task.milestoneId || null,
        assignee: task.assignee || [],
        createdAt: task.createdAt || Date.now()
    };
    
    tasks.push(newTask);
    saveConversation();
    
    return newTask;
}

function toggleTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
        task.completed = !task.completed;
        task.status = task.completed ? 'completed' : 'pending';
        saveConversation();
    }
}

function deleteTask(taskId, cascade = true) {
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx !== -1) {
        tasks.splice(idx, 1);
        
        // Remove from milestones
        milestones.forEach(m => {
            if (m.taskIds) {
                m.taskIds = m.taskIds.filter(id => id !== taskId);
            }
        });
        
        saveConversation();
    }
}

function updateTask(taskId, updates) {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
        Object.assign(task, updates);
        saveConversation();
    }
}

function getTaskTree() {
    // Return flat list for now
    return tasks;
}

function getRoadmap() {
    return roadmap;
}

function addRoadmapItem(text, type) {
    const item = { id: 'ri_' + Date.now(), text, type: type || 'item', createdAt: Date.now() };
    roadmap.push(item);
    saveConversation();
    return item;
}

// Milestone functions
function addMilestone({ name, description = '', color = '#58a6ff' }) {
    const ms = {
        id: 'ms_' + Date.now(),
        name,
        description,
        color,
        status: 'pending',
        taskIds: [],
        createdAt: Date.now()
    };
    
    milestones.push(ms);
    saveConversation();
    
    return ms;
}

function updateMilestone(id, fields) {
    const ms = milestones.find(m => m.id === id);
    if (ms) {
        Object.assign(ms, fields);
        saveConversation();
    }
}

function deleteMilestone(id) {
    const idx = milestones.findIndex(m => m.id === id);
    if (idx !== -1) {
        milestones.splice(idx, 1);
        
        // Remove milestone from tasks
        tasks.forEach(t => {
            if (t.milestoneId === id) {
                t.milestoneId = null;
            }
        });
        
        saveConversation();
    }
}
