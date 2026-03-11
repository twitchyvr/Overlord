const fs = require('fs');
const path = require('path');

let HUB = null;
let DB = null;

// Generate unique ID
function generateId() {
    return 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// Initialize database
function initDatabase() {
    const dbPath = path.join(process.cwd(), '.overlord', 'conversation.db');
    const dbDir = path.dirname(dbPath);
    
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
    
    try {
        const Database = require('better-sqlite3');
        DB = new Database(dbPath);
        
        // Create tables
        DB.exec(`
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                working_dir TEXT,
                created_at INTEGER,
                updated_at INTEGER,
                messages TEXT,
                tasks TEXT,
                roadmap TEXT,
                milestones TEXT
            );
            
            CREATE TABLE IF NOT EXISTS session_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT,
                category TEXT,
                agent TEXT,
                content TEXT,
                created_at INTEGER
            );
            
            CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC);
        `);
        
        HUB?.log('✅ Conversation database initialized', 'info');
    } catch (err) {
        HUB?.log('Conversation DB init failed: ' + err.message, 'warn');
    }
}

// Load conversation by ID
function loadConversationById(convId) {
    if (!DB) return null;
    
    try {
        const row = DB.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
        
        if (row) {
            return {
                id: row.id,
                workingDir: row.working_dir,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                messages: JSON.parse(row.messages || '[]'),
                tasks: JSON.parse(row.tasks || '[]'),
                roadmap: JSON.parse(row.roadmap || '[]'),
                milestones: JSON.parse(row.milestones || '[]')
            };
        }
    } catch (err) {
        HUB?.log('Load conversation error: ' + err.message, 'warn');
    }
    
    return null;
}

// Load last conversation
function loadLastConversation() {
    if (!DB) return null;
    
    try {
        const row = DB.prepare('SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1').get();
        
        if (row) {
            return loadConversationById(row.id);
        }
    } catch (err) {
        HUB?.log('Load last conversation error: ' + err.message, 'warn');
    }
    
    return null;
}

// Save conversation
function saveConversation(conv) {
    if (!DB || !conv) return;
    
    try {
        const stmt = DB.prepare(`
            INSERT OR REPLACE INTO conversations (id, working_dir, created_at, updated_at, messages, tasks, roadmap, milestones)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(
            conv.id,
            conv.workingDir || process.cwd(),
            conv.createdAt || Date.now(),
            Date.now(),
            JSON.stringify(conv.messages || []),
            JSON.stringify(conv.tasks || []),
            JSON.stringify(conv.roadmap || []),
            JSON.stringify(conv.milestones || [])
        );
    } catch (err) {
        HUB?.log('Save conversation error: ' + err.message, 'warn');
    }
}

// Get history from database
function getHistory(convId) {
    const conv = loadConversationById(convId);
    return conv ? conv.messages : [];
}

// Clear history
function clearHistory(convId) {
    if (!DB) return;
    
    try {
        DB.prepare('UPDATE conversations SET messages = ? WHERE id = ?').run('[]', convId);
    } catch (err) {
        HUB?.log('Clear history error: ' + err.message, 'warn');
    }
}

// List conversations
function listConversations() {
    if (!DB) return [];
    
    try {
        const rows = DB.prepare('SELECT id, working_dir, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 20').all();
        
        return rows.map(row => ({
            id: row.id,
            workingDir: row.working_dir,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
    } catch (err) {
        HUB?.log('List conversations error: ' + err.message, 'warn');
        return [];
    }
}

// Initialize module
function init(h) {
    HUB = h;
    initDatabase();
}

module.exports = {
    init,
    initDatabase,
    generateId,
    loadConversationById,
    loadLastConversation,
    saveConversation,
    getHistory,
    clearHistory,
    listConversations
};
