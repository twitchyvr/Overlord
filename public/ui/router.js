/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Layout Router
   ═══════════════════════════════════════════════════════════════════
   Controls mobile vs desktop layout switching. Replaces the
   scattered @media rules and showMobilePanel() function.

   Modes:
     - desktop (≥1100px): Chat + full right panel side-by-side
     - tablet  (769px–1099px): Chat + narrow right panel
     - mobile  (≤768px): Full-screen views, bottom tab bar

   Mobile-first: CSS is mobile-first. Desktop enhancements via JS.

   Dependencies: engine.js (OverlordUI), state.js (Store)
   ═══════════════════════════════════════════════════════════════════ */

import { OverlordUI } from './engine.js';

// ── Breakpoints ──────────────────────────────────────────────────
const BP_MOBILE  = 768;
const BP_DESKTOP = 1100;

export const Router = {

    /** Current layout mode: 'desktop' | 'tablet' | 'mobile' */
    mode: 'desktop',

    /** Current active mobile view id */
    _activeView: 'chat',

    /** Store reference */
    _store: null,

    /** ResizeObserver instance */
    _resizeObserver: null,

    /** Mobile nav element */
    _mobileNav: null,

    /** Cached panel-to-tab mapping */
    _panelTabMap: {
        'panel-roadmap':       'project',
        'panel-team':          'team',
        'panel-activity':      'activity',
        'panel-tasks':         'tasks',
        'panel-tools':         'activity',
        'panel-log':           'log',
        'panel-orchestration': 'orchestration'
    },

    // ══════════════════════════════════════════════════════════════
    //  INITIALIZATION
    // ══════════════════════════════════════════════════════════════

    /**
     * Initialize the router.
     * @param {OverlordUI} engine
     * @param {Store}      store
     */
    init(engine, store) {
        this._store = store;
        this._mobileNav = document.getElementById('mobile-nav');
        this._detectMode();
        this._setupResizeListener();
        this._setupMobileNav();
        this._applyMode();

        console.log(`[Router] Initialized in ${this.mode} mode`);
        return this;
    },

    // ══════════════════════════════════════════════════════════════
    //  VIEW SWITCHING
    // ══════════════════════════════════════════════════════════════

    /**
     * Switch the active view (mobile only).
     * @param {string} viewId — 'chat' | 'project' | 'team' | 'activity' | 'tasks' | 'log' | 'orchestration'
     */
    setView(viewId) {
        if (this.mode === 'desktop' || this.mode === 'tablet') {
            // On desktop/tablet, focus the corresponding panel instead
            this._focusPanel(viewId);
            return;
        }

        this._activeView = viewId;
        this._applyMobileView();
    },

    /**
     * Get the current active view id.
     * @returns {string}
     */
    getView() {
        return this._activeView;
    },

    // ══════════════════════════════════════════════════════════════
    //  INTERNAL
    // ══════════════════════════════════════════════════════════════

    /** @private Detect the current layout mode based on viewport width. */
    _detectMode() {
        const w = window.innerWidth;
        if (w <= BP_MOBILE) {
            this.mode = 'mobile';
        } else if (w <= BP_DESKTOP) {
            this.mode = 'tablet';
        } else {
            this.mode = 'desktop';
        }
    },

    /** @private Apply layout classes based on current mode. */
    _applyMode() {
        const app = document.getElementById('app');
        if (!app) return;

        // Remove all mode classes
        app.classList.remove('mode-desktop', 'mode-tablet', 'mode-mobile');
        app.classList.add(`mode-${this.mode}`);

        // Toggle mobile nav
        if (this._mobileNav) {
            this._mobileNav.style.display = this.mode === 'mobile' ? '' : 'none';
        }

        // Mobile: apply full-screen view
        if (this.mode === 'mobile') {
            this._applyMobileView();
        }

        // Dispatch mode change to engine
        OverlordUI.dispatch('layout_mode', this.mode);

        // Update store if available
        if (this._store) {
            this._store.set('ui.layoutMode', this.mode, { broadcast: false });
        }
    },

    /** @private Apply the active mobile view (show one panel, hide others). */
    _applyMobileView() {
        const chatPanel = document.querySelector('.chat-panel');
        const rightPanel = document.getElementById('right-panel');

        if (this._activeView === 'chat') {
            // Show chat, hide right panel using CSS classes
            if (chatPanel) chatPanel.classList.remove('mobile-hidden');
            if (rightPanel) rightPanel.classList.remove('mobile-visible');
        } else {
            // Hide chat, show right panel using CSS classes
            if (chatPanel) chatPanel.classList.add('mobile-hidden');
            if (rightPanel) rightPanel.classList.add('mobile-visible');

            // Find the panel that matches this view; toggle mobile-panel-active class
            const targetPanelId = this._viewToPanelId(this._activeView);
            document.querySelectorAll('.panel[id]').forEach(panel => {
                if (panel.id === targetPanelId) {
                    panel.classList.add('mobile-panel-active');
                    panel.classList.remove('collapsed');
                } else {
                    panel.classList.remove('mobile-panel-active');
                }
            });
        }

        // Update mobile nav active state
        this._updateMobileNavActive();
    },

    /** @private Map view id to panel element id. */
    _viewToPanelId(viewId) {
        const map = {
            'project':       'panel-roadmap',
            'team':          'panel-team',
            'activity':      'panel-activity',
            'tasks':         'panel-tasks',
            'tools':         'panel-tools',
            'log':           'panel-log',
            'orchestration': 'panel-orchestration'
        };
        return map[viewId] || viewId;
    },

    /** @private Focus a panel on desktop/tablet (scroll into view, expand if collapsed). */
    _focusPanel(viewId) {
        const panelId = this._viewToPanelId(viewId);
        const panel = document.getElementById(panelId);
        if (!panel) return;

        // Expand if collapsed
        if (panel.classList.contains('collapsed')) {
            panel.classList.remove('collapsed');
        }

        // Ensure visible
        if (panel.classList.contains('panel-hidden')) {
            const comp = OverlordUI.getComponent?.(panelId);
            if (comp?.show) comp.show();
        }

        // Scroll into view
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },

    /** @private Set up the ResizeObserver to detect viewport changes. */
    _setupResizeListener() {
        const handler = OverlordUI.debounce(() => {
            const prevMode = this.mode;
            this._detectMode();
            if (this.mode !== prevMode) {
                this._applyMode();
            }
        }, 150);

        window.addEventListener('resize', handler);
    },

    /** @private Set up mobile nav click handlers. */
    _setupMobileNav() {
        if (!this._mobileNav) return;

        OverlordUI.on(this._mobileNav, 'click', '.mobile-nav-item', (e, el) => {
            const view = el.dataset.view;
            if (view) this.setView(view);
        });
    },

    /** @private Update mobile nav active tab indicator. */
    _updateMobileNavActive() {
        if (!this._mobileNav) return;
        this._mobileNav.querySelectorAll('.mobile-nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === this._activeView);
        });
    }
};

// Export showMobilePanel for legacy compatibility
window.showMobilePanel = (viewId) => Router.setView(viewId);
