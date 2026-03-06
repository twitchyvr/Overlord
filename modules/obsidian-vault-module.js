// ==================== OBSIDIAN VAULT MODULE ====================
// Makes Overlord "Obsidian-aware" — discovers vaults, registers AI tools
// for reading/writing/searching vault notes, and injects vault context
// into the system prompt when configured.
//
// Integration paths:
//   1. Direct filesystem — works with any Obsidian vault (no plugins needed)
//   2. MCP preset — for the Obsidian Local REST API plugin (richer integration)

const fs = require('fs');
const path = require('path');
const os = require('os');

let hub = null;

function init(h) {
    hub = h;

    const config = hub.getService('config');
    const tools  = hub.getService('tools');

    // ══════════════════════════════════════════════════════════════
    //  VAULT DISCOVERY
    // ══════════════════════════════════════════════════════════════

    /**
     * Scan common locations for Obsidian vaults.
     * A vault is any directory containing a `.obsidian/` subdirectory.
     */
    function discoverVaults() {
        const home = os.homedir();
        const candidates = [
            home,
            path.join(home, 'Documents'),
            path.join(home, 'Obsidian'),
            path.join(home, 'vaults'),
            path.join(home, 'Desktop'),
            path.join(home, 'Dropbox'),
            path.join(home, 'OneDrive'),
            path.join(home, 'iCloud Drive'),
            path.join(home, 'Library', 'Mobile Documents', 'iCloud~md~obsidian', 'Documents')
        ];

        const vaults = [];
        const seen = new Set();

        for (const dir of candidates) {
            if (!fs.existsSync(dir)) continue;
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    const fullPath = path.join(dir, entry.name);
                    if (seen.has(fullPath)) continue;
                    const obsDir = path.join(fullPath, '.obsidian');
                    if (fs.existsSync(obsDir)) {
                        seen.add(fullPath);
                        vaults.push({
                            name: entry.name,
                            path: fullPath
                        });
                    }
                }
            } catch (e) {
                // Permission errors, etc. — skip silently
            }
        }

        return vaults;
    }

    // ══════════════════════════════════════════════════════════════
    //  HELPER: Recursive markdown file listing
    // ══════════════════════════════════════════════════════════════

    function listMdFiles(dir, maxDepth = 10, depth = 0) {
        const results = [];
        if (!fs.existsSync(dir) || depth > maxDepth) return results;
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
                if (e.name.startsWith('.')) continue; // Skip .obsidian, .trash, etc.
                const full = path.join(dir, e.name);
                if (e.isDirectory()) {
                    results.push(...listMdFiles(full, maxDepth, depth + 1));
                } else if (e.name.endsWith('.md')) {
                    results.push(full);
                }
            }
        } catch (e) {
            // Skip unreadable directories
        }
        return results;
    }

    // ══════════════════════════════════════════════════════════════
    //  HELPER: Get configured vault path
    // ══════════════════════════════════════════════════════════════

    function getVaultPath() {
        return config?.get?.('obsidianVaultPath') || config?.obsidianVaultPath || null;
    }

    // ══════════════════════════════════════════════════════════════
    //  REGISTER AI TOOLS
    // ══════════════════════════════════════════════════════════════

    if (tools && tools.registerTool) {

        tools.registerTool({
            name: 'vault_list_notes',
            description: 'List all markdown notes in the configured Obsidian vault. Returns relative paths.',
            parameters: {
                type: 'object',
                properties: {
                    folder: {
                        type: 'string',
                        description: 'Subfolder to list (relative to vault root). Omit to list all notes.'
                    }
                }
            }
        }, async (params) => {
            const vaultPath = getVaultPath();
            if (!vaultPath) return 'No Obsidian vault configured. Ask the user to set one in Settings → Obsidian.';
            const target = params.folder ? path.join(vaultPath, params.folder) : vaultPath;
            if (!fs.existsSync(target)) return 'Folder not found: ' + (params.folder || vaultPath);
            const files = listMdFiles(target);
            if (files.length === 0) return 'No markdown notes found in ' + (params.folder || 'vault root');
            return files.map(f => path.relative(vaultPath, f)).join('\n');
        });

        tools.registerTool({
            name: 'vault_read_note',
            description: 'Read a markdown note from the Obsidian vault. Returns the full file content including YAML frontmatter.',
            parameters: {
                type: 'object',
                properties: {
                    notePath: {
                        type: 'string',
                        description: 'Path to the note relative to vault root (e.g., "Projects/my-project.md")'
                    }
                },
                required: ['notePath']
            }
        }, async (params) => {
            const vaultPath = getVaultPath();
            if (!vaultPath) return 'No Obsidian vault configured.';
            const fullPath = path.join(vaultPath, params.notePath);
            // Security: ensure path stays within vault
            if (!fullPath.startsWith(vaultPath)) return 'Access denied: path outside vault.';
            if (!fs.existsSync(fullPath)) return 'Note not found: ' + params.notePath;
            try {
                return fs.readFileSync(fullPath, 'utf8');
            } catch (e) {
                return 'Error reading note: ' + e.message;
            }
        });

        tools.registerTool({
            name: 'vault_write_note',
            description: 'Create or update a markdown note in the Obsidian vault. Creates directories as needed.',
            parameters: {
                type: 'object',
                properties: {
                    notePath: {
                        type: 'string',
                        description: 'Path relative to vault root (e.g., "Projects/new-project.md")'
                    },
                    content: {
                        type: 'string',
                        description: 'Markdown content to write (can include YAML frontmatter)'
                    }
                },
                required: ['notePath', 'content']
            }
        }, async (params) => {
            const vaultPath = getVaultPath();
            if (!vaultPath) return 'No Obsidian vault configured.';
            const fullPath = path.join(vaultPath, params.notePath);
            if (!fullPath.startsWith(vaultPath)) return 'Access denied: path outside vault.';
            try {
                const dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                const existed = fs.existsSync(fullPath);
                fs.writeFileSync(fullPath, params.content, 'utf8');
                return (existed ? 'Updated' : 'Created') + ' note: ' + params.notePath;
            } catch (e) {
                return 'Error writing note: ' + e.message;
            }
        });

        tools.registerTool({
            name: 'vault_search',
            description: 'Search for notes in the Obsidian vault by keyword. Searches both filenames and content.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search query (case-insensitive, searches filenames and content)'
                    },
                    maxResults: {
                        type: 'number',
                        description: 'Maximum number of results to return (default: 20)'
                    }
                },
                required: ['query']
            }
        }, async (params) => {
            const vaultPath = getVaultPath();
            if (!vaultPath) return 'No Obsidian vault configured.';
            const files = listMdFiles(vaultPath);
            const results = [];
            const q = params.query.toLowerCase();
            const max = params.maxResults || 20;

            for (const f of files) {
                if (results.length >= max) break;
                const rel = path.relative(vaultPath, f);

                // Filename match
                if (rel.toLowerCase().includes(q)) {
                    results.push({ path: rel, match: 'filename' });
                    continue;
                }

                // Content match
                try {
                    const content = fs.readFileSync(f, 'utf8');
                    const idx = content.toLowerCase().indexOf(q);
                    if (idx !== -1) {
                        const start = Math.max(0, idx - 60);
                        const end   = Math.min(content.length, idx + q.length + 60);
                        const snippet = (start > 0 ? '…' : '') +
                            content.substring(start, end).replace(/\n/g, ' ') +
                            (end < content.length ? '…' : '');
                        results.push({ path: rel, match: 'content', snippet });
                    }
                } catch (e) {
                    // Skip unreadable files
                }
            }

            if (results.length === 0) return 'No matches found for: ' + params.query;
            return JSON.stringify(results, null, 2);
        });

        hub.log('[Obsidian] 4 vault tools registered (vault_list_notes, vault_read_note, vault_write_note, vault_search)', 'info');
    }

    // ══════════════════════════════════════════════════════════════
    //  SOCKET EVENTS
    // ══════════════════════════════════════════════════════════════

    hub.on('discover_vaults', (socket) => {
        const vaults = discoverVaults();
        hub.log('[Obsidian] Discovered ' + vaults.length + ' vault(s)', 'info');
        socket.emit('vaults_discovered', vaults);
    });

    hub.on('set_vault_path', (data) => {
        if (!data || !data.path) return;
        if (config && config.set) {
            config.set('obsidianVaultPath', data.path);
        } else if (config) {
            config.obsidianVaultPath = data.path;
        }
        hub.broadcastAll('config_updated', config.getAll ? config.getAll() : config);
        hub.log('[Obsidian] Vault path set: ' + data.path, 'success');
    });

    hub.on('clear_vault_path', () => {
        if (config && config.set) {
            config.set('obsidianVaultPath', '');
        } else if (config) {
            config.obsidianVaultPath = '';
        }
        hub.broadcastAll('config_updated', config.getAll ? config.getAll() : config);
        hub.log('[Obsidian] Vault path cleared', 'info');
    });

    // ══════════════════════════════════════════════════════════════
    //  SYSTEM PROMPT INJECTION
    // ══════════════════════════════════════════════════════════════

    // If hub supports registering system prompt sections, inject vault awareness
    if (typeof hub.registerSystemPromptSection === 'function') {
        hub.registerSystemPromptSection('obsidian', () => {
            const vaultPath = getVaultPath();
            if (!vaultPath) return '';
            return [
                '',
                '## Obsidian Vault',
                'You have access to an Obsidian vault at: ' + vaultPath,
                'When the user references their "vault", "notes", or "Obsidian", use these tools:',
                '- vault_list_notes: List all markdown notes in the vault',
                '- vault_read_note: Read a note by path (relative to vault root)',
                '- vault_write_note: Create or update a note',
                '- vault_search: Search notes by keyword (searches filenames and content)',
                ''
            ].join('\n');
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  REGISTER SERVICE
    // ══════════════════════════════════════════════════════════════

    hub.registerService('obsidian', {
        discoverVaults,
        getVaultPath,
        listNotes: (folder) => {
            const vaultPath = getVaultPath();
            if (!vaultPath) return [];
            const target = folder ? path.join(vaultPath, folder) : vaultPath;
            return listMdFiles(target).map(f => path.relative(vaultPath, f));
        }
    });

    hub.log('[Obsidian] Module initialized', 'info');
}

module.exports = { init };
