/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Kanban View
   ═══════════════════════════════════════════════════════════════════
   Full-screen overlay that renders tasks as a kanban board with
   draggable cards across status columns. Replaces the monolith's
   openKanban / renderKanban / kanbanDragStart-End-Over-Drop chain
   (~lines 12279-12430) with a Component-based implementation.

   Columns match the existing monolith KANBAN_COLS + alias handling
   for 'running' → 'in_progress' and 'done' → 'completed'.

   Features:
     - Horizontal scrolling column layout
     - Task cards with priority dots, assignee badges, dependency tags
     - Drag-and-drop between columns (emits update_task via socket)
     - Live re-render on tasks_update engine event
     - Task click dispatches open_task_detail
     - Escape key / close button to dismiss

   Dependencies: engine.js (Component, OverlordUI, h),
                 components/card.js (Card — kanban variant)
   ═══════════════════════════════════════════════════════════════════ */

import { Component, OverlordUI, h } from '../engine.js';
import { Card } from '../components/card.js';

// ── Column Definitions ───────────────────────────────────────────
const COLUMNS = [
    { status: 'pending',      label: 'To Do',        icon: '\u{1F4CB}' },
    { status: 'in_progress',  label: 'In Progress',  icon: '\u26A1'    },
    { status: 'plan_pending', label: 'Plan Pending',  icon: '\u{1F50D}' },
    { status: 'blocked',      label: 'Blocked',       icon: '\u{1F6AB}' },
    { status: 'completed',    label: 'Done',           icon: '\u2705'    },
    { status: 'skipped',      label: 'Skipped',        icon: '\u23ED'    },
];

// Aliases — normalise server-side status variants
const STATUS_ALIASES = { running: 'in_progress', done: 'completed' };


export class KanbanView extends Component {

    constructor(el, opts = {}) {
        super(el, opts);
        this._socket  = opts.socket || null;
        this._tasks   = [];
        this._visible = false;

        // Drag state
        this._dragTaskId    = null;
        this._dragCardHeight = 52;
    }

    // ══════════════════════════════════════════════════════════════
    //  LIFECYCLE
    // ══════════════════════════════════════════════════════════════

    mount() {
        this._mounted = true;

        // Ensure the overlay element has the correct base class
        if (!this.el.classList.contains('kanban-overlay')) {
            this.el.classList.add('kanban-overlay');
        }

        // Subscribe to live task updates via the engine event bus
        this._subs.push(
            OverlordUI.subscribe('tasks_update', (tasks) => {
                this._tasks = tasks || [];
                if (this._visible) this.render();
            })
        );

        // Also listen for the open_kanban dispatch from the tasks panel
        this._subs.push(
            OverlordUI.subscribe('open_kanban', () => this.open())
        );

        // Escape key to close
        this._escHandler = (e) => {
            if (e.key === 'Escape' && this._visible) {
                e.preventDefault();
                this.close();
            }
        };
        document.addEventListener('keydown', this._escHandler);

        // Seed from cached state if available
        const cached = OverlordUI.getState('tasks_update');
        if (cached) this._tasks = cached;
    }

    destroy() {
        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler);
            this._escHandler = null;
        }
        super.destroy();
    }

    // ══════════════════════════════════════════════════════════════
    //  OPEN / CLOSE
    // ══════════════════════════════════════════════════════════════

    open() {
        this._visible = true;
        this.el.classList.add('open');
        document.body.style.overflow = 'hidden';
        this.render();
    }

    close() {
        this._visible = false;
        this.el.classList.remove('open');
        document.body.style.overflow = '';
    }

    // ══════════════════════════════════════════════════════════════
    //  RENDER
    // ══════════════════════════════════════════════════════════════

    render() {
        if (!this._visible) return;

        const header = h('div', { class: 'kanban-header' },
            h('h2', null, 'KANBAN BOARD'),
            h('button', {
                class: 'kanban-close',
                'aria-label': 'Close kanban board',
                onClick: () => this.close()
            }, '\u2715')
        );

        const board = h('div', { class: 'kanban-board' });

        for (const col of COLUMNS) {
            const colTasks = this._tasks.filter(
                t => this._getTaskStatus(t) === col.status
            );
            board.appendChild(this._buildColumn(col.status, col.icon + ' ' + col.label, colTasks));
        }

        OverlordUI.setContent(this.el, h('div', { class: 'kanban-inner' }, header, board));
    }

    // ══════════════════════════════════════════════════════════════
    //  COLUMN BUILDER
    // ══════════════════════════════════════════════════════════════

    _buildColumn(status, label, tasks) {
        const count = h('span', { class: 'kanban-count' }, String(tasks.length));

        const colHeader = h('div', { class: 'kanban-col-header' },
            h('span', null, label),
            count
        );

        const dropZone = h('div', {
            class: 'kanban-drop-zone',
            dataset: { col: status }
        });

        // Drag-over / leave / drop handlers on the zone
        dropZone.addEventListener('dragover', (e) => this._onDragOver(e, dropZone));
        dropZone.addEventListener('dragleave', (e) => this._onDragLeave(e, dropZone));
        dropZone.addEventListener('drop', (e) => this._onDrop(e, status, dropZone));

        // Append task cards
        for (const task of tasks) {
            dropZone.appendChild(this._buildTaskCard(task));
        }

        return h('div', { class: 'kanban-col', dataset: { status } }, colHeader, dropZone);
    }

    // ══════════════════════════════════════════════════════════════
    //  TASK CARD BUILDER
    // ══════════════════════════════════════════════════════════════

    _buildTaskCard(task) {
        const isSkipped = this._getTaskStatus(task) === 'skipped';

        const card = h('div', {
            class: ('kanban-card' + (isSkipped ? ' status-skipped' : '')),
            draggable: 'true',
            dataset: { taskId: String(task.id) },
            onClick: () => {
                OverlordUI.dispatch('open_task_detail', { taskId: task.id });
            }
        });

        // Title
        card.appendChild(h('div', { class: 'kanban-card-title' }, task.title || 'Untitled'));

        // Meta row: priority + assignee badges
        const meta = h('div', { class: 'kanban-card-meta' });

        if (task.priority && task.priority !== 'normal') {
            meta.appendChild(h('span', {
                class: 'kanban-badge ' + task.priority
            }, task.priority));
        }

        const assignees = Array.isArray(task.assignee) ? task.assignee : (task.assignee ? [task.assignee] : []);
        if (assignees.length) {
            meta.appendChild(h('span', {
                class: 'kanban-badge assignee'
            }, assignees.slice(0, 2).join(', ')));
        }

        // Dependency indicator
        if (task.dependencies && task.dependencies.length) {
            meta.appendChild(h('span', {
                class: 'kanban-badge',
                title: 'Depends on: ' + task.dependencies.join(', ')
            }, '\u{1F517} ' + task.dependencies.length));
        }

        if (meta.childNodes.length) card.appendChild(meta);

        // Drag handlers on the card itself
        card.addEventListener('dragstart', (e) => this._onDragStart(e, card, task));
        card.addEventListener('dragend',   (e) => this._onDragEnd(e, card));

        return card;
    }

    // ══════════════════════════════════════════════════════════════
    //  STATUS NORMALISATION
    // ══════════════════════════════════════════════════════════════

    _getTaskStatus(task) {
        const raw = task.status || 'pending';
        return STATUS_ALIASES[raw] || raw;
    }

    // ══════════════════════════════════════════════════════════════
    //  DRAG & DROP
    // ══════════════════════════════════════════════════════════════

    _onDragStart(e, cardEl, task) {
        this._dragTaskId = String(task.id);
        this._dragCardHeight = cardEl.offsetHeight || 52;
        cardEl.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';

        // Styled ghost image
        const ghost = cardEl.cloneNode(true);
        ghost.classList.remove('dragging');
        ghost.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:'
            + cardEl.offsetWidth + 'px;opacity:0.9;pointer-events:none;z-index:9999;';
        document.body.appendChild(ghost);
        const rect = cardEl.getBoundingClientRect();
        e.dataTransfer.setDragImage(ghost, e.clientX - rect.left, e.clientY - rect.top);
        requestAnimationFrame(() => ghost.remove());
    }

    _onDragEnd(e, cardEl) {
        cardEl.classList.remove('dragging');
        this.el.querySelectorAll('.kanban-placeholder').forEach(p => p.remove());
    }

    _onDragOver(e, zone) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        zone.classList.add('drag-over');

        // Remove stale placeholder
        zone.querySelectorAll('.kanban-placeholder').forEach(p => p.remove());

        // Insert placeholder at correct vertical position
        const placeholder = h('div', {
            class: 'kanban-placeholder',
            style: { height: this._dragCardHeight + 'px' }
        });
        const before = this._getDropInsertPoint(zone, e.clientY);
        if (before) zone.insertBefore(placeholder, before);
        else zone.appendChild(placeholder);
    }

    _onDragLeave(e, zone) {
        if (!zone.contains(e.relatedTarget)) {
            zone.classList.remove('drag-over');
            zone.querySelectorAll('.kanban-placeholder').forEach(p => p.remove());
        }
    }

    _onDrop(e, newStatus, zone) {
        e.preventDefault();
        zone.classList.remove('drag-over');
        zone.querySelectorAll('.kanban-placeholder').forEach(p => p.remove());
        if (!this._dragTaskId) return;
        this._handleDrop(this._dragTaskId, newStatus);
        this._dragTaskId = null;
    }

    _getDropInsertPoint(zone, clientY) {
        const cards = Array.from(zone.querySelectorAll('.kanban-card:not(.dragging)'));
        for (const card of cards) {
            const rect = card.getBoundingClientRect();
            if (clientY < rect.top + rect.height / 2) return card;
        }
        return null;
    }

    // ══════════════════════════════════════════════════════════════
    //  DROP HANDLER — emit update to server
    // ══════════════════════════════════════════════════════════════

    _handleDrop(taskId, newStatus) {
        const task = this._tasks.find(t => String(t.id) === taskId);
        if (!task) return;
        if (this._getTaskStatus(task) === newStatus) return;

        // Optimistic local update
        task.status    = newStatus;
        task.completed = (newStatus === 'completed');

        // Emit to server
        if (this._socket) {
            this._socket.emit('task_updated', {
                id:        taskId,
                status:    newStatus,
                completed: task.completed
            });
        }

        // Dispatch for other panels (task list, etc.)
        OverlordUI.dispatch('task_action', {
            action: 'status_change',
            task
        });

        // Re-render with landing animation
        this.render();
        requestAnimationFrame(() => {
            const dropped = this.el.querySelector('[data-task-id="' + taskId + '"]');
            if (dropped) {
                dropped.classList.add('kanban-card-landing');
                dropped.addEventListener('animationend', () => {
                    dropped.classList.remove('kanban-card-landing');
                }, { once: true });
            }
        });
    }
}
