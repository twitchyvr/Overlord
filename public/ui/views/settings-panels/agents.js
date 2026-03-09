/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Settings: Agents Panel
   ═══════════════════════════════════════════════════════════════════
   Agent enable/disable, default agents configuration.

   Dependencies: engine.js, button.js
   ═══════════════════════════════════════════════════════════════════ */

import { h } from '../engine.js';
import { Button } from '../components/button.js';
import { OverlordUI } from '../engine.js';

/**
 * Render the Agents settings tab
 * @param {object} config - Current config
 * @param {object} socket - Socket connection
 * @returns {HTMLElement}
 */
export function renderAgentsTab(config = {}, socket = null) {
    const panel = h('div', { class: 'settings-tab-panel' });

    // Agent enable/disable section
    const agentsIntro = h('div', {
        style: { fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }
    }, 'Configure which agents are available in the Agent Manager. Click an agent to enable or disable it.');

    panel.appendChild(agentsIntro);

    // Default built-in agents
    const defaultAgents = [
        { id: 'implementer', name: 'Implementer', role: 'Code Implementer', desc: 'Implements code changes', defaultEnabled: true },
        { id: 'reviewer', name: 'Reviewer', role: 'Code Reviewer', desc: 'Reviews code changes', defaultEnabled: true },
        { id: 'tester', name: 'Tester', role: 'Test Engineer', desc: 'Writes and runs tests', defaultEnabled: true },
        { id: 'documenter', name: 'Documenter', role: 'Technical Writer', desc: 'Creates documentation', defaultEnabled: false },
        { id: 'researcher', name: 'Researcher', role: 'Research Analyst', desc: 'Researches topics and technologies', defaultEnabled: false },
        { id: 'coordinator', name: 'Coordinator', role: 'Task Coordinator', desc: 'Orchestrates other agents', defaultEnabled: false }
    ];

    const agentsList = h('div', { class: 'agents-list' });

    // Get current enabled agents from config
    const enabledAgents = config.enabledAgents || defaultAgents.filter(a => a.defaultEnabled).map(a => a.id);
    const disabledAgents = config.disabledAgents || [];

    defaultAgents.forEach(agent => {
        const isEnabled = !disabledAgents.includes(agent.id);
        
        const agentRow = h('div', {
            class: 'agent-config-row',
            style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', border: '1px solid var(--glass-border)', borderRadius: '6px', marginBottom: '8px' }
        });

        // Status indicator
        const statusDot = h('div', {
            style: {
                width: '8px', height: '8px', borderRadius: '50%',
                backgroundColor: isEnabled ? 'var(--accent-green)' : 'var(--text-muted)'
            }
        });

        // Agent info
        const info = h('div', { style: { flex: '1' } },
            h('div', { style: { fontWeight: '600', fontSize: '13px' } }, agent.name),
            h('div', { style: { fontSize: '11px', color: 'var(--text-secondary)' } }, agent.role),
            h('div', { style: { fontSize: '10px', color: 'var(--text-muted)' } }, agent.desc)
        );

        // Toggle button
        const toggleBtn = Button.create(isEnabled ? 'Enabled' : 'Disabled', {
            variant: isEnabled ? 'primary' : 'ghost', size: 'sm',
            onClick: () => {
                const newDisabled = isEnabled 
                    ? [...disabledAgents, agent.id]
                    : disabledAgents.filter(id => id !== agent.id);
                
                if (socket) {
                    socket.emit('update_config', { disabledAgents: newDisabled });
                }
                
                // Update UI
                const newEnabled = !isEnabled;
                statusDot.style.backgroundColor = newEnabled ? 'var(--accent-green)' : 'var(--text-muted)';
                toggleBtn.setProps({ variant: newEnabled ? 'primary' : 'ghost' });
                OverlordUI.setContent(toggleBtn, newEnabled ? 'Enabled' : 'Disabled');
            }
        });

        // Edit button
        const editBtn = Button.create('Edit', {
            variant: 'ghost', size: 'sm',
            onClick: () => {
                // Would open agent manager for this agent
                OverlordUI.dispatch('open_agent_manager', { agentId: agent.id });
            }
        });

        agentRow.appendChild(statusDot);
        agentRow.appendChild(info);
        agentRow.appendChild(toggleBtn);
        agentRow.appendChild(editBtn);

        agentsList.appendChild(agentRow);
    });

    panel.appendChild(buildSection('Agent Configuration',
        'Manage which agents are available in the system.',
        agentsList
    ));

    // Default agent selection
    const defaultAgentSelect = h('select', { class: 'settings-select-full', 'data-field': 'defaultAgent' });
    defaultAgents.forEach(agent => {
        const option = h('option', { value: agent.id }, `${agent.name} (${agent.role})`);
        if (config.defaultAgent === agent.id) option.selected = true;
        defaultAgentSelect.appendChild(option);
    });
    defaultAgentSelect.addEventListener('change', () => {
        if (socket) socket.emit('update_config', { defaultAgent: defaultAgentSelect.value });
    });

    panel.appendChild(buildSection('Default Agent',
        'The agent that is selected by default when opening Agent Manager.',
        defaultAgentSelect
    ));

    // Agent count limit
    const maxAgentsInput = h('input', {
        type: 'number', class: 'settings-input-full',
        'data-field': 'maxConcurrentAgents',
        value: String(config.maxConcurrentAgents || 3), min: '1', max: '10'
    });
    maxAgentsInput.addEventListener('change', () => {
        const v = parseInt(maxAgentsInput.value);
        if (!isNaN(v) && v >= 1 && v <= 10 && socket) {
            socket.emit('update_config', { maxConcurrentAgents: v });
        }
    });

    panel.appendChild(buildSection('Concurrent Agents',
        'Maximum number of agents that can run simultaneously.',
        maxAgentsInput
    ));

    // Auto-start agents
    const autoStartToggle = buildConfigToggle('autoStartAgents', 'Auto-start default agents on session start', (v) => {
        if (socket) socket.emit('update_config', { autoStartAgents: v });
    });
    if (config.autoStartAgents) autoStartToggle.querySelector('input').checked = true;

    panel.appendChild(buildSection('Session Behavior',
        'Configure how agents behave when a session starts.',
        autoStartToggle
    ));

    return panel;
}

// Helper functions
function buildSection(title, desc, ...children) {
    const sec = h('div', { class: 'settings-section' });
    sec.appendChild(h('div', { class: 'settings-section-title' }, title));
    if (desc) sec.appendChild(h('div', { class: 'settings-section-desc' }, desc));
    children.forEach(child => { if (child) sec.appendChild(child); });
    return sec;
}

function buildConfigToggle(field, label, onChange) {
    const cb = h('input', { type: 'checkbox', 'data-field': field });
    cb.addEventListener('change', () => onChange(cb.checked));
    return h('label', { class: 'toggle-wrap' },
        cb,
        h('span', { class: 'toggle-track' }),
        h('span', { class: 'toggle-label' }, label)
    );
}
