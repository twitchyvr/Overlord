/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Dropdown Component
   ═══════════════════════════════════════════════════════════════════
   Self-positioning dropdown with click-outside-close and optional
   search filtering.

   Fixes the chat dropdown bug:
     Renders at document.body level, positioned via JS — never trapped
     by ancestor backdrop-filter stacking contexts.

   Dependencies: engine.js (Component, OverlordUI, h)
   ═══════════════════════════════════════════════════════════════════ */

import { Component, OverlordUI, h } from '../engine.js';


export class Dropdown extends Component {

    /**
     * @param {HTMLElement} triggerEl  — the element that opens the dropdown
     * @param {object}      opts
     * @param {Array}   opts.items      — [{ id, label, icon?, divider?, disabled?, danger? }]
     * @param {Function} [opts.onSelect] — called with (item) on selection
     * @param {boolean}  [opts.searchable=false] — show search input
     * @param {string}   [opts.position='below'] — 'below' | 'above' | 'auto'
     * @param {string}   [opts.className]        — additional CSS class
     * @param {number}   [opts.maxHeight=300]     — max dropdown height in px
     */
    constructor(triggerEl, opts = {}) {
        super(triggerEl, {
            items:      [],
            onSelect:   null,
            searchable: false,
            position:   'auto',
            className:  '',
            maxHeight:  300,
            ...opts
        });

        this._menuEl    = null;  // the dropdown menu (appended to body)
        this._isOpen    = false;
        this._searchVal = '';
        this._outsideClickHandler = null;
        this._resizeHandler = null;
    }

    mount() {
        this._mounted = true;
        this.el.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });
    }

    destroy() {
        this.close();
        super.destroy();
    }

    // ── Public API ───────────────────────────────────────────────

    /** Open the dropdown. */
    open() {
        if (this._isOpen) return;
        this._isOpen = true;
        this._buildMenu();
        this._position();
        this._attachOutsideClick();
        this._attachResize();
    }

    /** Close the dropdown. */
    close() {
        if (!this._isOpen) return;
        this._isOpen = false;
        if (this._menuEl && this._menuEl.parentNode) {
            this._menuEl.parentNode.removeChild(this._menuEl);
        }
        this._menuEl = null;
        this._detachOutsideClick();
        this._detachResize();
    }

    /** Toggle open/close. */
    toggle() {
        if (this._isOpen) this.close();
        else this.open();
    }

    /** Whether the dropdown is open. */
    get isOpen() { return this._isOpen; }

    /**
     * Update the items list dynamically.
     * @param {Array} items
     */
    setItems(items) {
        this.opts.items = items;
        if (this._isOpen) {
            this.close();
            this.open();
        }
    }

    // ── Private ──────────────────────────────────────────────────

    /** @private Build the dropdown menu DOM and append to body. */
    _buildMenu() {
        const menu = h('div', {
            class: `dropdown-menu ${this.opts.className}`.trim(),
            style: {
                position: 'fixed',
                zIndex: '9999',
                maxHeight: this.opts.maxHeight + 'px',
                overflowY: 'auto'
            }
        });

        // Search input (optional)
        if (this.opts.searchable) {
            const searchInput = h('input', {
                class: 'dropdown-search',
                type: 'text',
                placeholder: 'Search...',
            });
            searchInput.addEventListener('input', () => {
                this._searchVal = searchInput.value.toLowerCase();
                this._filterItems();
            });
            menu.appendChild(searchInput);

            // Focus search on open
            requestAnimationFrame(() => searchInput.focus());
        }

        // Items container
        const list = h('div', { class: 'dropdown-list' });

        for (const item of this.opts.items) {
            if (item.divider) {
                list.appendChild(h('div', { class: 'dropdown-divider' }));
                continue;
            }

            const el = h('div', {
                class: `dropdown-item${item.disabled ? ' disabled' : ''}${item.danger ? ' danger' : ''}`,
                'data-dropdown-id': item.id,
                'data-search-text': (item.label || '').toLowerCase()
            });

            if (item.icon) {
                el.appendChild(h('span', { class: 'dropdown-icon' }, item.icon));
            }
            el.appendChild(h('span', { class: 'dropdown-label' }, item.label));

            if (!item.disabled) {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.close();
                    if (this.opts.onSelect) this.opts.onSelect(item);
                });
            }

            list.appendChild(el);
        }

        menu.appendChild(list);
        this._menuEl = menu;
        document.body.appendChild(menu);
    }

    /** @private Position the menu relative to the trigger. */
    _position() {
        if (!this._menuEl) return;
        const triggerRect = this.el.getBoundingClientRect();
        const menuRect = this._menuEl.getBoundingClientRect();

        let top, left;

        // Horizontal: align left edge with trigger, but don't overflow right
        left = triggerRect.left;
        if (left + menuRect.width > window.innerWidth - 8) {
            left = window.innerWidth - menuRect.width - 8;
        }
        left = Math.max(8, left);

        // Vertical: auto-position above or below
        const spaceBelow = window.innerHeight - triggerRect.bottom;
        const spaceAbove = triggerRect.top;
        const preferBelow = this.opts.position === 'below' ||
            (this.opts.position === 'auto' && spaceBelow >= menuRect.height) ||
            (this.opts.position === 'auto' && spaceBelow >= spaceAbove);

        if (preferBelow) {
            top = triggerRect.bottom + 4;
            // Clamp if overflows bottom
            if (top + menuRect.height > window.innerHeight - 8) {
                this._menuEl.style.maxHeight = (window.innerHeight - top - 8) + 'px';
            }
        } else {
            top = triggerRect.top - menuRect.height - 4;
            if (top < 8) {
                top = 8;
                this._menuEl.style.maxHeight = (triggerRect.top - 12) + 'px';
            }
        }

        this._menuEl.style.top = top + 'px';
        this._menuEl.style.left = left + 'px';
        this._menuEl.style.minWidth = Math.max(160, triggerRect.width) + 'px';
    }

    /** @private Filter visible items by search text. */
    _filterItems() {
        if (!this._menuEl) return;
        const items = this._menuEl.querySelectorAll('.dropdown-item');
        items.forEach(el => {
            const text = el.dataset.searchText || '';
            el.style.display = text.includes(this._searchVal) ? '' : 'none';
        });
    }

    /** @private Attach click-outside handler. */
    _attachOutsideClick() {
        this._outsideClickHandler = (e) => {
            if (this._menuEl && !this._menuEl.contains(e.target) && !this.el.contains(e.target)) {
                this.close();
            }
        };
        // Defer to avoid immediately closing from the trigger click
        requestAnimationFrame(() => {
            document.addEventListener('mousedown', this._outsideClickHandler);
        });
    }

    /** @private Detach click-outside handler. */
    _detachOutsideClick() {
        if (this._outsideClickHandler) {
            document.removeEventListener('mousedown', this._outsideClickHandler);
            this._outsideClickHandler = null;
        }
    }

    /** @private Attach resize/scroll handler to reposition. */
    _attachResize() {
        this._resizeHandler = OverlordUI.throttle(() => {
            if (this._isOpen) this._position();
        }, 100);
        window.addEventListener('resize', this._resizeHandler);
        window.addEventListener('scroll', this._resizeHandler, true);
    }

    /** @private Detach resize/scroll handler. */
    _detachResize() {
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            window.removeEventListener('scroll', this._resizeHandler, true);
            this._resizeHandler = null;
        }
    }
}
