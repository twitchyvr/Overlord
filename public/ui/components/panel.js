/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Panel Component
   ═══════════════════════════════════════════════════════════════════
   Self-contained panel component that replaces the monolith's
   scattered panel infrastructure (PANEL_REGISTRY, collapse handlers,
   popout system, applyPanelVisibility, etc.).

   Capabilities:
     - Collapse / expand (animated, keyboard-accessible, Radix pattern)
     - Pop-out to separate window via BroadcastChannel
     - Pull-back from pop-out
     - Maximize / solo mode
     - Show / hide (visibility toggle)
     - Drag-resize between panels (inter-panel dividers)
     - Right-panel width resize
     - Mobile landscape: tap header → switch to that panel
     - Persists state to localStorage via the Store

   Fixes the PANEL_REGISTRY init bug:
     Panel instances self-register during construction.
     No separate population step that can get out of order.

   Dependencies: engine.js (Component, OverlordUI)
   ═══════════════════════════════════════════════════════════════════ */

import { Component, OverlordUI, h } from '../engine.js';

// ── Panel Registry (populated as panels are constructed) ──────────
const PANELS = new Map();   // id → PanelComponent instance
let _soloPanel = null;      // id of the currently maximized panel

/**
 * Get all registered panels.
 * @returns {Map<string, PanelComponent>}
 */
export function getPanels() { return PANELS; }

/**
 * Get the panel registry as an array (for iteration / config menus).
 * @returns {{ id: string, label: string, icon: string, defaultVisible: boolean }[]}
 */
export function getPanelRegistry() {
    return [...PANELS.values()].map(p => ({
        id:             p.id,
        label:          p.opts.label,
        icon:           p.opts.icon,
        defaultVisible: p.opts.defaultVisible
    }));
}


// ══════════════════════════════════════════════════════════════════
//  PanelComponent Class
// ══════════════════════════════════════════════════════════════════

export class PanelComponent extends Component {

    /**
     * @param {HTMLElement} el   — the .panel element
     * @param {object}      opts — panel config
     * @param {string}      opts.id              — unique panel id (e.g., 'panel-tasks')
     * @param {string}      opts.label           — display label (e.g., '✅ Tasks')
     * @param {string}      opts.icon            — emoji icon
     * @param {boolean}     [opts.defaultVisible=true]  — visible on first load
     * @param {boolean}     [opts.popOutEnabled=true]    — allow pop-out
     * @param {boolean}     [opts.maximizeEnabled=true]  — allow maximize/solo
     */
    constructor(el, opts = {}) {
        super(el, {
            defaultVisible:  true,
            popOutEnabled:   true,
            maximizeEnabled: true,
            ...opts
        });

        this.id = opts.id || el.id;
        this._headerEl  = this.$('.panel-header');
        this._contentEl = this.$('.panel-content');
        this._collapsed = false;
        this._visible   = true;
        this._poppedOut = false;

        // Self-register into global panel registry (fixes init ordering bug)
        PANELS.set(this.id, this);
    }

    // ── Lifecycle ────────────────────────────────────────────────

    mount() {
        this._mounted = true;
        this._setupCollapse();
        this._setupButtons();
        this._setupAccessibility();
        this._applyPersistedState();
    }

    destroy() {
        PANELS.delete(this.id);
        super.destroy();
    }

    // ── Public API ───────────────────────────────────────────────

    /** Collapse the panel (animated). */
    collapse() {
        this._collapsed = true;
        this.el.classList.add('collapsed');
        this._updateAriaState();
    }

    /** Expand the panel (animated). */
    expand() {
        this._collapsed = false;
        this.el.classList.remove('collapsed');
        this._updateAriaState();
    }

    /** Toggle collapsed state. */
    toggleCollapse() {
        if (this._collapsed) this.expand();
        else this.collapse();
    }

    /** Whether the panel is currently collapsed. */
    get isCollapsed() { return this._collapsed; }

    /** Show the panel (visibility). */
    show() {
        this._visible = true;
        this.el.classList.remove('panel-hidden');
    }

    /** Hide the panel (visibility). */
    hide() {
        this._visible = false;
        this.el.classList.add('panel-hidden');
    }

    /** Whether the panel is currently visible. */
    get isVisible() { return this._visible; }

    /** Pop out to a separate window. */
    popOut() {
        if (!this.opts.popOutEnabled) return;
        OverlordUI.popOut(this.id);
        this._poppedOut = true;
    }

    /** Pull back from pop-out. */
    pullBack() {
        OverlordUI.pullBack(this.id);
        this._poppedOut = false;
    }

    /** Whether the panel is popped out. */
    get isPoppedOut() { return this._poppedOut; }

    /** Maximize this panel (solo mode — hide siblings). */
    maximize() {
        if (!this.opts.maximizeEnabled) return;
        _soloPanel = this.id;
        const rp = document.getElementById('right-panel');

        // Hide all other panels and dividers
        document.querySelectorAll('.panel[id]').forEach(el => {
            el.style.display = el.id === this.id ? '' : 'none';
        });
        document.querySelectorAll('.panel-divider').forEach(el => {
            el.style.display = 'none';
        });

        this.el.style.flexBasis = '100%';
        this.el.style.maxHeight = 'none';
        this.el.style.display = 'flex';
        if (rp) rp.classList.add('solo-active');

        // Update maximize button
        const btn = this.$('.panel-btn-max');
        if (btn) { btn.textContent = '⤡'; btn.title = 'Restore'; }
    }

    /** Restore from maximize (show siblings). */
    restore() {
        _soloPanel = null;
        const rp = document.getElementById('right-panel');

        // Show all panels and dividers
        document.querySelectorAll('.panel[id], .panel-divider').forEach(el => {
            el.style.display = '';
        });

        // Reset maximize buttons
        document.querySelectorAll('.panel-btn-max').forEach(b => {
            b.textContent = '⤢'; b.title = 'Maximize';
        });

        if (rp) rp.classList.remove('solo-active');

        // Reset maxHeight
        document.querySelectorAll('.panel[id]').forEach(el => {
            el.style.maxHeight = '';
        });

        // Re-apply persisted heights
        applyPersistedHeights();
    }

    /** Toggle maximize/restore. */
    toggleMaximize() {
        if (_soloPanel === this.id) this.restore();
        else this.maximize();
    }

    /** Whether this panel is currently maximized. */
    get isMaximized() { return _soloPanel === this.id; }

    /**
     * Update the panel content safely.
     * Accepts DOM nodes or text. For trusted HTML, use setTrustedContent.
     * @param {string|Node|Node[]} content
     */
    setContent(content) {
        if (this._contentEl) {
            OverlordUI.setContent(this._contentEl, content);
        }
    }

    /**
     * Update the panel content with trusted HTML.
     * IMPORTANT: Only use for server-rendered / template HTML.
     * @param {string} htmlString
     */
    setTrustedContent(htmlString) {
        if (this._contentEl) {
            OverlordUI.setTrustedContent(this._contentEl, htmlString);
        }
    }

    // ── Private Methods ──────────────────────────────────────────

    /** @private Set up collapse/expand click & keyboard handlers. */
    _setupCollapse() {
        if (!this._headerEl) return;

        this._headerEl.addEventListener('click', (e) => {
            // Don't collapse if clicking a button inside the header
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;

            // Landscape mobile: tap header → show mobile panel instead
            if (this._isLandscapeMobile()) {
                const tabName = this._getMobileTabName();
                if (tabName && typeof window.showMobilePanel === 'function') {
                    window.showMobilePanel(tabName, e);
                    return;
                }
            }

            this.toggleCollapse();
            this._persistCollapseState();
        });

        this._headerEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this._headerEl.click();
            }
        });
    }

    /** @private Wire up popout, maximize, and any other header buttons. */
    _setupButtons() {
        // Popout button
        const popoutBtn = this.$('.panel-btn-popout');
        if (popoutBtn) {
            popoutBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this._poppedOut) this.pullBack();
                else this.popOut();
            });
        }

        // Maximize button
        const maxBtn = this.$('.panel-btn-max');
        if (maxBtn) {
            maxBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMaximize();
            });
        }
    }

    /** @private Set up ARIA attributes (Radix Collapsible pattern). */
    _setupAccessibility() {
        if (!this._headerEl) return;
        this._headerEl.setAttribute('tabindex', '0');
        this._headerEl.setAttribute('role', 'button');

        if (this._contentEl && !this._contentEl.id) {
            this._contentEl.id = this.id + '-content';
        }
        this._updateAriaState();
    }

    /** @private Update ARIA state attributes. */
    _updateAriaState() {
        const state = this._collapsed ? 'closed' : 'open';
        this.el.setAttribute('data-state', state);
        if (this._headerEl) {
            this._headerEl.setAttribute('aria-expanded', this._collapsed ? 'false' : 'true');
            if (this._contentEl?.id) {
                this._headerEl.setAttribute('aria-controls', this._contentEl.id);
            }
        }
    }

    /** @private Load and apply persisted collapse state from store. */
    _applyPersistedState() {
        if (!OverlordUI._store) return;
        const states = OverlordUI._store.peek('panels.states', {});
        if (states[this.id]) {
            this.collapse();
        } else if (states[this.id] === false) {
            this.expand();
        }
        // First-load defaults (no persisted state)
        if (!Object.keys(states).length) {
            if (this.id === 'panel-roadmap' || this.id === 'panel-tools') {
                this.collapse();
            }
        }
    }

    /** @private Persist the current collapse state. */
    _persistCollapseState() {
        if (!OverlordUI._store) return;
        OverlordUI._store.update('panels.states', states => {
            return { ...states, [this.id]: this._collapsed };
        });
    }

    /** @private Check if we're in landscape mobile mode. */
    _isLandscapeMobile() {
        return window.innerWidth <= 768 &&
               window.innerHeight <= 500 &&
               window.innerWidth > window.innerHeight;
    }

    /** @private Map panel id to mobile tab name. */
    _getMobileTabName() {
        const map = {
            'panel-roadmap':  'project',
            'panel-team':     'team',
            'panel-activity': 'activity',
            'panel-tasks':    'tasks',
            'panel-tools':    'activity',
            'panel-log':      'log'
        };
        return map[this.id];
    }
}


// ══════════════════════════════════════════════════════════════════
//  PANEL SYSTEM UTILITIES
// ══════════════════════════════════════════════════════════════════
// Static functions that operate on the global panel collection.

/**
 * Apply visibility state from the store to all registered panels.
 * Hides dividers adjacent to hidden panels.
 * Auto-hides right-panel if ALL panels are hidden/popped-out.
 */
export function applyPanelVisibility() {
    if (!OverlordUI._store) return;
    const vis = OverlordUI._store.peek('panels.visibility', {});

    PANELS.forEach((panel) => {
        const visible = vis[panel.id] !== undefined ? vis[panel.id] : panel.opts.defaultVisible;
        if (visible) panel.show();
        else panel.hide();
    });

    // Hide dividers adjacent to hidden panels
    document.querySelectorAll('.panel-divider').forEach(div => {
        const between = (div.dataset.between || '').split(',');
        const anyHidden = between.some(id => {
            const el = document.getElementById(id);
            return el && el.classList.contains('panel-hidden');
        });
        div.style.display = anyHidden ? 'none' : '';
    });

    // Auto-hide right-panel if ALL panels are hidden or popped out
    const anyVisible = [...PANELS.values()].some(p =>
        p.isVisible && !p.isPoppedOut
    );
    const rp = document.getElementById('right-panel');
    if (rp) rp.style.display = anyVisible ? '' : 'none';
}

/**
 * Toggle visibility for a single panel and persist.
 * @param {string} panelId
 */
export function togglePanelVisibility(panelId) {
    if (!OverlordUI._store) return;
    const panel = PANELS.get(panelId);
    if (!panel) return;

    OverlordUI._store.update('panels.visibility', vis => {
        const current = vis[panelId] !== undefined ? vis[panelId] : panel.opts.defaultVisible;
        return { ...vis, [panelId]: !current };
    });

    applyPanelVisibility();
}

/**
 * Show all panels and persist.
 */
export function showAllPanels() {
    if (!OverlordUI._store) return;
    const vis = {};
    PANELS.forEach((_, id) => { vis[id] = true; });
    OverlordUI._store.set('panels.visibility', vis);
    applyPanelVisibility();
}

/**
 * Hide all panels and persist.
 */
export function hideAllPanels() {
    if (!OverlordUI._store) return;
    const vis = {};
    PANELS.forEach((_, id) => { vis[id] = false; });
    OverlordUI._store.set('panels.visibility', vis);
    applyPanelVisibility();
}

/**
 * Apply persisted panel heights (flex-basis) from store.
 */
export function applyPersistedHeights() {
    if (!OverlordUI._store) return;
    const heights = OverlordUI._store.peek('panels.heights', {});
    let dirty = false;
    Object.entries(heights).forEach(([id, basis]) => {
        const el = document.getElementById(id);
        // Only apply pixel values — reject stale %, 100%, auto, etc.
        if (el && basis && /^\d+(\.\d+)?px$/.test(basis)) {
            el.style.flexBasis = basis;
        } else if (basis && !/^\d+(\.\d+)?px$/.test(basis)) {
            // Remove invalid entry
            delete heights[id];
            dirty = true;
        }
    });
    if (dirty) OverlordUI._store.set('panels.heights', heights);
}

/**
 * Save current panel heights to store.
 */
export function savePanelHeights() {
    if (!OverlordUI._store) return;
    const heights = {};
    document.querySelectorAll('.panel[id]').forEach(panel => {
        const basis = panel.style.flexBasis;
        // Only persist pixel values — never save %, auto, or solo (100%)
        if (basis && /^\d+(\.\d+)?px$/.test(basis)) {
            heights[panel.id] = basis;
        }
    });
    OverlordUI._store.set('panels.heights', heights);
}

/**
 * Initialize drag-resize behavior on all .panel-divider elements.
 * Allows users to vertically resize panels by dragging dividers.
 */
export function initPanelDividers() {
    document.querySelectorAll('.panel-divider').forEach(divider => {
        let dragging = false, startY = 0, prevPanel = null, nextPanel = null;
        let prevStart = 0, nextStart = 0;

        divider.addEventListener('mousedown', (e) => {
            // Walk siblings to find surrounding non-collapsed panels
            prevPanel = divider.previousElementSibling;
            while (prevPanel && (prevPanel.classList.contains('panel-divider') || prevPanel.classList.contains('collapsed')))
                prevPanel = prevPanel.previousElementSibling;
            nextPanel = divider.nextElementSibling;
            while (nextPanel && (nextPanel.classList.contains('panel-divider') || nextPanel.classList.contains('collapsed')))
                nextPanel = nextPanel.nextElementSibling;
            if (!prevPanel || !nextPanel) return;

            dragging = true;
            startY = e.clientY;
            prevStart = prevPanel.offsetHeight;
            nextStart = nextPanel.offsetHeight;
            divider.classList.add('dragging');
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging || !prevPanel || !nextPanel) return;
            const delta = e.clientY - startY;
            const newPrev = Math.max(32, prevStart + delta);
            const newNext = Math.max(32, nextStart - delta);
            prevPanel.style.flexBasis = newPrev + 'px';
            nextPanel.style.flexBasis = newNext + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (dragging) {
                dragging = false;
                divider.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                savePanelHeights();
            }
        });
    });
}

/**
 * Initialize the right-panel width resize handle.
 */
export function initRightPanelResize() {
    const handle = document.getElementById('panel-resize-handle');
    const rp = document.getElementById('right-panel');
    if (!handle || !rp) return;

    let startX = 0, startWidth = 0;

    handle.addEventListener('mousedown', (e) => {
        startX = e.clientX;
        startWidth = rp.offsetWidth;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        rp.style.willChange = 'width';
        rp.style.transition = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!handle.classList.contains('dragging')) return;
        const delta = startX - e.clientX;
        rp.style.width = Math.min(700, Math.max(200, startWidth + delta)) + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (!handle.classList.contains('dragging')) return;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        rp.style.willChange = '';
        rp.style.transition = '';
        if (OverlordUI._store) {
            OverlordUI._store.set('panels.width', rp.style.width);
        }
    });

    // Apply persisted width
    if (OverlordUI._store) {
        const savedW = OverlordUI._store.peek('panels.width');
        if (savedW) rp.style.width = typeof savedW === 'number' ? savedW + 'px' : savedW;
    }
}

/**
 * Render the panel configurator menu (visibility toggles).
 * @param {HTMLElement} menuEl — the .panel-config-menu element
 */
export function renderPanelConfigurator(menuEl) {
    if (!menuEl || !OverlordUI._store) return;
    const vis = OverlordUI._store.peek('panels.visibility', {});
    const frag = document.createDocumentFragment();

    PANELS.forEach((panel) => {
        const on = vis[panel.id] !== undefined ? vis[panel.id] : panel.opts.defaultVisible;
        const item = h('div', {
            class: 'panel-config-item',
            dataset: { panelId: panel.id }
        },
            h('span', null, panel.opts.label),
            h('div', { class: 'panel-config-toggle' + (on ? ' on' : '') })
        );
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePanelVisibility(panel.id);
            renderPanelConfigurator(menuEl);
        });
        frag.appendChild(item);
    });

    // Separator
    const sep = h('div', { style: 'height:1px;background:var(--border);margin:4px 0;' });
    frag.appendChild(sep);

    // Show All / Hide All
    const showAll = h('div', {
        class: 'panel-config-item',
        style: 'color:var(--accent-cyan,#00d4ff);'
    }, 'Show All');
    showAll.addEventListener('click', (e) => {
        e.stopPropagation();
        showAllPanels();
        renderPanelConfigurator(menuEl);
    });
    frag.appendChild(showAll);

    const hideAll = h('div', {
        class: 'panel-config-item',
        style: 'color:var(--text-muted);'
    }, 'Hide All');
    hideAll.addEventListener('click', (e) => {
        e.stopPropagation();
        hideAllPanels();
        renderPanelConfigurator(menuEl);
    });
    frag.appendChild(hideAll);

    menuEl.textContent = '';
    menuEl.appendChild(frag);
}

/**
 * Render toolbar panel toggle buttons.
 * @param {HTMLElement} containerEl — the #toolbar-panel-toggles element
 */
export function renderToolbarPanelToggles(containerEl) {
    if (!containerEl || !OverlordUI._store) return;
    const vis = OverlordUI._store.peek('panels.visibility', {});
    const frag = document.createDocumentFragment();

    PANELS.forEach((panel) => {
        const on = vis[panel.id] !== undefined ? vis[panel.id] : panel.opts.defaultVisible;
        const btn = h('button', {
            class: 'toolbar-btn panel-toggle-btn' + (on ? ' panel-toggle-on' : ''),
            title: panel.opts.label + (on ? ' (visible)' : ' (hidden)'),
            dataset: { panelId: panel.id }
        }, panel.opts.icon);
        btn.addEventListener('click', () => {
            togglePanelVisibility(panel.id);
            renderToolbarPanelToggles(containerEl);
        });
        frag.appendChild(btn);
    });

    containerEl.textContent = '';
    containerEl.appendChild(frag);
}

/**
 * Initialize the entire panel system.
 * Call this once after all panels are registered.
 */
export function initPanelSystem() {
    // Mount all panels
    PANELS.forEach(panel => {
        if (!panel._mounted) panel.mount();
    });

    // Apply visibility from store
    applyPanelVisibility();

    // Apply persisted heights
    applyPersistedHeights();

    // Initialize drag-resize dividers
    initPanelDividers();

    // Initialize right-panel width resize
    initRightPanelResize();

    // Render toolbar toggles
    const toggleContainer = document.getElementById('toolbar-panel-toggles');
    if (toggleContainer) renderToolbarPanelToggles(toggleContainer);
}
