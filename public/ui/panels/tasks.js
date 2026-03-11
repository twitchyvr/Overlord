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
        // NOTE: 'kanban' is a full-screen overlay — never restore it automatically on startup
        // because that would pop open the Kanban board as soon as tasks load. Always start in list/tree.
        if (OverlordUI._store) {
            const savedView = OverlordUI._store.peek('tasks.view', 'list');
            this._view = savedView === 'kanban' ? 'list' : savedView;
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

        // Todo checkbox toggle
        this.on('click', '.todo-checkbox', (e, el) => {
            const taskId = el.dataset.taskId;
            const todoId = el.dataset.todoId;
            if (taskId && todoId) this._toggleTodo(taskId, todoId);
        });

        // Todo delete
        this.on('click', '.todo-delete', (e, el) => {
            const taskId = el.dataset.taskId;
            const todoId = el.dataset.todoId;
            if (taskId && todoId) this._removeTodo(taskId, todoId);
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

        // ── Click task title → drill into detail ────────────────────
        this.on('click', '.task-title', (e, el) => {
            const item = el.closest('.task-item');
            if (item?.dataset?.taskId) this._openTaskDetail(item.dataset.taskId);
        });

        // ── Drag-to-reorder ─────────────────────────────────────────
        this._dragSrcId = null;
        this._setupDragReorder();
    }

    _setupDragReorder() {
        const getSocket = () => this.opts?.socket;

        this.on('dragstart', '.task-item', (e, el) => {
            this._dragSrcId = el.dataset.taskId;
            el.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', el.dataset.taskId);
        });

        this.on('dragend', '.task-item', (e, el) => {
            el.classList.remove('dragging');
            this._dragSrcId = null;
            // Remove all drop indicators
            if (this._listEl) {
                this._listEl.querySelectorAll('.task-drop-indicator').forEach(d => d.remove());
                this._listEl.querySelectorAll('.drag-over').forEach(d => d.classList.remove('drag-over'));
            }
        });

        this.on('dragover', '.task-item', (e, el) => {
            if (!this._dragSrcId || el.dataset.taskId === this._dragSrcId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            // Remove previous indicators
            if (this._listEl) {
                this._listEl.querySelectorAll('.drag-over').forEach(d => d.classList.remove('drag-over'));
            }
            el.classList.add('drag-over');
        });

        this.on('dragleave', '.task-item', (e, el) => {
            el.classList.remove('drag-over');
        });

        this.on('drop', '.task-item', (e, el) => {
            e.preventDefault();
            el.classList.remove('drag-over');
            const srcId = this._dragSrcId;
            const targetId = el.dataset.taskId;
            if (!srcId || !targetId || srcId === targetId) return;

            // Optimistic reorder
            const srcIdx = this._tasks.findIndex(t => String(t.id) === String(srcId));
            const tgtIdx = this._tasks.findIndex(t => String(t.id) === String(targetId));
            if (srcIdx === -1 || tgtIdx === -1) return;

            const [moved] = this._tasks.splice(srcIdx, 1);
            this._tasks.splice(tgtIdx, 0, moved);
            this.render(this._tasks);

            // Emit reorder to server
            const orderedIds = this._tasks.map(t => t.id);
            const sock = getSocket();
            if (sock) sock.emit('tasks_reorder', { orderedIds });
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

        // Todos (atomic checklist items)
        if (task.todos && task.todos.length > 0) {
            const todosContainer = h('div', {
                class: 'task-todos',
                style: 'padding:4px 12px 4px 42px;'
            });
            const doneCount = task.todos.filter(td => td.done).length;
            const totalCount = task.todos.length;
            // Progress summary
            todosContainer.appendChild(h('div', {
                style: 'font-size:9px;color:var(--text-muted);margin-bottom:3px;'
            }, `Checklist: ${doneCount}/${totalCount}`));

            task.todos.forEach(td => {
                const todoRow = h('div', {
                    class: 'todo-item',
                    style: 'display:flex;align-items:center;gap:6px;padding:2px 0;font-size:11px;'
                });
                const cb = h('input', {
                    type: 'checkbox',
                    class: 'todo-checkbox',
                    'data-task-id': task.id,
                    'data-todo-id': td.id,
                    style: 'width:13px;height:13px;cursor:pointer;'
                });
                if (td.done) cb.checked = true;
                todoRow.appendChild(cb);
                todoRow.appendChild(h('span', {
                    style: td.done
                        ? 'flex:1;text-decoration:line-through;color:var(--text-muted);'
                        : 'flex:1;color:var(--text-primary);'
                }, td.text));
                todoRow.appendChild(h('button', {
                    class: 'todo-delete',
                    'data-task-id': task.id,
                    'data-todo-id': td.id,
                    style: 'background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:10px;padding:0 2px;',
                    title: 'Remove todo'
                }, '✕'));
                todosContainer.appendChild(todoRow);
            });
            item.appendChild(todosContainer);
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

    // ── Todo Operations ─────────────────────────────────────────

    _toggleTodo(taskId, todoId) {
        const socket = this.opts?.socket;
        if (socket) {
            socket.emit('toggle_todo', { taskId, todoId });
        }
    }

    _removeTodo(taskId, todoId) {
        const socket = this.opts?.socket;
        if (socket) {
            socket.emit('remove_todo', { taskId, todoId });
        }
    }
}
