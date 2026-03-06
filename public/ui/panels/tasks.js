/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Tasks Panel
   ═══════════════════════════════════════════════════════════════════
   Extracted from monolith: renderTasks(), renderTasksListView(),
   renderTasksTreeView(), renderNode(), task CRUD operations.

   Features:
     - List / Tree / Kanban view switching via Tabs
     - Drag-reorder task items
     - Inline task editing (checkbox, priority, assignee)
     - Task detail sheet (slide-up)
     - Add task modal
     - Sub-task tree rendering
     - Burndown chart integration

   Dependencies: engine.js, components/tabs.js
   ═══════════════════════════════════════════════════════════════════ */

import { OverlordUI, h } from '../engine.js';
import { PanelComponent } from '../components/panel.js';
import { Tabs } from '../components/tabs.js';


export class TasksPanel extends PanelComponent {

    constructor(el, opts = {}) {
        super(el, opts);
        this._tasks = [];
        this._view = 'list';  // 'list' | 'tree' | 'kanban'
        this._viewTabs = null;
        this._listEl = null;
        this._treeCollapsed = new Set();
    }

    mount() {
        super.mount();
        this._listEl = this.$('#tasks') || this.$('.panel-content');

        // Load persisted view preference
        if (OverlordUI._store) {
            this._view = OverlordUI._store.peek('tasks.view', 'list');
            const collapsed = OverlordUI._store.peek('tasks.treeCollapsed', []);
            this._treeCollapsed = new Set(collapsed);
        }

        // View tabs
        const tabContainer = this.$('.task-view-tabs');
        if (tabContainer) {
            this._viewTabs = new Tabs(tabContainer, {
                items: [
                    { id: 'list', label: '☰ List' },
                    { id: 'tree', label: '🌳 Tree' },
                    { id: 'kanban', label: '📋 Board' }
                ],
                activeId: this._view,
                style: 'pills',
                onChange: (id) => {
                    this._view = id;
                    if (OverlordUI._store) OverlordUI._store.set('tasks.view', id);
                    this.render(this._tasks);
                }
            });
            this._viewTabs.mount();
        }

        // Subscribe to task updates
        if (OverlordUI._store) {
            this.subscribe(OverlordUI._store, 'tasks.list', (tasks) => {
                this._tasks = tasks || [];
                this.render(this._tasks);
            });
        }

        // Event delegation for task actions
        this.on('click', '.task-checkbox', (e, el) => {
            const taskId = el.dataset.taskId;
            if (taskId) this._toggleTaskComplete(taskId);
        });

        this.on('click', '.task-action-btn', (e, el) => {
            const action = el.dataset.action;
            const taskId = el.dataset.taskId;
            if (action === 'edit') this._openTaskDetail(taskId);
            if (action === 'delete') this._deleteTask(taskId);
        });

        this.on('click', '.task-skip-btn', (e, el) => {
            const taskId = el.dataset.taskId;
            if (taskId) this._skipTask(taskId);
        });

        this.on('click', '.task-delete', (e, el) => {
            const taskId = el.dataset.taskId;
            if (taskId) this._deleteTask(taskId);
        });

        this.on('click', '.tasks-add-btn', () => {
            OverlordUI.dispatch('open_add_task_modal');
        });
    }

    render(tasks) {
        if (!this._listEl) return;
        this._tasks = tasks || this._tasks;

        switch (this._view) {
            case 'tree':  this._renderTreeView();  break;
            case 'kanban': this._renderKanbanView(); break;
            default:      this._renderListView();  break;
        }
    }

    // ── List View ────────────────────────────────────────────────

    _renderListView() {
        if (!this._tasks.length) {
            OverlordUI.setContent(this._listEl, h('div', {
                style: 'padding:16px;text-align:center;color:var(--text-muted);font-size:12px;'
            }, 'No tasks yet'));
            return;
        }

        const frag = document.createDocumentFragment();
        for (const task of this._tasks) {
            frag.appendChild(this._buildTaskItem(task));
        }

        this._listEl.textContent = '';
        this._listEl.appendChild(frag);
    }

    _buildTaskItem(task) {
        const isCompleted = task.completed || task.status === 'completed' || task.status === 'done';
        const isRunning = task.status === 'running' || task.status === 'in_progress' || task.status === 'working';
        const isSkipped = task.status === 'skipped';
        const isBlocked = task.status === 'blocked';
        const isPlanPending = task.status === 'plan_pending';

        const classes = [
            'task-item',
            isCompleted ? 'completed' : '',
            isRunning ? 'task-running' : '',
            isSkipped ? 'task-skipped' : '',
            isBlocked ? 'task-blocked' : ''
        ].filter(Boolean).join(' ');

        const item = h('div', {
            class: classes,
            'data-task-id': task.id,
            'data-plan-pending': isPlanPending ? '1' : '0',
            draggable: 'true'
        });

        const header = h('div', { class: 'task-header' });

        // Priority dot (colored indicator)
        const priorityColors = { critical: '#ef4444', high: '#f59e0b', medium: '#6366f1', low: '#6b7280', normal: '#6b7280' };
        const dotColor = priorityColors[task.priority || 'normal'] || '#6b7280';
        header.appendChild(h('div', {
            class: 'task-priority-dot',
            style: `background:${dotColor}`,
            title: `Priority: ${task.priority || 'normal'}`
        }));

        // Checkbox (actual <input> so it's visible)
        const checkbox = h('input', {
            type: 'checkbox',
            class: 'task-checkbox',
            'data-task-id': task.id
        });
        if (isCompleted) checkbox.checked = true;
        header.appendChild(checkbox);

        // Title wrapper (holds title + assignee + timing)
        const titleWrap = h('div', { style: 'flex:1;min-width:0;' });
        const titleEl = h('span', {
            class: `task-title${isCompleted ? ' completed' : ''}`,
            title: 'Double-click to edit'
        }, task.title || 'Untitled');
        if (isRunning && task.currentTool) {
            titleEl.setAttribute('data-current-tool', task.currentTool);
        }
        titleWrap.appendChild(titleEl);

        // Assignee badges under title
        if (task.assignee) {
            const assignees = Array.isArray(task.assignee) ? task.assignee : [task.assignee];
            const agentRow = h('div', { style: 'display:flex;gap:3px;margin-top:2px;flex-wrap:wrap;' });
            assignees.forEach(name => {
                agentRow.appendChild(h('span', {
                    style: 'font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(0,212,255,0.12);color:var(--electric);border:1px solid rgba(0,212,255,0.2);'
                }, name));
            });
            titleWrap.appendChild(agentRow);
        }

        header.appendChild(titleWrap);

        // Priority badge (text)
        if (task.priority && task.priority !== 'normal') {
            header.appendChild(h('span', {
                class: `task-priority priority-${task.priority}`
            }, task.priority.toUpperCase()));
        }

        // Skip button
        const skipIcon = isSkipped ? '↩' : '⟩⟩';
        const skipTitle = isSkipped ? 'Restore task' : 'Skip task';
        header.appendChild(h('button', {
            class: 'task-skip-btn',
            'data-action': 'skip',
            'data-task-id': task.id,
            title: skipTitle
        }, skipIcon));

        // Delete button
        header.appendChild(h('button', {
            class: 'task-delete',
            'data-action': 'delete',
            'data-task-id': task.id,
            title: 'Delete'
        }, '✕'));

        item.appendChild(header);

        // Description (visible by default, not hidden behind .expanded)
        if (task.description) {
            item.appendChild(h('div', {
                class: 'task-description',
                style: 'display:block;'
            }, task.description));
        }

        // Dependency info
        if (task.dependsOn?.length) {
            const depNames = task.dependsOn.map(id => {
                const dep = this._tasks.find(t => t.id === id || String(t.id) === String(id));
                return dep ? dep.title : id;
            });
            item.appendChild(h('div', {
                style: 'font-size:9px;color:var(--text-muted);padding:2px 12px 4px 42px;'
            }, `⛓ Waiting for: ${depNames.join(', ')}`));
        }

        // Meta row (visible by default)
        const hasMeta = task.assignee || task.milestone || task.created || task.id;
        if (hasMeta) {
            const meta = h('div', {
                class: 'task-meta',
                style: 'display:flex;justify-content:space-between;'
            });
            if (task.created) {
                const d = new Date(task.created);
                const formatted = isNaN(d) ? task.created : d.toLocaleDateString();
                meta.appendChild(h('span', { class: 'task-created' }, `Created: ${formatted}`));
            }
            if (task.milestone) meta.appendChild(h('span', null, `🏁 ${task.milestone}`));
            if (task.id) meta.appendChild(h('span', { class: 'task-id', style: 'font-size:9px;color:var(--text-secondary);font-family:monospace;' }, `#${task.id}`));
            item.appendChild(meta);
        }

        return item;
    }

    // ── Tree View ────────────────────────────────────────────────

    _renderTreeView() {
        if (!this._tasks.length) {
            OverlordUI.setContent(this._listEl, h('div', {
                style: 'padding:16px;text-align:center;color:var(--text-muted);font-size:12px;'
            }, 'No tasks yet'));
            return;
        }

        // Build tree structure from flat list
        const tree = this._buildTree(this._tasks);
        const frag = document.createDocumentFragment();
        this._renderTreeNodes(tree, frag, 0);

        this._listEl.textContent = '';
        this._listEl.appendChild(frag);
    }

    _buildTree(tasks) {
        const map = new Map();
        const roots = [];
        tasks.forEach(t => map.set(t.id, { ...t, children: [] }));
        tasks.forEach(t => {
            const node = map.get(t.id);
            if (t.parentId && map.has(t.parentId)) {
                map.get(t.parentId).children.push(node);
            } else {
                roots.push(node);
            }
        });
        return roots;
    }

    _renderTreeNodes(nodes, container, depth) {
        for (const node of nodes) {
            const branch = h('div', {
                class: 'task-tree-branch',
                style: { '--tree-indent': depth }
            });

            const item = this._buildTaskItem(node);
            item.classList.add(`task-indent-${Math.min(depth, 10)}`);

            if (node.children.length > 0) {
                const isCollapsed = this._treeCollapsed.has(node.id);
                const toggle = h('button', {
                    class: 'task-tree-toggle',
                    'data-task-id': node.id,
                    style: { transform: isCollapsed ? '' : 'rotate(90deg)' }
                }, '▸');
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._toggleTreeCollapse(node.id);
                });
                item.querySelector('.task-header')?.prepend(toggle);

                branch.appendChild(item);

                if (!isCollapsed) {
                    const childContainer = h('div', { class: 'task-tree-children' });
                    this._renderTreeNodes(node.children, childContainer, depth + 1);
                    branch.appendChild(childContainer);
                }
            } else {
                branch.appendChild(item);
            }

            container.appendChild(branch);
        }
    }

    _toggleTreeCollapse(taskId) {
        if (this._treeCollapsed.has(taskId)) {
            this._treeCollapsed.delete(taskId);
        } else {
            this._treeCollapsed.add(taskId);
        }
        if (OverlordUI._store) {
            OverlordUI._store.set('tasks.treeCollapsed', [...this._treeCollapsed]);
        }
        this.render(this._tasks);
    }

    // ── Kanban View (inline mini-board) ──────────────────────────

    _renderKanbanView() {
        // Delegate to the full kanban overlay if open, otherwise show inline
        OverlordUI.dispatch('open_kanban');
    }

    // ── Task Operations ──────────────────────────────────────────

    _toggleTaskComplete(taskId) {
        const task = this._tasks.find(t => String(t.id) === String(taskId));
        if (!task) return;
        task.completed = !task.completed;
        task.status = task.completed ? 'done' : 'pending';
        // Emit to server
        OverlordUI.dispatch('task_action', { action: 'toggle', task });
    }

    _skipTask(taskId) {
        const task = this._tasks.find(t => String(t.id) === String(taskId));
        if (!task) return;
        const newStatus = task.status === 'skipped' ? 'pending' : 'skipped';
        task.status = newStatus;
        OverlordUI.dispatch('task_action', { action: 'skip', taskId, status: newStatus });
        this.render(this._tasks);
    }

    _deleteTask(taskId) {
        OverlordUI.dispatch('task_action', { action: 'delete', taskId });
    }

    _openTaskDetail(taskId) {
        OverlordUI.dispatch('open_task_detail', { taskId });
    }
}
