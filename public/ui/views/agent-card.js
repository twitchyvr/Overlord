/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Agent Card
   ═══════════════════════════════════════════════════════════════════
   Compact agent display for team panel: shows agent icon, name, role
   in a small card format with status indicator.

   Extracted from agent-manager.js for modularity.
   Dependencies: engine.js (Component, OverlordUI, h)
   ═══════════════════════════════════════════════════════════════════ */

import { Component, OverlordUI, h } from '../engine.js';

/**
 * Default avatar colors for agents based on name hash
 */
const AVATAR_COLORS = [
    '#58a6ff', '#3fb950', '#d29922', '#f85149', '#a371f7',
    '#79c0ff', '#56d364', '#e3b341', '#ff7b72', '#d2a8ff'
];

/**
 * Get a consistent color for an agent based on their name
 * @param {string} name - Agent name
 * @returns {string} - Hex color code
 */
export function getAgentColor(name) {
    if (!name) return AVATAR_COLORS[0];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * Get initials from agent name
 * @param {string} name - Agent name
 * @returns {string} - 2-letter initials
 */
export function getAgentInitials(name) {
    if (!name) return '??';
    const parts = name.split(/[-_\s]/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
}

/**
 * Build an agent card element
 * @param {object} params - Parameters for building the card
 * @param {string} params.name - Agent name (required)
 * @param {string} params.role - Agent role title
 * @param {string} params.status - Current status (idle, working, paused, error)
 * @param {boolean} params.builtIn - Whether agent is built-in
 * @param {boolean} params.selected - Whether card is selected
 * @param {Function} params.onClick - Click handler
 * @param {Function} params.onContextMenu - Right-click handler
 * @returns {HTMLElement}
 */
export function buildAgentCard({
    name,
    role,
    status = 'idle',
    builtIn = false,
    selected = false,
    onClick,
    onContextMenu
}) {
    const color = getAgentColor(name);
    const initials = getAgentInitials(name);

    const statusClass = getStatusClass(status);

    const card = h('div', {
        class: 'am-agent-card' + (selected ? ' selected' : ''),
        onClick,
        onContextMenu
    });

    // Avatar
    const avatar = h('div', {
        class: 'am-agent-avatar',
        style: { backgroundColor: color }
    }, initials);

    // Status dot
    const statusDot = h('div', {
        class: 'am-agent-dot ' + statusClass
    });

    // Content
    const content = h('div', { class: 'am-agent-info' },
        h('div', { class: 'am-agent-name', style: { fontWeight: '600', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '4px' } },
            name,
            builtIn ? h('span', { style: { fontSize: '9px', background: 'rgba(88,166,255,0.2)', color: 'var(--accent-primary,#58a6ff)', borderRadius: '3px', padding: '1px 4px', letterSpacing: '0.04em', flexShrink: '0' } }, 'BUILT-IN') : null
        ),
        h('div', { class: 'am-agent-role', style: { fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
            role || ''
        )
    );

    card.appendChild(avatar);
    card.appendChild(statusDot);
    card.appendChild(content);

    return card;
}

/**
 * Build a compact agent row (for sidebar lists)
 * @param {object} params - Parameters
 * @param {string} params.name - Agent name
 * @param {string} params.role - Agent role
 * @param {boolean} params.builtIn - Built-in flag
 * @param {boolean} params.selected - Selected state
 * @param {Function} params.onClick - Click handler
 * @returns {HTMLElement}
 */
export function buildAgentRow({
    name,
    role,
    builtIn = false,
    selected = false,
    onClick
}) {
    const row = h('div', {
        class: 'am-agent-row' + (selected ? ' selected' : ''),
        onClick
    });

    const dot = h('div', { class: 'am-agent-dot' });

    const info = h('div', { style: { flex: '1', overflow: 'hidden' } },
        h('div', { style: { fontWeight: '600', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '4px' } },
            name,
            builtIn ? h('span', { style: { fontSize: '9px', background: 'rgba(88,166,255,0.2)', color: 'var(--accent-primary,#58a6ff)', borderRadius: '3px', padding: '1px 4px', letterSpacing: '0.04em', flexShrink: '0' } }, 'BUILT-IN') : null
        ),
        h('div', { style: { fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, role || '')
    );

    row.appendChild(dot);
    row.appendChild(info);

    return row;
}

/**
 * Get status CSS class based on status string
 * @param {string} status - Status string
 * @returns {string} - CSS class name
 */
export function getStatusClass(status) {
    switch (status) {
        case 'working':
        case 'running':
            return 'working';
        case 'paused':
            return 'paused';
        case 'error':
        case 'failed':
            return 'error';
        case 'idle':
        default:
            return 'idle';
    }
}

/**
 * Get status label text
 * @param {string} status - Status string
 * @returns {string} - Human readable status
 */
export function getStatusLabel(status) {
    switch (status) {
        case 'working':
        case 'running':
            return 'Working';
        case 'paused':
            return 'Paused';
        case 'error':
        case 'failed':
            return 'Error';
        case 'idle':
        default:
            return 'Idle';
    }
}

/**
 * Render a list of agent cards
 * @param {object} params - Parameters
 * @param {Array} params.agents - Array of agent objects
 * @param {string} params.currentAgentId - Currently selected agent ID
 * @param {Function} params.onSelect - Selection handler
 * @param {Function} params.onContextMenu - Right-click handler
 * @returns {HTMLElement}
 */
export function renderAgentList({
    agents = [],
    currentAgentId = null,
    onSelect,
    onContextMenu
}) {
    const container = h('div', { class: 'am-agent-list' });

    // Sort: built-in agents last
    const sorted = [...agents].sort((a, b) => (b.builtIn ? 1 : 0) - (a.builtIn ? 1 : 0));

    for (const agent of sorted) {
        const id = agent.id || agent.name;
        const card = buildAgentRow({
            name: agent.name || id,
            role: agent.role,
            builtIn: agent.builtIn,
            selected: id === currentAgentId,
            onClick: () => onSelect && onSelect(id)
        });
        container.appendChild(card);
    }

    return container;
}

/**
 * Build a mini agent chip for inline display
 * @param {object} params - Parameters
 * @param {string} params.name - Agent name
 * @param {string} params.role - Agent role
 * @param {string} params.status - Status
 * @returns {HTMLElement}
 */
export function buildAgentChip({ name, role, status = 'idle' }) {
    const statusClass = getStatusClass(status);
    const color = getAgentColor(name);
    const initials = getAgentInitials(name);

    return h('div', { class: 'am-agent-chip', style: { display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '3px 8px' } },
        h('div', { class: 'am-agent-chip-avatar', style: { width: '18px', height: '18px', borderRadius: '50%', backgroundColor: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: '600', color: '#000' } }, initials),
        h('div', { class: 'am-agent-chip-dot ' + statusClass, style: { width: '6px', height: '6px', borderRadius: '50%' } }),
        h('span', { style: { fontSize: '10px', color: 'var(--text-primary)' } }, name)
    );
}

// Export component class for direct use
export class AgentCard extends Component {
    constructor(el, opts = {}) {
        super(el, opts);
        this._agent = opts.agent || {};
        this._selected = opts.selected || false;
        this._onClick = opts.onClick || (() => {});
    }

    mount() {
        this._mounted = true;
        this.render();
    }

    render() {
        const card = buildAgentCard({
            name: this._agent.name,
            role: this._agent.role,
            status: this._agent.status,
            builtIn: this._agent.builtIn,
            selected: this._selected,
            onClick: () => this._onClick(this._agent)
        });
        this.el.textContent = '';
        this.el.appendChild(card);
    }

    update(agent, selected = false) {
        this._agent = agent;
        this._selected = selected;
        this.render();
    }
}
