// ==================== TASKS ENGINE ====================
// Dedicated module owning all task/milestone socket event handling.
// Registers as hub service 'tasks' with a clean public API.
// Storage is delegated to conversation-module (tasks live in conversation.json).
// Other modules use hub.getService('tasks') instead of reaching into conversation.
// Supports hierarchical task trees up to 10 levels deep.

let hub;

async function init(h) {
    hub = h;

    // ── Bridge socket events → tasks engine handlers ─────────────────────
    // hub.js routes socket events here via 'socket:task_*' hub events.
    hub.on('socket:task_added',               ({ socket, data })      => handleTaskAdded(socket, data));
    hub.on('socket:task_toggled',             ({ socket, data })      => handleTaskToggled(socket, data));
    hub.on('socket:task_deleted',             ({ socket, data })      => handleTaskDeleted(socket, data));
    hub.on('socket:task_updated',             ({ socket, data })      => handleTaskUpdated(socket, data));
    hub.on('socket:tasks_reorder',            ({ socket, data })      => handleTasksReorder(socket, data));
    hub.on('socket:focus_task',               ({ socket, data, cb })  => handleFocusTask(socket, data, cb));
    hub.on('socket:assign_task_to_milestone', ({ socket, data, cb })  => handleAssignToMilestone(socket, data, cb));

    // ── Hierarchy socket events ──────────────────────────────────────────
    hub.on('socket:add_child_task',     ({ socket, data, cb }) => handleAddChildTask(socket, data, cb));
    hub.on('socket:reparent_task',      ({ socket, data, cb }) => handleReparentTask(socket, data, cb));
    hub.on('socket:get_task_tree',      ({ socket, data, cb }) => handleGetTaskTree(socket, data, cb));
    hub.on('socket:get_task_children',  ({ socket, data, cb }) => handleGetTaskChildren(socket, data, cb));
    hub.on('socket:get_task_breadcrumb',({ socket, data, cb }) => handleGetTaskBreadcrumb(socket, data, cb));

    // ── Register public service API ───────────────────────────────────────
    hub.registerService('tasks', {
        // Task CRUD
        getTasks:     ()             => getConv()?.getTasks?.() || [],
        addTask:      (task)         => { getConv()?.addTask?.(task);                 _broadcastTasks(); },
        updateTask:   (id, updates)  => { getConv()?.updateTask?.(id, updates);       _broadcastTasks(); },
        deleteTask:   (id, cascade)  => { getConv()?.deleteTask?.(id, cascade);       _broadcastTasks(); },
        toggleTask:   (id)           => { getConv()?.toggleTask?.(id);                _broadcastTasks(); },
        reorderTasks: (ids)          => { getConv()?.reorderTasks?.(ids);             _broadcastTasks(); },

        // Milestone operations (storage still in conversation-module)
        addMilestone:    (ms)            => getConv()?.addMilestone?.(ms),
        updateMilestone: (id, updates)   => getConv()?.updateMilestone?.(id, updates),
        deleteMilestone: (id)            => getConv()?.deleteMilestone?.(id),
        launchMilestone: (id)            => getConv()?.launchMilestone?.(id),
        getMilestones:   ()              => (getConv()?.getRoadmap?.() || []).filter(r => r.type === 'milestone'),
        getRoadmap:      ()              => getConv()?.getRoadmap?.() || [],

        // ── Hierarchy API ─────────────────────────────────────────────────
        getChildren:      (taskId) => getConv()?.getChildren?.(taskId) || [],
        getDescendants:   (taskId) => getConv()?.getDescendants?.(taskId) || [],
        getAncestors:     (taskId) => getConv()?.getAncestors?.(taskId) || [],
        getBreadcrumb:    (taskId) => getConv()?.getBreadcrumb?.(taskId) || [],
        getTaskTree:      ()       => getConv()?.getTaskTree?.() || [],

        // Add a child task under a parent (convenience wrapper)
        addChildTask: (parentId, task) => {
            const conv = getConv();
            if (!conv) return null;
            task.parentId = parentId;
            conv.addTask(task);
            _broadcastTasks();
            return task;
        },

        // Move a task to a new parent (or to root if parentId=null)
        reparentTask: (taskId, newParentId) => {
            const conv = getConv();
            if (!conv) return { error: 'Conversation service unavailable' };
            conv.updateTask(taskId, { parentId: newParentId || null });
            _broadcastTasks();
            return { success: true };
        },

        // Utility
        broadcastSnapshot: () => _broadcastTasks(),
        broadcastTree:     () => _broadcastTree(),
    });

    hub.log('Tasks engine loaded (hierarchy-aware)', 'success');
}

// ── Internal helpers ──────────────────────────────────────────────────────

function getConv() {
    return hub.getService('conversation');
}

function _broadcastTasks() {
    const conv = getConv();
    if (!conv) return;
    const tasks = conv.getTasks?.() || [];
    hub.broadcastAll('tasks_update', tasks);
    // Also emit internal hub event so other modules (e.g. orchestration) can react
    hub.emit('tasks:changed', tasks);
}

/** Broadcast the full tree structure for tree-view / mind-map rendering */
function _broadcastTree() {
    const conv = getConv();
    if (!conv) return;
    const tree = conv.getTaskTree?.() || [];
    hub.broadcastAll('task_tree_update', tree);
}

// ── Socket event handlers ─────────────────────────────────────────────────

function handleTaskAdded(socket, task) {
    const conv = getConv();
    if (!conv) return;
    conv.addTask(task);
    _broadcastTasks();
    _broadcastTree();
}

function handleTaskToggled(socket, data) {
    const conv = getConv();
    if (!conv) return;
    conv.toggleTask(data.id);
    _broadcastTasks();
    _broadcastTree();
}

function handleTaskDeleted(socket, data) {
    const conv = getConv();
    if (!conv) return;
    // Support { id, cascade } or plain taskId string
    const taskId = typeof data === 'string' ? data : data.id;
    const cascade = typeof data === 'object' ? data.cascade : true;
    conv.deleteTask(taskId, cascade);
    _broadcastTasks();
    _broadcastTree();
}

function handleTaskUpdated(socket, task) {
    const conv = getConv();
    if (!conv) return;
    conv.updateTask(task.id, task);
    _broadcastTasks();
    _broadcastTree();
}

function handleTasksReorder(socket, orderedIds) {
    const conv = getConv();
    if (!conv) return;
    conv.reorderTasks(orderedIds);
    _broadcastTasks();
    _broadcastTree();
}

function handleFocusTask(socket, { taskId }, cb) {
    const conv = getConv();
    if (!conv) { if (typeof cb === 'function') cb({ error: 'Conversation service unavailable' }); return; }

    const task = conv.getTasks?.().find(t => t.id === taskId);
    if (!task) { if (typeof cb === 'function') cb({ error: 'Task not found: ' + taskId }); return; }

    // Mark task in_progress
    conv.updateTask(taskId, { status: 'in_progress' });

    // Launch parent milestone if not already active
    if (task.milestoneId && conv.launchMilestone) {
        const ms = (conv.getMilestones?.() || conv.getRoadmap?.()?.filter(r => r.type === 'milestone') || [])
            .find(m => m.id === task.milestoneId);
        if (ms && ms.status !== 'active' && ms.status !== 'completed') {
            conv.launchMilestone(task.milestoneId);
            hub.broadcast('agent_activity', {
                type: 'milestone_launched',
                data: { name: ms.text, branch: ms.branch }
            });
        }
    }

    _broadcastTasks();
    _broadcastTree();
    hub.log(`[focus_task] Task "${task.title}" → in_progress`, 'info');
    if (typeof cb === 'function') cb({ success: true, task });
}

function handleAssignToMilestone(socket, { taskId, milestoneId }, cb) {
    const conv = getConv();
    if (!conv) { if (typeof cb === 'function') cb({ error: 'Conversation service unavailable' }); return; }
    conv.updateTask(taskId, { milestoneId: milestoneId || null });
    _broadcastTasks();
    if (typeof cb === 'function') cb({ success: true });
}

// ── Hierarchy socket handlers ────────────────────────────────────────────

/**
 * Add a subtask under a parent.
 * data: { parentId: string, task: { title, description, priority, ... } }
 */
function handleAddChildTask(socket, { parentId, task }, cb) {
    const conv = getConv();
    if (!conv) { if (typeof cb === 'function') cb({ error: 'Conversation service unavailable' }); return; }

    if (!parentId) {
        if (typeof cb === 'function') cb({ error: 'parentId is required' });
        return;
    }

    // Verify parent exists
    const parent = conv.getTasks?.().find(t => t.id === parentId);
    if (!parent) {
        if (typeof cb === 'function') cb({ error: 'Parent task not found: ' + parentId });
        return;
    }

    // Set parentId on the task and add it
    task.parentId = parentId;
    conv.addTask(task);

    _broadcastTasks();
    _broadcastTree();
    hub.log(`[add_child_task] Added subtask "${task.title}" under "${parent.title}"`, 'info');
    if (typeof cb === 'function') cb({ success: true, task });
}

/**
 * Move a task to a new parent (or to root).
 * data: { taskId: string, newParentId: string|null }
 */
function handleReparentTask(socket, { taskId, newParentId }, cb) {
    const conv = getConv();
    if (!conv) { if (typeof cb === 'function') cb({ error: 'Conversation service unavailable' }); return; }

    const task = conv.getTasks?.().find(t => t.id === taskId);
    if (!task) {
        if (typeof cb === 'function') cb({ error: 'Task not found: ' + taskId });
        return;
    }

    // updateTask in conversation-module handles cycle detection & depth validation
    conv.updateTask(taskId, { parentId: newParentId || null });

    _broadcastTasks();
    _broadcastTree();
    const dest = newParentId
        ? (conv.getTasks?.().find(t => t.id === newParentId)?.title || newParentId)
        : 'root';
    hub.log(`[reparent_task] Moved "${task.title}" → ${dest}`, 'info');
    if (typeof cb === 'function') cb({ success: true });
}

/**
 * Get the full task tree structure.
 * data: {} (no params needed)
 */
function handleGetTaskTree(socket, data, cb) {
    const conv = getConv();
    if (!conv) { if (typeof cb === 'function') cb({ error: 'Conversation service unavailable' }); return; }
    const tree = conv.getTaskTree?.() || [];
    if (typeof cb === 'function') cb({ success: true, tree });
}

/**
 * Get direct children of a task.
 * data: { taskId: string }
 */
function handleGetTaskChildren(socket, { taskId }, cb) {
    const conv = getConv();
    if (!conv) { if (typeof cb === 'function') cb({ error: 'Conversation service unavailable' }); return; }
    const children = conv.getChildren?.(taskId) || [];
    if (typeof cb === 'function') cb({ success: true, children });
}

/**
 * Get breadcrumb path for a task.
 * data: { taskId: string }
 */
function handleGetTaskBreadcrumb(socket, { taskId }, cb) {
    const conv = getConv();
    if (!conv) { if (typeof cb === 'function') cb({ error: 'Conversation service unavailable' }); return; }
    const breadcrumb = conv.getBreadcrumb?.(taskId) || [];
    if (typeof cb === 'function') cb({ success: true, breadcrumb });
}

module.exports = { init };
