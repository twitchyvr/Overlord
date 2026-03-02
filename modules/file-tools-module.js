// ==================== FILE TOOLS MODULE ====================
// OS-agnostic file manipulation with chunked reading/writing
// Handles large files by streaming in chunks

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

let hub = null;
let config = null;

// Default chunk size for large file operations
const DEFAULT_CHUNK_SIZE = 64 * 1024; // 64KB chunks

// Detect OS
const isWindows = process.platform === 'win32';

async function init(h) {
    hub = h;
    config = hub.getService('config');
    
    // Register file tools
    hub.registerService('fileTools', {
        readChunked: readChunked,
        writeChunked: writeChunked,
        appendToFile: appendToFile,
        insertInFile: insertInFile,
        patchFile: patchFile,
        createFile: createFile,
        deleteFile: deleteFile,
        listDirectory: listDirectory,
        getFileInfo: getFileInfo,
        searchInFile: searchInFile,
        replaceInFile: replaceInFile,
        readFileLines: readFileLines,
        ensureDirectory: ensureDirectory
    });
    
    hub.log('File tools module loaded - OS: ' + process.platform, 'success');

    const tools = hub.getService('tools');
    if (!tools || !tools.registerTool) {
        hub.log('[file-tools] tools service not available — dynamic tools skipped', 'warn');
        return;
    }

    // ── B1: Foundational awareness tools ──────────────────────────────────
    tools.registerTool({
        name: 'file_tree',
        description: 'Recursive directory tree of the project. Skips node_modules, .git, dist, build. ALWAYS call this before any multi-file task to understand the project layout.',
        input_schema: {
            type: 'object',
            properties: {
                path:  { type: 'string', description: 'Root directory (default: working dir)' },
                depth: { type: 'number', description: 'Max depth (default: 4)' }
            }
        }
    }, async ({ path: p, depth = 4 }) => {
        const conv = hub.getService('conversation');
        const root = p || (conv && conv.getWorkingDirectory ? conv.getWorkingDirectory() : process.cwd());
        const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.overlord', '__pycache__',
                              '.venv', 'venv', 'target', '.next', '.nuxt', 'coverage', '.turbo']);
        function tree(dir, prefix, d) {
            if (d <= 0) return '';
            let entries;
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
            catch(e) { return prefix + '[permission denied]\n'; }
            entries = entries.filter(e => !e.name.startsWith('.') || e.name === '.env.example')
                             .filter(e => !SKIP.has(e.name))
                             .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
            let out = '';
            entries.forEach((e, i) => {
                const last = i === entries.length - 1;
                const branch = last ? '└── ' : '├── ';
                const childPfx = last ? '    ' : '│   ';
                out += prefix + branch + e.name + (e.isDirectory() ? '/' : '') + '\n';
                if (e.isDirectory()) out += tree(path.join(dir, e.name), prefix + childPfx, d - 1);
            });
            return out;
        }
        try {
            const result = path.basename(root) + '/\n' + tree(root, '', depth);
            return result || '(empty directory)';
        } catch(e) {
            return 'Error: ' + e.message;
        }
    });

    tools.registerTool({
        name: 'git_diff',
        description: 'Show git status or diff. Use after writing files to see exactly what changed before marking a task done.',
        input_schema: {
            type: 'object',
            properties: {
                mode: { type: 'string', enum: ['status', 'diff', 'diff_staged', 'log'], description: 'status=changed files, diff=unstaged changes, diff_staged=staged, log=recent commits (default: status)' },
                file: { type: 'string', description: 'Specific file to diff (optional)' }
            }
        }
    }, async ({ mode = 'status', file }) => {
        const conv = hub.getService('conversation');
        const cwd = conv && conv.getWorkingDirectory ? conv.getWorkingDirectory() : process.cwd();
        try {
            let args;
            if (mode === 'status')      args = ['status', '--short'];
            else if (mode === 'diff')   args = file ? ['diff', '--', file] : ['diff'];
            else if (mode === 'diff_staged') args = file ? ['diff', '--staged', '--', file] : ['diff', '--staged'];
            else if (mode === 'log')    args = ['log', '--oneline', '-15'];
            else                        args = ['status', '--short'];
            const out = execFileSync('git', args, { cwd, timeout: 10000, encoding: 'utf8' });
            return out.trim() || '(no output — working tree clean)';
        } catch(e) {
            if (e.status === 128) return 'Not a git repository at: ' + cwd;
            return (e.stdout || e.stderr || e.message || 'git error').trim();
        }
    });

    tools.registerTool({
        name: 'project_info',
        description: 'Read project metadata: name, language, dependencies, scripts. Call once at the start of a session to understand the project stack.',
        input_schema: { type: 'object', properties: {} }
    }, async () => {
        const conv = hub.getService('conversation');
        const cwd = conv && conv.getWorkingDirectory ? conv.getWorkingDirectory() : process.cwd();
        const result = { workingDir: cwd, detected: [] };

        // package.json (Node/JS)
        const pkgPath = path.join(cwd, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                result.name = pkg.name;
                result.version = pkg.version;
                result.language = 'JavaScript/TypeScript';
                result.deps = Object.keys(pkg.dependencies || {});
                result.devDeps = Object.keys(pkg.devDependencies || {});
                result.scripts = Object.keys(pkg.scripts || {});
                result.detected.push('package.json');
            } catch(e) {}
        }
        // Cargo.toml (Rust)
        const cargoPath = path.join(cwd, 'Cargo.toml');
        if (fs.existsSync(cargoPath)) {
            try {
                const cargo = fs.readFileSync(cargoPath, 'utf8');
                const nameMatch = cargo.match(/^name\s*=\s*"([^"]+)"/m);
                if (nameMatch) result.name = result.name || nameMatch[1];
                result.language = (result.language ? result.language + ' + ' : '') + 'Rust';
                result.detected.push('Cargo.toml');
            } catch(e) {}
        }
        // pyproject.toml / requirements.txt (Python)
        if (fs.existsSync(path.join(cwd, 'pyproject.toml')) || fs.existsSync(path.join(cwd, 'requirements.txt'))) {
            result.language = (result.language ? result.language + ' + ' : '') + 'Python';
            result.detected.push('pyproject.toml/requirements.txt');
        }
        // go.mod (Go)
        const goPath = path.join(cwd, 'go.mod');
        if (fs.existsSync(goPath)) {
            result.language = (result.language ? result.language + ' + ' : '') + 'Go';
            result.detected.push('go.mod');
        }
        if (result.detected.length === 0) return 'No recognized project files found in: ' + cwd;
        return JSON.stringify(result, null, 2);
    });

    // ── B2: Agent memory tools ─────────────────────────────────────────────
    tools.registerTool({
        name: 'agent_remember',
        description: 'Save a persistent note to this agent\'s long-term memory. Use to record project conventions, recurring errors, user preferences, and patterns discovered during work. This memory persists across sessions.',
        input_schema: {
            type: 'object',
            required: ['note'],
            properties: {
                note: { type: 'string', description: 'The note to remember (1-3 sentences)' }
            }
        }
    }, async ({ note }) => {
        const agentName = hub.getCurrentAgentName() || 'orchestrator';
        const baseDir = config && config.baseDir ? config.baseDir : path.join(process.cwd(), '.overlord');
        const memDir = path.join(baseDir, '.overlord', 'agents');
        const memPath = path.join(memDir, agentName + '.md');
        try {
            fs.mkdirSync(memDir, { recursive: true });
            const entry = `\n- ${new Date().toISOString().slice(0, 10)}: ${note}`;
            fs.appendFileSync(memPath, entry, 'utf8');
            return `Memory saved for ${agentName}.`;
        } catch(e) {
            return 'Error saving memory: ' + e.message;
        }
    });

    tools.registerTool({
        name: 'agent_recall',
        description: 'Read this agent\'s long-term memory notes from previous sessions. Call at the start of a new task to recall relevant project knowledge.',
        input_schema: { type: 'object', properties: {} }
    }, async () => {
        const agentName = hub.getCurrentAgentName() || 'orchestrator';
        const baseDir = config && config.baseDir ? config.baseDir : path.join(process.cwd(), '.overlord');
        const memPath = path.join(baseDir, '.overlord', 'agents', agentName + '.md');
        try {
            const content = fs.readFileSync(memPath, 'utf8').trim();
            return content || '(no memory yet — use agent_remember to save notes)';
        } catch(e) {
            return '(no memory yet — use agent_remember to save notes)';
        }
    });
}

// Read file in chunks
async function readChunked(filePath, options = {}) {
    const { chunkSize = DEFAULT_CHUNK_SIZE, start = 0, end = null } = options;
    
    try {
        const stats = await fs.promises.stat(filePath);
        const totalSize = stats.size;
        const readEnd = end || totalSize;
        
        if (start >= totalSize) {
            return { success: true, content: '', message: 'Start position beyond file length' };
        }
        
        const chunks = [];
        let bytesRead = 0;
        
        return new Promise((resolve, reject) => {
            const stream = fs.createReadStream(filePath, {
                start: start,
                end: Math.min(readEnd, totalSize) - 1,
                highWaterMark: chunkSize
            });
            
            stream.on('data', (chunk) => {
                chunks.push(chunk);
                bytesRead += chunk.length;
            });
            
            stream.on('end', () => {
                const content = Buffer.concat(chunks).toString('utf8');
                resolve({
                    success: true,
                    content: content,
                    bytesRead: bytesRead,
                    totalSize: totalSize,
                    hasMore: readEnd < totalSize
                });
            });
            
            stream.on('error', (err) => {
                reject(err);
            });
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Write file in chunks (for large files)
async function writeChunked(filePath, content, options = {}) {
    const { chunkSize = DEFAULT_CHUNK_SIZE, append = false } = options;
    
    try {
        // Ensure directory exists
        const dir = path.dirname(filePath);
        await fs.promises.mkdir(dir, { recursive: true });
        
        const flags = append ? 'a' : 'w';
        
        if (content.length <= chunkSize) {
            // Small file - write directly
            await fs.promises.writeFile(filePath, content, 'utf8');
            return { success: true, bytesWritten: content.length };
        }
        
        // Large file - write in chunks
        let bytesWritten = 0;
        const stream = fs.createWriteStream(filePath, { flags });
        
        return new Promise((resolve, reject) => {
            let offset = 0;
            
            function writeNextChunk() {
                const chunk = content.slice(offset, offset + chunkSize);
                if (chunk.length === 0) {
                    stream.end();
                    return;
                }
                
                const canContinue = stream.write(chunk);
                bytesWritten += chunk.length;
                offset += chunkSize;
                
                if (canContinue) {
                    writeNextChunk();
                } else {
                    stream.once('drain', writeNextChunk);
                }
            }
            
            stream.on('finish', () => {
                resolve({ success: true, bytesWritten });
            });
            
            stream.on('error', (err) => {
                reject(err);
            });
            
            writeNextChunk();
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Append to file
async function appendToFile(filePath, content) {
    return writeChunked(filePath, content, { append: true });
}

// Insert content at specific position
async function insertInFile(filePath, content, position) {
    try {
        // Read existing content
        const existing = await readChunked(filePath);
        if (!existing.success && existing.error.includes('ENOENT')) {
            // File doesn't exist, create it
            return writeChunked(filePath, content);
        }
        
        if (!existing.success) {
            return existing;
        }
        
        // Insert at position
        const before = existing.content.slice(0, position);
        const after = existing.content.slice(position);
        const newContent = before + content + after;
        
        return writeChunked(filePath, newContent);
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Patch file - replace specific section
async function patchFile(filePath, search, replace) {
    try {
        const result = await readChunked(filePath);
        if (!result.success) {
            return result;
        }
        
        if (!result.content.includes(search)) {
            return { success: false, error: 'Search string not found in file' };
        }
        
        const newContent = result.content.replace(search, replace);
        return writeChunked(filePath, newContent);
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Create new file
async function createFile(filePath, content = '') {
    return writeChunked(filePath, content);
}

// Delete file
async function deleteFile(filePath) {
    try {
        await fs.promises.unlink(filePath);
        return { success: true };
    } catch (err) {
        if (err.code === 'ENOENT') {
            return { success: true, message: 'File did not exist' };
        }
        return { success: false, error: err.message };
    }
}

// List directory contents
async function listDirectory(dirPath, options = {}) {
    const { recursive = false, includeHidden = false } = options;
    
    try {
        let entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        
        if (!includeHidden) {
            entries = entries.filter(e => !e.name.startsWith('.'));
        }
        
        const results = await Promise.all(entries.map(async (entry) => {
            const fullPath = path.join(dirPath, entry.name);
            const stats = await fs.promises.stat(fullPath);
            
            return {
                name: entry.name,
                isDirectory: entry.isDirectory(),
                isFile: entry.isFile(),
                size: stats.size,
                modified: stats.mtime.toISOString()
            };
        }));
        
        if (recursive) {
            const dirs = results.filter(r => r.isDirectory);
            const files = results.filter(r => r.isFile);
            
            for (const dir of dirs) {
                const subResults = await listDirectory(path.join(dirPath, dir.name), { recursive: true });
                dir.children = subResults;
            }
            
            return [...dirs, ...files];
        }
        
        return { success: true, entries: results };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Get file info
async function getFileInfo(filePath) {
    try {
        const stats = await fs.promises.stat(filePath);
        return {
            success: true,
            info: {
                name: path.basename(filePath),
                path: filePath,
                directory: path.dirname(filePath),
                extension: path.extname(filePath),
                size: stats.size,
                isDirectory: stats.isDirectory(),
                isFile: stats.isFile(),
                created: stats.birthtime.toISOString(),
                modified: stats.mtime.toISOString(),
                accessed: stats.atime.toISOString()
            }
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Search for pattern in file
async function searchInFile(filePath, pattern, options = {}) {
    const { caseSensitive = true, wholeWord = false, regex = false } = options;
    
    try {
        const result = await readChunked(filePath);
        if (!result.success) {
            return result;
        }
        
        let searchPattern = pattern;
        if (!regex) {
            searchPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
        if (wholeWord) {
            searchPattern = '\\b' + searchPattern + '\\b';
        }
        
        const flags = caseSensitive ? 'g' : 'gi';
        const re = new RegExp(searchPattern, flags);
        
        const matches = result.content.match(re);
        
        return {
            success: true,
            pattern: pattern,
            matches: matches ? matches.length : 0,
            found: matches ? true : false
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Replace all occurrences in file
async function replaceInFile(filePath, search, replace, options = {}) {
    const { caseSensitive = true, regex = false } = options;
    
    try {
        const result = await readChunked(filePath);
        if (!result.success) {
            return result;
        }
        
        let searchPattern = search;
        if (!regex) {
            searchPattern = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
        
        const flags = caseSensitive ? 'g' : 'gi';
        const re = new RegExp(searchPattern, flags);
        
        const matchCount = (result.content.match(re) || []).length;
        const newContent = result.content.replace(re, replace);
        
        const writeResult = await writeChunked(filePath, newContent);
        
        return {
            success: writeResult.success,
            replacements: matchCount,
            bytesWritten: writeResult.bytesWritten,
            error: writeResult.error
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Read specific line range
async function readFileLines(filePath, startLine, endLine) {
    try {
        const result = await readChunked(filePath);
        if (!result.success) {
            return result;
        }
        
        const lines = result.content.split(/\r?\n/);
        const requestedLines = lines.slice(startLine - 1, endLine);
        
        return {
            success: true,
            lines: requestedLines,
            totalLines: lines.length,
            startLine,
            endLine
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Ensure directory exists
async function ensureDirectory(dirPath) {
    try {
        await fs.promises.mkdir(dirPath, { recursive: true });
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { init };
