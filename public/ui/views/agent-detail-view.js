/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Agent Detail View
   ═══════════════════════════════════════════════════════════════════
   Full agent editor component: displays agent name, role, description,
   capabilities, system prompt, languages. Shows full editing form
   with validation.

   Extracted from agent-manager.js for modularity.
   Dependencies: engine.js (Component, OverlordUI, h), toast.js (Toast)
   ═══════════════════════════════════════════════════════════════════ */

import { Component, OverlordUI, h } from '../engine.js';

// Field IDs map for the editor
export const AGENT_DETAIL_FIELD_IDS = {
    name: 'am-name',
    role: 'am-role',
    description: 'am-description',
    instructions: 'am-instructions',
    securityRole: 'am-security-role',
    group: 'am-group'
};

// Fallback security roles — replaced at runtime
let SECURITY_ROLES_MAP = {
    'full-access':  { label: 'Full Access',   description: 'Unrestricted system agent' },
    'implementer':  { label: 'Implementer',   description: 'Read, write, execute — no orchestration' },
    'contributor': { label: 'Contributor',    description: 'Read and write — no shell access' },
    'reviewer':    { label: 'Reviewer',       description: 'Read and analyze only' },
    'coordinator': { label: 'Coordinator',    description: 'Read + orchestration — no implementation' },
    'observer':    { label: 'Observer',       description: 'Read-only access' }
};

/**
 * Update security roles map from server data
 * @param {object} roles - Role definitions from server
 */
export function setSecurityRoles(roles) {
    if (roles && typeof roles === 'object' && Object.keys(roles).length > 0) {
        SECURITY_ROLES_MAP = roles;
    }
}

/**
 * Get security roles map
 * @returns {object}
 */
export function getSecurityRoles() {
    return SECURITY_ROLES_MAP;
}

/**
 * Build a complete agent detail/editor view
 * @param {object} params - Parameters for building the editor
 * @param {object} params.agent - Agent data object
 * @param {boolean} params.isNew - Whether this is a new agent
 * @param {Function} params.onChange - Callback when any field changes
 * @param {Function} params.onSave - Callback for save button
 * @param {Function} params.onCancel - Callback for cancel button
 * @param {Function} params.onDelete - Callback for delete button
 * @param {Function} params.onAiFillToggle - Callback for AI Fill toggle
 * @param {Function} params.onGeneratePreview - Callback for AI preview generation
 * @param {object} params.groups - Available groups for dropdown
 * @param {object} params.toolCategories - Tool categories for permissions
 * @param {object} params.currentTools - Currently selected tools
 * @param {object} params.lockedFields - Set of locked field names
 * @param {object} params.fieldPreviews - Object of preview fields
 * @param {boolean} params.aiPanelOpen - Whether AI panel is open
 * @returns {HTMLElement}
 */
export function buildAgentDetailView({
    agent,
    isNew,
    onChange,
    onSave,
    onCancel,
    onDelete,
    onAiFillToggle,
    onGeneratePreview,
    groups = [],
    toolCategories = {},
    currentTools = [],
    lockedFields = new Set(),
    fieldPreviews = {},
    aiPanelOpen = false
}) {
    const root = document.createElement('div');

    // Title
    const title = h('h3', {
        style: { margin: '0 0 14px', fontSize: '12px', fontWeight: '700', letterSpacing: '0.06em', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }
    },
        isNew ? 'NEW AGENT' : 'EDIT AGENT',
        (!isNew && agent.builtIn) ? h('span', { style: { fontSize: '10px', background: 'rgba(88,166,255,0.15)', color: 'var(--accent-primary,#58a6ff)', borderRadius: '4px', padding: '2px 7px', fontWeight: '600' } }, '�� BUILT-IN') : null
    );

    const fields = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });

    // Text fields
    fields.appendChild(buildTextField('NAME', 'name', 'input', agent.name || '', 'e.g. backend-dev', onChange));
    fields.appendChild(buildTextField('ROLE', 'role', 'input', agent.role || '', 'e.g. Backend Developer', onChange));
    fields.appendChild(buildTextField('DESCRIPTION', 'description', 'textarea', agent.description || '', 'What this agent specializes in...', onChange, 2));
    fields.appendChild(buildTextField('INSTRUCTIONS', 'instructions', 'textarea', agent.instructions || '', 'Special instructions for this agent...', onChange, 3));

    // Security Role + Group row
    const securityRoleNames = Object.keys(SECURITY_ROLES_MAP);
    const securitySelect = buildSelect('am-security-role', securityRoleNames, agent.securityRole || 'implementer', SECURITY_ROLES_MAP, onChange);
    const groupSelect = buildGroupSelect(groups, agent.group || '', onChange);

    // Override toggle
    const roleDef = SECURITY_ROLES_MAP[agent.securityRole || 'implementer'] || {};
    const overrideCheckbox = h('input', {
        type: 'checkbox', id: 'am-override-role',
        checked: agent.overrideRoleRestrictions || false,
        style: { marginRight: '4px', verticalAlign: 'middle' },
        onChange
    });
    const overrideRow = h('div', {
        id: 'am-override-row',
        style: {
            display: roleDef.canOverride !== false ? 'flex' : 'none',
            alignItems: 'center', gap: '4px', marginTop: '4px', fontSize: '11px', color: 'var(--text-muted)'
        }
    }, overrideCheckbox, 'Override role restrictions');

    const secGroupRow = h('div', { style: { display: 'flex', gap: '8px' } },
        h('div', { style: { flex: '1' } },
            buildFieldHeader('SECURITY ROLE', 'securityRole', lockedFields, () => {}),
            securitySelect,
            overrideRow
        ),
        h('div', { style: { flex: '1' } },
            h('label', { style: { fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '3px' } }, 'GROUP'),
            groupSelect
        )
    );
    fields.appendChild(secGroupRow);

    // Tool permissions (using agent-permissions module logic)
    const toolPermsEl = h('div', { id: 'am-tool-perms', style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    renderToolPermissions(toolPermsEl, toolCategories, currentTools, agent);

    fields.appendChild(h('div', null,
        buildFieldHeader('TOOL PERMISSIONS', 'tools', lockedFields, () => {}),
        toolPermsEl
    ));

    // AI Fill panel
    const aiHint = h('textarea', {
        id: 'am-ai-hint', rows: '2',
        placeholder: 'Optional: add context or refinement instructions...',
        style: { width: '100%', padding: '6px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '12px', resize: 'vertical', boxSizing: 'border-box', marginBottom: '6px' }
    });
    const generateBtn = h('button', {
        class: 'am-generate-btn', id: 'am-generate-btn',
        onClick: onGeneratePreview
    }, '✨ Generate Preview');
    const aiPanel = h('div', { id: 'am-ai-panel', class: aiPanelOpen ? 'open' : '' },
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
    const previewBar = h('div', { id: 'am-preview-bar' },
        previewCount,
        h('button', { class: 'am-accept-all-btn' }, 'Accept All'),
        h('button', { class: 'am-discard-all-btn' }, 'Discard All')
    );
    fields.appendChild(previewBar);

    // Action buttons
    const saveBtn = h('button', {
        id: 'am-save-btn',
        style: { flex: '1', padding: '7px', background: 'var(--accent-green)', border: 'none', borderRadius: '4px', cursor: 'pointer', color: '#000', fontSize: '12px', fontWeight: '600' },
        onClick: onSave
    }, 'Save');
    const aiFillToggle = h('button', {
        id: 'am-aifill-toggle',
        style: { padding: '7px 10px', background: 'var(--bg-secondary)', border: '1px solid rgba(88,166,255,0.35)', borderRadius: '4px', cursor: 'pointer', color: 'var(--accent-primary)', fontSize: '12px', fontWeight: '600' },
        onClick: onAiFillToggle
    }, '✨ AI Fill');
    const cancelBtn = h('button', {
        style: { padding: '7px 14px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '12px' },
        onClick: onCancel
    }, 'Cancel');
    const deleteBtn = h('button', {
        id: 'am-delete-btn',
        style: { padding: '7px', background: 'none', border: '1px solid var(--accent-red)', borderRadius: '4px', cursor: 'pointer', color: 'var(--accent-red)', fontSize: '12px', display: (isNew || agent.builtIn) ? 'none' : '' },
        onClick: onDelete
    }, 'Delete');

    const actions = h('div', { style: { display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' } },
        saveBtn, aiFillToggle, cancelBtn, deleteBtn
    );
    fields.appendChild(actions);

    root.appendChild(title);
    root.appendChild(fields);

    // Wire change listeners
    const dirtyEls = root.querySelectorAll('input, textarea, select');
    dirtyEls.forEach(el => {
        el.addEventListener('input', onChange);
        el.addEventListener('change', onChange);
    });

    return root;
}

/**
 * Build a text field (input or textarea)
 */
function buildTextField(label, key, tag, value, placeholder, onChange, rows) {
    const id = AGENT_DETAIL_FIELD_IDS[key] || ('am-' + key);
    const header = buildFieldHeader(label, key, new Set(), () => {});
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
    return h('div', null, header, input);
}

/**
 * Build field header with lock indicator
 */
function buildFieldHeader(label, field, lockedFields, onToggleLock) {
    const isLocked = lockedFields.has(field);
    const lockInd = h('span', {
        class: 'am-locked-indicator', id: 'am-lock-ind-' + field,
        style: { display: isLocked ? 'inline' : 'none' }
    }, '�� locked');
    const lockBtn = h('button', {
        class: 'am-lock-btn' + (isLocked ? ' locked' : ''), id: 'am-lock-' + field,
        title: 'Lock: AI won\'t change this field',
        onClick: () => onToggleLock(field)
    }, isLocked ? '��' : '��');
    return h('div', { class: 'am-field-header' },
        h('label', null, label), lockInd, lockBtn
    );
}

/**
 * Build a select dropdown
 */
function buildSelect(id, options, selected, labelMap, onChange) {
    const sel = h('select', {
        id,
        style: { width: '100%', padding: '6px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '12px' },
        onChange
    });
    for (const opt of options) {
        const info = labelMap && labelMap[opt];
        const label = info ? `${info.label || opt} — ${info.description || ''}` : opt;
        const o = h('option', { value: opt, title: info ? (info.description || '') : '' }, label);
        if (opt === selected) o.selected = true;
        sel.appendChild(o);
    }
    return sel;
}

/**
 * Build group select dropdown
 */
function buildGroupSelect(groups, selectedValue, onChange) {
    const sel = h('select', {
        id: 'am-group',
        style: { width: '100%', padding: '6px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '12px' },
        onChange
    });
    sel.appendChild(h('option', { value: '' }, 'None'));

    const roots = (groups || []).filter(g => !g.parentId);
    const childMap = {};
    for (const g of groups || []) {
        if (g.parentId) {
            if (!childMap[g.parentId]) childMap[g.parentId] = [];
            childMap[g.parentId].push(g);
        }
    }
    for (const root of roots) {
        sel.appendChild(h('option', { value: root.id }, root.name || root.id));
        for (const child of (childMap[root.id] || [])) {
            sel.appendChild(h('option', { value: child.id }, (root.name || root.id) + ' > ' + (child.name || child.id)));
        }
    }
    if (selectedValue) sel.value = selectedValue;
    return sel;
}

/**
 * Render tool permissions UI
 */
function renderToolPermissions(container, categories, currentTools, agent) {
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
 * Get selected tools from the editor element
 * @param {HTMLElement} editorEl - The editor container element
 * @param {object} agent - Current agent object
 * @returns {string[]}
 */
export function getSelectedTools(editorEl, agent) {
    if (!editorEl) return [];
    const forcedTools = agent.forcedTools || [];
    const blockedTools = agent.blockedTools || [];

    let selected = [...editorEl.querySelectorAll('.am-tool-chk:checked:not(:disabled)')].map(cb => cb.value);
    for (const t of forcedTools) { if (!selected.includes(t)) selected.push(t); }
    selected = selected.filter(t => !blockedTools.includes(t));
    return selected;
}

/**
 * Get form values from the editor
 * @param {HTMLElement} editorEl - The editor container element
 * @param {string[]} selectedTools - Array of selected tool names
 * @returns {object}
 */
export function getFormValues(editorEl, selectedTools = []) {
    const val = (id) => {
        const el = editorEl.querySelector('#' + id);
        return el ? el.value.trim() : '';
    };
    const overrideEl = editorEl.querySelector('#am-override-role');
    return {
        name: val(AGENT_DETAIL_FIELD_IDS.name),
        role: val(AGENT_DETAIL_FIELD_IDS.role),
        description: val(AGENT_DETAIL_FIELD_IDS.description),
        instructions: val(AGENT_DETAIL_FIELD_IDS.instructions),
        securityRole: val(AGENT_DETAIL_FIELD_IDS.securityRole),
        group: val(AGENT_DETAIL_FIELD_IDS.group),
        tools: selectedTools,
        overrideRoleRestrictions: overrideEl ? overrideEl.checked : false
    };
}

/**
 * Validate agent form
 * @param {object} values - Form values
 * @returns {object} - { valid: boolean, error?: string }
 */
export function validateAgentForm(values) {
    if (!values.name || !values.name.trim()) {
        return { valid: false, error: 'Agent name is required' };
    }
    return { valid: true };
}

// Export the component class for direct use
export class AgentDetailView extends Component {
    constructor(el, opts = {}) {
        super(el, opts);
        this._agent = opts.agent || {};
        this._isNew = opts.isNew || false;
        this._onChange = opts.onChange || (() => {});
        this._onSave = opts.onSave || (() => {});
        this._onCancel = opts.onCancel || (() => {});
        this._onDelete = opts.onDelete || (() => {});
        this._onAiFillToggle = opts.onAiFillToggle || (() => {});
        this._onGeneratePreview = opts.onGeneratePreview || (() => {});
    }

    mount() {
        this._mounted = true;
        this.render();
    }

    render() {
        const detail = buildAgentDetailView({
            agent: this._agent,
            isNew: this._isNew,
            onChange: this._onChange,
            onSave: this._onSave,
            onCancel: this._onCancel,
            onDelete: this._onDelete,
            onAiFillToggle: this._onAiFillToggle,
            onGeneratePreview: this._onGeneratePreview,
            groups: this.opts.groups || [],
            toolCategories: this.opts.toolCategories || {},
            currentTools: this.opts.currentTools || [],
            lockedFields: this.opts.lockedFields || new Set(),
            fieldPreviews: this.opts.fieldPreviews || {},
            aiPanelOpen: this.opts.aiPanelOpen || false
        });
        this.el.textContent = '';
        this.el.appendChild(detail);
    }

    updateAgent(agent) {
        this._agent = agent;
        this.render();
    }

    setGroups(groups) {
        this.opts.groups = groups;
        this.render();
    }
}
