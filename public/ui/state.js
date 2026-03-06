/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Reactive State Store
   ═══════════════════════════════════════════════════════════════════
   Centralized state management replacing scattered globals:
     - window._teamAgents          → store.get('team.agents')
     - window._roadmapItems        → store.get('roadmap.items')
     - window._taskTree            → store.get('tasks.tree')
     - window._pendingRecommendations → store.get('orchestration.recommendations')
     - window._bcMsgs              → store.get('backchannel.messages')
     - tasks (local var)           → store.get('tasks.list')
     - agentSessionStates (Map)    → store.get('agents.sessions')
     - allConversations            → store.get('conversations.list')
     - isProcessing                → store.get('ui.processing')
     - etc.

   Features:
     - get/set with dot-notation keys (e.g., 'team.agents')
     - Reactive subscriptions (listeners fire on change)
     - localStorage persistence for designated keys
     - Batch updates (single notification for multiple changes)
     - Deep clone on get (immutability protection)
     - BroadcastChannel sync (for pop-out windows)

   Dependencies: none (standalone module)
   ═══════════════════════════════════════════════════════════════════ */

export class Store {

    constructor() {
        /** @private Internal data store */
        this._data = {};

        /** @private Key → Set<Function> — change listeners */
        this._listeners = new Map();

        /** @private Key → localStorage key — persistence mapping */
        this._persistMap = new Map();

        /** @private Batching control */
        this._batching = false;
        this._batchedKeys = new Set();

        /** @private BroadcastChannel reference (set by engine) */
        this._channel = null;
    }

    // ══════════════════════════════════════════════════════════════
    //  CORE API
    // ══════════════════════════════════════════════════════════════

    /**
     * Get a value by dot-notation key.
     * Returns a deep clone for objects/arrays to prevent mutation.
     *
     * @param {string} key  — dot-notation path (e.g., 'team.agents')
     * @param {*}      [fallback] — default value if key is undefined
     * @returns {*}
     */
    get(key, fallback) {
        const val = this._resolve(key);
        if (val === undefined) return fallback;
        // Return primitives directly, clone objects for immutability
        if (val === null || typeof val !== 'object') return val;
        try { return structuredClone(val); }
        catch { return JSON.parse(JSON.stringify(val)); }
    }

    /**
     * Get a value by dot-notation key WITHOUT cloning.
     * Use only when you need performance and won't mutate the result.
     *
     * @param {string} key
     * @param {*}      [fallback]
     * @returns {*}
     */
    peek(key, fallback) {
        const val = this._resolve(key);
        return val === undefined ? fallback : val;
    }

    /**
     * Set a value by dot-notation key.
     * Notifies subscribers and persists if the key is registered for persistence.
     *
     * @param {string} key     — dot-notation path
     * @param {*}      value   — new value
     * @param {object} [opts]  — { silent: false, broadcast: true }
     */
    set(key, value, opts = {}) {
        const { silent = false, broadcast = true } = opts;

        this._assign(key, value);

        // Persist to localStorage if registered
        if (this._persistMap.has(key)) {
            this._persistToStorage(key, value);
        }

        // Broadcast to pop-out windows
        if (broadcast && this._channel) {
            try {
                this._channel.postMessage({ type: 'state_sync', key, value });
            } catch { /* structuredClone may fail for some values */ }
        }

        // Notify subscribers
        if (!silent) {
            if (this._batching) {
                this._batchedKeys.add(key);
            } else {
                this._notify(key, value);
            }
        }
    }

    /**
     * Update a value by applying a function to the current value.
     *
     * @param {string}   key — dot-notation path
     * @param {Function} fn  — receives current value, returns new value
     * @param {object}   [opts]
     */
    update(key, fn, opts) {
        const current = this.get(key);
        const next = fn(current);
        this.set(key, next, opts);
    }

    /**
     * Delete a key from the store.
     * @param {string} key
     */
    delete(key) {
        const parts = key.split('.');
        const last = parts.pop();
        let obj = this._data;
        for (const part of parts) {
            if (obj == null || typeof obj !== 'object') return;
            obj = obj[part];
        }
        if (obj && typeof obj === 'object') {
            delete obj[last];
            this._notify(key, undefined);
        }
    }

    /**
     * Check if a key exists and is not undefined.
     * @param {string} key
     * @returns {boolean}
     */
    has(key) {
        return this._resolve(key) !== undefined;
    }

    // ══════════════════════════════════════════════════════════════
    //  SUBSCRIPTIONS
    // ══════════════════════════════════════════════════════════════

    /**
     * Subscribe to changes on a key.
     * The listener fires whenever set() is called on that key (or a parent/child).
     *
     * @param {string}   key — dot-notation path (or '*' for all changes)
     * @param {Function} fn  — callback(newValue, key)
     * @returns {Function} unsubscribe function
     */
    subscribe(key, fn) {
        if (!this._listeners.has(key)) {
            this._listeners.set(key, new Set());
        }
        this._listeners.get(key).add(fn);

        return () => {
            const set = this._listeners.get(key);
            if (set) {
                set.delete(fn);
                if (set.size === 0) this._listeners.delete(key);
            }
        };
    }

    // ══════════════════════════════════════════════════════════════
    //  PERSISTENCE
    // ══════════════════════════════════════════════════════════════

    /**
     * Register a key for localStorage persistence.
     * On registration, loads the saved value from localStorage if available.
     *
     * @param {string} key        — store key (e.g., 'ui.theme')
     * @param {string} storageKey — localStorage key (e.g., 'theme')
     * @param {*}      [fallback] — default value if nothing saved
     */
    persist(key, storageKey, fallback) {
        this._persistMap.set(key, storageKey);

        // Hydrate from localStorage
        try {
            const saved = localStorage.getItem(storageKey);
            if (saved !== null) {
                let parsed;
                try { parsed = JSON.parse(saved); }
                catch { parsed = saved; } // plain string values
                this._assign(key, parsed);
                return;
            }
        } catch { /* localStorage may be unavailable */ }

        // Use fallback if nothing saved
        if (fallback !== undefined && this._resolve(key) === undefined) {
            this._assign(key, fallback);
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  BATCH UPDATES
    // ══════════════════════════════════════════════════════════════

    /**
     * Batch multiple set() calls into a single notification pass.
     * Prevents redundant re-renders when updating many keys at once.
     *
     * @param {Function} fn — function that calls set() multiple times
     *
     * Usage:
     *   store.batch(() => {
     *       store.set('team.agents', agents);
     *       store.set('tasks.list', tasks);
     *       store.set('roadmap.items', items);
     *   });
     *   // Subscribers notified only once, after all three updates.
     */
    batch(fn) {
        this._batching = true;
        this._batchedKeys.clear();
        try {
            fn();
        } finally {
            this._batching = false;
            // Notify all changed keys
            for (const key of this._batchedKeys) {
                this._notify(key, this._resolve(key));
            }
            this._batchedKeys.clear();
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  SNAPSHOT / RESTORE
    // ══════════════════════════════════════════════════════════════

    /**
     * Get a snapshot of the entire store (deep clone).
     * @returns {object}
     */
    snapshot() {
        try { return structuredClone(this._data); }
        catch { return JSON.parse(JSON.stringify(this._data)); }
    }

    /**
     * Restore the store from a snapshot. Notifies all listeners.
     * @param {object} data
     */
    restore(data) {
        this._data = typeof data === 'object' && data !== null ? data : {};
        // Notify all subscribers
        this._listeners.forEach((listeners, key) => {
            const val = this._resolve(key);
            listeners.forEach(fn => {
                try { fn(val, key); } catch (e) { console.warn('[Store] listener error:', e); }
            });
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  INTERNAL HELPERS
    // ══════════════════════════════════════════════════════════════

    /**
     * Resolve a dot-notation key to its value.
     * @private
     * @param {string} key
     * @returns {*}
     */
    _resolve(key) {
        const parts = key.split('.');
        let obj = this._data;
        for (const part of parts) {
            if (obj == null || typeof obj !== 'object') return undefined;
            obj = obj[part];
        }
        return obj;
    }

    /**
     * Assign a value at a dot-notation key, creating intermediate objects as needed.
     * @private
     * @param {string} key
     * @param {*}      value
     */
    _assign(key, value) {
        const parts = key.split('.');
        const last = parts.pop();
        let obj = this._data;
        for (const part of parts) {
            if (obj[part] == null || typeof obj[part] !== 'object') {
                obj[part] = {};
            }
            obj = obj[part];
        }
        obj[last] = value;
    }

    /**
     * Notify listeners for a key.
     * Also notifies wildcard ('*') listeners and parent key listeners.
     * @private
     * @param {string} key
     * @param {*}      value
     */
    _notify(key, value) {
        // Exact match listeners
        const exact = this._listeners.get(key);
        if (exact) {
            exact.forEach(fn => {
                try { fn(value, key); } catch (e) { console.warn('[Store] listener error:', e); }
            });
        }

        // Wildcard listeners
        const wildcard = this._listeners.get('*');
        if (wildcard) {
            wildcard.forEach(fn => {
                try { fn(value, key); } catch (e) { console.warn('[Store] listener error:', e); }
            });
        }

        // Notify parent key listeners (e.g., 'tasks' listener fires when 'tasks.list' changes)
        const parts = key.split('.');
        if (parts.length > 1) {
            for (let i = 1; i < parts.length; i++) {
                const parentKey = parts.slice(0, i).join('.');
                const parentListeners = this._listeners.get(parentKey);
                if (parentListeners) {
                    const parentVal = this._resolve(parentKey);
                    parentListeners.forEach(fn => {
                        try { fn(parentVal, key); } catch (e) { console.warn('[Store] listener error:', e); }
                    });
                }
            }
        }
    }

    /**
     * Persist a value to localStorage.
     * @private
     * @param {string} key
     * @param {*}      value
     */
    _persistToStorage(key, value) {
        const storageKey = this._persistMap.get(key);
        if (!storageKey) return;
        try {
            const serialized = typeof value === 'string' ? value : JSON.stringify(value);
            localStorage.setItem(storageKey, serialized);
        } catch (e) {
            console.warn(`[Store] Failed to persist "${key}" to localStorage:`, e);
        }
    }
}


// ══════════════════════════════════════════════════════════════════
//  DEFAULT STORE FACTORY
// ══════════════════════════════════════════════════════════════════
// Creates a pre-configured store with all the persistence keys
// from the existing monolith mapped correctly.

/**
 * Create and configure the default Overlord store.
 * Maps all existing localStorage keys used by the monolith.
 *
 * @returns {Store}
 */
export function createStore() {
    const store = new Store();

    // ── Persisted keys (matches existing localStorage usage) ──
    // Key:         store path             → localStorage key            → default
    store.persist('tasks.view',            'overlord_task_view',          'list');
    store.persist('tasks.treeCollapsed',   'overlord_tree_collapsed',     []);
    store.persist('panels.visibility',     'overlord_panel_visibility',   {});
    store.persist('panels.states',         'overlord_panel_states',       {});
    store.persist('panels.heights',        'overlord_panel_heights',      {});
    store.persist('panels.width',          'overlord_panel_width',        320);
    store.persist('chat.mode',             'overlord_chat_mode',          'auto');
    store.persist('settings.aiSetKeys',    'overlord_ai_set_keys',        []);
    store.persist('settings.longRunning',  'overlord_long_running',       'off');
    store.persist('settings.notifications','overlord_notifications',      'on');
    store.persist('ui.theme',              'theme',                       'dark');

    // ── Non-persisted initial state ──
    store.set('team.agents',                 [],    { silent: true });
    store.set('tasks.list',                  [],    { silent: true });
    store.set('roadmap.items',               [],    { silent: true });
    store.set('tasks.tree',                  null,  { silent: true });
    store.set('orchestration.recommendations', [],  { silent: true });
    store.set('backchannel.messages',        [],    { silent: true });
    store.set('conversations.list',          [],    { silent: true });
    store.set('conversations.current',       null,  { silent: true });
    store.set('agents.sessions',             {},    { silent: true });
    store.set('agents.messages',             {},    { silent: true });
    store.set('ui.processing',               false, { silent: true });
    store.set('ui.connected',                false, { silent: true });
    store.set('ui.popouts',                  {},    { silent: true });
    store.set('activity.items',              [],    { silent: true });
    store.set('queue.messages',              [],    { silent: true });
    store.set('queue.drainMode',             'consolidated', { silent: true });

    return store;
}
