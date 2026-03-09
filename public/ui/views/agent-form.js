/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Agent Form
   ═══════════════════════════════════════════════════════════════════
   Creation/edit form: handles new agent creation and editing with fields:
   name (kebab-case), role, description, capabilities (multi-select),
   system prompt, languages.

   Extracted from agent-manager.js for modularity.
   Dependencies: engine.js (Component, OverlordUI, h)
   ═══════════════════════════════════════════════════════════════════ */

import { Component, OverlordUI, h } from '../engine.js';

// Field configuration
export const AGENT_FORM_FIELDS = {
    name: { type: 'text', required: true, placeholder: 'e.g. backend-dev', pattern: '^[a-z][a-z0-9-]*$', label: 'NAME', maxLength: 40 },
    role: { type: 'text', required: false, placeholder: 'e.g. Backend Developer', label: 'ROLE', maxLength: 60 },
    description: { type: 'textarea', required: false, placeholder: 'What this agent specializes in...', label: 'DESCRIPTION', rows: 2 },
    instructions: { type: 'textarea', required: false, placeholder: 'Special instructions for this agent...', label: 'INSTRUCTIONS', rows: 3 },
    securityRole: { type: 'select', required: false, label: 'SECURITY ROLE' },
    group: { type: 'select', required: false, label: 'GROUP' },
    capabilities: { type: 'multiselect', required: false, label: 'CAPABILITIES' },
    languages: { type: 'multiselect', required: false, label: 'LANGUAGES' },
    systemPrompt: { type: 'textarea', required: false, placeholder: 'System prompt for the agent...', label: 'SYSTEM PROMPT', rows: 4 }
};

// Common programming languages for the languages field
export const COMMON_LANGUAGES = [
    'JavaScript', 'TypeScript', 'Python', 'Java', 'C#', 'C++', 'Go', 'Rust',
    'Ruby', 'PHP', 'Swift', 'Kotlin', 'Scala', 'R', 'SQL', 'Shell', 'PowerShell'
];

/**
 * Convert a name to kebab-case
 * @param {string} name - Input string
 * @returns {string} - kebab-case string
 */
export function toKebabCase(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/^([a-z])/, (_, c) => c); // Ensure starts with letter
}

/**
 * Validate agent name (kebab-case)
 * @param {string} name - Agent name
 * @returns {object} - { valid: boolean, error?: string }
 */
export function validateAgentName(name) {
    if (!name || !name.trim()) {
        return { valid: false, error: 'Agent name is required' };
    }
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
        return { valid: false, error: 'Name must be lowercase letters, numbers, and hyphens only' };
    }
    if (name.length > 40) {
        return { valid: false, error: 'Name must be 40 characters or less' };
    }
    return { valid: true };
}

/**
 * Build the agent creation/edit form
 * @param {object} params - Parameters
 * @param {object} params.agent - Initial agent data
 * @param {boolean} params.isNew - Whether this is a new agent
 * @param {object} params.securityRoles - Security role options
 * @param {Array} params.groups - Available groups
 * @param {Array} params.availableCapabilities - Available capabilities
 * @param {Array} params.availableLanguages - Available languages
 * @param {Function} params.onChange - Change handler
 * @param {Function} params.onSubmit - Submit handler
 * @param {Function} params.onCancel - Cancel handler
 * @returns {HTMLElement}
 */
export function buildAgentForm({
    agent = {},
    isNew = false,
    securityRoles = {},
    groups = [],
    availableCapabilities = [],
    availableLanguages = COMMON_LANGUAGES,
    onChange,
    onSubmit,
    onCancel
}) {
    const root = document.createElement('div');
    root.className = 'agent-form';

    // Title
    const title = h('h3', {
        style: { margin: '0 0 16px', fontSize: '13px', fontWeight: '700', letterSpacing: '0.06em', color: 'var(--text-secondary)' }
    }, isNew ? 'CREATE NEW AGENT' : 'EDIT AGENT');

    root.appendChild(title);

    // Form fields container
    const fieldsContainer = h('div', { class: 'agent-form-fields', style: { display: 'flex', flexDirection: 'column', gap: '14px' } });

    // Name field (with kebab-case conversion)
    const nameInput = h('input', {
        id: 'af-name',
        type: 'text',
        value: agent.name || '',
        placeholder: AGENT_FORM_FIELDS.name.placeholder,
        maxlength: AGENT_FORM_FIELDS.name.maxLength,
        style: { width: '100%', padding: '8px 10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box', fontFamily: 'monospace' }
    });
    const nameHint = h('span', {
        class: 'agent-form-hint',
        style: { fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }
    }, 'kebab-case (lowercase with hyphens)');
    
    // Auto-convert to kebab-case on input
    nameInput.addEventListener('input', (e) => {
        const cursorPos = e.target.selectionStart;
        const oldValue = e.target.value;
        const newValue = toKebabCase(oldValue);
        if (newValue !== oldValue) {
            e.target.value = newValue;
            // Try to maintain cursor position
            if (cursorPos <= oldValue.length) {
                e.target.setSelectionRange(cursorPos, cursorPos);
            }
        }
        onChange && onChange(e);
    });

    fieldsContainer.appendChild(buildFormField('NAME', nameInput, nameHint));

    // Role field
    const roleInput = h('input', {
        id: 'af-role',
        type: 'text',
        value: agent.role || '',
        placeholder: AGENT_FORM_FIELDS.role.placeholder,
        maxlength: AGENT_FORM_FIELDS.role.maxLength,
        style: { width: '100%', padding: '8px 10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box' }
    });
    fieldsContainer.appendChild(buildFormField('ROLE', roleInput));

    // Description field
    const descInput = h('textarea', {
        id: 'af-description',
        rows: String(AGENT_FORM_FIELDS.description.rows),
        placeholder: AGENT_FORM_FIELDS.description.placeholder,
        style: { width: '100%', padding: '8px 10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box' }
    }, agent.description || '');
    fieldsContainer.appendChild(buildFormField('DESCRIPTION', descInput));

    // Instructions/System prompt field
    const instructionsInput = h('textarea', {
        id: 'af-instructions',
        rows: String(AGENT_FORM_FIELDS.instructions.rows),
        placeholder: AGENT_FORM_FIELDS.instructions.placeholder,
        style: { width: '100%', padding: '8px 10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box' }
    }, agent.instructions || '');
    fieldsContainer.appendChild(buildFormField('INSTRUCTIONS', instructionsInput));

    // Security role + Group row
    const secGroupRow = h('div', { style: { display: 'flex', gap: '12px' } });

    // Security role dropdown
    const roleOptions = Object.keys(securityRoles);
    const securitySelect = h('select', {
        id: 'af-security-role',
        style: { flex: '1', padding: '8px 10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '13px' }
    });
    for (const opt of roleOptions) {
        const info = securityRoles[opt];
        const label = info ? `${info.label || opt} — ${info.description || ''}` : opt;
        const o = h('option', { value: opt, title: info ? (info.description || '') : '' }, label);
        if (opt === (agent.securityRole || 'implementer')) o.selected = true;
        securitySelect.appendChild(o);
    }
    secGroupRow.appendChild(buildFormField('SECURITY ROLE', securitySelect));

    // Group dropdown
    const groupSelect = h('select', {
        id: 'af-group',
        style: { flex: '1', padding: '8px 10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '13px' }
    });
    groupSelect.appendChild(h('option', { value: '' }, 'None'));
    for (const g of groups) {
        groupSelect.appendChild(h('option', { value: g.id }, g.name || g.id));
    }
    if (agent.group) groupSelect.value = agent.group;
    secGroupRow.appendChild(buildFormField('GROUP', groupSelect));

    fieldsContainer.appendChild(secGroupRow);

    // Capabilities multi-select
    if (availableCapabilities.length > 0) {
        const capabilitiesContainer = buildMultiSelect({
            id: 'af-capabilities',
            label: 'CAPABILITIES',
            options: availableCapabilities,
            selected: agent.capabilities || [],
            onChange
        });
        fieldsContainer.appendChild(capabilitiesContainer);
    }

    // Languages multi-select
    const languagesContainer = buildMultiSelect({
        id: 'af-languages',
        label: 'LANGUAGES',
        options: availableLanguages,
        selected: agent.languages || [],
        onChange
    });
    fieldsContainer.appendChild(languagesContainer);

    root.appendChild(fieldsContainer);

    // Action buttons
    const actions = h('div', { class: 'agent-form-actions', style: { display: 'flex', gap: '10px', marginTop: '20px' } });

    const submitBtn = h('button', {
        type: 'submit',
        style: { flex: '1', padding: '10px', background: 'var(--accent-green)', border: 'none', borderRadius: '4px', cursor: 'pointer', color: '#000', fontSize: '13px', fontWeight: '600' }
    }, isNew ? 'Create Agent' : 'Save Changes');

    const cancelBtn = h('button', {
        type: 'button',
        style: { padding: '10px 16px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '13px' },
        onClick: onCancel
    }, 'Cancel');

    actions.appendChild(submitBtn);
    actions.appendChild(cancelBtn);
    root.appendChild(actions);

    // Wire up change listeners
    const inputs = root.querySelectorAll('input, textarea, select');
    inputs.forEach(el => {
        el.addEventListener('input', onChange);
        el.addEventListener('change', onChange);
    });

    // Form submission
    root.addEventListener('submit', (e) => {
        e.preventDefault();
        onSubmit && onSubmit(e);
    });

    return root;
}

/**
 * Build a single form field with label
 */
function buildFormField(label, input, hint) {
    const container = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
    const labelEl = h('label', {
        style: { fontSize: '10px', color: 'var(--text-muted)', fontWeight: '600', letterSpacing: '0.05em' }
    }, label);
    container.appendChild(labelEl);
    container.appendChild(input);
    if (hint) container.appendChild(hint);
    return container;
}

/**
 * Build a multi-select component
 */
function buildMultiSelect({ id, label, options = [], selected = [], onChange }) {
    const container = h('div', {
        class: 'agent-form-multiselect',
        style: { display: 'flex', flexDirection: 'column', gap: '6px' }
    });

    const labelEl = h('label', {
        style: { fontSize: '10px', color: 'var(--text-muted)', fontWeight: '600', letterSpacing: '0.05em' }
    }, label);
    container.appendChild(labelEl);

    // Selected tags container
    const tagsContainer = h('div', {
        class: 'agent-form-tags',
        style: { display: 'flex', flexWrap: 'wrap', gap: '6px', minHeight: '28px' }
    });

    // Hidden select for form data
    const hiddenSelect = h('select', {
        id: id,
        multiple: true,
        style: { display: 'none' }
    });
    for (const opt of options) {
        const o = h('option', { value: opt }, opt);
        if (selected.includes(opt)) o.selected = true;
        hiddenSelect.appendChild(o);
    }

    // Tag buttons for selected items
    const selectedSet = new Set(selected);
    const updateTags = () => {
        tagsContainer.textContent = '';
        for (const opt of options) {
            if (selectedSet.has(opt)) {
                const tag = h('span', {
                    class: 'agent-form-tag',
                    style: { display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'var(--accent-primary)', color: '#000', borderRadius: '3px', padding: '3px 8px', fontSize: '11px', fontWeight: '500' }
                },
                    opt,
                    h('button', {
                        type: 'button',
                        style: { background: 'none', border: 'none', cursor: 'pointer', color: '#000', fontSize: '12px', padding: '0', lineHeight: '1' },
                        onClick: (e) => {
                            e.stopPropagation();
                            selectedSet.delete(opt);
                            hiddenSelect.querySelector(`option[value="${opt}"]`).selected = false;
                            updateTags();
                            onChange && onChange({ target: hiddenSelect });
                        }
                    }, '×')
                );
                tagsContainer.appendChild(tag);
            }
        }
    };
    updateTags();

    // Dropdown for adding new items
    const dropdown = h('select', {
        class: 'agent-form-add-select',
        style: { width: '100%', padding: '6px 8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '12px' }
    });
    dropdown.appendChild(h('option', { value: '' }, `— Add ${label.toLowerCase()} —`));
    for (const opt of options) {
        if (!selectedSet.has(opt)) {
            dropdown.appendChild(h('option', { value: opt }, opt));
        }
    }
    dropdown.addEventListener('change', (e) => {
        if (e.target.value) {
            selectedSet.add(e.target.value);
            hiddenSelect.querySelector(`option[value="${e.target.value}"]`).selected = true;
            updateTags();
            e.target.value = '';
            onChange && onChange({ target: hiddenSelect });
        }
    });

    container.appendChild(tagsContainer);
    container.appendChild(dropdown);
    container.appendChild(hiddenSelect);

    return container;
}

/**
 * Get form values from the agent form
 * @param {HTMLElement} formEl - The form element
 * @returns {object} - Form values
 */
export function getFormValues(formEl) {
    const getVal = (id) => {
        const el = formEl.querySelector('#' + id);
        if (!el) return '';
        if (el.tagName === 'SELECT' && el.multiple) {
            return [...el.selectedOptions].map(o => o.value);
        }
        return el.value.trim();
    };

    return {
        name: getVal('af-name'),
        role: getVal('af-role'),
        description: getVal('af-description'),
        instructions: getVal('af-instructions'),
        securityRole: getVal('af-security-role'),
        group: getVal('af-group'),
        capabilities: getVal('af-capabilities'),
        languages: getVal('af-languages')
    };
}

/**
 * Validate the agent form
 * @param {object} values - Form values
 * @returns {object} - { valid: boolean, errors: object }
 */
export function validateForm(values) {
    const errors = {};

    // Name validation
    const nameValidation = validateAgentName(values.name);
    if (!nameValidation.valid) {
        errors.name = nameValidation.error;
    }

    // Role validation
    if (values.role && values.role.length > 60) {
        errors.role = 'Role must be 60 characters or less';
    }

    return {
        valid: Object.keys(errors).length === 0,
        errors
    };
}

// Export component class
export class AgentForm extends Component {
    constructor(el, opts = {}) {
        super(el, opts);
        this._agent = opts.agent || {};
        this._isNew = opts.isNew !== false;
        this._onSubmit = opts.onSubmit || (() => {});
        this._onCancel = opts.onCancel || (() => {});
        this._onChange = opts.onChange || (() => {});
    }

    mount() {
        this._mounted = true;
        this.render();
    }

    render() {
        const form = buildAgentForm({
            agent: this._agent,
            isNew: this._isNew,
            securityRoles: this.opts.securityRoles || {},
            groups: this.opts.groups || [],
            availableCapabilities: this.opts.availableCapabilities || [],
            availableLanguages: this.opts.availableLanguages || COMMON_LANGUAGES,
            onChange: (e) => {
                this._onChange(e, this.getValues());
            },
            onSubmit: (e) => {
                const values = this.getValues();
                const validation = validateForm(values);
                if (validation.valid) {
                    this._onSubmit(values);
                } else {
                    // Show errors
                    for (const [field, error] of Object.entries(validation.errors)) {
                        console.warn(`Validation error (${field}): ${error}`);
                    }
                }
            },
            onCancel: this._onCancel
        });
        this.el.textContent = '';
        this.el.appendChild(form);
    }

    getValues() {
        return getFormValues(this.el);
    }

    setValues(values) {
        const fields = ['name', 'role', 'description', 'instructions', 'securityRole', 'group'];
        for (const field of fields) {
            const el = this.el.querySelector('#af-' + field);
            if (el && values[field] !== undefined) {
                el.value = values[field];
            }
        }
    }

    setGroups(groups) {
        this.opts.groups = groups;
        this.render();
    }

    setSecurityRoles(roles) {
        this.opts.securityRoles = roles;
        this.render();
    }
}
