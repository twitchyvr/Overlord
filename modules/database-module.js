// ==================== DATABASE MODULE ====================
// SQLite database for persistent storage
// Handles conversations, tasks, and other data

const path = require('path');
const fs = require('fs');

let hub = null;
let config = null;
let db = null;

async function init(h) {
    hub = h;
    config = hub.getService('config');
    
    try {
        const Database = require('better-sqlite3');
        const dbPath = path.join(config.baseDir, '.overlord', 'data.db');
        
        // Ensure directory exists
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        db = new Database(dbPath);
        
        // Initialize tables
        initializeTables();
        
        hub.registerService('database', {
            // Conversations
            getConversation: getConversation,
            saveConversation: saveConversation,
            listConversations: listConversations,
            deleteConversation: deleteConversation,
            
            // Tasks
            getTasks: getTasks,
            saveTask: saveTask,
            deleteTask: deleteTask,
            updateTask: updateTask,
            reorderTasks: reorderTasks,
            
            // Working Directory
            getWorkingDir: getWorkingDir,
            setWorkingDir: setWorkingDir,
            
            // Generic queries
            query: query,
            run: run
        });
        
        hub.log('Database module loaded - SQLite', 'success');
    } catch (err) {
        hub.log('Database initialization failed: ' + err.message, 'error');
        hub.log('Falling back to file-based storage', 'warning');
    }
}

function initializeTables() {
    // Conversations table
    db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT,
            messages TEXT,
            roadmap TEXT,
            working_dir TEXT,
            tasks TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Tasks table
    db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            conversation_id TEXT,
            title TEXT,
            description TEXT,
            priority TEXT DEFAULT 'normal',
            completed INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            metadata TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id)
        )
    `);
    
    // Settings table
    db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);
    
    console.log('[Database] Tables initialized');
}

// Conversations
function getConversation(id) {
    const stmt = db.prepare('SELECT * FROM conversations WHERE id = ?');
    const row = stmt.get(id);
    
    if (!row) return null;
    
    return {
        id: row.id,
        title: row.title,
        messages: JSON.parse(row.messages || '[]'),
        roadmap: JSON.parse(row.roadmap || '[]'),
        workingDir: row.working_dir,
        tasks: JSON.parse(row.tasks || '[]'),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function saveConversation(conv) {
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO conversations (id, title, messages, roadmap, working_dir, tasks, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run(
        conv.id,
        conv.title,
        JSON.stringify(conv.messages),
        JSON.stringify(conv.roadmap),
        conv.workingDir || '',
        JSON.stringify(conv.tasks || [])
    );
}

function listConversations() {
    const stmt = db.prepare('SELECT id, title, updated_at, messages FROM conversations ORDER BY updated_at DESC');
    const rows = stmt.all();
    
    return rows.map(row => ({
        id: row.id,
        title: row.title,
        updatedAt: row.updated_at,
        messageCount: (JSON.parse(row.messages || '[]')).length
    }));
}

function deleteConversation(id) {
    const stmt = db.prepare('DELETE FROM conversations WHERE id = ?');
    stmt.run(id);
}

// Tasks
function getTasks(conversationId) {
    let stmt;
    if (conversationId) {
        stmt = db.prepare('SELECT * FROM tasks WHERE conversation_id = ? ORDER BY sort_order');
        return stmt.all(conversationId).map(mapTask);
    } else {
        stmt = db.prepare('SELECT * FROM tasks ORDER BY sort_order');
        return stmt.all().map(mapTask);
    }
}

function mapTask(row) {
    return {
        id: row.id,
        conversationId: row.conversation_id,
        title: row.title,
        description: row.description,
        priority: row.priority,
        completed: !!row.completed,
        sortOrder: row.sort_order,
        metadata: JSON.parse(row.metadata || '{}'),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function saveTask(task) {
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO tasks (id, conversation_id, title, description, priority, completed, sort_order, metadata, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run(
        task.id,
        task.conversationId || null,
        task.title,
        task.description || '',
        task.priority || 'normal',
        task.completed ? 1 : 0,
        task.sortOrder || 0,
        JSON.stringify(task.metadata || {})
    );
}

function deleteTask(id) {
    const stmt = db.prepare('DELETE FROM tasks WHERE id = ?');
    stmt.run(id);
}

function updateTask(id, updates) {
    const fields = [];
    const values = [];
    
    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
    if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
    if (updates.completed !== undefined) { fields.push('completed = ?'); values.push(updates.completed ? 1 : 0); }
    if (updates.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(updates.sortOrder); }
    if (updates.metadata !== undefined) { fields.push('metadata = ?'); values.push(JSON.stringify(updates.metadata)); }
    
    if (fields.length === 0) return { success: false, error: 'No fields to update' };
    
    values.push(id);
    
    const stmt = db.prepare('UPDATE tasks SET ' + fields.join(', ') + ', updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    stmt.run(...values);
    
    return { success: true };
}

function reorderTasks(taskIds) {
    const stmt = db.prepare('UPDATE tasks SET sort_order = ? WHERE id = ?');
    
    const transaction = db.transaction(() => {
        taskIds.forEach((id, index) => {
            stmt.run(index, id);
        });
    });
    
    transaction();
    return { success: true };
}

// Working Directory
function getWorkingDir() {
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get('working_dir');
    return row ? row.value : process.cwd();
}

function setWorkingDir(dir) {
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    stmt.run('working_dir', dir);
    return { success: true };
}

// Generic queries
function query(sql, params = []) {
    try {
        const stmt = db.prepare(sql);
        return { success: true, results: stmt.all(...params) };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

function run(sql, params = []) {
    try {
        const stmt = db.prepare(sql);
        return { success: true, changes: stmt.run(...params).changes };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { init };
