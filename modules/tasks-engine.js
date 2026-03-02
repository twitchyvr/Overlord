// ==================== TASKS ENGINE ====================
// Dedicated module owning all task/milestone socket event handling.
// Registers as hub service 'tasks' with a clean public API.
// Storage is delegated to conversation-module (tasks live in conversation.json).
// Other modules use hub.getService('tasks') instead of reaching into conversation.

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

    // ── Register public service API ───────────────────────────────────────
    hub.registerService('tasks', {
        // Task CRUD
        getTasks:     ()             => getConv()?.getTasks?.() || [],
        addTask:      (task)         => { getConv()?.addTask?.(task);                 _broadcastTasks(); },
        updateTask:   (id, updates)  => { getConv()?.updateTask?.(id, updates);       _broadcastTasks(); },
        deleteTask:   (id)           => { getConv()?.deleteTask?.(id);                _broadcastTasks(); },
        toggleTask:   (id)           => { getConv()?.toggleTask?.(id);                _broadcastTasks(); },
        reorderTasks: (ids)          => { getConv()?.reorderTasks?.(ids);             _broadcastTasks(); },

        // Milestone operations (storage still in conversation-module)
        addMilestone:    (ms)            => getConv()?.addMilestone?.(ms),
        updateMilestone: (id, updates)   => getConv()?.updateMilestone?.(id, updates),
        deleteMilestone: (id)            => getConv()?.deleteMilestone?.(id),
        launchMilestone: (id)            => getConv()?.launchMilestone?.(id),
        getMilestones:   ()              => (getConv()?.getRoadmap?.() || []).filter(r => r.type === 'milestone'),
        getRoadmap:      ()              => getConv()?.getRoadmap?.() || [],

        // Utility
        broadcastSnapshot: () => _broadcastTasks(),
    });

    hub.log('Tasks engine loaded', 'success');
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

// ── Socket event handlers ─────────────────────────────────────────────────

function handleTaskAdded(socket, task) {
    const conv = getConv();
    if (!conv) return;
    conv.addTask(task);
    _broadcastTasks();
}

function handleTaskToggled(socket, data) {
    const conv = getConv();
    if (!conv) return;
    conv.toggleTask(data.id);
    _broadcastTasks();
}

function handleTaskDeleted(socket, taskId) {
    const conv = getConv();
    if (!conv) return;
    conv.deleteTask(taskId);
    _broadcastTasks();
}

function handleTaskUpdated(socket, task) {
    const conv = getConv();
    if (!conv) return;
    conv.updateTask(task.id, task);
    _broadcastTasks();
}

function handleTasksReorder(socket, orderedIds) {
    const conv = getConv();
    if (!conv) return;
    conv.reorderTasks(orderedIds);
    _broadcastTasks();
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

module.exports = { init };
