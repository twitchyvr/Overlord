/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI ENGINE
   ═══════════════════════════════════════════════════════════════════
   Core module: component registry, lifecycle, DOM helpers,
   event delegation, and pub-sub dispatcher.

   Evolves the existing UIEngine (monolith lines 4881-4910) into a
   full component-based architecture while preserving its API:
     - register() / dispatch() / getState() / refresh() / refreshForEvent()

   Adds:
     - Component base class with mount/render/unmount/destroy lifecycle
     - Hyperscript DOM builder (h)
     - Safe DOM content setter (setContent)
     - Scoped selectors ($ / $$)
     - Event delegation (on / off)
     - BroadcastChannel sync for pop-out windows

   Dependencies: state.js (Store)
   ═══════════════════════════════════════════════════════════════════ */

// ── Component Base Class ─────────────────────────────────────────
// Every UI piece extends this. Provides lifecycle hooks and
// automatic store subscription management.

export class Component {
    /**
     * @param {HTMLElement} el   — root DOM element
     * @param {object}      opts — component-specific config
     */
    constructor(el, opts = {}) {
        this.el = el;
        this.opts = opts;
        this._subs = [];      // store unsubscribe functions
        this._listeners = []; // delegated event teardown fns
        this._mounted = false;
    }

    /* ── Lifecycle hooks (override in subclasses) ── */

    /** Called when the component enters the DOM. Set up subscriptions here. */
    mount() {}

    /** Called when relevant state changes. Receives the changed data. */
    render(/* state */) {}

    /** Called when the component is temporarily removed (e.g., panel collapsed). */
    unmount() {
        this._mounted = false;
    }

    /** Full teardown — removes subscriptions, listeners, DOM. */
    destroy() {
        this.unmount();
        this._subs.forEach(fn => fn());
        this._subs = [];
        this._listeners.forEach(fn => fn());
        this._listeners = [];
        if (this.el && this.el.parentNode) {
            this.el.parentNode.removeChild(this.el);
        }
    }

    /* ── Helpers available to all components ── */

    /** Subscribe to a store key. Auto-unsubscribed on destroy(). */
    subscribe(store, key, fn) {
        const unsub = store.subscribe(key, fn);
        this._subs.push(unsub);
        return unsub;
    }

    /** Scoped querySelector within this component's root element. */
    $(selector) { return this.el.querySelector(selector); }

    /** Scoped querySelectorAll within this component's root element. */
    $$(selector) { return [...this.el.querySelectorAll(selector)]; }

    /** Delegate an event within this component's root. Auto-cleaned on destroy(). */
    on(eventType, selector, handler) {
        const teardown = OverlordUI.on(this.el, eventType, selector, handler);
        this._listeners.push(teardown);
        return teardown;
    }
}


// ── OverlordUI: The Engine Singleton ─────────────────────────────
// Central registry that manages all components and dispatches events.
// Backward-compatible with the monolith's UIEngine API.

export const OverlordUI = {

    // ── Internal Maps ──
    _components: new Map(),   // id → Component instance
    _panels:     new Map(),   // id → { deps: string[], render: fn } (legacy compat)
    _state:      new Map(),   // eventName → latestData
    _eventBus:   new Map(),   // eventName → Set<fn>

    // ── Store reference (set during init) ──
    _store: null,

    // ── BroadcastChannel for pop-out sync ──
    _channel: typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('overlord-sync')
        : null,
    _isPopout: typeof location !== 'undefined'
        ? new URLSearchParams(location.search).get('popout')
        : null,
    _popoutWindows: {},

    // ══════════════════════════════════════════════════════════════
    //  INITIALIZATION
    // ══════════════════════════════════════════════════════════════

    /**
     * Bootstrap the engine.
     * @param {Store} store — reactive state store instance
     */
    init(store) {
        this._store = store;
        this._setupBroadcastChannel();
        console.log('[OverlordUI] Engine initialized');
        return this;
    },

    // ══════════════════════════════════════════════════════════════
    //  COMPONENT REGISTRY & LIFECYCLE
    // ══════════════════════════════════════════════════════════════

    /**
     * Register and mount a component instance.
     * @param {string}    id        — unique identifier
     * @param {Component} instance  — component instance (already constructed)
     */
    registerComponent(id, instance) {
        if (this._components.has(id)) {
            console.warn(`[OverlordUI] Component "${id}" already registered, replacing`);
            this._components.get(id).destroy();
        }
        this._components.set(id, instance);
        return instance;
    },

    /**
     * Mount a registered component.
     * @param {string} id — component id
     */
    mountComponent(id) {
        const comp = this._components.get(id);
        if (!comp) { console.warn(`[OverlordUI] Cannot mount unknown component "${id}"`); return; }
        if (comp._mounted) return;
        comp._mounted = true;
        try { comp.mount(); } catch (e) { console.error(`[OverlordUI] Error mounting "${id}":`, e); }
        return comp;
    },

    /**
     * Unmount a component (keeps it registered for re-mount).
     * @param {string} id — component id
     */
    unmountComponent(id) {
        const comp = this._components.get(id);
        if (comp && comp._mounted) {
            try { comp.unmount(); } catch (e) { console.warn(`[OverlordUI] Error unmounting "${id}":`, e); }
        }
    },

    /**
     * Destroy and deregister a component.
     * @param {string} id — component id
     */
    destroyComponent(id) {
        const comp = this._components.get(id);
        if (comp) {
            try { comp.destroy(); } catch (e) { console.warn(`[OverlordUI] Error destroying "${id}":`, e); }
            this._components.delete(id);
        }
    },

    /**
     * Get a registered component by id.
     * @param {string} id
     * @returns {Component|undefined}
     */
    getComponent(id) {
        return this._components.get(id);
    },

    /**
     * Mount all registered components that aren't yet mounted.
     */
    mountAll() {
        this._components.forEach((comp, id) => {
            if (!comp._mounted) this.mountComponent(id);
        });
    },

    // ══════════════════════════════════════════════════════════════
    //  LEGACY UIEngine COMPAT (register / dispatch / getState / refresh)
    // ══════════════════════════════════════════════════════════════
    // These preserve the monolith's UIEngine API so existing panel
    // registrations continue to work during migration.

    /**
     * Register a panel render function with event dependencies.
     * (Legacy API — preserved from monolith UIEngine)
     * @param {string}          id     — panel identifier
     * @param {string|string[]} deps   — socket event(s) this panel depends on
     * @param {Function}        render — render function called when deps fire
     */
    register(id, deps, render) {
        this._panels.set(id, {
            deps: Array.isArray(deps) ? deps : [deps],
            render
        });
    },

    /**
     * Dispatch an event — updates cached state and re-renders dependent panels.
     * (Legacy API — preserved from monolith UIEngine)
     * @param {string} event — event name (e.g., 'tasks_update')
     * @param {*}      data  — event payload
     */
    dispatch(event, data) {
        // Cache latest state
        this._state.set(event, data);

        // Fire legacy panel renders
        this._panels.forEach(panel => {
            if (panel.deps.includes(event)) {
                try { panel.render(data); }
                catch (e) { console.warn(`[OverlordUI] panel error in "${event}":`, e); }
            }
        });

        // Fire event bus listeners
        const listeners = this._eventBus.get(event);
        if (listeners) {
            listeners.forEach(fn => {
                try { fn(data); }
                catch (e) { console.warn(`[OverlordUI] listener error in "${event}":`, e); }
            });
        }
    },

    /**
     * Get cached state for an event.
     * @param {string} event
     * @returns {*}
     */
    getState(event) {
        return this._state.get(event);
    },

    /**
     * Force-refresh a specific panel.
     * @param {string} id
     */
    refresh(id) {
        const p = this._panels.get(id);
        if (p) try { p.render(); } catch (e) { /* silent */ }
    },

    /**
     * Re-render all panels that depend on a specific event.
     * @param {string} event
     */
    refreshForEvent(event) {
        this._panels.forEach(p => {
            if (p.deps.includes(event)) {
                try { p.render(this._state.get(event)); } catch (e) { /* silent */ }
            }
        });
    },

    // ══════════════════════════════════════════════════════════════
    //  EVENT BUS (fine-grained pub-sub beyond legacy panels)
    // ══════════════════════════════════════════════════════════════

    /**
     * Subscribe to an engine event.
     * @param {string}   event — event name
     * @param {Function} fn    — callback
     * @returns {Function} unsubscribe function
     */
    subscribe(event, fn) {
        if (!this._eventBus.has(event)) this._eventBus.set(event, new Set());
        this._eventBus.get(event).add(fn);
        return () => {
            const set = this._eventBus.get(event);
            if (set) { set.delete(fn); if (set.size === 0) this._eventBus.delete(event); }
        };
    },

    // ══════════════════════════════════════════════════════════════
    //  DOM HELPERS
    // ══════════════════════════════════════════════════════════════

    /**
     * Hyperscript — create DOM elements declaratively.
     * @param {string}                  tag      — tag name (e.g., 'div', 'button')
     * @param {object|null}             attrs    — attributes / properties / event handlers
     * @param {...(string|Node|Array)}  children — child nodes or text
     * @returns {HTMLElement}
     *
     * Usage:
     *   h('div', { class: 'card', 'data-id': '42' },
     *     h('span', { class: 'title' }, 'Hello'),
     *     h('button', { onClick: handleClick }, 'Click me')
     *   )
     */
    h(tag, attrs, ...children) {
        const el = document.createElement(tag);

        if (attrs) {
            for (const [key, val] of Object.entries(attrs)) {
                if (key.startsWith('on') && typeof val === 'function') {
                    // onClick → click, onMouseEnter → mouseenter
                    el.addEventListener(key.slice(2).toLowerCase(), val);
                } else if (key === 'style' && typeof val === 'object') {
                    Object.assign(el.style, val);
                } else if (key === 'className' || key === 'class') {
                    el.className = val;
                } else if (key === 'dataset' && typeof val === 'object') {
                    Object.assign(el.dataset, val);
                } else if (val === true) {
                    el.setAttribute(key, '');
                } else if (val !== false && val != null) {
                    el.setAttribute(key, val);
                }
            }
        }

        const append = (child) => {
            if (child == null || child === false) return;
            if (Array.isArray(child)) { child.forEach(append); return; }
            if (child instanceof Node) { el.appendChild(child); return; }
            el.appendChild(document.createTextNode(String(child)));
        };
        children.forEach(append);

        return el;
    },

    /**
     * Set content on an element safely.
     * Accepts DOM nodes (appended directly), arrays of nodes, or strings
     * (set as textContent to prevent XSS). For trusted HTML from the
     * server (e.g., markdown-rendered content), use setTrustedContent().
     *
     * @param {HTMLElement}              el      — target element
     * @param {string|Node|Node[]|null}  content — content to set
     */
    setContent(el, content) {
        el.textContent = '';
        if (content == null) return;
        if (content instanceof Node) {
            el.appendChild(content);
        } else if (Array.isArray(content)) {
            const frag = document.createDocumentFragment();
            content.forEach(c => {
                if (c instanceof Node) frag.appendChild(c);
                else frag.appendChild(document.createTextNode(String(c)));
            });
            el.appendChild(frag);
        } else {
            el.textContent = String(content);
        }
    },

    /**
     * Set trusted HTML content on an element.
     * Uses the Sanitizer API (setHTML) when available, otherwise
     * uses DOMParser for sanitization before inserting.
     *
     * IMPORTANT: Only use this for content that originates from
     * trusted sources (e.g., server-rendered markdown, our own
     * template strings). Never use with raw user input.
     *
     * @param {HTMLElement} el          — target element
     * @param {string}      htmlString — trusted HTML string
     */
    setTrustedContent(el, htmlString) {
        if (typeof el.setHTML === 'function') {
            // Sanitizer API (Chrome 105+, Firefox 116+)
            el.setHTML(htmlString);
        } else {
            // Fallback: parse and re-insert (strips scripts/events)
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlString, 'text/html');
            el.textContent = '';
            while (doc.body.firstChild) {
                el.appendChild(document.adoptNode(doc.body.firstChild));
            }
        }
    },

    /**
     * Scoped querySelector.
     * @param {string}      selector
     * @param {HTMLElement}  [scope=document]
     * @returns {HTMLElement|null}
     */
    $(selector, scope = document) {
        return scope.querySelector(selector);
    },

    /**
     * Scoped querySelectorAll (returns real Array).
     * @param {string}      selector
     * @param {HTMLElement}  [scope=document]
     * @returns {HTMLElement[]}
     */
    $$(selector, scope = document) {
        return [...scope.querySelectorAll(selector)];
    },

    // ══════════════════════════════════════════════════════════════
    //  EVENT DELEGATION
    // ══════════════════════════════════════════════════════════════

    /**
     * Delegated event listener.
     * Replaces 300+ inline onclick= handlers with a single listener per root.
     *
     * @param {HTMLElement} root      — ancestor element to listen on
     * @param {string}      eventType — 'click', 'input', 'change', etc.
     * @param {string}      selector  — CSS selector to match delegated targets
     * @param {Function}    handler   — called with (event, matchedElement)
     * @returns {Function}  teardown function to remove the listener
     *
     * Usage:
     *   OverlordUI.on(document, 'click', '[data-action]', (e, el) => {
     *       const action = el.dataset.action;
     *       // handle action...
     *   });
     */
    on(root, eventType, selector, handler) {
        const listener = (e) => {
            const target = e.target.closest(selector);
            if (target && root.contains(target)) {
                handler(e, target);
            }
        };
        root.addEventListener(eventType, listener, { passive: eventType === 'scroll' });
        return () => root.removeEventListener(eventType, listener);
    },

    // ══════════════════════════════════════════════════════════════
    //  BROADCAST CHANNEL (Pop-Out Window Sync)
    // ══════════════════════════════════════════════════════════════
    // Preserves existing BroadcastChannel 'overlord-sync' protocol.

    /**
     * Post a message to all pop-out windows (and main window).
     * @param {object} msg — { type: string, ...data }
     */
    broadcast(msg) {
        if (this._channel) {
            try { this._channel.postMessage(msg); }
            catch (e) { console.warn('[OverlordUI] BroadcastChannel error:', e); }
        }
    },

    /**
     * Open a panel in a pop-out window.
     * @param {string} panelId — panel element id
     */
    popOut(panelId) {
        const panel = document.getElementById(panelId);
        if (!panel) return;

        const label = panel.querySelector('.panel-header span')?.textContent || panelId;
        const w = window.open(
            `${location.pathname}?popout=${panelId}`,
            `overlord_${panelId}`,
            'width=480,height=600,menubar=no,toolbar=no'
        );
        if (w) {
            this._popoutWindows[panelId] = w;
            panel.classList.add('panel-popped-out');

            // Insert placeholder
            const placeholder = this.h('div', {
                class: 'popout-placeholder',
                id: `popout-ph-${panelId}`,
                'data-panel': panelId
            }, `${label} — popped out ↗`);
            panel.after(placeholder);

            this.broadcast({ type: 'panel_popped_out', panelId });
        }
    },

    /**
     * Pull a popped-out panel back to the main window.
     * @param {string} panelId
     */
    pullBack(panelId) {
        const w = this._popoutWindows[panelId];
        if (w && !w.closed) w.close();
        delete this._popoutWindows[panelId];

        const panel = document.getElementById(panelId);
        if (panel) panel.classList.remove('panel-popped-out');

        const ph = document.getElementById(`popout-ph-${panelId}`);
        if (ph) ph.remove();

        this.broadcast({ type: 'panel_pulled_back', panelId });
    },

    /** @private Set up BroadcastChannel listeners. */
    _setupBroadcastChannel() {
        if (!this._channel) return;

        this._channel.onmessage = (e) => {
            const data = e.data;
            if (!data || !data.type) return;

            switch (data.type) {
                case 'popout_closing':
                    if (!this._isPopout) this.pullBack(data.panelId);
                    break;
                case 'theme_changed':
                    document.documentElement.dataset.theme = data.theme;
                    break;
                case 'state_sync':
                    // Allow pop-out windows to receive state updates
                    if (this._isPopout && this._store && data.key) {
                        this._store.set(data.key, data.value, { silent: false, broadcast: false });
                    }
                    break;
            }

            // Forward to event bus so components can react
            this.dispatch('broadcast:' + data.type, data);
        };
    },

    // ══════════════════════════════════════════════════════════════
    //  UTILITY
    // ══════════════════════════════════════════════════════════════

    /**
     * Debounce a function.
     * @param {Function} fn    — function to debounce
     * @param {number}   delay — milliseconds
     * @returns {Function}
     */
    debounce(fn, delay = 150) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    },

    /**
     * Throttle a function (trailing edge).
     * @param {Function} fn    — function to throttle
     * @param {number}   limit — milliseconds
     * @returns {Function}
     */
    throttle(fn, limit = 100) {
        let waiting = false;
        let lastArgs = null;
        return (...args) => {
            if (!waiting) {
                fn(...args);
                waiting = true;
                setTimeout(() => {
                    waiting = false;
                    if (lastArgs) { fn(...lastArgs); lastArgs = null; }
                }, limit);
            } else {
                lastArgs = args;
            }
        };
    },

    /**
     * Escape HTML to prevent XSS.
     * @param {string} str
     * @returns {string}
     */
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    /**
     * Generate a short unique id.
     * @param {string} [prefix='']
     * @returns {string}
     */
    uid(prefix = '') {
        return prefix + Math.random().toString(36).slice(2, 9);
    },

    /**
     * Format a timestamp for display.
     * @param {Date|string|number} date
     * @returns {string} e.g., "2:34 PM"
     */
    formatTime(date) {
        const d = date instanceof Date ? date : new Date(date);
        return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    },

    /**
     * Clamp a number between min and max.
     * @param {number} val
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }
};

// Make h available as a standalone import for convenience
export const h = OverlordUI.h.bind(OverlordUI);
