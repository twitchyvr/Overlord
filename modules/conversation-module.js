// ==================== CONVERSATION MODULE ====================
// Handles conversation persistence with context management

const fs = require('fs');
const path = require('path');

let hub = null;
let config = null;
let conversationId = null;
let history = [];
let workingDir = null; // Will be set from config in init()
let tasks = [];
let roadmap = [];

// Context management
// MiniMax M2.5: 204,800 context window, ~66,000 max output
// Safe input headroom: 204,800 - 66,000 = 138,800 tokens
const MAX_CONTEXT_TOKENS = 204800;   // Full model context window
const MAX_INPUT_TOKENS = 138800;     // Safe input limit (leaves room for max output)
const SOFT_LIMIT_TOKENS = 120000;    // Soft limit: start warning here
const WARNING_THRESHOLD = 0.85;      // Warn at 85% of soft limit
const CRITICAL_THRESHOLD = 0.95;     // Critical at 95% of soft limit

// Estimate tokens (roughly 4 chars per token)
function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

// Calculate total context usage
function calculateContextUsage() {
    const totalChars = history.reduce((sum, msg) => {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        return sum + content.length;
    }, 0);

    const estimatedTokens = Math.ceil(totalChars / 4);

    // Display percentage against the full model context window so users see accurate numbers
    const percentUsedOfContext = estimatedTokens / MAX_CONTEXT_TOKENS;
    // Soft limit percentage (when to trigger truncation)
    const percentUsedOfSoftLimit = estimatedTokens / SOFT_LIMIT_TOKENS;

    const displayPercent = Math.min(Math.round(percentUsedOfContext * 100), 100);
    const percentLeft = Math.max(100 - displayPercent, 0);

    let status = 'normal';
    if (percentUsedOfSoftLimit >= CRITICAL_THRESHOLD) {
        status = 'critical';
    } else if (percentUsedOfSoftLimit >= WARNING_THRESHOLD) {
        status = 'warning';
    }

    return {
        totalChars,
        estimatedTokens,
        maxTokens: MAX_CONTEXT_TOKENS,
        softLimitTokens: SOFT_LIMIT_TOKENS,
        percentUsed: displayPercent,
        percentLeft: percentLeft,
        rawPercentUsed: Math.round(percentUsedOfContext * 100),
        needsTruncation: estimatedTokens >= SOFT_LIMIT_TOKENS,
        status
    };
}

// Broadcast context warning to client
function broadcastContextWarning() {
    const usage = calculateContextUsage();
    
    // Get compaction info from context tracker
    let compactionCount = 0;
    try {
        const tracker = hub?.getService('contextTracker');
        if (tracker?.getCompactionStats) {
            compactionCount = tracker.getCompactionStats().totalCompactions || 0;
        }
    } catch (e) {}
    
    // Include all needed info for the client
    const warningData = {
        ...usage,
        compactionCount: compactionCount,
        maxContextTokens: MAX_CONTEXT_TOKENS,
        maxHistoryTokens: SOFT_LIMIT_TOKENS
    };
    
    hub.broadcast('context_warning', warningData);
    hub.log(`Context: ${Math.round(usage.percentUsed)}% used (${usage.percentLeft.toFixed(1)}% left) (compact:${compactionCount}x)`, 
             usage.status === 'critical' ? 'error' : usage.status === 'warning' ? 'warning' : 'info');
}

const CONVERSATIONS_DIR = '.overlord/conversations';
const METADATA_FILE = '.overlord/conversations/conversations.json';

async function init(h) {
    hub = h;
    config = hub.getService('config');
    
    // Set working directory from config (use project root as default)
    workingDir = config.baseDir || process.cwd();
    
    // Ensure directories exist
    const convDir = path.join(workingDir, CONVERSATIONS_DIR);
    if (!fs.existsSync(convDir)) {
        fs.mkdirSync(convDir, { recursive: true });
    }
    
    // Load last conversation by default
    loadLastConversation();
    
    hub.registerService('conversation', {
        getId: () => conversationId,
        getHistory: () => history,
        getRoadmap: () => roadmap,
        getMilestones: () => roadmap.filter(r => r.type === 'milestone'),
        getWorkingDirectory: getWorkingDirectory,
        setWorkingDirectory: setWorkingDirectory,
        getTasks: getTasks,
        addTask: addTask,
        toggleTask: toggleTask,
        deleteTask: deleteTask,
        updateTask: updateTask,
        reorderTasks: reorderTasks,
        addMilestone: addMilestone,
        updateMilestone: updateMilestone,
        deleteMilestone: deleteMilestone,
        launchMilestone: launchMilestone,
        addUserMessage: addUserMessage,
        addAssistantMessage: addAssistantMessage,
        addToolResult: addToolResult,
        addRoadmapItem: addRoadmapItem,
        checkpoint: checkpoint,
        sanitize: sanitizeHistory,
        save: saveConversation,
        new: newConversation,
        getState: getState,
        listConversations: listConversations,
        loadConversation: loadConversationById,
        // Context management
        getContextUsage: calculateContextUsage,
        shouldWarnContext: () => calculateContextUsage().status !== 'normal',
        isContextCritical: () => calculateContextUsage().status === 'critical',
        clearHistory: clearHistoryForNewChat,
        replaceHistory: replaceHistory,
        archiveCurrentAndNew: archiveAndStartNew,
        loadProjectData: loadProjectData
    });
    
    hub.log('Conversation module loaded', 'success');
}

function listConversations() {
    const metaPath = path.join(config.baseDir, METADATA_FILE);
    try {
        if (fs.existsSync(metaPath)) {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            return meta.conversations || [];
        }
    } catch (e) {
        console.error('Error loading conversations list:', e.message);
    }
    return [];
}

function loadConversationById(convId) {
    const convPath = path.join(config.baseDir, CONVERSATIONS_DIR, `${convId}.json`);
    try {
        if (fs.existsSync(convPath)) {
            const data = JSON.parse(fs.readFileSync(convPath, 'utf8'));
            conversationId = data.id;
            history = data.messages || [];
            // Migrate: ensure all milestones have IDs (old saved conversations may lack them)
            roadmap = (data.roadmap || []).map((item, i) => {
                if (item.type === 'milestone' && !item.id) {
                    return { ...item, id: 'ms_' + i + '_' + Date.now() };
                }
                return item;
            });
            workingDir = data.workingDir || workingDir;
            tasks = data.tasks || [];
            
            // FIX: Sanitize history after loading to remove orphaned tool_results
            // This prevents "tool_result references unknown id" errors
            const tokenMgr = hub?.getService('tokenManager');
            if (tokenMgr?.sanitizeHistory) {
                const beforeCount = history.length;
                history = tokenMgr.sanitizeHistory(history);
                const removed = beforeCount - history.length;
                if (removed > 0) {
                    console.log(`[Conversation] Cleaned ${removed} orphaned tool entries from loaded conversation`);
                    hub.log(`Cleaned ${removed} orphaned tool entries from loaded conversation`, 'warning');
                }
            }
            
            // Save current conversation first
            saveConversation();
            
            hub.broadcast('conversation_loaded', {
                id: conversationId,
                messages: history,
                roadmap: roadmap
            });
            
            // CRITICAL: Always broadcast working directory when loading conversation
            hub.broadcast('working_dir_update', workingDir);
            hub.log('Loaded conversation: ' + convId + ' (' + history.length + ' messages)', 'success');
            return { success: true, id: conversationId, messageCount: history.length };
        }
    } catch (e) {
        hub.log('Error loading conversation: ' + e.message, 'error');
    }
    return { success: false, error: 'Conversation not found' };
}

function loadLastConversation() {
    const metaPath = path.join(config.baseDir, METADATA_FILE);
    try {
        if (fs.existsSync(metaPath)) {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            if (meta.conversations && meta.conversations.length > 0) {
                // Load the most recent conversation
                const lastConv = meta.conversations[0];
                return loadConversationById(lastConv.id);
            }
        }
    } catch (e) {
        console.log('No previous conversation found, starting fresh');
    }
    
    conversationId = generateId();
    console.log('Started fresh conversation: ' + conversationId);
    // CRITICAL: Broadcast working directory for fresh conversation
    hub.broadcast('working_dir_update', workingDir);
}

function generateId() {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Working directory functions
function getWorkingDirectory() {
    return workingDir;
}

function setWorkingDirectory(dir) {
    if (!dir || dir === workingDir) return;
    workingDir = dir;
    hub.broadcast('working_dir_update', workingDir);
    saveConversation();
}

// Load tasks + roadmap + workingDir from a project — called when switching projects
function loadProjectData({ tasks: newTasks, roadmap: newRoadmap, workingDir: newWorkingDir }) {
    tasks = Array.isArray(newTasks) ? newTasks : [];
    roadmap = Array.isArray(newRoadmap) ? newRoadmap : [];
    if (newWorkingDir) workingDir = newWorkingDir;
    hub.broadcastAll('tasks_update', tasks);
    hub.roadmapUpdate(roadmap);
    if (newWorkingDir) hub.broadcast('working_dir_update', workingDir);
}

// Tasks functions
function getTasks() {
    return tasks || [];
}

function addTask(task) {
    if (!tasks) tasks = [];
    tasks.push(task);
    hub.broadcastAll('tasks_update', tasks);
    saveConversation();
    hub.log('Task added: ' + task.title, 'info');
}

function toggleTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
        task.completed = !task.completed;
        hub.broadcastAll('tasks_update', tasks);
        saveConversation();
    }
}

function deleteTask(taskId) {
    tasks = tasks.filter(t => t.id !== taskId);
    hub.broadcastAll('tasks_update', tasks);
    saveConversation();
    hub.log('Task deleted: ' + taskId, 'info');
}

function reorderTasks(orderedIds) {
    // Re-sort the tasks array to match the provided id order
    const idIndex = {};
    orderedIds.forEach((id, i) => { idIndex[id] = i; });
    tasks.sort((a, b) => {
        const ai = idIndex[a.id] !== undefined ? idIndex[a.id] : 9999;
        const bi = idIndex[b.id] !== undefined ? idIndex[b.id] : 9999;
        return ai - bi;
    });
    hub.broadcastAll('tasks_update', tasks);
    saveConversation();
}

function updateTask(taskId, updates) {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
        if (updates.title !== undefined) task.title = updates.title;
        if (updates.description !== undefined) task.description = updates.description;
        if (updates.priority !== undefined) task.priority = updates.priority;
        if (updates.completed !== undefined) task.completed = updates.completed;
        if (updates.status !== undefined) {
            task.status = updates.status;
            // Sync completed flag with status for backward compat
            if (updates.status === 'completed') task.completed = true;
            if (updates.status === 'pending' || updates.status === 'skipped') task.completed = false;
        }
        if (updates.assignee !== undefined) task.assignee = updates.assignee;
        if (updates.workingDir !== undefined) task.workingDir = updates.workingDir;
        if (updates.actions !== undefined) task.actions = updates.actions;
        if (updates.dependsOn !== undefined) task.dependsOn = updates.dependsOn; // array of taskIds
        if (updates.milestoneId !== undefined) task.milestoneId = updates.milestoneId;
        if (updates.notes !== undefined) task.notes = updates.notes;
        hub.broadcastAll('tasks_update', tasks);
        saveConversation();
        hub.log('Task updated: ' + task.title, 'info');
        // Auto-complete milestone when all assigned tasks finish
        _checkMilestoneComplete(task.milestoneId);
    }
}

// ==================== MILESTONE CRUD ====================

function addMilestone({ name, description = '', color = '#58a6ff' }) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const item = {
        type: 'milestone',
        id: 'ms_' + Date.now(),
        text: name,
        description,
        branch: 'milestone/' + slug,
        color,
        status: 'pending',
        done: false,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null
    };
    roadmap.push(item);
    hub.roadmapUpdate(roadmap);
    saveConversation();
    hub.log('Milestone created: ' + name, 'info');
    return item;
}

function updateMilestone(id, fields) {
    const ms = roadmap.find(r => r.id === id && r.type === 'milestone');
    if (!ms) return null;
    const allowed = ['text', 'description', 'color', 'status', 'done', 'branch', 'startedAt', 'completedAt', 'closeSummary'];
    allowed.forEach(k => { if (fields[k] !== undefined) ms[k] = fields[k]; });
    hub.roadmapUpdate(roadmap);
    saveConversation();
    return ms;
}

function deleteMilestone(id) {
    const idx = roadmap.findIndex(r => r.id === id && r.type === 'milestone');
    if (idx === -1) return false;
    roadmap.splice(idx, 1);
    // Clear milestoneId on all tasks that referenced this milestone
    tasks.forEach(t => { if (t.milestoneId === id) t.milestoneId = null; });
    hub.broadcastAll('tasks_update', tasks);
    hub.roadmapUpdate(roadmap);
    saveConversation();
    hub.log('Milestone deleted: ' + id, 'info');
    return true;
}

function launchMilestone(id) {
    const ms = roadmap.find(r => r.id === id && r.type === 'milestone');
    if (!ms) return null;
    ms.status = 'active';
    ms.startedAt = new Date().toISOString();
    ms.done = false;
    hub.roadmapUpdate(roadmap);
    saveConversation();
    hub.log('Milestone launched: ' + ms.text, 'info');
    return ms;
}

function _checkMilestoneComplete(milestoneId) {
    if (!milestoneId) return;
    const ms = roadmap.find(r => r.id === milestoneId && r.type === 'milestone');
    if (!ms || ms.status !== 'active') return;
    const msTasks = tasks.filter(t => t.milestoneId === milestoneId);
    if (msTasks.length > 0 && msTasks.every(t => t.completed || t.status === 'completed')) {
        ms.status = 'completed';
        ms.done = true;
        ms.completedAt = new Date().toISOString();
        hub.roadmapUpdate(roadmap);
        saveConversation();
        hub.log('Milestone completed: ' + ms.text, 'success');
        hub.emit('milestone_completed', ms);
    }
}

function addUserMessage(content) {
    history.push({ role: 'user', content });
    // Check context after adding message
    broadcastContextWarning();
}

function replaceHistory(newHistory) {
    history = Array.isArray(newHistory) ? newHistory : [];
    saveConversation();
    broadcastContextWarning();
}

function addAssistantMessage(message) {
    history.push(message);
    saveConversation();
    // Check context after adding message
    broadcastContextWarning();
}

function addToolResult(toolId, content) {
    // CRITICAL: MiniMax requires tool_result with EXACT tool_use_id matching
    // The tool ID must be the SAME string that was in the tool_use call
    history.push({ 
        role: 'user', 
        content: [{ 
            type: 'tool_result', 
            tool_use_id: toolId, 
            content: String(content) 
        }] 
    });
    // Debug
    console.log('[addToolResult] Added result for tool_use_id:', toolId);
}

function addRoadmapItem(text, type) {
    type = type || 'task';
    const item = { type, text, done: false };
    if (type === 'milestone') item.id = 'ms_' + Date.now();
    roadmap.push(item);
    hub.roadmapUpdate(roadmap);
    saveConversation();
}

function checkpoint(summary) {
    if (roadmap.length > 0) {
        roadmap[roadmap.length - 1].done = true;
    }
    hub.roadmapUpdate(roadmap);
    hub.status('Checkpoint: ' + summary, 'checkpoint');
}

function newConversation() {
    saveConversation();
    conversationId = generateId();
    history = [];
    workingDir = config?.baseDir || process.cwd();
    tasks = [];
    roadmap = [
        { type: 'milestone', text: 'System Initialization', done: true },
        { type: 'task', text: 'Orchestration Ready', done: true }
    ];
    hub.roadmapUpdate(roadmap);
    hub.broadcast('conversation_new', { id: conversationId, messages: [], roadmap: roadmap });
    hub.broadcast('working_dir_update', workingDir); // CRITICAL: Always broadcast working dir
    hub.broadcast('context_warning', { percentUsed: 0, percentLeft: 100, status: 'normal' });
    hub.log('Started new conversation with working dir: ' + workingDir, 'success');
}

// Clear history for a fresh start
function clearHistoryForNewChat() {
    saveConversation();
    history = [];
    hub.broadcast('context_warning', { percentUsed: 0, percentLeft: 100, status: 'normal' });
    hub.log('History cleared - fresh start', 'success');
}

// Archive current and start new
function archiveAndStartNew() {
    saveConversation(); // Save current first
    conversationId = generateId();
    history = [];
    workingDir = config?.baseDir || process.cwd();
    roadmap = [
        { type: 'milestone', text: 'System Initialization', done: true },
        { type: 'task', text: 'Orchestration Ready', done: true }
    ];
    hub.roadmapUpdate(roadmap);
    hub.broadcast('conversation_new', { id: conversationId, messages: [], roadmap: roadmap });
    hub.broadcast('working_dir_update', workingDir); // CRITICAL: Always broadcast working dir
    hub.broadcast('context_warning', { percentUsed: 0, percentLeft: 100, status: 'normal' });
    hub.log('Archived conversation and started new with working dir: ' + workingDir, 'success');
}

function getState() {
    return {
        id: conversationId,
        messages: history,
        roadmap: roadmap,
        workingDir: workingDir,
        tasks: tasks
    };
}

function saveConversation() {
    if (!conversationId || history.length === 0) return;
    
    const convPath = path.join(config.baseDir, CONVERSATIONS_DIR, `${conversationId}.json`);
    const data = {
        id: conversationId,
        title: history.find(m => m.role === 'user')?.content?.substring(0, 40) || 'Untitled',
        messages: history,
        roadmap: roadmap,
        workingDir: workingDir,
        tasks: tasks,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(convPath, JSON.stringify(data, null, 2));
    
    // Update metadata
    const metaPath = path.join(config.baseDir, METADATA_FILE);
    let meta = { conversations: [] };
    
    try {
        if (fs.existsSync(metaPath)) {
            meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        }
    } catch (e) {}
    
    const idx = meta.conversations.findIndex(c => c.id === conversationId);
    const metaEntry = { id: conversationId, title: data.title, updatedAt: data.updatedAt, messageCount: history.length };
    
    if (idx >= 0) meta.conversations[idx] = metaEntry;
    else meta.conversations.unshift(metaEntry);
    
    meta.conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

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

module.exports = { init };
