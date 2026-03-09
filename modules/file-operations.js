// ==================== FILE OPERATIONS MODULE ====================
// File read, write, patch, and directory listing operations

const fs = require('fs');
const path = require('path');

let HUB = null;
let CONFIG = null;

// Max file size for read operations (50KB)
const MAX_READ_SIZE = 50 * 1024;

// Get current working directory
function getCWD() {
    const conv = HUB?.getService('conversation');
    return conv?.getWorkingDirectory ? conv.getWorkingDirectory() : process.cwd();
}

// Resolve path relative to working directory
function resolvePath(p) {
    if (!p) return getCWD();
    if (path.isAbsolute(p)) return p;
    return path.resolve(getCWD(), p);
}

// Sanitize filename/path to remove problematic characters
function sanitizeFilename(filePath) {
    if (!filePath) return filePath;
    const dir = path.dirname(filePath);
    let base = path.basename(filePath);
    // Remove path separators and null bytes
    base = base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '');
    return path.join(dir, base);
}

// Sanitize file content
function sanitizeFileContent(content) {
    if (typeof content !== 'string') return content;
    // Remove null bytes
    content = content.replace(/\x00/g, '');
    // Repair any corrupted Unicode from MiniMax model output
    try {
        const guardrail = require('./guardrail-module');
        if (guardrail && guardrail.repairUnicode) {
            content = guardrail.repairUnicode(content);
        }
    } catch (_) {}
    return content;
}

// Emoji regex: matches all emoji (presentation sequences, keycaps, flags, ZWJ sequences, components)
const EMOJI_REGEX = /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*/gu;

// Extract emoji map from a string — returns { position: emoji } for restoration
function extractEmojiMap(str) {
    if (typeof str !== 'string') return new Map();
    const map = new Map();
    let match;
    const regex = new RegExp(EMOJI_REGEX.source, 'gu');
    while ((match = regex.exec(str)) !== null) {
        map.set(match.index, match[0]);
    }
    return map;
}

// Restore emoji that were corrupted during a patch operation
// Compares original file content with new content and restores emoji that were mangled
function restoreCorruptedEmoji(originalContent, newContent) {
    if (!originalContent || !newContent) return newContent;

    const originalEmojis = extractEmojiMap(originalContent);
    if (originalEmojis.size === 0) return newContent; // No emoji to protect

    // Check if any original emoji were lost/corrupted
    let result = newContent;
    for (const [, emoji] of originalEmojis) {
        if (!result.includes(emoji)) {
            // This emoji was corrupted — try to find and fix the corruption
            // MiniMax typically replaces emoji with: lone surrogates, replacement chars, or mojibake
            // Look for replacement character sequences near where the emoji should be
            result = result.replace(/\uFFFD+/g, (match, offset) => {
                // If there's an original emoji that could fit here, restore it
                // This is a heuristic — check if any nearby original position had this emoji
                for (const [origPos, origEmoji] of originalEmojis) {
                    if (Math.abs(origPos - offset) < 20 && !result.includes(origEmoji)) {
                        return origEmoji;
                    }
                }
                return match;
            });
        }
    }

    return result;
}

// Read file contents
function readFile(p) {
    const filePath = resolvePath(p);
    
    try {
        const stats = fs.statSync(filePath);
        
        // Check file size
        if (stats.size > MAX_READ_SIZE) {
            return `ERROR: File too large (${stats.size} bytes). Use read_file_lines to read a portion.`;
        }
        
        const content = fs.readFileSync(filePath, 'utf-8');
        
        // Verify it's actually text
        if (content.length === 0 && stats.size > 0) {
            return `ERROR: File appears to be binary (${stats.size} bytes). Cannot display.`;
        }
        
        return content;
    } catch (err) {
        if (err.code === 'ENOENT') {
            return `ERROR: File not found: ${filePath}`;
        }
        if (err.code === 'EISDIR') {
            return `ERROR: Path is a directory: ${filePath}`;
        }
        return `ERROR: ${err.message}`;
    }
}

// Read specific lines from file
function readFileLines(p, startLine, endLine) {
    const filePath = resolvePath(p);
    
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        
        // Adjust for 1-based indexing
        const start = Math.max(1, startLine || 1) - 1;
        const end = Math.min(lines.length, endLine || lines.length);
        
        if (start >= lines.length) {
            return `ERROR: Start line ${startLine} exceeds file length (${lines.length} lines)`;
        }
        
        const selectedLines = lines.slice(start, end);
        
        return selectedLines.join('\n');
    } catch (err) {
        if (err.code === 'ENOENT') {
            return `ERROR: File not found: ${filePath}`;
        }
        return `ERROR: ${err.message}`;
    }
}

// Write file
function writeFile(p, content) {
    const filePath = resolvePath(p);
    const sanitizedContent = sanitizeFileContent(content);
    
    try {
        // Create directory if it doesn't exist
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(filePath, sanitizedContent, 'utf-8');
        
        const stats = fs.statSync(filePath);
        HUB?.log(`[File] Wrote ${stats.size} bytes to ${filePath}`, 'info');
        
        return `Written to: ${filePath} (${stats.size} bytes)`;
    } catch (err) {
        return `ERROR: ${err.message}`;
    }
}

// Get overlord directory
function getOverlordDir() {
    // This would be set by the conversation service
    const conv = HUB?.getService('conversation');
    return conv?.getWorkingDirectory ? conv.getWorkingDirectory() : process.cwd();
}

// Write session note
function writeSessionNote(note, category) {
    const overlordDir = getOverlordDir();
    const notesDir = path.join(overlordDir, '.overlord');
    const notesFile = path.join(notesDir, 'session-notes.txt');
    
    try {
        if (!fs.existsSync(notesDir)) {
            fs.mkdirSync(notesDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString();
        const entry = `\n[${timestamp}] [${category}] ${note}\n`;
        
        fs.appendFileSync(notesFile, entry, 'utf-8');
        
        return `Session note saved: ${note.substring(0, 50)}...`;
    } catch (err) {
        return `ERROR: ${err.message}`;
    }
}

// Append timeline event
function appendTimeline(event) {
    const overlordDir = getOverlordDir();
    const timelineFile = path.join(overlordDir, '.overlord', 'timeline.json');
    
    try {
        let timeline = [];
        
        if (fs.existsSync(timelineFile)) {
            const content = fs.readFileSync(timelineFile, 'utf-8');
            timeline = JSON.parse(content);
        }
        
        timeline.push({
            timestamp: new Date().toISOString(),
            ...event
        });
        
        fs.writeFileSync(timelineFile, JSON.stringify(timeline, null, 2), 'utf-8');
        
        return 'Timeline updated';
    } catch (err) {
        return `ERROR: ${err.message}`;
    }
}

// List directory contents
function listDir(p) {
    const dirPath = resolvePath(p);
    
    try {
        if (!fs.existsSync(dirPath)) {
            return `ERROR: Directory not found: ${dirPath}`;
        }
        
        const stats = fs.statSync(dirPath);
        if (!stats.isDirectory()) {
            return `ERROR: Not a directory: ${dirPath}`;
        }
        
        const items = fs.readdirSync(dirPath);
        const output = [];
        
        // Sort: directories first, then files
        const dirs = [];
        const files = [];
        
        items.forEach(item => {
            try {
                const itemPath = path.join(dirPath, item);
                const itemStats = fs.statSync(itemPath);
                
                if (itemStats.isDirectory()) {
                    dirs.push({ name: item, isDir: true });
                } else {
                    files.push({ name: item, isDir: false, size: itemStats.size });
                }
            } catch (e) {
                // Skip inaccessible items
            }
        });
        
        // Format output
        dirs.sort((a, b) => a.name.localeCompare(b.name));
        files.sort((a, b) => a.name.localeCompare(b.name));
        
        dirs.forEach(d => output.push(`DIR  ${d.name}`));
        files.forEach(f => output.push(`FILE ${f.name}`));
        
        return output.join('\n');
    } catch (err) {
        return `ERROR: ${err.message}`;
    }
}

// Patch file (search and replace)
function patchFile(p, search, replace) {
    const filePath = resolvePath(p);

    try {
        if (!fs.existsSync(filePath)) {
            return `ERROR: File not found: ${filePath}`;
        }

        const content = fs.readFileSync(filePath, 'utf-8');

        // Sanitize the replacement content (repair corrupted Unicode from MiniMax)
        const sanitizedReplace = sanitizeFileContent(replace);

        // Check if search string exists (try exact first, then with repaired Unicode)
        let searchStr = search;
        if (!content.includes(searchStr)) {
            // Try sanitized version of search string
            searchStr = sanitizeFileContent(search);
            if (!content.includes(searchStr)) {
                return `ERROR: Search string not found in file. Make sure the exact string exists (check for whitespace differences).`;
            }
        }

        // Perform replacement
        let newContent = content.replace(searchStr, sanitizedReplace);

        // Emoji protection: restore any emoji from the original file that were corrupted
        newContent = restoreCorruptedEmoji(content, newContent);

        fs.writeFileSync(filePath, newContent, 'utf-8');

        HUB?.log(`[File] Patched ${filePath}`, 'info');

        return `Patched: ${filePath}`;
    } catch (err) {
        return `ERROR: ${err.message}`;
    }
}

// Append to file
function appendFile(p, content) {
    const filePath = resolvePath(p);
    const sanitizedContent = sanitizeFileContent(content);
    
    try {
        // Create directory if needed
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.appendFileSync(filePath, sanitizedContent, 'utf-8');
        
        const stats = fs.statSync(filePath);
        return `Appended to: ${filePath} (now ${stats.size} bytes)`;
    } catch (err) {
        return `ERROR: ${err.message}`;
    }
}

// Initialize module
function init(hub) {
    HUB = hub;
    CONFIG = hub.getService('config');
}

module.exports = {
    init,
    readFile,
    readFileLines,
    writeFile,
    patchFile,
    appendFile,
    listDir,
    sanitizeFilename,
    sanitizeFileContent,
    getCWD,
    resolvePath,
    getOverlordDir,
    writeSessionNote,
    appendTimeline
};
