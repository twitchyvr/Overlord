/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Tabs Component
   ═══════════════════════════════════════════════════════════════════
   Polished, accessible segmented control / tab bar.

   Replaces: plan variant selector, team filter tabs, task view tabs,
   settings tabs, chat mode selector.

   Fixes the plan variant selector bug:
     Separates "preview" (visual selection) from "confirm" (action).
     onChange fires on selection, but caller decides when to commit.

   Styles: 'pills' | 'underline' | 'segmented'

   Dependencies: engine.js (Component, h)
   ═══════════════════════════════════════════════════════════════════ */

import { Component, h } from '../engine.js';


export class Tabs extends Component {

    /**
     * @param {HTMLElement} el   — container element
     * @param {object}      opts
     * @param {Array}  opts.items    — [{ id, label, badge?, icon?, disabled? }]
     * @param {string} [opts.activeId]  — initially active tab id
     * @param {string} [opts.style='pills'] — 'pills' | 'underline' | 'segmented'
     * @param {Function} [opts.onChange] — called with (id, prevId) on tab switch
     */
    constructor(el, opts = {}) {
        super(el, {
            items:    [],
            activeId: null,
            style:    'pills',
            onChange:  null,
            ...opts
        });

        this._activeId = this.opts.activeId || (this.opts.items[0]?.id ?? null);
        this._tabEls = new Map(); // id → button element
    }

    mount() {
        this._mounted = true;
        this._render();
    }

    /** Get the currently active tab id. */
    getActive() { return this._activeId; }

    /**
     * Set the active tab programmatically.
     * @param {string}  id     — tab id to activate
     * @param {boolean} [silent=false] — if true, don't fire onChange
     */
    setActive(id, silent = false) {
        const prevId = this._activeId;
        if (id === prevId) return;

        const item = this.opts.items.find(i => i.id === id);
        if (!item || item.disabled) return;

        this._activeId = id;
        this._updateActiveStyles();

        if (!silent && this.opts.onChange) {
            this.opts.onChange(id, prevId);
        }
    }

    /**
     * Update the badge on a specific tab.
     * @param {string}       id    — tab id
     * @param {string|number|null} text — badge text (null to remove)
     */
    setBadge(id, text) {
        const item = this.opts.items.find(i => i.id === id);
        if (item) item.badge = text;

        const tabEl = this._tabEls.get(id);
        if (!tabEl) return;

        let badge = tabEl.querySelector('.tab-badge');
        if (text == null || text === '') {
            if (badge) badge.remove();
            return;
        }
        if (!badge) {
            badge = h('span', { class: 'tab-badge' });
            tabEl.appendChild(badge);
        }
        badge.textContent = String(text);
    }

    /**
     * Dynamically replace the entire item list.
     * @param {Array} items — new tab items
     * @param {string} [activeId] — optional new active id
     */
    setItems(items, activeId) {
        this.opts.items = items;
        if (activeId !== undefined) this._activeId = activeId;
        else if (!items.find(i => i.id === this._activeId)) {
            this._activeId = items[0]?.id ?? null;
        }
        this._render();
    }

    // ── Private ──────────────────────────────────────────────────

    /** @private Full re-render of the tab bar. */
    _render() {
        this.el.textContent = '';
        this.el.className = `tabs tabs-${this.opts.style}`;
        this._tabEls.clear();

        const frag = document.createDocumentFragment();

        for (const item of this.opts.items) {
            const isActive = item.id === this._activeId;
            const btn = h('button', {
                class: `tab-item${isActive ? ' active' : ''}${item.disabled ? ' disabled' : ''}`,
                'data-tab-id': item.id,
                role: 'tab',
                'aria-selected': isActive ? 'true' : 'false',
                'aria-disabled': item.disabled ? 'true' : undefined,
                tabindex: isActive ? '0' : '-1'
            });

            if (item.icon) {
                btn.appendChild(h('span', { class: 'tab-icon' }, item.icon));
            }
            btn.appendChild(h('span', { class: 'tab-label' }, item.label));
            if (item.badge != null && item.badge !== '') {
                btn.appendChild(h('span', { class: 'tab-badge' }, String(item.badge)));
            }

            if (!item.disabled) {
                btn.addEventListener('click', () => this.setActive(item.id));
            }

            this._tabEls.set(item.id, btn);
            frag.appendChild(btn);
        }

        this.el.appendChild(frag);

        // Keyboard navigation (arrow keys)
        this.el.addEventListener('keydown', (e) => {
            const items = this.opts.items.filter(i => !i.disabled);
            const idx = items.findIndex(i => i.id === this._activeId);
            if (idx === -1) return;

            let newIdx = idx;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                newIdx = (idx + 1) % items.length;
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                newIdx = (idx - 1 + items.length) % items.length;
            } else if (e.key === 'Home') {
                newIdx = 0;
            } else if (e.key === 'End') {
                newIdx = items.length - 1;
            } else {
                return;
            }

            e.preventDefault();
            this.setActive(items[newIdx].id);
            this._tabEls.get(items[newIdx].id)?.focus();
        });
    }

    /** @private Update active/inactive visual styles without full re-render. */
    _updateActiveStyles() {
        this._tabEls.forEach((btn, id) => {
            const active = id === this._activeId;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
            btn.setAttribute('tabindex', active ? '0' : '-1');
        });
    }
}
