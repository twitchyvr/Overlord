/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Agent Permissions
   ═══════════════════════════════════════════════════════════════════
   Capability management: manages which capabilities an agent has,
   handles capability categories.

   Extracted from agent-manager.js for modularity.
   Dependencies: engine.js (Component, OverlordUI, h)
   ═══════════════════════════════════════════════════════════════════ */

import { Component, OverlordUI, h } from '../engine.js';

/**
 * Default capability categories
 */
export const DEFAULT_CAPABILITY_CATEGORIES = {
    'code': {
        label: 'Code',
        description: 'Code reading and writing capabilities',
        capabilities: ['read_code', 'write_code', 'refactor_code', 'debug_code']
    },
    'file': {
        label: 'File System',
        description: 'File and directory operations',
        capabilities: ['read_files', 'write_files', 'delete_files', 'create_dirs', 'list_dirs']
    },
    'exec': {
        label: 'Execution',
        description: 'Command execution and process control',
        capabilities: ['run_commands', 'manage_processes', 'kill_process']
    },
    'network': {
        label: 'Network',
        description: 'Network operations',
        capabilities: ['http_requests', 'web_scraping', 'socket_connections']
    },
    'ai': {
        label: 'AI & ML',
        description: 'AI and machine learning capabilities',
        capabilities: ['ai_generate', 'ai_analyze', 'ai_translate']
    },
    'security': {
        label: 'Security',
        description: 'Security and access control',
        capabilities: ['encrypt', 'decrypt', 'authenticate', 'manage_keys']
    }
};

/**
 * Get capability category info
 * @param {string} category - Category key
 * @returns {object|null}
 */
export function getCategoryInfo(category) {
    return DEFAULT_CAPABILITY_CATEGORIES[category] || null;
}

/**
 * Get all category keys
 * @returns {string[]}
 */
export function getAllCategories() {
    return Object.keys(DEFAULT_CAPABILITY_CATEGORIES);
}

/**
 * Get capabilities for a category
 * @param {string} category - Category key
 * @returns {string[]}
 */
export function getCapabilitiesForCategory(category) {
    const cat = DEFAULT_CAPABILITY_CATEGORIES[category];
    return cat ? cat.capabilities : [];
}

/**
 * Get all available capabilities
 * @returns {string[]}
 */
export function getAllCapabilities() {
    const caps = [];
    for (const cat of Object.values(DEFAULT_CAPABILITY_CATEGORIES)) {
        caps.push(...cat.capabilities);
    }
    return [...new Set(caps)];
}

/**
 * Get category for a capability
 * @param {string} capability - Capability name
 * @returns {string|null}
 */
export function getCategoryForCapability(capability) {
    for (const [cat, info] of Object.entries(DEFAULT_CAPABILITY_CATEGORIES)) {
        if (info.capabilities.includes(capability)) {
            return cat;
        }
    }
    return null;
}

/**
 * Build the capability management UI
 * @param {object} params - Parameters
 * @param {object} params.toolCategories - Tool categories from server
 * @param {Array} params.currentTools - Currently selected tools
 * @param {object} params.agent - Agent object with forcedTools/blockedTools
 * @param {Function} params.onChange - Change handler
 * @returns {HTMLElement}
 */
export function buildCapabilityManager({
    toolCategories = {},
    currentTools = [],
    agent = {},
    onChange
}) {
    const container = document.createElement('div');
    container.className = 'agent-permissions';

    const forcedTools = agent.forcedTools || [];
    const blockedTools = agent.blockedTools || [];

    // If we have server-provided categories, use those; otherwise use defaults
    const categories = Object.keys(toolCategories).length > 0 ? toolCategories : DEFAULT_CAPABILITY_CATEGORIES;

    for (const [cat, tools] of Object.entries(categories)) {
        const catDiv = document.createElement('div');
        catDiv.className = 'am-perm-category';

        // Category header
        const catInfo = DEFAULT_CAPABILITY_CATEGORIES[cat];
        const catLabel = catInfo ? catInfo.label : cat;
        const catDesc = catInfo ? catInfo.description : '';

        const header = h('div', {
            class: 'am-perm-category-header',
            style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }
        },
            h('span', {
                style: { fontSize: '11px', fontWeight: '600', color: 'var(--text-primary)', textTransform: 'capitalize' }
            }, catLabel),
            catDesc ? h('span', {
                style: { fontSize: '10px', color: 'var(--text-muted)' }
            }, '— ' + catDesc) : null
        );
        catDiv.appendChild(header);

        // Tools grid
        const toolsGrid = h('div', {
            class: 'am-perm-tools-grid',
            style: { display: 'flex', flexWrap: 'wrap', gap: '6px' }
        });

        for (const tool of tools) {
            const isForced = forcedTools.includes(tool);
            const isBlocked = blockedTools.includes(tool);
            const isSelected = currentTools.includes(tool);

            const toolChip = buildToolChip({
                tool,
                isForced,
                isBlocked,
                isSelected,
                onChange
            });
            toolsGrid.appendChild(toolChip);
        }

        catDiv.appendChild(toolsGrid);
        container.appendChild(catDiv);
    }

    return container;
}

/**
 * Build a single tool capability chip
 * @param {object} params - Parameters
 * @param {string} params.tool - Tool name
 * @param {boolean} params.isForced - Tool is forced (required)
 * @param {boolean} params.isBlocked - Tool is blocked
 * @param {boolean} params.isSelected - Tool is selected
 * @param {Function} params.onChange - Change handler
 * @returns {HTMLElement}
 */
export function buildToolChip({
    tool,
    isForced = false,
    isBlocked = false,
    isSelected = false,
    onChange
}) {
    const chip = document.createElement('label');
    chip.className = 'am-perm-chip';
    
    if (isForced) {
        chip.style.color = 'var(--accent-primary)';
        chip.style.cursor = 'default';
        chip.title = 'Required — cannot remove';
    } else if (isBlocked) {
        chip.style.opacity = '0.35';
        chip.style.cursor = 'not-allowed';
        chip.title = 'Blocked — cannot add';
    } else {
        chip.style.cursor = 'pointer';
        chip.title = tool;
    }

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'am-perm-chk';
    checkbox.value = tool;
    checkbox.style.accentColor = isForced ? 'var(--accent-primary)' : 'var(--accent-green)';

    if (isForced) {
        checkbox.checked = true;
        checkbox.disabled = true;
    } else if (isBlocked) {
        checkbox.checked = false;
        checkbox.disabled = true;
    } else {
        checkbox.checked = isSelected;
        checkbox.addEventListener('change', onChange);
    }

    chip.appendChild(checkbox);
    chip.appendChild(document.createTextNode(tool));

    if (isForced) {
        const lockIcon = document.createElement('span');
        lockIcon.textContent = '��';
        lockIcon.style.fontSize = '9px';
        lockIcon.style.marginLeft = '2px';
        chip.appendChild(lockIcon);
    } else if (isBlocked) {
        const blockIcon = document.createElement('span');
        blockIcon.textContent = '⛔';
        blockIcon.style.fontSize = '9px';
        blockIcon.style.marginLeft = '2px';
        chip.appendChild(blockIcon);
    }

    return chip;
}

/**
 * Build tool permissions UI (legacy compatibility)
 * This is the function used by agent-manager.js
 * @param {HTMLElement} container - Container element
 * @param {object} categories - Tool categories
 * @param {Array} currentTools - Currently selected tools
 * @param {object} agent - Agent object
 */
export function renderToolPermissions(container, categories, currentTools, agent) {
    container.textContent = '';

    const forcedTools = agent.forcedTools || [];
    const blockedTools = agent.blockedTools || [];

    for (const [cat, tools] of Object.entries(categories || {})) {
        const catDiv = document.createElement('div');
        catDiv.className = 'am-tool-cat';
        
        const catSpan = document.createElement('span');
        catSpan.style.cssText = 'font-size:10px;color:var(--text-muted);width:70px;flex-shrink:0;text-transform:uppercase;';
        catSpan.textContent = cat;
        catDiv.appendChild(catSpan);

        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;';
        
        for (const tool of tools) {
            const isForced = forcedTools.includes(tool);
            const isBlocked = blockedTools.includes(tool);
            const inCurrent = currentTools.includes(tool);

            const lbl = document.createElement('label');
            lbl.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:10px;cursor:pointer;white-space:nowrap;';
            if (isForced) { lbl.style.color = 'var(--accent-primary,#58a6ff)'; lbl.title = 'Required — cannot remove'; }
            else if (isBlocked) { lbl.style.opacity = '0.35'; lbl.title = 'Blocked — cannot add'; }
            else { lbl.style.color = 'var(--text-primary)'; }

            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.className = 'am-tool-chk';
            chk.value = tool;
            chk.style.accentColor = isForced ? 'var(--accent-primary,#58a6ff)' : 'var(--accent-green)';

            if (isForced) { chk.checked = true; chk.disabled = true; }
            else if (isBlocked) { chk.checked = false; chk.disabled = true; }
            else { chk.checked = inCurrent; }

            lbl.appendChild(chk);
            lbl.appendChild(document.createTextNode(tool));
            if (isForced) { const ic = document.createElement('span'); ic.textContent = '��'; ic.style.fontSize = '9px'; lbl.appendChild(ic); }
            else if (isBlocked) { const ic = document.createElement('span'); ic.textContent = '⛔'; ic.style.fontSize = '9px'; lbl.appendChild(ic); }
            wrap.appendChild(lbl);
        }
        
        catDiv.appendChild(wrap);
        container.appendChild(catDiv);
    }
}

/**
 * Get selected tools from a container
 * @param {HTMLElement} container - Container with checkboxes
 * @param {object} agent - Agent with forcedTools/blockedTools
 * @returns {string[]}
 */
export function getSelectedTools(container, agent) {
    if (!container) return [];

    const forcedTools = agent.forcedTools || [];
    const blockedTools = agent.blockedTools || [];

    let selected = [...container.querySelectorAll('.am-tool-chk:checked:not(:disabled)')].map(cb => cb.value);
    for (const t of forcedTools) { if (!selected.includes(t)) selected.push(t); }
    selected = selected.filter(t => !blockedTools.includes(t));
    return selected;
}

/**
 * Get selected tools (alternative method for am-perm-chk class)
 * @param {HTMLElement} container - Container with checkboxes
 * @param {object} agent - Agent with forcedTools/blockedTools
 * @returns {string[]}
 */
export function getSelectedPermissions(container, agent) {
    if (!container) return [];

    const forcedTools = agent.forcedTools || [];
    const blockedTools = agent.blockedTools || [];

    let selected = [...container.querySelectorAll('.am-perm-chk:checked:not(:disabled)')].map(cb => cb.value);
    for (const t of forcedTools) { if (!selected.includes(t)) selected.push(t); }
    selected = selected.filter(t => !blockedTools.includes(t));
    return selected;
}

/**
 * Build a category filter for tool selection
 * @param {object} params - Parameters
 * @param {Array} params.categories - Available categories
 * @param {string} params.selectedCategory - Currently selected category
 * @param {Function} params.onSelect - Selection handler
 * @returns {HTMLElement}
 */
export function buildCategoryFilter({
    categories = [],
    selectedCategory = 'all',
    onSelect
}) {
    const container = h('div', {
        class: 'am-perm-category-filter',
        style: { display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }
    });

    // "All" option
    const allBtn = h('button', {
        class: 'am-perm-filter-btn' + (selectedCategory === 'all' ? ' active' : ''),
        style: { padding: '4px 10px', background: selectedCategory === 'all' ? 'var(--accent-primary)' : 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', color: selectedCategory === 'all' ? '#000' : 'var(--text-primary)', fontSize: '11px', fontWeight: '500' },
        onClick: () => onSelect && onSelect('all')
    }, 'All');
    container.appendChild(allBtn);

    // Category buttons
    for (const cat of categories) {
        const catInfo = DEFAULT_CAPABILITY_CATEGORIES[cat];
        const label = catInfo ? catInfo.label : cat;
        
        const btn = h('button', {
            class: 'am-perm-filter-btn' + (selectedCategory === cat ? ' active' : ''),
            style: { padding: '4px 10px', background: selectedCategory === cat ? 'var(--accent-primary)' : 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', color: selectedCategory === cat ? '#000' : 'var(--text-primary)', fontSize: '11px', fontWeight: '500' },
            onClick: () => onSelect && onSelect(cat)
        }, label);
        container.appendChild(btn);
    }

    return container;
}

/**
 * Build a summary of selected capabilities
 * @param {Array} selectedTools - Selected tool names
 * @param {object} categories - Tool categories
 * @returns {HTMLElement}
 */
export function buildCapabilitySummary(selectedTools = [], categories = {}) {
    const container = h('div', {
        class: 'am-perm-summary',
        style: { fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }
    });

    if (!selectedTools.length) {
        container.textContent = 'No capabilities selected';
        return container;
    }

    // Group by category
    const byCategory = {};
    for (const tool of selectedTools) {
        let found = false;
        for (const [cat, tools] of Object.entries(categories)) {
            if (tools.includes(tool)) {
                if (!byCategory[cat]) byCategory[cat] = [];
                byCategory[cat].push(tool);
                found = true;
                break;
            }
        }
        if (!found) {
            if (!byCategory['other']) byCategory['other'] = [];
            byCategory['other'].push(tool);
        }
    }

    const parts = [];
    for (const [cat, tools] of Object.entries(byCategory)) {
        const catInfo = DEFAULT_CAPABILITY_CATEGORIES[cat];
        const label = catInfo ? catInfo.label : cat;
        parts.push(`${label}: ${tools.length}`);
    }

    container.textContent = parts.join(' | ') + ` (${selectedTools.length} total)`;
    return container;
}

/**
 * Check if a tool is available for an agent
 * @param {string} tool - Tool name
 * @param {object} agent - Agent object
 * @returns {string} - 'available', 'forced', 'blocked', or 'unknown'
 */
export function getToolStatus(tool, agent) {
    const forcedTools = agent.forcedTools || [];
    const blockedTools = agent.blockedTools || [];

    if (forcedTools.includes(tool)) return 'forced';
    if (blockedTools.includes(tool)) return 'blocked';
    return 'available';
}

/**
 * Build tool status indicator
 * @param {string} status - Tool status
 * @returns {HTMLElement}
 */
export function buildToolStatusIndicator(status) {
    const indicator = h('span', {
        class: 'am-perm-status',
        style: { fontSize: '9px', marginLeft: '4px' }
    });

    switch (status) {
        case 'forced':
            indicator.textContent = '��';
            indicator.title = 'Required — cannot remove';
            break;
        case 'blocked':
            indicator.textContent = '⛔';
            indicator.title = 'Blocked — cannot add';
            break;
        default:
            return null;
    }

    return indicator;
}

// Export component class for direct use
export class AgentPermissions extends Component {
    constructor(el, opts = {}) {
        super(el, opts);
        this._agent = opts.agent || {};
        this._toolCategories = opts.toolCategories || {};
        this._currentTools = opts.currentTools || [];
        this._onChange = opts.onChange || (() => {});
    }

    mount() {
        this._mounted = true;
        this.render();
    }

    render() {
        const perms = buildCapabilityManager({
            toolCategories: this._toolCategories,
            currentTools: this._currentTools,
            agent: this._agent,
            onChange: (e) => {
                const tools = getSelectedPermissions(this.el, this._agent);
                this._currentTools = tools;
                this._onChange(tools);
            }
        });
        this.el.textContent = '';
        this.el.appendChild(perms);
    }

    getSelectedTools() {
        return getSelectedPermissions(this.el, this._agent);
    }

    setToolCategories(categories) {
        this._toolCategories = categories;
        this.render();
    }

    setCurrentTools(tools) {
        this._currentTools = tools;
        this.render();
    }

    setAgent(agent) {
        this._agent = agent;
        this.render();
    }
}
