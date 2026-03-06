/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Button Component
   ═══════════════════════════════════════════════════════════════════
   Standardized button factory with consistent variants and sizes.

   Variants: primary, secondary, ghost, danger, electric
   Sizes: sm, md, lg
   Features: icon support, loading state, disabled state

   Dependencies: engine.js (h)
   ═══════════════════════════════════════════════════════════════════ */

import { h } from '../engine.js';


export class Button {

    /**
     * Create a button element.
     *
     * @param {string}   label   — button text
     * @param {object}   [opts]
     * @param {string}   [opts.variant='secondary'] — 'primary' | 'secondary' | 'ghost' | 'danger' | 'electric'
     * @param {string}   [opts.size='md']           — 'sm' | 'md' | 'lg'
     * @param {string}   [opts.icon]                — emoji/text icon (prepended)
     * @param {string}   [opts.iconAfter]           — emoji/text icon (appended)
     * @param {boolean}  [opts.disabled=false]
     * @param {boolean}  [opts.loading=false]
     * @param {string}   [opts.className]           — additional CSS class
     * @param {string}   [opts.title]               — tooltip text
     * @param {string}   [opts.type='button']       — 'button' | 'submit' | 'reset'
     * @param {object}   [opts.dataset]             — data-* attributes
     * @param {Function} [opts.onClick]             — click handler
     * @returns {HTMLElement}
     */
    static create(label, opts = {}) {
        const {
            variant   = 'secondary',
            size      = 'md',
            icon,
            iconAfter,
            disabled  = false,
            loading   = false,
            className = '',
            title,
            type      = 'button',
            dataset   = {},
            onClick
        } = opts;

        const btnClass = [
            'btn',
            `btn-${variant}`,
            `btn-${size}`,
            loading && 'btn-loading',
            className
        ].filter(Boolean).join(' ');

        const btn = h('button', {
            class: btnClass,
            type,
            disabled: disabled || loading,
            title,
            dataset
        });

        if (loading) {
            btn.appendChild(h('span', { class: 'btn-spinner' }, '⟳'));
        }
        if (icon) {
            btn.appendChild(h('span', { class: 'btn-icon' }, icon));
        }
        btn.appendChild(h('span', { class: 'btn-label' }, label));
        if (iconAfter) {
            btn.appendChild(h('span', { class: 'btn-icon btn-icon-after' }, iconAfter));
        }

        if (onClick) {
            btn.addEventListener('click', onClick);
        }

        return btn;
    }

    /**
     * Set the loading state on a button.
     * @param {HTMLElement} btn
     * @param {boolean}     loading
     */
    static setLoading(btn, loading) {
        btn.classList.toggle('btn-loading', loading);
        btn.disabled = loading;
        let spinner = btn.querySelector('.btn-spinner');
        if (loading && !spinner) {
            spinner = h('span', { class: 'btn-spinner' }, '⟳');
            btn.insertBefore(spinner, btn.firstChild);
        } else if (!loading && spinner) {
            spinner.remove();
        }
    }

    /**
     * Create a button group.
     * @param {HTMLElement[]} buttons — array of button elements
     * @param {object} [opts]
     * @param {string} [opts.className]
     * @returns {HTMLElement}
     */
    static group(buttons, opts = {}) {
        const group = h('div', { class: `btn-group ${opts.className || ''}`.trim() });
        buttons.forEach(btn => group.appendChild(btn));
        return group;
    }
}
