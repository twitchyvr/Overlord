/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Toast Notification System
   ═══════════════════════════════════════════════════════════════════
   Extracted from the monolith's toast system. Same API, modularized.

   Supports variants: info, success, warning, error, agent (aurora border)
   Auto-dismiss with configurable duration.
   Stacks from top-right (desktop) or top-center (mobile).

   Dependencies: engine.js (h)
   ═══════════════════════════════════════════════════════════════════ */

import { h } from '../engine.js';


// ── Container reference ──────────────────────────────────────────
let _container = null;

function getContainer() {
    if (!_container) {
        _container = document.getElementById('toast-container');
        if (!_container) {
            _container = h('div', { id: 'toast-container' });
            document.body.appendChild(_container);
        }
    }
    return _container;
}


export class Toast {

    /**
     * Show a toast notification.
     *
     * @param {string}  message  — text content
     * @param {object}  [opts]
     * @param {string}  [opts.type='info']    — 'info' | 'success' | 'warning' | 'error' | 'agent'
     * @param {number}  [opts.duration=4000]  — auto-dismiss ms (0 = no auto-dismiss)
     * @param {boolean} [opts.closable=true]  — show close button
     * @param {string}  [opts.title]          — optional title (for agent toasts)
     * @param {string}  [opts.preview]        — optional preview text (for agent toasts)
     * @param {string}  [opts.link]           — optional link text (for agent toasts)
     * @param {Function} [opts.onClick]       — click handler for the toast body
     * @returns {HTMLElement} the toast element
     */
    static show(message, opts = {}) {
        const {
            type     = 'info',
            duration = 4000,
            closable = true,
            title,
            preview,
            link,
            onClick
        } = opts;

        const container = getContainer();

        const toast = h('div', {
            class: `toast toast-${type}`,
            role: 'alert',
            'aria-live': 'polite'
        });

        // Agent toasts have a richer structure
        if (type === 'agent') {
            toast.classList.add('toast-agent');
            const row = h('div', { class: 'toast-agent-row' });
            if (title)   row.appendChild(h('div', { class: 'toast-agent-title' }, title));
            if (message) row.appendChild(h('div', { class: 'toast-agent-preview' }, message));
            if (preview) row.appendChild(h('div', { class: 'toast-agent-preview' }, preview));
            if (link)    row.appendChild(h('div', { class: 'toast-agent-link' }, link));
            toast.appendChild(row);
        } else {
            toast.appendChild(document.createTextNode(message));
        }

        // Close button
        if (closable) {
            const closeBtn = h('button', {
                class: 'toast-close',
                'aria-label': 'Dismiss'
            }, '✕');
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                Toast.dismiss(toast);
            });
            toast.appendChild(closeBtn);
        }

        // Click handler
        if (onClick) {
            toast.style.cursor = 'pointer';
            toast.addEventListener('click', () => onClick(toast));
        }

        container.appendChild(toast);

        // Auto-dismiss
        if (duration > 0) {
            toast._dismissTimer = setTimeout(() => Toast.dismiss(toast), duration);
        }

        return toast;
    }

    /**
     * Dismiss a toast (with exit animation).
     * @param {HTMLElement} toastEl
     */
    static dismiss(toastEl) {
        if (!toastEl || toastEl._dismissing) return;
        toastEl._dismissing = true;

        if (toastEl._dismissTimer) {
            clearTimeout(toastEl._dismissTimer);
        }

        // Trigger exit animation
        toastEl.style.animation = 'toast-out 0.3s ease forwards';
        setTimeout(() => {
            if (toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
        }, 300);
    }

    /**
     * Dismiss all active toasts.
     */
    static dismissAll() {
        const container = getContainer();
        [...container.children].forEach(child => Toast.dismiss(child));
    }

    // ── Convenience Methods ──────────────────────────────────────

    static info(msg, opts = {})    { return Toast.show(msg, { ...opts, type: 'info' }); }
    static success(msg, opts = {}) { return Toast.show(msg, { ...opts, type: 'success' }); }
    static warning(msg, opts = {}) { return Toast.show(msg, { ...opts, type: 'warning' }); }
    static error(msg, opts = {})   { return Toast.show(msg, { ...opts, type: 'error' }); }
    static agent(msg, opts = {})   { return Toast.show(msg, { ...opts, type: 'agent' }); }
}
