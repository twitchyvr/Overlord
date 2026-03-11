/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Agent List
   ═══════════════════════════════════════════════════════════════════
   Agent list rendering: buildAgentList(), filtering, sorting, agent cards

   Dependencies: engine.js
   ═══════════════════════════════════════════════════════════════════ */

import { h } from '../engine.js';
import { OverlordUI } from '../engine.js';

/**
 * Build an agent card
 * @param {object} agent - Agent data
 * @param {object} opts - Options
 * @returns {HTMLElement}
 */
export function buildAgentCard(agent, opts = {}) {
    const { sessionState = {}, agentStats = {}, sparklineRenderer = null, onAction = null } = opts;
    
    const ses = sessionState;
    const isWorking = ses.isProcessing || (agent.status || '').toLowerCase() === 'thinking';
    const isOnDeck = !isWorking && !ses.paused && ((ses.inboxCount || 0) > 0);
    const dotCls = ses.paused ? 'paused' : isWorking ? 'working' : isOnDeck ? 'on_deck' : 'idle';
    const effectiveStatus = ses.paused ? 'PAUSED' : isWorking ? 'WORKING' : isOnDeck ? 'ON DECK' : 'IDLE';
    const safeName = agent.name.replace(/\s+/g, '_');

    const card = h('div', {
        class: `agent-card agent-${dotCls}`,
        'data-agent': agent.name
    });

    // Header row
    const header = h('div', { class: 'agent-card-header', style: 'display:flex;align-items:center;gap:6px;padding:8px 10px;' });

    // Status dot
    header.appendChild(h('span', {
        class: `agent-status-dot ${dotCls}`,
        id: `agent-dot-${safeName}`
    }));

    // Name
    header.appendChild(h('span', { class: 'agent-card-name' }, agent.name || 'Agent'));

    // Scope badge
    if (agent.scope === 'project') {
        header.appendChild(h('span', {
            style: 'font-size:9px;background:rgba(120,83,15,0.4);color:#fcd34d;border:1px solid rgba(252,211,77,0.3);border-radius:3px;padding:1px 4px;',
            title: 'Project-only agent'
        }, 'P'));
    } else {
        header.appendChild(h('span', {
            style: 'font-size:9px;background:rgba(37,99,235,0.2);color:#93c5fd;border:1px solid rgba(147,197,253,0.2);border-radius:3px;padding:1px 4px;',
            title: 'Global agent'
        }, 'G'));
    }

    // Task count badge
    const tasks = OverlordUI._store?.peek('tasks.list', []) || [];
    const agentTaskCount = tasks.filter(t => !t.completed && t.assignee && (Array.isArray(t.assignee) ? t.assignee.includes(agent.name) : t.assignee === agent.name)).length;
    if (agentTaskCount > 0) {
        header.appendChild(h('span', {
            class: 'agent-task-badge',
            title: `${agentTaskCount} active task(s) assigned`
        }, String(agentTaskCount)));
    }

    // Inbox badge
    const inboxCnt = ses.inboxCount || agent.inboxCount || 0;
    header.appendChild(h('span', {
        class: 'agent-inbox-badge',
        id: `agent-inbox-${safeName}`,
        style: inboxCnt > 0 ? '' : 'display:none;'
    }, String(inboxCnt)));

    // Status badge
    header.appendChild(h('span', {
        class: `agent-badge ${effectiveStatus.toLowerCase()}`,
        id: `agent-status-badge-${safeName}`
    }, effectiveStatus));

    // Sparkline
    const sparkWrap = h('span', { id: `agent-sparkline-${safeName}` });
    if (sparklineRenderer) {
        sparkWrap.appendChild(sparklineRenderer(agent.name));
    }
    header.appendChild(sparkWrap);

    // Chat button
    header.appendChild(h('button', {
        class: 'agent-card-btn',
        title: `Chat with ${agent.name}`,
        dataset: { action: 'agent-chat', agent: agent.name }
    }, '��'));

    // Start Room button
    header.appendChild(h('button', {
        class: 'agent-card-btn',
        title: `Start a room with ${agent.name}`,
        dataset: { action: 'start-room', agent: agent.name }
    }, '��'));

    // Pause/resume button
    const pauseIcon = ses.paused ? '▶' : '⏸';
    header.appendChild(h('button', {
        class: 'agent-card-btn',
        id: `pause-btn-${safeName}`,
        title: ses.paused ? 'Resume agent' : 'Pause agent',
        dataset: { action: 'agent-pause', agent: agent.name }
    }, pauseIcon));

    card.appendChild(header);

    // Role
    if (agent.role) {
        card.appendChild(h('div', { class: 'agent-card-role' }, agent.role));
    }

    // Model badge
    if (agent.model) {
        card.appendChild(h('div', {
            style: 'font-size:9px;color:var(--text-muted);padding:0 10px 2px;opacity:0.7;'
        }, agent.model));
    }

    // Current task
    if (agent.currentTask) {
        card.appendChild(h('div', { class: 'agent-current-task' }, agent.currentTask));
    }

    // Capabilities
    if (agent.capabilities?.length) {
        const caps = h('div', { class: 'agent-caps' });
        agent.capabilities.slice(0, 5).forEach(c => caps.appendChild(h('span', { class: 'agent-cap' }, c)));
        if (agent.capabilities.length > 5) {
            caps.appendChild(h('span', { class: 'agent-cap', style: 'opacity:0.5;' }, `+${agent.capabilities.length - 5}`));
        }
        card.appendChild(caps);
    }

    // Stats
    const stats = agentStats;
    card.appendChild(h('div', {
        class: 'agent-stats-row',
        id: `agent-stats-${agent.name}`,
        style: 'font-size:9px;color:var(--text-muted);padding:2px 10px 6px;font-family:monospace;'
    }, `↑${stats.sent || 0} ↓${stats.recv || 0}`));

    return card;
}

/**
 * Build the complete agent list
 * @param {Array} agents - Array of agent objects
 * @param {object} opts - Options
 * @returns {HTMLElement}
 */
export function buildAgentList(agents, opts = {}) {
    const { filter = 'all', sessionStates = {}, agentStats = {}, sparklineRenderer = null } = opts;
    const frag = document.createDocumentFragment();

    for (const agent of agents) {
        const card = buildAgentCard(agent, {
            sessionState: sessionStates[agent.name] || {},
            agentStats: agentStats[agent.name] || {},
            sparklineRenderer,
            onAction: opts.onAction
        });
        frag.appendChild(card);
    }

    return frag;
}

/**
 * Filter agents by status
 * @param {Array} agents - Array of agent objects
 * @param {string} filter - Filter type (all, active, on_deck, idle)
 * @param {object} sessionStates - Session states
 * @returns {Array}
 */
export function filterAgents(agents, filter, sessionStates = {}) {
    if (filter === 'all') return agents;
    
    return agents.filter(a => {
        if (a.name === 'orchestrator' && filter === 'active') return true;
        
        const ses = sessionStates[a.name] || { isProcessing: false, paused: false, inboxCount: 0 };
        const isWorking = ses.isProcessing === true;
        
        switch (filter) {
            case 'active':
                return isWorking && !ses.paused;
            case 'on_deck':
                return !isWorking && !ses.paused && (ses.inboxCount || 0) > 0;
            case 'idle':
                return !isWorking && !ses.paused && (ses.inboxCount || 0) === 0;
            default:
                return true;
        }
    });
}

/**
 * Sort agents by status
 * @param {Array} agents - Array of agent objects
 * @param {object} sessionStates - Session states
 * @returns {Array}
 */
export function sortAgents(agents, sessionStates = {}) {
    return [...agents].sort((a, b) => {
        const rankOf = (agent) => {
            if (agent.name === 'orchestrator') return -1;
            const ses = sessionStates[agent.name] || { isProcessing: false, paused: false, inboxCount: 0 };
            if (ses.isProcessing === true && !ses.paused) return 0;
            if ((ses.inboxCount || 0) > 0 && !ses.paused) return 1;
            return 2;
        };
        return rankOf(a) - rankOf(b);
    });
}

/**
 * Get agent status
 * @param {object} agent - Agent object
 * @param {object} sessionState - Session state
 * @returns {string}
 */
export function getAgentStatus(agent, sessionState = {}) {
    const ses = sessionState;
    if (ses.paused) return 'paused';
    if (ses.isProcessing) return 'working';
    if ((ses.inboxCount || 0) > 0) return 'on_deck';
    return 'idle';
}

/**
 * Check if agent is working
 * @param {object} agent - Agent object
 * @param {object} sessionState - Session state
 * @returns {boolean}
 */
export function isAgentWorking(agent, sessionState = {}) {
    if (sessionState.isProcessing) return true;
    const status = (agent.status || '').toLowerCase();
    return status === 'thinking';
}
