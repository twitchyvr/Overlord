/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Agent Manager View
   ═══════════════════════════════════════════════════════════════════
   Modal for managing agents (create, edit, delete) and groups.

   Two tabs:
     1. Agents — sidebar list + editor panel (name, role, desc,
        instructions, security role, group, tool permissions)
     2. Groups — list with members, collaboration mode, color;
        add / edit / delete

   Dependencies: engine.js (Component, OverlordUI, h),
                 modal.js (Modal), tabs.js (Tabs), button.js (Button)
   ═══════════════════════════════════════════════════════════════════ */

import { Component, OverlordUI, h } from '../engine.js';
import { Modal }  from '../components/modal.js';
import { Tabs }   from '../components/tabs.js';
import { Button } from '../components/button.js';

// ── Tool categories for permission checkboxes ────────────────────
const TOOL_CATEGORIES = {
    shell:  ['bash', 'powershell'],
    files:  ['read_file', 'read_file_lines', 'write_file', 'patch_file', 'append_file', 'list_dir'],
    ai:     ['web_search', 'understand_image'],
    system: ['system_info', 'get_working_dir', 'set_working_dir'],
    agents: ['list_agents', 'get_agent_info', 'assign_task'],
    qa:     ['qa_run_tests', 'qa_check_lint', 'qa_check_types', 'qa_check_coverage'],
    notes:  ['record_note', 'recall_notes'],
    skills: ['list_skills', 'get_skill', 'activate_skill']
};

const MODAL_ID = 'agent-manager';

export class AgentManagerView extends Component {

    constructor(el, opts = {}) {
        super(el, opts);
        this._socket         = opts.socket || null;
        this._agents         = [];
        this._groups         = [];
        this._currentAgentId = null;
        this._dirty          = false;
        this._tabs           = null;
        this._editorEl       = null;
        this._listEl         = null;
        this._groupsEl       = null;
        this._saveBtn        = null;
        this._aiProposal     = null; // AI-proposed agent config for diff preview
    }

    // ══════════════════════════════════════════════════════════════
    //  LIFECYCLE
    // ══════════════════════════════════════════════════════════════

    mount() {
        this._mounted = true;
    }

    /** Open the agent manager modal. */
    open() {
        const content = this._buildContent();
        Modal.open(MODAL_ID, {
            title: 'Agent Manager',
            content,
            size: 'xl',
            className: 'agent-manager-modal',
            onClose: () => { this._dirty = false; this._currentAgentId = null; }
        });
        this._loadAgentList();
        this._loadGroups();
    }

    /** Close the modal. */
    close() {
        Modal.close(MODAL_ID);
    }

    // ══════════════════════════════════════════════════════════════
    //  LAYOUT
    // ══════════════════════════════════════════════════════════════

    /** @private Build the full modal body content node. */
    _buildContent() {
        const tabBar = h('div', { class: 'agent-mgr-tabs' });
        this._tabs = new Tabs(tabBar, {
            items: [
                { id: 'agents', label: 'Agents' },
                { id: 'groups', label: 'Groups' }
            ],
            activeId: 'agents',
            style: 'underline',
            onChange: (id) => this._onTabChange(id)
        });
        this._tabs.mount();

        this._listEl   = h('div', { class: 'agent-mgr-list' });
        this._editorEl = h('div', { class: 'agent-mgr-editor' });
        this._groupsEl = h('div', { class: 'agent-mgr-groups', style: { display: 'none' } });

        const agentsPane = h('div', { class: 'agent-mgr-split' }, this._listEl, this._editorEl);

        return h('div', { class: 'agent-mgr-root' }, tabBar, agentsPane, this._groupsEl);
    }

    /** @private Handle tab switch. */
    _onTabChange(id) {
        const agentsPane = this._listEl?.parentElement;
        if (id === 'agents') {
            if (agentsPane) agentsPane.style.display = '';
            this._groupsEl.style.display = 'none';
        } else {
            if (agentsPane) agentsPane.style.display = 'none';
            this._groupsEl.style.display = '';
            this._renderGroups();
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  AGENT LIST
    // ══════════════════════════════════════════════════════════════

    _loadAgentList() {
        if (!this._socket) return;
        this._socket.emit('list_agents', (agents) => {
            this._agents = agents || [];
            this._renderAgentList();
        });
    }

    _renderAgentList() {
        this._listEl.textContent = '';
        const newBtn = Button.create('+ New Agent', {
            variant: 'primary', size: 'sm',
            onClick: () => this._newAgent()
        });
        this._listEl.appendChild(newBtn);

        for (const agent of this._agents) {
            const id = agent.id || agent.name;
            const item = h('div', {
                class: `agent-list-item${id === this._currentAgentId ? ' selected' : ''}`,
                dataset: { agentId: id },
                onClick: () => this._selectAgent(id)
            }, h('span', { class: 'agent-list-name' }, agent.name || id));
            this._listEl.appendChild(item);
        }
    }

    _selectAgent(agentId) {
        this._currentAgentId = agentId;
        this._aiProposal = null;
        this._renderAgentList();
        if (!this._socket) return;
        this._socket.emit('get_agent', agentId, (agent) => {
            if (agent) this._renderEditor(agent);
        });
    }

    _newAgent() {
        this._currentAgentId = null;
        this._aiProposal = null;
        this._renderEditor({
            name: '', role: '', description: '', instructions: '',
            securityRole: 'worker', group: '', tools: []
        });
        this._markDirty();
    }

    // ══════════════════════════════════════════════════════════════
    //  AGENT EDITOR
    // ══════════════════════════════════════════════════════════════

    _renderEditor(agent) {
        this._editorEl.textContent = '';
        this._markClean();

        const field = (label, key, tag) => {
            const id = `agent-field-${key}`;
            const el = tag === 'textarea'
                ? h('textarea', { id, class: 'agent-input', rows: '3', onInput: () => this._markDirty() }, agent[key] || '')
                : h('input', { id, class: 'agent-input', type: 'text', value: agent[key] || '', onInput: () => this._markDirty() });
            return h('div', { class: 'agent-field' },
                h('label', { for: id, class: 'agent-label' }, label), el
            );
        };

        const groupSelect = h('select', { id: 'agent-field-group', class: 'agent-input', onChange: () => this._markDirty() },
            h('option', { value: '' }, '(none)'),
            ...this._groups.map(g => {
                const opt = h('option', { value: g.id || g.name }, g.name || g.id);
                if ((agent.group || '') === (g.id || g.name)) opt.selected = true;
                return opt;
            })
        );

        const securitySelect = h('select', { id: 'agent-field-securityRole', class: 'agent-input', onChange: () => this._markDirty() },
            ...['worker', 'lead', 'admin', 'auditor'].map(r => {
                const opt = h('option', { value: r }, r);
                if (agent.securityRole === r) opt.selected = true;
                return opt;
            })
        );

        const toolsSection = this._renderToolPermissions(agent.tools || []);

        this._saveBtn = Button.create('Save', {
            variant: 'primary', size: 'sm', disabled: true,
            onClick: () => this._saveAgent()
        });
        const deleteBtn = Button.create('Delete', {
            variant: 'danger', size: 'sm',
            onClick: () => this._deleteAgent()
        });
        const actions = Button.group(
            this._currentAgentId ? [this._saveBtn, deleteBtn] : [this._saveBtn]
        );

        this._editorEl.appendChild(
            h('div', { class: 'agent-editor-inner' },
                field('Name', 'name', 'input'),
                field('Role', 'role', 'input'),
                field('Description', 'description', 'textarea'),
                field('Instructions', 'instructions', 'textarea'),
                h('div', { class: 'agent-field' },
                    h('label', { class: 'agent-label' }, 'Security Role'), securitySelect),
                h('div', { class: 'agent-field' },
                    h('label', { class: 'agent-label' }, 'Group'), groupSelect),
                h('div', { class: 'agent-field' },
                    h('label', { class: 'agent-label' }, 'Tool Permissions'), toolsSection),
                actions
            )
        );
    }

    // ── Tool permissions ────────────────────────────────────────

    _renderToolPermissions(enabledTools) {
        const wrap = h('div', { class: 'agent-tools-grid' });
        const enabled = new Set(enabledTools);
        const proposed = this._aiProposal ? new Set(this._aiProposal.tools || []) : null;

        for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
            const catEl = h('div', { class: 'agent-tools-category' },
                h('div', { class: 'agent-tools-cat-label' }, category)
            );
            for (const tool of tools) {
                const checked = enabled.has(tool);
                const diff = proposed
                    ? (proposed.has(tool) !== checked ? (proposed.has(tool) ? 'added' : 'removed') : '')
                    : '';
                const cb = h('input', { type: 'checkbox', class: 'agent-tool-cb', dataset: { tool }, onChange: () => this._markDirty() });
                if (checked) cb.checked = true;
                const label = h('label', { class: `agent-tool-label ${diff ? 'tool-diff-' + diff : ''}`.trim() }, cb, ' ' + tool);
                catEl.appendChild(label);
            }
            wrap.appendChild(catEl);
        }
        return wrap;
    }

    _getSelectedTools() {
        if (!this._editorEl) return [];
        const cbs = this._editorEl.querySelectorAll('.agent-tool-cb:checked');
        return [...cbs].map(cb => cb.dataset.tool);
    }

    // ── Dirty state ─────────────────────────────────────────────

    _markDirty() {
        this._dirty = true;
        if (this._saveBtn) this._saveBtn.disabled = false;
    }

    _markClean() {
        this._dirty = false;
        if (this._saveBtn) this._saveBtn.disabled = true;
    }

    // ══════════════════════════════════════════════════════════════
    //  AGENT CRUD
    // ══════════════════════════════════════════════════════════════

    _saveAgent() {
        if (!this._socket) return;
        const val = (id) => {
            const el = this._editorEl.querySelector(`#agent-field-${id}`);
            return el ? el.value.trim() : '';
        };
        const data = {
            name:         val('name'),
            role:         val('role'),
            description:  val('description'),
            instructions: val('instructions'),
            securityRole: val('securityRole'),
            group:        val('group'),
            tools:        this._getSelectedTools()
        };
        if (!data.name) return;

        if (this._currentAgentId) {
            data.id = this._currentAgentId;
            this._socket.emit('update_agent', data, (res) => {
                if (res && res.success) { this._markClean(); this._loadAgentList(); }
            });
        } else {
            this._socket.emit('add_agent', data, (res) => {
                if (res && res.success) {
                    this._currentAgentId = res.id || data.name;
                    this._markClean();
                    this._loadAgentList();
                }
            });
        }
    }

    _deleteAgent() {
        if (!this._currentAgentId || !this._socket) return;
        this._socket.emit('remove_agent', this._currentAgentId);
        this._currentAgentId = null;
        this._editorEl.textContent = '';
        this._loadAgentList();
    }

    // ══════════════════════════════════════════════════════════════
    //  AI PREVIEW (side-by-side diff for proposed changes)
    // ══════════════════════════════════════════════════════════════

    /** Accept an AI-proposed agent config and re-render to show diff. */
    showAIProposal(proposal) {
        this._aiProposal = proposal;
        if (this._currentAgentId) {
            this._selectAgent(this._currentAgentId);
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  GROUPS TAB
    // ══════════════════════════════════════════════════════════════

    _loadGroups() {
        if (!this._socket) return;
        this._socket.emit('list_groups', (groups) => {
            this._groups = groups || [];
        });
    }

    _renderGroups() {
        this._groupsEl.textContent = '';
        const addBtn = Button.create('+ New Group', {
            variant: 'primary', size: 'sm',
            onClick: () => this._addGroup()
        });
        this._groupsEl.appendChild(addBtn);

        for (const group of this._groups) {
            const members = (group.members || []).join(', ') || 'No members';
            const card = h('div', { class: 'group-card', style: { borderLeft: `4px solid ${group.color || '#666'}` } },
                h('div', { class: 'group-header' },
                    h('strong', null, group.name || group.id),
                    Button.create('Delete', {
                        variant: 'danger', size: 'sm',
                        onClick: () => this._deleteGroup(group.id || group.name)
                    })
                ),
                h('div', { class: 'group-meta' },
                    h('span', null, 'Mode: ' + (group.collaborationMode || 'parallel')),
                    h('span', null, 'Members: ' + members)
                )
            );
            this._groupsEl.appendChild(card);
        }
    }

    _addGroup() {
        if (!this._socket) return;
        const name = prompt('Group name:');
        if (!name) return;
        this._socket.emit('create_group', { name, color: '#5b8def', collaborationMode: 'parallel' }, () => {
            this._loadGroups();
            setTimeout(() => this._renderGroups(), 100);
        });
    }

    _deleteGroup(id) {
        if (!this._socket || !id) return;
        this._socket.emit('delete_group', id, () => {
            this._loadGroups();
            setTimeout(() => this._renderGroups(), 100);
        });
    }
}
