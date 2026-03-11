/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Settings Main
   ═══════════════════════════════════════════════════════════════════
   Main settings container with tab navigation, layout, event handlers
   for switching between settings panels.

   Dependencies: engine.js, modal.js, tabs.js, button.js
   ═══════════════════════════════════════════════════════════════════ */

import { Component, OverlordUI, h } from '../engine.js';
import { Modal } from '../components/modal.js';
import { Tabs } from '../components/tabs.js';
import { Button } from '../components/button.js';

// Re-export panel builders
import { renderGeneralTab } from './settings-panels/general.js';
import { renderAITab } from './settings-panels/ai.js';
import { renderToolsTab } from './settings-panels/tools.js';
import { renderDisplayTab, renderAppearancePanel } from './settings-panels/appearance.js';
import { renderSecurityTab } from './settings-panels/security.js';

const MODAL_ID = 'settings-modal';

/**
 * Build the main settings container with tabs
 * @param {object} params - Parameters
 * @param {Function} params.onTabChange - Callback when tab changes
 * @param {object} params.config - Current config values
 * @param {object} params.socket - Socket connection
 * @param {object} params.mcpServers - MCP server list
 * @returns {HTMLElement}
 */
export function buildSettingsContainer({
    onTabChange,
    config = {},
    socket = null,
    mcpServers = []
}) {
    const wrapper = h('div', { class: 'settings-view' });

    // Tab bar container
    const tabBar = h('div', { class: 'settings-tab-bar' });
    wrapper.appendChild(tabBar);

    // Tab panels container
    const panelHost = h('div', { class: 'settings-panels' });
    wrapper.appendChild(panelHost);

    // Create tab panels
    const tabPanels = {
        general: renderGeneralTab(config, socket),
        ai: renderAITab(config, socket),
        tools: renderToolsTab(config, socket, mcpServers),
        display: renderDisplayTab(config),
        security: renderSecurityTab(config),
        prompt: renderPromptTab(config, socket)
    };

    Object.values(tabPanels).forEach(p => {
        p.style.display = 'none';
        panelHost.appendChild(p);
    });
    tabPanels.general.style.display = 'block';

    // Tabs component
    const tabs = new Tabs(tabBar, {
        items: [
            { id: 'general', label: 'General' },
            { id: 'ai', label: 'AI' },
            { id: 'tools', label: 'Tools' },
            { id: 'display', label: 'Display' },
            { id: 'security', label: 'Security' },
            { id: 'prompt', label: '�� Prompt' }
        ],
        activeId: 'general',
        style: 'underline',
        onChange: (id) => {
            Object.entries(tabPanels).forEach(([key, panel]) => {
                panel.style.display = key === id ? 'block' : 'none';
            });
            if (id === 'prompt') refreshPromptTab(tabPanels.prompt, socket);
            if (onTabChange) onTabChange(id);
        }
    });
    tabs.mount();

    // Footer actions
    const footer = h('div', { class: 'settings-actions' },
        Button.create('Cancel', {
            variant: 'ghost', size: 'sm',
            onClick: () => Modal.close(MODAL_ID)
        }),
        Button.create('Save', {
            variant: 'primary', size: 'sm',
            onClick: () => saveSettings(panelHost, socket)
        })
    );
    wrapper.appendChild(footer);

    // Store references for later access
    wrapper._tabPanels = tabPanels;
    wrapper._tabs = tabs;

    return wrapper;
}

/**
 * Render the Prompt tab (system prompt inspector)
 */
function renderPromptTab(config, socket) {
    const panel = h('div', { class: 'settings-tab-panel' });

    // System Prompt Preview
    const promptArea = h('textarea', {
        class: 'settings-textarea settings-prompt-preview',
        readonly: '',
        rows: '18',
        placeholder: 'Click "Refresh" to load the compiled system prompt…',
        style: 'font-family: monospace; font-size: 11px; resize: vertical; white-space: pre;'
    });

    const refreshBtn = Button.create('Refresh', {
        variant: 'ghost', size: 'sm',
        onClick: () => {
            if (socket) socket.emit('get_system_prompt');
        }
    });

    const promptHeader = h('div', { style: 'display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;' },
        h('div', { class: 'settings-label' }, 'Compiled System Prompt'),
        refreshBtn
    );

    panel.appendChild(buildSection('System Prompt Inspector',
        'Live view of the full system prompt sent to the AI on every request.',
        promptHeader,
        promptArea
    ));

    // Custom Instructions (quick-access)
    const instrArea = h('textarea', {
        class: 'settings-textarea',
        'data-field': 'customInstructions',
        maxlength: '4000',
        placeholder: 'Additional directives appended to the system prompt…',
        rows: '6'
    });
    instrArea.addEventListener('input', () => {
        if (socket) socket.emit('update_config', { customInstructions: instrArea.value });
    });

    panel.appendChild(buildSection('Custom Instructions',
        'These directives are appended to the system prompt as a ## CUSTOM INSTRUCTIONS section.',
        instrArea
    ));

    // Context Viewer
    const ctxArea = h('textarea', {
        class: 'settings-textarea settings-prompt-preview',
        readonly: '',
        rows: '14',
        placeholder: 'Click "Refresh" to load the last API context snapshot…',
        style: 'font-family: monospace; font-size: 10px; resize: vertical; white-space: pre; tab-size: 2;'
    });

    const ctxRefreshBtn = Button.create('Refresh', {
        variant: 'ghost', size: 'sm',
        onClick: () => {
            if (socket) socket.emit('get_last_context');
        }
    });

    const ctxHeader = h('div', { style: 'display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;' },
        h('div', { class: 'settings-label' }, 'Last API Request Context'),
        ctxRefreshBtn
    );

    panel.appendChild(buildSection('Context Viewer',
        'Shows what was sent to the API on the last request.',
        ctxHeader,
        ctxArea
    ));

    // Socket listeners
    if (socket) {
        socket.on('system_prompt_data', (data) => {
            if (promptArea) promptArea.value = data.prompt || '';
        });

        socket.on('last_context_data', (data) => {
            if (ctxArea) {
                if (data.error) {
                    ctxArea.value = data.error;
                } else {
                    ctxArea.value = formatContext(data);
                }
            }
        });
    }

    return panel;
}

/**
 * Refresh the prompt tab
 */
function refreshPromptTab(panel, socket) {
    if (socket) socket.emit('get_system_prompt');
}

/**
 * Format context for display
 */
function formatContext(ctx) {
    const lines = [];
    lines.push(`=== API CONTEXT SNAPSHOT ===`);
    lines.push(`Timestamp: ${new Date(ctx.ts).toLocaleString()}`);
    lines.push(`Model: ${ctx.model}`);
    lines.push(`Max Tokens: ${ctx.maxTokens}`);
    lines.push(`Temperature: ${ctx.temperature}`);
    lines.push(`Tools: ${ctx.toolsCount} definitions`);
    if (ctx.thinkingEnabled) {
        lines.push(`Thinking: enabled (budget: ${ctx.thinkingBudget})`);
    }
    lines.push('');
    lines.push(`=== SYSTEM PROMPT (${(ctx.system || '').length} chars) ===`);
    lines.push((ctx.system || '').substring(0, 2000));
    if ((ctx.system || '').length > 2000) lines.push('... [truncated]');
    lines.push('');
    lines.push(`=== MESSAGES (${ctx.messagesCount} total) ===`);
    if (ctx.messages) {
        for (let i = 0; i < ctx.messages.length; i++) {
            const m = ctx.messages[i];
            lines.push(`[${i}] ${m.role.toUpperCase()} (${m.contentLength} chars)`);
            if (m.contentPreview) {
                lines.push(`    ${m.contentPreview}`);
            }
        }
    }
    return lines.join('\n');
}

/**
 * Save settings from the modal
 */
function saveSettings(panelHost, socket) {
    if (!socket) return;

    const body = panelHost.closest('.modal-body') || panelHost;
    const g = (field) => body.querySelector(`[data-field="${field}"]`);
    const gv = (field) => g(field)?.value;
    const gc = (field) => g(field)?.checked;
    const gr = (name) => body.querySelector(`[name="${name}"]:checked`)?.value;

    const update = {};

    // Text areas
    if (g('customInstructions')) update.customInstructions = gv('customInstructions');
    if (g('projectMemory')) update.projectMemory = gv('projectMemory');
    if (g('referenceDocumentation')) update.referenceDocumentation = gv('referenceDocumentation') || '';
    if (g('obsidianVaultPath')) update.obsidianVaultPath = gv('obsidianVaultPath') || '';

    // Numeric inputs
    ['sessionNotesLines', 'timelineLines', 'rateLimitTokens', 'rateLimitRefillRate',
        'messageQueueSize', 'maxParallelAgents', 'thinkingBudget', 'ttsSpeed', 'gitOpsMinChanges'
    ].forEach(key => {
        const el = g(key);
        if (el) {
            const v = parseFloat(el.value);
            if (!isNaN(v)) update[key] = v;
        }
    });

    // Toggles
    ['autoCreateIssues', 'taskEnforcement', 'strictCompletion', 'thinkingEnabled',
        'gitOpsEnabled', 'ttsEnabled', 'longRunning'
    ].forEach(key => {
        const el = g(key);
        if (el) update[key] = el.checked;
    });

    // Radio groups
    ['queueDrainMode', 'planLength', 'gitOpsTrigger', 'gitOpsPush', 'ttsMode'].forEach(name => {
        const v = gr(name);
        if (v) update[name] = v;
    });

    // Selects
    if (g('ttsVoice')) update.ttsVoice = gv('ttsVoice');
    if (g('gitOpsCommitStyle')) update.gitOpsCommitStyle = gv('gitOpsCommitStyle');
    if (g('model')) update.model = gv('model');

    socket.emit('update_config', update);
    Modal.close(MODAL_ID);
}

/**
 * Build a settings section with title, description, and children
 */
export function buildSection(title, desc, ...children) {
    const sec = h('div', { class: 'settings-section' });
    sec.appendChild(h('div', { class: 'settings-section-title' }, title));
    if (desc) sec.appendChild(h('div', { class: 'settings-section-desc' }, desc));
    children.forEach(child => { if (child) sec.appendChild(child); });
    return sec;
}

/**
 * Create a toggle checkbox
 */
export function buildToggle(name, label, onChange) {
    const cb = h('input', { type: 'checkbox', 'data-toggle': name });
    cb.addEventListener('change', () => onChange(cb.checked));
    return h('label', { class: 'toggle-wrap' },
        cb,
        h('span', { class: 'toggle-track' }),
        h('span', { class: 'toggle-label' }, label)
    );
}

/**
 * Create a config-bound toggle (persisted via update_config)
 */
export function buildConfigToggle(field, label, onChange) {
    const cb = h('input', { type: 'checkbox', 'data-field': field });
    cb.addEventListener('change', () => onChange(cb.checked));
    return h('label', { class: 'toggle-wrap' },
        cb,
        h('span', { class: 'toggle-track' }),
        h('span', { class: 'toggle-label' }, label)
    );
}

/**
 * Apply config to form fields
 */
export function applyConfigToForm(body, config) {
    if (!config) return;

    // Text fields
    const textFields = ['model', 'customInstructions', 'projectMemory', 'referenceDocumentation', 'obsidianVaultPath', 'ttsVoice', 'gitOpsCommitStyle'];
    textFields.forEach(key => {
        const el = body.querySelector(`[data-field="${key}"]`);
        if (el && config[key] !== undefined) el.value = config[key];
    });

    // Numeric fields
    const numFields = ['sessionNotesLines', 'timelineLines', 'rateLimitTokens', 'rateLimitRefillRate',
        'messageQueueSize', 'maxParallelAgents', 'thinkingBudget', 'ttsSpeed', 'gitOpsMinChanges', 'maxAICycles'];
    numFields.forEach(key => {
        const el = body.querySelector(`[data-field="${key}"]`);
        if (el && config[key] !== undefined) el.value = config[key];
    });

    // Toggle fields
    const toggleFields = ['autoCreateIssues', 'taskEnforcement', 'strictCompletion', 'thinkingEnabled',
        'gitOpsEnabled', 'ttsEnabled', 'longRunning'];
    toggleFields.forEach(key => {
        const el = body.querySelector(`[data-field="${key}"]`);
        if (el) el.checked = !!config[key];
    });

    // Radio fields
    const radioFields = ['queueDrainMode', 'planLength', 'gitOpsTrigger', 'gitOpsPush', 'ttsMode'];
    radioFields.forEach(key => {
        const val = config[key];
        if (val) {
            const rb = body.querySelector(`[name="${key}"][value="${val}"]`);
            if (rb) rb.checked = true;
        }
    });

    // Handle visibility
    const ttsModesEl = body.querySelector('[data-field="ttsEnabled"]');
    const ttsModesWrap = ttsModesEl?.closest('.settings-section')?.querySelector('div[style*="display"]');
    if (ttsModesWrap) ttsModesWrap.style.display = config.ttsEnabled ? '' : 'none';

    const gitopsSub = body.querySelector('#gitops-sub');
    if (gitopsSub) gitopsSub.style.display = config.gitOpsEnabled !== false ? '' : 'none';

    const budgetEl = body.querySelector('[data-field="thinkingBudget"]');
    if (budgetEl) budgetEl.disabled = !config.thinkingEnabled;
}

// Export SettingsView component for backward compatibility
export class SettingsView extends Component {
    constructor(el, opts = {}) {
        super(el, opts);
        this._socket = opts.socket || null;
        this._config = {};
        this._mcpServers = [];
        this._tabPanels = {};
    }

    mount() {
        this._mounted = true;
        
        // Subscribe to engine events
        this._subs.push(
            OverlordUI.subscribe('config_data', (d) => this._applyConfig(d)),
            OverlordUI.subscribe('config_updated', (d) => this._applyConfig(d)),
            OverlordUI.subscribe('mcp_servers_updated', (d) => {
                this._mcpServers = d.servers || [];
                this._renderMcpServers(this._mcpServers);
            })
        );
    }

    open() {
        if (Modal.isOpen(MODAL_ID)) return;

        const content = buildSettingsContainer({
            config: this._config,
            socket: this._socket,
            mcpServers: this._mcpServers
        });

        Modal.open(MODAL_ID, {
            title: 'Settings',
            content,
            size: 'lg',
            className: 'settings-view-modal',
            onOpen: () => {
                if (this._socket) {
                    this._socket.emit('get_config');
                    this._socket.emit('get_mcp_servers');
                }
            },
            onClose: () => {
                this._tabPanels = {};
            }
        });
    }

    close() {
        Modal.close(MODAL_ID);
    }

    _applyConfig(data) {
        if (!data) return;
        Object.assign(this._config, data);
        
        const body = Modal.getBody(MODAL_ID);
        if (body) {
            applyConfigToForm(body, data);
        }
    }

    _renderMcpServers(servers) {
        // Implemented in tools panel
    }
}
