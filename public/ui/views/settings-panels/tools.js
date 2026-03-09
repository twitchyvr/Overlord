/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Settings: Tools Panel
   ═══════════════════════════════════════════════════════════════════
   Tool enable/disable, tool-specific settings, MCP server management.

   Dependencies: engine.js, button.js
   ═══════════════════════════════════════════════════════════════════ */

import { h } from '../engine.js';
import { Button } from '../components/button.js';
import { OverlordUI } from '../engine.js';

/**
 * Render the Tools/MCP settings tab
 * @param {object} config - Current config
 * @param {object} socket - Socket connection
 * @param {Array} mcpServers - MCP server list
 * @returns {HTMLElement}
 */
export function renderToolsTab(config = {}, socket = null, mcpServers = []) {
    const panel = h('div', { class: 'settings-tab-panel' });

    // MCP server list
    const listHost = h('div', { 'data-ref': 'mcpList', class: 'mcp-server-list' });
    OverlordUI.setContent(listHost, h('div', {
        style: { color: 'var(--text-secondary)', fontSize: '11px' }
    }, 'Loading MCP servers...'));
    
    // Listen for server updates
    if (socket) {
        socket.on('mcp_servers_updated', (data) => {
            renderMcpServerList(listHost, data.servers || [], socket);
        });
    }

    panel.appendChild(buildSection('MCP Servers',
        'Model Context Protocol servers provide tools to the AI.',
        listHost
    ));

    // Add Custom Server form
    const addName = h('input', { 
        class: 'settings-input-full', 
        placeholder: 'Server name (e.g. my-server)', 
        'data-ref': 'mcpAddName' 
    });
    const addCmd = h('input', { 
        class: 'settings-input-full', 
        placeholder: 'Command (e.g. uvx or npx)', 
        'data-ref': 'mcpAddCmd' 
    });
    const addArgs = h('input', { 
        class: 'settings-input-full', 
        placeholder: 'Args JSON (e.g. ["my-mcp-package"])', 
        'data-ref': 'mcpAddArgs' 
    });
    const addDesc = h('input', { 
        class: 'settings-input-full', 
        placeholder: 'Description (optional)', 
        'data-ref': 'mcpAddDesc' 
    });
    
    const addBtn = Button.create('Add Server', {
        variant: 'primary', size: 'sm',
        onClick: () => addCustomMcpServer(addName, addCmd, addArgs, addDesc, socket)
    });
    
    const addForm = h('div', { class: 'mcp-add-form', style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        addName, addCmd, addArgs, addDesc, addBtn
    );
    
    panel.appendChild(buildSection('Add Custom Server', null, addForm));

    // Tool enable/disable section
    const toolsList = h('div', { class: 'tools-list' });
    
    // Default tools that can be toggled
    const defaultTools = [
        { id: 'bash', name: 'Bash', desc: 'Execute shell commands' },
        { id: 'read', name: 'Read Files', desc: 'Read file contents' },
        { id: 'write', name: 'Write Files', desc: 'Create and modify files' },
        { id: 'glob', name: 'Glob', desc: 'Find files by pattern' },
        { id: 'grep', name: 'Grep', desc: 'Search file contents' },
        { id: 'edit', name: 'Edit', desc: 'Edit existing files' },
        { id: 'mkdir', name: 'mkdir', desc: 'Create directories' },
        { id: 'rm', name: 'Remove', desc: 'Delete files and directories' },
        { id: 'move', name: 'Move', desc: 'Move/rename files' },
        { id: 'web_fetch', name: 'Web Fetch', desc: 'Fetch web pages' },
        { id: 'github', name: 'GitHub', desc: 'GitHub API operations' },
        { id: 'npm', name: 'NPM', desc: 'NPM package operations' },
        { id: 'git', name: 'Git', desc: 'Git operations' },
        { id: 'search', name: 'Search', desc: 'Search the web' },
        { id: 'analyze', name: 'Analyze', desc: 'Code analysis' },
        { id: 'test', name: 'Test', desc: 'Run tests' }
    ];

    defaultTools.forEach(tool => {
        const toggle = buildToolToggle(tool.id, tool.name, tool.desc, config, socket);
        toolsList.appendChild(toggle);
    });

    panel.appendChild(buildSection('Tools',
        'Enable or disable individual tools for this session.',
        toolsList
    ));

    return panel;
}

/**
 * Render the MCP server list
 */
function renderMcpServerList(container, servers, socket) {
    container.textContent = '';

    if (!servers.length) {
        container.appendChild(h('div', {
            style: { color: 'var(--text-secondary)', fontSize: '11px' }
        }, 'No servers configured.'));
        return;
    }

    const frag = document.createDocumentFragment();
    servers.forEach(srv => {
        const toggleLabel = srv.enabled ? 'Disable' : 'Enable';
        const toolsText = srv.tools && srv.tools.length
            ? srv.tools.slice(0, 5).join(', ') + (srv.tools.length > 5 ? '...' : '')
            : 'No tools';

        const envInput = h('input', {
            class: 'settings-input-full',
            placeholder: 'ENV_VAR=value (e.g. GITHUB_TOKEN=ghp_xxx)',
            'data-srv-env': srv.name
        });
        
        const envBtn = Button.create('Connect', {
            variant: 'primary', size: 'sm',
            onClick: () => submitMcpEnv(srv.name, envInput, socket)
        });
        
        const envForm = h('div', {
            class: 'mcp-env-form',
            style: { display: 'none', marginTop: '6px' }
        }, envInput, envBtn);

        const toggleBtn = Button.create(toggleLabel, {
            variant: srv.enabled ? 'danger' : 'primary', size: 'sm',
            onClick: () => toggleMcpServer(srv.name, srv.enabled, envForm, socket)
        });

        const header = h('div', {
            style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }
        },
            h('span', { style: { fontWeight: '600', fontSize: '12px' } }, srv.name),
            srv.builtin ? h('span', {
                style: { fontSize: '9px', color: 'var(--text-secondary)' }
            }, '[builtin]') : null,
            h('span', {
                class: 'mcp-server-status ' + (srv.status || ''),
                style: { fontSize: '10px', textTransform: 'uppercase', marginLeft: 'auto' }
            }, (srv.status || 'unknown').toUpperCase()),
            toggleBtn
        );

        const desc = srv.description
            ? h('div', { style: { fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' } }, srv.description)
            : null;

        const tools = srv.enabled && srv.toolCount
            ? h('div', { style: { fontSize: '10px', color: 'var(--text-muted)' } },
                srv.toolCount + ' tools: ' + toolsText)
            : null;

        const item = h('div', {
            class: 'mcp-server-item',
            style: { padding: '10px 0', borderBottom: '1px solid var(--glass-border)' }
        }, header, desc, tools, envForm);

        frag.appendChild(item);
    });

    container.appendChild(frag);
}

/**
 * Toggle MCP server enabled state
 */
function toggleMcpServer(name, currentlyEnabled, envForm, socket) {
    if (!socket) return;
    if (currentlyEnabled) {
        socket.emit('disable_mcp_server', { name });
    } else {
        socket.emit('enable_mcp_server', { name, env: {} });
    }
}

/**
 * Submit MCP server environment variables
 */
function submitMcpEnv(name, inputEl, socket) {
    if (!socket) return;
    const val = inputEl.value.trim();
    const env = {};
    if (val.includes('=')) {
        const [k, ...rest] = val.split('=');
        env[k.trim()] = rest.join('=').trim();
    }
    socket.emit('enable_mcp_server', { name, env });
}

/**
 * Add custom MCP server
 */
function addCustomMcpServer(nameEl, cmdEl, argsEl, descEl, socket) {
    if (!socket) return;
    const name = nameEl.value.trim();
    const command = cmdEl.value.trim();
    const argsStr = argsEl.value.trim();
    const desc = descEl.value.trim();

    if (!name || !command) return;

    let args = [];
    try {
        args = argsStr ? JSON.parse(argsStr) : [];
    } catch (_e) {
        args = argsStr ? argsStr.split(' ') : [];
    }

    socket.emit('add_mcp_server', { name, command, args, description: desc });

    // Clear form
    nameEl.value = '';
    cmdEl.value = '';
    argsEl.value = '';
    descEl.value = '';
}

/**
 * Build a tool toggle
 */
function buildToolToggle(toolId, toolName, toolDesc, config, socket) {
    const isEnabled = config.enabledTools?.includes(toolId) || !config.disabledTools?.includes(toolId);
    
    const toggle = h('label', { 
        class: 'tool-toggle',
        style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0', borderBottom: '1px solid var(--glass-border)' }
    });
    
    const checkbox = h('input', { 
        type: 'checkbox',
        'data-tool': toolId,
        checked: isEnabled
    });
    checkbox.addEventListener('change', () => {
        if (socket) {
            const disabledTools = config.disabledTools || [];
            if (checkbox.checked) {
                // Enable tool
                socket.emit('update_config', { 
                    disabledTools: disabledTools.filter(t => t !== toolId) 
                });
            } else {
                // Disable tool
                socket.emit('update_config', { 
                    disabledTools: [...disabledTools, toolId] 
                });
            }
        }
    });
    
    const info = h('div', { style: { flex: '1' } },
        h('div', { style: { fontWeight: '600', fontSize: '12px' } }, toolName),
        h('div', { style: { fontSize: '10px', color: 'var(--text-muted)' } }, toolDesc)
    );
    
    toggle.appendChild(checkbox);
    toggle.appendChild(info);
    
    return toggle;
}

// Helper functions
function buildSection(title, desc, ...children) {
    const sec = h('div', { class: 'settings-section' });
    sec.appendChild(h('div', { class: 'settings-section-title' }, title));
    if (desc) sec.appendChild(h('div', { class: 'settings-section-desc' }, desc));
    children.forEach(child => { if (child) sec.appendChild(child); });
    return sec;
}
