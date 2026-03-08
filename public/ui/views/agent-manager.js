/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Agent Manager View
   ═══════════════════════════════════════════════════════════════════
   Modal for managing agents (create, edit, delete) and groups.

   Two tabs:
     1. Agents — sidebar list + editor panel (name, role, desc,
        instructions, security role, group, tool permissions, AI Fill)
     2. Groups — list with members, collaboration mode, color;
        add / edit / delete with inline form

   Ported from the monolith (index-ori.html lines 4634-4821, 9895-10893).
   Uses am-* class names to match existing CSS in components.css:3011-3068.
   Tool permissions are loaded dynamically from the server.

   Dependencies: engine.js (Component, OverlordUI, h),
                 modal.js (Modal), toast.js (Toast)
   ═══════════════════════════════════════════════════════════════════ */

import { Component, OverlordUI, h } from '../engine.js';
import { Modal }  from '../components/modal.js';
import { Toast }  from '../components/toast.js';

const MODAL_ID = 'agent-manager';
const SECURITY_ROLES = ['developer', 'security-aware', 'security-analyst', 'security-lead', 'ciso', 'readonly'];
const FILLABLE_FIELDS = ['name', 'role', 'description', 'instructions', 'securityRole', 'tools'];
const FIELD_IDS = { name: 'am-name', role: 'am-role', description: 'am-description', instructions: 'am-instructions', securityRole: 'am-security-role' };

export class AgentManagerView extends Component {

    constructor(el, opts = {}) {
        super(el, opts);
        this._socket          = opts.socket || null;
        this._agents          = [];
        this._allAgents       = [];
        this._groups          = [];
        this._currentAgentId  = null;
        this._dirty           = false;
        this._toolCategories  = {};
        this._lockedFields    = new Set();
        this._fieldPreviews   = {};
        this._aiPanelOpen     = false;
        this._pendingGroupValue = null;
        // DOM refs (set during _buildContent)
        this._root            = null;
        this._agentListEl     = null;
        this._editorEl        = null;
        this._emptyEl         = null;
        this._groupsListEl    = null;
        this._groupFormEl     = null;
        this._saveBtn         = null;
        this._previewBar      = null;
    }

    // ══════════════════════════════════════════════════════════════
    //  LIFECYCLE
    // ══════════════════════════════════════════════════════════════

    mount() { this._mounted = true; }

    /** Open the agent manager modal. */
    open() {
        const content = this._buildContent();
        Modal.open(MODAL_ID, {
            title: 'AGENT MANAGER',
            content,
            size: 'xl',
            className: 'agent-manager-modal',
            onClose: () => { this._dirty = false; this._currentAgentId = null; this._clearPreview(); }
        });
        // Fetch dynamic tool categories, then load data
        if (this._socket) {
            this._socket.emit('get_available_tools', (cats) => {
                this._toolCategories = cats || {};
                this._loadAgentList();
                this._loadGroups();
            });
        }
    }

    close() { Modal.close(MODAL_ID); }

    // ══════════════════════════════════════════════════════════════
    //  LAYOUT
    // ══════════════════════════════════════════════════════════════

    _buildContent() {
        // Tab bar
        const agentsTab = h('button', {
            class: 'amtab amtab-active', role: 'tab',
            'aria-selected': 'true', 'data-state': 'active', tabindex: '0',
            onClick: () => this._switchTab('agents')
        }, 'Agents');
        const groupsTab = h('button', {
            class: 'amtab', role: 'tab',
            'aria-selected': 'false', 'data-state': 'inactive', tabindex: '-1',
            onClick: () => this._switchTab('groups')
        }, 'Groups');
        this._agentsTabBtn = agentsTab;
        this._groupsTabBtn = groupsTab;

        const tabBar = h('div', {
            role: 'tablist', 'aria-label': 'Agent Manager sections',
            style: { display: 'flex', gap: '4px', marginBottom: '12px' }
        }, agentsTab, groupsTab);

        // Agent list sidebar
        this._agentListEl = h('div', { style: { flex: '1', overflowY: 'auto', padding: '4px' } });
        const newAgentBtn = h('button', {
            style: { width: '100%', padding: '6px', background: 'var(--accent-green)', border: 'none', borderRadius: '4px', cursor: 'pointer', color: '#000', fontSize: '11px', fontWeight: '600' },
            onClick: () => this._newAgent()
        }, '+ New Agent');
        const sidebar = h('div', {
            style: { width: '240px', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }
        },
            h('div', { style: { padding: '10px', borderBottom: '1px solid var(--border-color)' } }, newAgentBtn),
            this._agentListEl
        );

        // Agent editor (hidden by default)
        this._editorEl = h('div', {
            style: { flex: '1', overflowY: 'auto', padding: '16px', display: 'none' }
        });

        // Empty state
        this._emptyEl = h('div', {
            style: { flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '12px' }
        }, 'Select an agent or create a new one');

        // Agents panel
        this._agentsPanel = h('div', {
            role: 'tabpanel', 'data-state': 'active',
            style: { flex: '1', overflow: 'auto', display: 'flex' }
        }, sidebar, this._editorEl, this._emptyEl);

        // Groups panel (hidden by default)
        this._groupsListEl = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
        this._groupFormEl = h('div', { style: { display: 'none', marginTop: '12px', padding: '14px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--accent-primary)' } });
        const newGroupBtn = h('button', {
            style: { padding: '5px 10px', background: 'var(--accent-green)', border: 'none', borderRadius: '4px', cursor: 'pointer', color: '#000', fontSize: '11px', fontWeight: '600' },
            onClick: () => this._newGroup()
        }, '+ New Group');
        this._groupsPanel = h('div', {
            role: 'tabpanel', 'data-state': 'inactive',
            style: { flex: '1', overflow: 'auto', padding: '16px', display: 'none', flexDirection: 'column' }
        },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' } },
                h('span', { style: { fontSize: '11px', color: 'var(--text-muted)' } }, 'Agent groups for collaboration and organization'),
                newGroupBtn
            ),
            this._groupsListEl,
            this._groupFormEl
        );

        this._root = h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '400px' } },
            tabBar, this._agentsPanel, this._groupsPanel
        );
        return this._root;
    }

    // ── Tab switching ─────────────────────────────────────────

    _switchTab(tab) {
        const isAgents = tab === 'agents';
        this._agentsTabBtn.className = 'amtab' + (isAgents ? ' amtab-active' : '');
        this._groupsTabBtn.className = 'amtab' + (!isAgents ? ' amtab-active' : '');
        this._agentsTabBtn.setAttribute('aria-selected', isAgents ? 'true' : 'false');
        this._groupsTabBtn.setAttribute('aria-selected', !isAgents ? 'true' : 'false');
        this._agentsPanel.style.display = isAgents ? 'flex' : 'none';
        this._groupsPanel.style.display = isAgents ? 'none' : 'flex';
        if (!isAgents) this._renderGroups();
    }

    // ══════════════════════════════════════════════════════════════
    //  AGENT LIST
    // ══════════════════════════════════════════════════════════════

    _loadAgentList() {
        if (!this._socket) return;
        this._socket.emit('list_agents', (agents) => {
            this._agents = agents || [];
            this._allAgents = agents || [];
            this._renderAgentList();
        });
    }

    _renderAgentList() {
        const el = this._agentListEl;
        if (!el) return;
        el.textContent = '';
        for (const agent of this._agents) {
            const id = agent.id || agent.name;
            const selected = id === this._currentAgentId;
            const nameEl = h('div', { style: { fontWeight: '600', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '4px' } },
                agent.name || id,
                agent.builtIn ? h('span', { style: { fontSize: '9px', background: 'rgba(88,166,255,0.2)', color: 'var(--accent-primary,#58a6ff)', borderRadius: '3px', padding: '1px 4px', letterSpacing: '0.04em', flexShrink: '0' } }, 'BUILT-IN') : null
            );
            const row = h('div', {
                class: 'am-agent-row' + (selected ? ' selected' : ''),
                onClick: () => this._selectAgent(id)
            },
                h('div', { class: 'am-agent-dot' }),
                h('div', { style: { flex: '1', overflow: 'hidden' } },
                    nameEl,
                    h('div', { style: { fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, agent.role || '')
                )
            );
            el.appendChild(row);
        }
    }

    _selectAgent(agentId) {
        this._currentAgentId = agentId;
        this._clearPreview();
        this._markClean();
        this._renderAgentList();
        if (!this._socket) return;
        this._socket.emit('get_agent', agentId, (agent) => {
            if (!agent) return;
            this._currentAgent = agent;
            this._emptyEl.style.display = 'none';
            this._editorEl.style.display = 'block';
            this._renderEditor(agent);
            this._pendingGroupValue = agent.group || '';
            this._loadGroups();
        });
    }

    _newAgent() {
        this._clearPreview();
        this._currentAgentId = null;
        this._emptyEl.style.display = 'none';
        this._editorEl.style.display = 'block';
        this._renderEditor({
            name: '', role: '', description: '', instructions: '',
            securityRole: 'developer', group: '', tools: []
        }, true);
        this._markDirty();
    }

    _cancelEdit() {
        this._clearPreview();
        this._currentAgentId = null;
        this._editorEl.style.display = 'none';
        this._emptyEl.style.display = 'flex';
    }

    // ══════════════════════════════════════════════════════════════
    //  AGENT EDITOR
    // ══════════════════════════════════════════════════════════════

    _renderEditor(agent, isNew = false) {
        const ed = this._editorEl;
        ed.textContent = '';

        const title = h('h3', {
            style: { margin: '0 0 14px', fontSize: '12px', fontWeight: '700', letterSpacing: '0.06em', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }
        },
            isNew ? 'NEW AGENT' : 'EDIT AGENT',
            (!isNew && agent.builtIn) ? h('span', { style: { fontSize: '10px', background: 'rgba(88,166,255,0.15)', color: 'var(--accent-primary,#58a6ff)', borderRadius: '4px', padding: '2px 7px', fontWeight: '600' } }, '🔒 BUILT-IN') : null
        );

        const fields = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });

        // Text fields
        fields.appendChild(this._buildField('NAME', 'name', 'input', agent.name || '', 'e.g. backend-dev'));
        fields.appendChild(this._buildField('ROLE', 'role', 'input', agent.role || '', 'e.g. Backend Developer'));
        fields.appendChild(this._buildField('DESCRIPTION', 'description', 'textarea', agent.description || '', 'What this agent specializes in...', 2));
        fields.appendChild(this._buildField('INSTRUCTIONS', 'instructions', 'textarea', agent.instructions || '', 'Special instructions for this agent...', 3));

        // Security Role + Group row
        const securitySelect = this._buildSelect('am-security-role', SECURITY_ROLES, agent.securityRole || 'developer');
        const groupSelect = h('select', {
            id: 'am-group',
            style: { width: '100%', padding: '6px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '12px' },
            onChange: () => this._markDirty()
        }, h('option', { value: '' }, 'None'));
        this._groupSelect = groupSelect;

        const secGroupRow = h('div', { style: { display: 'flex', gap: '8px' } },
            h('div', { style: { flex: '1' } },
                this._buildFieldHeader('SECURITY ROLE', 'securityRole'),
                securitySelect,
                this._buildDiffBar('securityRole')
            ),
            h('div', { style: { flex: '1' } },
                h('label', { style: { fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '3px' } }, 'GROUP'),
                groupSelect
            )
        );
        fields.appendChild(secGroupRow);

        // Tool permissions
        const toolPermsEl = h('div', { id: 'am-tool-perms', style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
        this._toolPermsEl = toolPermsEl;
        this._renderToolPerms(agent.tools || []);

        fields.appendChild(h('div', null,
            this._buildFieldHeader('TOOL PERMISSIONS', 'tools'),
            toolPermsEl,
            this._buildDiffBar('tools')
        ));

        // AI Fill panel
        const aiHint = h('textarea', {
            id: 'am-ai-hint', rows: '2',
            placeholder: 'Optional: add context or refinement instructions...',
            style: { width: '100%', padding: '6px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '12px', resize: 'vertical', boxSizing: 'border-box', marginBottom: '6px' }
        });
        const generateBtn = h('button', {
            class: 'am-generate-btn', id: 'am-generate-btn',
            onClick: () => this._generatePreview()
        }, '✨ Generate Preview');
        const aiPanel = h('div', { id: 'am-ai-panel' },
            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '4px' } },
                h('div', { style: { fontSize: '10px', color: 'var(--accent-primary)', fontWeight: '700', letterSpacing: '0.05em' } }, '✨ AI FILL'),
                h('span', { style: { fontSize: '10px', color: 'var(--text-muted)' } }, '— existing fields are used automatically')
            ),
            aiHint,
            h('div', { style: { fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px', lineHeight: '1.5' } },
                'Whatever is already filled in above will be sent as context. Leave this box empty to let AI improve existing values, or type here to guide specific fields.'
            ),
            generateBtn
        );
        fields.appendChild(aiPanel);

        // Preview bar
        const previewCount = h('span', { class: 'am-preview-count', id: 'am-preview-count' }, '✨ Previewing AI suggestions');
        this._previewBar = h('div', { id: 'am-preview-bar' },
            previewCount,
            h('button', { class: 'am-accept-all-btn', onClick: () => this._acceptAll() }, 'Accept All'),
            h('button', { class: 'am-discard-all-btn', onClick: () => this._discardAll() }, 'Discard All')
        );
        fields.appendChild(this._previewBar);

        // Action buttons
        this._saveBtn = h('button', {
            id: 'am-save-btn', disabled: true,
            style: { flex: '1', padding: '7px', background: 'var(--accent-green)', border: 'none', borderRadius: '4px', cursor: 'pointer', color: '#000', fontSize: '12px', fontWeight: '600', opacity: '0.5', transition: 'opacity .15s' },
            onClick: () => this._saveAgent()
        }, 'Save');
        const aiFillToggle = h('button', {
            id: 'am-aifill-toggle',
            style: { padding: '7px 10px', background: 'var(--bg-secondary)', border: '1px solid rgba(88,166,255,0.35)', borderRadius: '4px', cursor: 'pointer', color: 'var(--accent-primary)', fontSize: '12px', fontWeight: '600' },
            onClick: () => this._toggleAiPanel()
        }, '✨ AI Fill');
        const cancelBtn = h('button', {
            style: { padding: '7px 14px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '12px' },
            onClick: () => this._cancelEdit()
        }, 'Cancel');
        const deleteBtn = h('button', {
            id: 'am-delete-btn',
            style: { padding: '7px', background: 'none', border: '1px solid var(--accent-red)', borderRadius: '4px', cursor: 'pointer', color: 'var(--accent-red)', fontSize: '12px', display: (isNew || agent.builtIn) ? 'none' : '' },
            onClick: () => this._deleteAgent()
        }, 'Delete');

        const actions = h('div', { style: { display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' } },
            this._saveBtn, aiFillToggle, cancelBtn, deleteBtn
        );
        fields.appendChild(actions);

        ed.appendChild(title);
        ed.appendChild(fields);

        // Wire dirty listeners
        const dirtyEls = ed.querySelectorAll('input, textarea, select');
        dirtyEls.forEach(el => {
            el.addEventListener('input', () => this._markDirty());
            el.addEventListener('change', () => this._markDirty());
        });
    }

    // ── Field builders ────────────────────────────────────────

    _buildField(label, key, tag, value, placeholder, rows) {
        const id = FIELD_IDS[key] || ('am-' + key);
        const header = this._buildFieldHeader(label, key);
        let input;
        if (tag === 'textarea') {
            input = h('textarea', {
                id, rows: String(rows || 2), placeholder: placeholder || '',
                style: { width: '100%', padding: '6px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '12px', resize: 'vertical', boxSizing: 'border-box' }
            }, value);
        } else {
            input = h('input', {
                id, type: 'text', value: value, placeholder: placeholder || '',
                style: { width: '100%', padding: '6px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '12px', boxSizing: 'border-box' }
            });
        }
        const diff = this._buildDiffBar(key);
        return h('div', null, header, input, diff);
    }

    _buildFieldHeader(label, field) {
        const lockInd = h('span', {
            class: 'am-locked-indicator', id: 'am-lock-ind-' + field,
            style: { display: 'none' }
        }, '🔒 locked');
        const lockBtn = h('button', {
            class: 'am-lock-btn', id: 'am-lock-' + field,
            title: 'Lock: AI won\'t change this field',
            onClick: () => this._toggleLock(field)
        }, '🔓');
        return h('div', { class: 'am-field-header' },
            h('label', null, label), lockInd, lockBtn
        );
    }

    _buildDiffBar(field) {
        const wasEl = h('span', { class: 'am-diff-was', id: 'am-was-' + field });
        const acceptBtn = h('button', {
            class: 'am-diff-accept', title: 'Keep AI suggestion',
            onClick: () => this._acceptField(field)
        }, '✓');
        const revertBtn = h('button', {
            class: 'am-diff-revert', title: 'Revert to original',
            onClick: () => this._revertField(field)
        }, '✗');
        return h('div', { class: 'am-field-diff', id: 'am-diff-' + field }, wasEl, acceptBtn, revertBtn);
    }

    _buildSelect(id, options, selected) {
        const sel = h('select', {
            id,
            style: { width: '100%', padding: '6px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '12px' },
            onChange: () => this._markDirty()
        });
        for (const opt of options) {
            const o = h('option', { value: opt }, opt);
            if (opt === selected) o.selected = true;
            sel.appendChild(o);
        }
        return sel;
    }

    // ── Tool permissions ──────────────────────────────────────

    _renderToolPerms(currentTools, proposedTools) {
        const el = this._toolPermsEl;
        if (!el) return;
        while (el.firstChild) el.removeChild(el.firstChild);

        const agent       = this._currentAgent || {};
        const forcedTools  = agent.forcedTools  || [];
        const blockedTools = agent.blockedTools || [];

        const categories = this._toolCategories;
        for (const [cat, tools] of Object.entries(categories)) {
            const catDiv = document.createElement('div');
            catDiv.className = 'am-tool-cat';
            const catSpan = document.createElement('span');
            catSpan.style.cssText = 'font-size:10px;color:var(--text-muted);width:70px;flex-shrink:0;text-transform:uppercase;';
            catSpan.textContent = cat;
            catDiv.appendChild(catSpan);

            const wrap = document.createElement('div');
            wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;';
            for (const tool of tools) {
                const isForced   = forcedTools.includes(tool);
                const isBlocked  = blockedTools.includes(tool);
                const inCurrent  = currentTools.includes(tool);
                const inProposed = proposedTools ? proposedTools.includes(tool) : inCurrent;
                const changed    = !isForced && !isBlocked && proposedTools && (inProposed !== inCurrent);

                const lbl = document.createElement('label');
                lbl.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:10px;cursor:pointer;white-space:nowrap;';
                if (isForced)  { lbl.style.color = 'var(--accent-primary,#58a6ff)'; lbl.title = 'Required — cannot remove'; }
                else if (isBlocked) { lbl.style.opacity = '0.35'; lbl.title = 'Blocked — cannot add'; }
                else           { lbl.style.color = 'var(--text-primary)'; }
                if (changed)   { lbl.style.outline = '1px solid #d29922'; lbl.style.borderRadius = '3px'; lbl.style.padding = '1px 3px'; }

                const chk = document.createElement('input');
                chk.type = 'checkbox';
                chk.className = 'am-tool-chk';
                chk.value = tool;
                chk.style.accentColor = isForced ? 'var(--accent-primary,#58a6ff)' : 'var(--accent-green)';

                if (isForced)  { chk.checked = true;  chk.disabled = true; }
                else if (isBlocked) { chk.checked = false; chk.disabled = true; }
                else           { chk.checked = inProposed; }

                lbl.appendChild(chk);
                lbl.appendChild(document.createTextNode(tool));
                if (isForced)  { const ic = document.createElement('span'); ic.textContent = '🔒'; ic.style.fontSize = '9px'; lbl.appendChild(ic); }
                else if (isBlocked) { const ic = document.createElement('span'); ic.textContent = '⛔'; ic.style.fontSize = '9px'; lbl.appendChild(ic); }
                wrap.appendChild(lbl);
            }
            catDiv.appendChild(wrap);
            el.appendChild(catDiv);
        }
    }

    _getSelectedTools() {
        if (!this._editorEl) return [];
        const agent       = this._currentAgent || {};
        const forcedTools  = agent.forcedTools  || [];
        const blockedTools = agent.blockedTools || [];
        // Collect all checked non-disabled checkboxes
        let selected = [...this._editorEl.querySelectorAll('.am-tool-chk:checked:not(:disabled)')].map(cb => cb.value);
        // Always include forced tools (they are disabled/checked, not captured above)
        for (const t of forcedTools) { if (!selected.includes(t)) selected.push(t); }
        // Strip any blocked tools (defensive)
        selected = selected.filter(t => !blockedTools.includes(t));
        return selected;
    }

    // ── Dirty state ───────────────────────────────────────────

    _markDirty() {
        this._dirty = true;
        if (this._saveBtn) { this._saveBtn.disabled = false; this._saveBtn.style.opacity = ''; }
    }

    _markClean() {
        this._dirty = false;
        if (this._saveBtn) { this._saveBtn.disabled = true; this._saveBtn.style.opacity = '0.5'; }
    }

    // ══════════════════════════════════════════════════════════════
    //  AGENT CRUD
    // ══════════════════════════════════════════════════════════════

    _saveAgent() {
        if (!this._socket) return;
        const val = (id) => {
            const el = this._editorEl.querySelector('#' + (FIELD_IDS[id] || ('am-' + id)));
            return el ? el.value.trim() : '';
        };
        const name = val('name');
        if (!name) { Toast.error('Agent name is required'); return; }

        if (this._saveBtn) { this._saveBtn.disabled = true; this._saveBtn.textContent = 'Saving…'; }

        const data = {
            name,
            role:         val('role'),
            description:  val('description'),
            instructions: val('instructions'),
            securityRole: val('securityRole'),
            group:        (this._editorEl.querySelector('#am-group') || {}).value || '',
            tools:        this._getSelectedTools()
        };

        const onSuccess = (reloadId) => {
            Toast.success('Agent saved');
            this._clearPreview();
            this._markClean();
            if (this._saveBtn) this._saveBtn.textContent = 'Save';
            this._loadAgentList();
            const id = reloadId || this._currentAgentId;
            if (id) this._selectAgent(id);
        };

        if (this._currentAgentId) {
            data.id = this._currentAgentId;
            this._socket.emit('update_agent', data, (result) => {
                if (result && result.success !== false) {
                    if (result.id) this._currentAgentId = result.id;
                    onSuccess(this._currentAgentId);
                } else {
                    if (this._saveBtn) { this._saveBtn.disabled = false; this._saveBtn.textContent = 'Save'; }
                    Toast.error('Save failed: ' + ((result && result.error) || 'unknown'));
                }
            });
        } else {
            this._socket.emit('add_agent', data, (result) => {
                if (result && result.success !== false) {
                    const newId = result.agent && result.agent.id;
                    if (newId) this._currentAgentId = newId;
                    onSuccess(newId);
                } else {
                    if (this._saveBtn) { this._saveBtn.disabled = false; this._saveBtn.textContent = 'Save'; }
                    Toast.error('Create failed: ' + ((result && result.error) || 'unknown'));
                }
            });
        }
    }

    _deleteAgent() {
        if (!this._currentAgentId || !this._socket) return;
        if (!confirm('Delete this agent?')) return;
        this._socket.emit('remove_agent', this._currentAgentId, (result) => {
            if (result && result.success === false) {
                Toast.error(result.error || 'Cannot delete this agent');
            } else {
                Toast.info('Agent deleted');
                this._currentAgent = null;
                this._cancelEdit();
                setTimeout(() => this._loadAgentList(), 300);
            }
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  AI FILL
    // ══════════════════════════════════════════════════════════════

    _toggleLock(field) {
        const isLocked = this._lockedFields.has(field);
        if (isLocked) this._lockedFields.delete(field); else this._lockedFields.add(field);
        const btn = this._editorEl.querySelector('#am-lock-' + field);
        const ind = this._editorEl.querySelector('#am-lock-ind-' + field);
        if (btn) { btn.textContent = isLocked ? '🔓' : '🔒'; btn.classList.toggle('locked', !isLocked); }
        if (ind) ind.style.display = isLocked ? 'none' : '';
    }

    _toggleAiPanel() {
        const panel = this._editorEl.querySelector('#am-ai-panel');
        const btn = this._editorEl.querySelector('#am-aifill-toggle');
        const opening = !panel.classList.contains('open');
        panel.classList.toggle('open', opening);
        if (btn) btn.style.borderColor = opening ? 'var(--accent-primary)' : 'rgba(88,166,255,0.35)';
        if (opening) {
            const hint = this._editorEl.querySelector('#am-ai-hint');
            if (hint) setTimeout(() => hint.focus(), 50);
        }
    }

    _getFieldEl(field) {
        const id = FIELD_IDS[field];
        return id ? this._editorEl.querySelector('#' + id) : null;
    }

    _generatePreview() {
        const btn = this._editorEl.querySelector('#am-generate-btn');
        const hintEl = this._editorEl.querySelector('#am-ai-hint');
        const hint = hintEl ? hintEl.value : '';

        const currentValues = {
            name:         (this._getFieldEl('name') || {}).value || '',
            role:         (this._getFieldEl('role') || {}).value || '',
            description:  (this._getFieldEl('description') || {}).value || '',
            instructions: (this._getFieldEl('instructions') || {}).value || '',
            securityRole: (this._getFieldEl('securityRole') || {}).value || 'developer',
            tools:        this._getSelectedTools(),
            prompt:       hint.trim()
        };

        if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }

        this._socket.emit('ai_fill_agent', { hint: currentValues, lockedFields: [...this._lockedFields] }, (result) => {
            if (btn) { btn.disabled = false; btn.textContent = '✨ Generate Preview'; }
            if (!result || result.error) {
                Toast.error('AI Fill error: ' + ((result && result.error) || 'unknown'));
                return;
            }
            this._applyPreview(result, currentValues);
            // Close AI panel
            const panel = this._editorEl.querySelector('#am-ai-panel');
            if (panel) panel.classList.remove('open');
            const toggle = this._editorEl.querySelector('#am-aifill-toggle');
            if (toggle) toggle.style.borderColor = 'rgba(88,166,255,0.35)';
        });
    }

    _applyPreview(result, orig) {
        // Text/select fields
        ['name', 'role', 'description', 'instructions', 'securityRole'].forEach(field => {
            if (this._lockedFields.has(field)) return;
            const proposed = result[field];
            if (!proposed) return;
            const el = this._getFieldEl(field);
            if (!el) return;
            const original = orig[field] || '';
            if (proposed === original) return;
            this._fieldPreviews[field] = { original, proposed };
            el.value = proposed;
            el.style.borderColor = 'rgba(88,166,255,0.5)';
            el.style.background = 'rgba(88,166,255,0.04)';
            const diffEl = this._editorEl.querySelector('#am-diff-' + field);
            const wasEl = this._editorEl.querySelector('#am-was-' + field);
            if (wasEl) wasEl.textContent = original ? 'was: ' + original : '(was empty)';
            if (diffEl) diffEl.classList.add('active');
        });
        // Tools
        if (!this._lockedFields.has('tools') && Array.isArray(result.tools)) {
            const origTools = orig.tools || [];
            const newTools = result.tools;
            const added = newTools.filter(t => !origTools.includes(t)).length;
            const removed = origTools.filter(t => !newTools.includes(t)).length;
            if (added > 0 || removed > 0) {
                this._fieldPreviews.tools = { original: origTools, proposed: newTools };
                this._renderToolPerms(origTools, newTools);
                const parts = [];
                if (added) parts.push('+' + added + ' added');
                if (removed) parts.push('-' + removed + ' removed');
                const wasEl = this._editorEl.querySelector('#am-was-tools');
                const diffEl = this._editorEl.querySelector('#am-diff-tools');
                if (wasEl) wasEl.textContent = 'was ' + origTools.length + ' tools (' + parts.join(', ') + ')';
                if (diffEl) diffEl.classList.add('active');
            }
        }
        this._updatePreviewCount();
        if (this._previewBar) this._previewBar.classList.add('active');
        this._markDirty();
    }

    _updatePreviewCount() {
        const n = Object.keys(this._fieldPreviews).length;
        const el = this._editorEl.querySelector('#am-preview-count');
        if (el) el.textContent = n > 0 ? '✨ ' + n + ' field' + (n !== 1 ? 's' : '') + ' to review — accept or revert each below' : '✨ All reviewed';
        if (n === 0) {
            setTimeout(() => {
                if (Object.keys(this._fieldPreviews).length === 0 && this._previewBar) {
                    this._previewBar.classList.remove('active');
                }
            }, 900);
        }
    }

    _acceptField(field) {
        if (!this._fieldPreviews[field]) return;
        delete this._fieldPreviews[field];
        if (field !== 'tools') {
            const el = this._getFieldEl(field);
            if (el) { el.style.borderColor = ''; el.style.background = ''; }
        }
        const diffEl = this._editorEl.querySelector('#am-diff-' + field);
        if (diffEl) diffEl.classList.remove('active');
        this._updatePreviewCount();
    }

    _revertField(field) {
        const preview = this._fieldPreviews[field];
        if (!preview) return;
        if (field === 'tools') {
            this._renderToolPerms(preview.original);
        } else {
            const el = this._getFieldEl(field);
            if (el) { el.value = preview.original; el.style.borderColor = ''; el.style.background = ''; }
        }
        delete this._fieldPreviews[field];
        const diffEl = this._editorEl.querySelector('#am-diff-' + field);
        if (diffEl) diffEl.classList.remove('active');
        this._updatePreviewCount();
    }

    _acceptAll() { [...Object.keys(this._fieldPreviews)].forEach(f => this._acceptField(f)); }
    _discardAll() { [...Object.keys(this._fieldPreviews)].forEach(f => this._revertField(f)); }

    _clearPreview() {
        this._discardAll();
        FILLABLE_FIELDS.forEach(field => {
            if (field !== 'tools' && this._editorEl) {
                const el = this._getFieldEl(field);
                if (el) { el.style.borderColor = ''; el.style.background = ''; }
            }
            if (this._editorEl) {
                const diffEl = this._editorEl.querySelector('#am-diff-' + field);
                if (diffEl) diffEl.classList.remove('active');
                const lockBtn = this._editorEl.querySelector('#am-lock-' + field);
                const lockInd = this._editorEl.querySelector('#am-lock-ind-' + field);
                if (lockBtn) { lockBtn.textContent = '🔓'; lockBtn.classList.remove('locked'); }
                if (lockInd) lockInd.style.display = 'none';
            }
        });
        this._lockedFields.clear();
        this._fieldPreviews = {};
        if (this._previewBar) this._previewBar.classList.remove('active');
        if (this._editorEl) {
            const panel = this._editorEl.querySelector('#am-ai-panel');
            if (panel) panel.classList.remove('open');
            const toggle = this._editorEl.querySelector('#am-aifill-toggle');
            if (toggle) toggle.style.borderColor = 'rgba(88,166,255,0.35)';
            const hint = this._editorEl.querySelector('#am-ai-hint');
            if (hint) hint.value = '';
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  GROUPS TAB
    // ══════════════════════════════════════════════════════════════

    _loadGroups() {
        if (!this._socket) return;
        this._socket.emit('list_agents', (agents) => {
            if (Array.isArray(agents)) this._allAgents = agents;
            this._socket.emit('list_groups', (groups) => {
                this._groups = groups || [];
                this._populateGroupDropdown();
            });
        });
    }

    _populateGroupDropdown() {
        const sel = this._groupSelect;
        if (!sel) return;
        // safe: programmatic option building
        sel.textContent = '';
        sel.appendChild(h('option', { value: '' }, 'None'));
        for (const g of this._groups) {
            const opt = h('option', { value: g.id }, g.name || g.id);
            sel.appendChild(opt);
        }
        if (this._pendingGroupValue !== null) {
            sel.value = this._pendingGroupValue;
            this._pendingGroupValue = null;
        }
    }

    _renderGroups() {
        const el = this._groupsListEl;
        if (!el) return;
        el.textContent = '';

        if (!this._groups.length) {
            el.appendChild(h('div', { style: { fontSize: '11px', color: 'var(--text-muted)', padding: '8px 0' } }, 'No groups yet — click + New Group to create one.'));
            return;
        }

        const esc = (s) => OverlordUI.escapeHtml ? OverlordUI.escapeHtml(String(s)) : String(s);

        for (const g of this._groups) {
            const members = this._allAgents.filter(a => a.group === g.id || a.group === g.name);
            const collabLabel = { sequential: 'Sequential', parallel: 'Parallel', consensus: 'Consensus' }[g.collaborationMode] || g.collaborationMode || 'Sequential';

            // Member pills
            const memberWrap = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' } });
            if (members.length) {
                for (const m of members) {
                    const pill = h('span', {
                        style: { display: 'inline-flex', alignItems: 'center', gap: '3px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '3px', padding: '1px 6px', fontSize: '10px', color: 'var(--text-primary)' }
                    },
                        esc(m.name),
                        h('button', {
                            style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', fontSize: '10px', padding: '0 0 0 2px', lineHeight: '1' },
                            title: 'Remove from group',
                            onClick: () => this._removeAgentFromGroup(m.id || m.name, g.id)
                        }, '×')
                    );
                    memberWrap.appendChild(pill);
                }
            } else {
                memberWrap.appendChild(h('span', { style: { fontSize: '10px', color: 'var(--text-muted)' } }, 'No agents'));
            }

            // Add agent dropdown
            const nonMembers = this._allAgents.filter(a => !members.find(m => (m.id || m.name) === (a.id || a.name)));
            let addRow = null;
            if (nonMembers.length) {
                const addSelect = h('select', {
                    id: 'am-add-agent-' + g.id,
                    style: { flex: '1', padding: '4px 6px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '11px' }
                }, h('option', { value: '' }, '— Add agent —'));
                for (const a of nonMembers) {
                    addSelect.appendChild(h('option', { value: a.id || a.name }, esc(a.name)));
                }
                addRow = h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
                    addSelect,
                    h('button', {
                        style: { padding: '4px 10px', background: 'var(--accent-primary)', border: 'none', borderRadius: '4px', cursor: 'pointer', color: '#000', fontSize: '11px', fontWeight: '600' },
                        onClick: () => this._addAgentToGroup(g.id)
                    }, 'Add')
                );
            }

            const card = h('div', {
                style: { background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '12px' }
            },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' } },
                    h('div', { style: { width: '14px', height: '14px', borderRadius: '3px', background: g.color || '#58a6ff', flexShrink: '0' } }),
                    h('span', { style: { fontWeight: '600', fontSize: '12px', color: 'var(--text-primary)', flex: '1' } }, esc(g.name)),
                    h('span', { style: { fontSize: '10px', color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '3px' } }, collabLabel),
                    h('button', {
                        style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px', padding: '2px 4px' },
                        title: 'Edit', onClick: () => this._editGroup(g.id)
                    }, '✏'),
                    h('button', {
                        style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', fontSize: '11px', padding: '2px 4px' },
                        title: 'Delete', onClick: () => this._deleteGroup(g.id)
                    }, '✕')
                ),
                g.description ? h('div', { style: { fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' } }, esc(g.description)) : null,
                memberWrap,
                addRow
            );
            el.appendChild(card);
        }
    }

    _addAgentToGroup(groupId) {
        const sel = this._groupsPanel.querySelector('#am-add-agent-' + groupId);
        if (!sel || !sel.value) return;
        this._socket.emit('add_agent_to_group', { agentId: sel.value, groupId }, () => {
            this._loadAgentList();
            this._loadGroups();
            setTimeout(() => this._renderGroups(), 200);
        });
    }

    _removeAgentFromGroup(agentId, groupId) {
        this._socket.emit('remove_agent_from_group', { agentId }, () => {
            this._loadAgentList();
            this._loadGroups();
            setTimeout(() => this._renderGroups(), 200);
        });
    }

    // ── Group CRUD ────────────────────────────────────────────

    _buildGroupForm() {
        const form = this._groupFormEl;
        form.textContent = '';
        const st = this._groupFormState || {};

        const titleEl = h('div', {
            style: { fontSize: '10px', color: 'var(--accent-primary)', fontWeight: '700', letterSpacing: '0.05em', marginBottom: '10px' }
        }, st.editId ? 'EDIT GROUP' : 'NEW GROUP');

        const nameInput = h('input', {
            id: 'am-group-name', placeholder: 'Group name *', value: st.name || '',
            style: { flex: '1', padding: '6px 8px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '12px' }
        });
        const colorInput = h('input', {
            id: 'am-group-color', type: 'color', value: st.color || '#3fb950',
            style: { width: '36px', height: '32px', padding: '2px', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'var(--bg-primary)', cursor: 'pointer' }
        });
        const descInput = h('input', {
            id: 'am-group-description', placeholder: 'Description (optional)', value: st.description || '',
            style: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '12px', marginBottom: '8px' }
        });
        const collabSelect = h('select', {
            id: 'am-group-collab',
            style: { flex: '1', padding: '5px 8px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '12px' }
        },
            h('option', { value: 'sequential' }, 'Sequential — agents run one after another'),
            h('option', { value: 'parallel' }, 'Parallel — agents run simultaneously'),
            h('option', { value: 'consensus' }, 'Consensus — agents vote on decisions')
        );
        if (st.collaborationMode) collabSelect.value = st.collaborationMode;

        form.appendChild(titleEl);
        form.appendChild(h('div', { style: { display: 'flex', gap: '8px', marginBottom: '8px' } }, nameInput, colorInput));
        form.appendChild(descInput);
        form.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' } },
            h('span', { style: { fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' } }, 'Collab mode:'),
            collabSelect
        ));
        form.appendChild(h('div', { style: { display: 'flex', gap: '6px' } },
            h('button', {
                style: { padding: '6px 14px', background: 'var(--accent-green)', border: 'none', borderRadius: '4px', cursor: 'pointer', color: '#000', fontSize: '11px', fontWeight: '600' },
                onClick: () => this._saveGroup()
            }, 'Save'),
            h('button', {
                style: { padding: '6px 12px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '11px' },
                onClick: () => this._cancelGroup()
            }, 'Cancel')
        ));
        form.style.display = 'block';
    }

    _newGroup() {
        this._groupFormState = { editId: null, name: '', description: '', color: '#3fb950', collaborationMode: 'sequential' };
        this._buildGroupForm();
    }

    _editGroup(groupId) {
        this._socket.emit('list_groups', (groups) => {
            const g = (groups || []).find(x => x.id === groupId);
            if (!g) return;
            this._groupFormState = {
                editId: g.id,
                name: g.name || '',
                description: g.description || '',
                color: g.color || '#3fb950',
                collaborationMode: g.collaborationMode || 'sequential'
            };
            this._buildGroupForm();
        });
    }

    _saveGroup() {
        const name = (this._groupFormEl.querySelector('#am-group-name') || {}).value?.trim();
        if (!name) { Toast.error('Group name is required'); return; }
        const groupData = {
            name,
            description: (this._groupFormEl.querySelector('#am-group-description') || {}).value?.trim() || '',
            color: (this._groupFormEl.querySelector('#am-group-color') || {}).value || '#3fb950',
            collaborationMode: (this._groupFormEl.querySelector('#am-group-collab') || {}).value || 'sequential'
        };
        const editId = this._groupFormState?.editId;
        if (editId) {
            this._socket.emit('update_group', { id: editId, ...groupData }, (result) => {
                if (result && result.success !== false) {
                    Toast.success('Group updated');
                    this._cancelGroup();
                    this._loadGroups();
                    setTimeout(() => this._renderGroups(), 200);
                }
            });
        } else {
            this._socket.emit('create_group', groupData, (result) => {
                if (result && result.success !== false) {
                    Toast.success('Group created');
                    this._cancelGroup();
                    this._loadGroups();
                    setTimeout(() => this._renderGroups(), 200);
                }
            });
        }
    }

    _cancelGroup() {
        this._groupFormEl.style.display = 'none';
        this._groupFormState = null;
    }

    _deleteGroup(groupId) {
        if (!confirm('Delete this group? Agents in the group will be unassigned.')) return;
        this._socket.emit('delete_group', groupId, () => {
            this._loadGroups();
            setTimeout(() => this._renderGroups(), 200);
        });
    }
}
