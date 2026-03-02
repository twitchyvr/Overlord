// ==================== NOTES MODULE ====================
// Session Note Tool - Persistent memory for agent sessions
// Implements record_note and recall_notes tools similar to MiniAgent cookbook
//
// Features:
// - Lazy loading: file created only when first note is recorded
// - Categories: organize notes by type (user_preference, project_info, decision, etc.)
// - Timestamps: every note includes ISO timestamp
// - Search/filter: recall by category

const fs = require('fs');
const path = require('path');

let HUB = null;
let CONFIG = null;

// Default notes storage path
const DEFAULT_NOTES_FILE = '.overlord/notes.json';

// In-memory cache
let notesCache = null;
let cacheLoaded = false;

// ==================== INITIALIZATION ====================

function init(hub) {
    HUB = hub;
    
    // Wait for config
    let attempts = 0;
    while (!HUB.getService('config') && attempts < 10) {
        new Promise(r => setTimeout(r, 100));
        attempts++;
    }
    
    CONFIG = HUB.getService('config') || {};
    
    // Register the notes service
    const service = {
        recordNote: recordNote,
        recallNotes: recallNotes,
        getNotesCount: getNotesCount,
        clearNotes: clearNotes,
        getNotesFilePath: getNotesFilePath
    };
    
    HUB.registerService('notes', service);
    
    // Log status
    const notesPath = getNotesFilePath();
    const exists = fs.existsSync(notesPath);
    HUB.log(`📝 Notes module loaded (${exists ? 'has notes' : 'empty'})`, 'success');
}

// ==================== PATH HELPERS ====================

function getNotesFilePath() {
    const baseDir = CONFIG?.baseDir || process.cwd();
    return path.join(baseDir, DEFAULT_NOTES_FILE);
}

function ensureNotesDir() {
    const notesPath = getNotesFilePath();
    const dir = path.dirname(notesPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return notesPath;
}

// ==================== CORE FUNCTIONS ====================

function loadNotes() {
    if (cacheLoaded) return notesCache;
    
    const notesPath = getNotesFilePath();
    
    if (fs.existsSync(notesPath)) {
        try {
            const data = fs.readFileSync(notesPath, 'utf8');
            notesCache = JSON.parse(data);
            if (!Array.isArray(notesCache)) {
                notesCache = [];
            }
        } catch (e) {
            HUB?.log('Notes load error: ' + e.message, 'warn');
            notesCache = [];
        }
    } else {
        notesCache = [];
    }
    
    cacheLoaded = true;
    return notesCache;
}

function saveNotes(notes) {
    const notesPath = ensureNotesDir();
    try {
        fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2), 'utf8');
        notesCache = notes;
        cacheLoaded = true;
        return true;
    } catch (e) {
        HUB?.log('Notes save error: ' + e.message, 'error');
        return false;
    }
}

// ==================== PUBLIC API ====================

/**
 * Record a new note
 * @param {string} content - The note content (required)
 * @param {string} category - Optional category (default: 'general')
 * @returns {object} Result with success status and message
 */
function recordNote(content, category = 'general') {
    if (!content || typeof content !== 'string') {
        return { 
            success: false, 
            content: 'Error: Note content is required and must be a string' 
        };
    }
    
    // Trim and validate content
    const trimmedContent = content.trim();
    if (trimmedContent.length === 0) {
        return { 
            success: false, 
            content: 'Error: Note content cannot be empty' 
        };
    }
    
    // Validate category
    const validCategory = (category || 'general').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    
    // Load existing notes
    const notes = loadNotes();
    
    // Create new note
    const note = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        timestamp: new Date().toISOString(),
        category: validCategory || 'general',
        content: trimmedContent
    };
    
    // Add to notes array
    notes.push(note);
    
    // Save to file
    if (saveNotes(notes)) {
        HUB?.log(`📝 Note recorded: [${note.category}] ${trimmedContent.substring(0, 50)}...`, 'info');
        return {
            success: true,
            content: `Recorded note (${notes.length} total): ${trimmedContent.substring(0, 100)}${trimmedContent.length > 100 ? '...' : ''}\nCategory: ${note.category}\nTimestamp: ${note.timestamp}`
        };
    } else {
        return {
            success: false,
            content: 'Error: Failed to save note to storage'
        };
    }
}

/**
 * Recall notes, optionally filtered by category
 * @param {string} category - Optional category filter
 * @returns {object} Result with success status and formatted notes
 */
function recallNotes(category = null) {
    const notes = loadNotes();
    
    if (!notes || notes.length === 0) {
        return {
            success: true,
            content: 'No notes recorded yet. Use record_note to save important information.'
        };
    }
    
    // Filter by category if specified
    let filteredNotes = notes;
    if (category && typeof category === 'string' && category.trim()) {
        const cat = category.trim().toLowerCase();
        filteredNotes = notes.filter(n => n.category.toLowerCase() === cat);
        
        if (filteredNotes.length === 0) {
            const allCategories = [...new Set(notes.map(n => n.category))];
            return {
                success: true,
                content: `No notes found in category: "${category}"\n\nAvailable categories: ${allCategories.join(', ')}`
            };
        }
    }
    
    // Sort by timestamp (newest first)
    filteredNotes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Format notes for display
    const lines = ['## 📝 Recorded Notes'];
    
    if (category) {
        lines.push(`\n*Filtered by category: ${category}*`);
    }
    
    lines.push(`\n*Total: ${filteredNotes.length} note(s)*\n---`);
    
    filteredNotes.forEach((note, idx) => {
        const date = new Date(note.timestamp).toLocaleString();
        lines.push(`\n### ${idx + 1}. [${note.category}]`);
        lines.push(`*${date}*`);
        lines.push(`\n${note.content}`);
        lines.push('\n---');
    });
    
    return {
        success: true,
        content: lines.join('\n')
    };
}

/**
 * Get total notes count
 * @returns {number} Number of notes
 */
function getNotesCount() {
    const notes = loadNotes();
    return notes.length;
}

/**
 * Clear all notes (with confirmation)
 * @param {boolean} confirm - Must be true to actually clear
 * @returns {object} Result
 */
function clearNotes(confirm = false) {
    if (!confirm) {
        return {
            success: false,
            content: 'To clear all notes, call clearNotes(true). This action cannot be undone.'
        };
    }
    
    const notes = loadNotes();
    const count = notes.length;
    
    if (saveNotes([])) {
        HUB?.log(`🗑️ Cleared ${count} notes`, 'warn');
        return {
            success: true,
            content: `All ${count} notes have been deleted.`
        };
    } else {
        return {
            success: false,
            content: 'Error: Failed to clear notes'
        };
    }
}

// ==================== TOOL REGISTRATION ====================
// These functions are called by tools-v5.js to register note tools

function getToolDefinitions() {
    return [
        {
            name: 'record_note',
            description: 'Record important information as session notes for future reference. Use this to record key facts, user preferences, decisions, or context that should be recalled later in the agent execution chain. Each note is timestamped.',
            input_schema: {
                type: 'object',
                properties: {
                    content: {
                        type: 'string',
                        description: 'The information to record as a note. Be concise but specific.'
                    },
                    category: {
                        type: 'string',
                        description: 'Optional category/tag for this note (e.g., "user_preference", "project_info", "decision", "general")'
                    }
                },
                required: ['content']
            }
        },
        {
            name: 'recall_notes',
            description: 'Recall all previously recorded session notes. Use this to retrieve important information, context, or decisions from earlier in the session or previous agent execution chains.',
            input_schema: {
                type: 'object',
                properties: {
                    category: {
                        type: 'string',
                        description: 'Optional: filter notes by category (e.g., "user_preference", "project_info")'
                    }
                },
                required: []
            }
        }
    ];
}

function executeNoteTool(toolName, input) {
    switch (toolName) {
        case 'record_note':
            return recordNote(input.content, input.category);
        case 'recall_notes':
            return recallNotes(input.category);
        default:
            return { success: false, content: 'Unknown note tool: ' + toolName };
    }
}

// Export for external use
module.exports = { 
    init, 
    getToolDefinitions, 
    executeNoteTool,
    recordNote,
    recallNotes,
    getNotesCount,
    clearNotes,
    getNotesFilePath
};
