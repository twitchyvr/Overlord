/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Modal Component
   ═══════════════════════════════════════════════════════════════════
   Unified overlay/modal manager. Replaces 15+ bespoke overlay
   implementations with consistent z-stacking, backdrop, escape key,
   click-outside, and body scroll lock.

   Positions: center (default), bottom-sheet (mobile),
              drawer-right (tool inspector), fullscreen

   Dependencies: engine.js (OverlordUI, h)
   ═══════════════════════════════════════════════════════════════════ */

import { OverlordUI, h } from '../engine.js';

// ── Modal stack (manages z-index ordering) ───────────────────────
const _stack = [];             // active modals in open order
const BASE_Z = 1000;           // starting z-index
let _modalRoot = null;         // shared container element

/**
 * Get or create the modal root container.
 * @returns {HTMLElement}
 */
function getRoot() {
    if (!_modalRoot) {
        _modalRoot = document.getElementById('modal-root');
        if (!_modalRoot) {
            _modalRoot = h('div', { id: 'modal-root' });
            document.body.appendChild(_modalRoot);
        }
    }
    return _modalRoot;
}


// ══════════════════════════════════════════════════════════════════
//  Modal Class
// ══════════════════════════════════════════════════════════════════

export class Modal {

    /**
     * Open a modal.
     * @param {string}  id      — unique modal identifier
     * @param {object}  options
     * @param {string|Node} options.content        — modal body (DOM node or trusted HTML string)
     * @param {string}      [options.title]         — header title
     * @param {string}      [options.size='md']     — 'sm' | 'md' | 'lg' | 'xl' | 'full'
     * @param {string}      [options.position='center'] — 'center' | 'bottom-sheet' | 'drawer-right' | 'fullscreen'
     * @param {boolean}     [options.closeOnBackdrop=true]
     * @param {boolean}     [options.closeOnEscape=true]
     * @param {string}      [options.className]     — additional CSS class for the modal
     * @param {Function}    [options.onClose]        — callback when modal closes
     * @param {Function}    [options.onOpen]         — callback after modal opens
     * @returns {HTMLElement} the modal wrapper element
     */
    static open(id, options = {}) {
        const {
            content,
            title,
            size       = 'md',
            position   = 'center',
            closeOnBackdrop = true,
            closeOnEscape   = true,
            className  = '',
            onClose,
            onOpen
        } = options;

        // If already open, focus it
        const existing = _stack.find(m => m.id === id);
        if (existing) {
            existing.el.focus();
            return existing.el;
        }

        const zIndex = BASE_Z + (_stack.length * 10);

        // Build modal structure
        const backdrop = h('div', {
            class: `modal-backdrop modal-pos-${position} ${className}`.trim(),
            'data-modal-id': id,
            style: { zIndex }
        });

        const dialog = h('div', {
            class: `modal-dialog modal-${size}`,
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': title ? `modal-title-${id}` : undefined,
            tabindex: '-1'
        });

        // Header (optional)
        if (title) {
            const header = h('div', { class: 'modal-header' },
                h('h3', { class: 'modal-title', id: `modal-title-${id}` }, title),
                h('button', {
                    class: 'modal-close',
                    'aria-label': 'Close',
                    onClick: () => Modal.close(id)
                }, '✕')
            );
            dialog.appendChild(header);
        }

        // Body
        const body = h('div', { class: 'modal-body' });
        if (content instanceof Node) {
            body.appendChild(content);
        } else if (typeof content === 'string') {
            OverlordUI.setTrustedContent(body, content);
        }
        dialog.appendChild(body);

        backdrop.appendChild(dialog);

        // Click-outside to close
        if (closeOnBackdrop) {
            backdrop.addEventListener('mousedown', (e) => {
                if (e.target === backdrop) Modal.close(id);
            });
        }

        // Escape key to close
        const escHandler = closeOnEscape ? (e) => {
            if (e.key === 'Escape') {
                // Only close the topmost modal
                const top = _stack[_stack.length - 1];
                if (top && top.id === id) {
                    e.preventDefault();
                    Modal.close(id);
                }
            }
        } : null;

        if (escHandler) {
            document.addEventListener('keydown', escHandler);
        }

        // Add to stack and DOM
        _stack.push({ id, el: backdrop, escHandler, onClose });
        getRoot().appendChild(backdrop);

        // Lock body scroll if first modal
        if (_stack.length === 1) {
            document.body.style.overflow = 'hidden';
        }

        // Focus the dialog
        requestAnimationFrame(() => {
            dialog.focus();
            if (onOpen) onOpen(backdrop, dialog);
        });

        return backdrop;
    }

    /**
     * Close a modal by id.
     * @param {string} id
     */
    static close(id) {
        const idx = _stack.findIndex(m => m.id === id);
        if (idx === -1) return;

        const modal = _stack[idx];

        // Remove escape handler
        if (modal.escHandler) {
            document.removeEventListener('keydown', modal.escHandler);
        }

        // Remove from DOM
        if (modal.el.parentNode) {
            modal.el.parentNode.removeChild(modal.el);
        }

        // Fire onClose callback
        if (modal.onClose) {
            try { modal.onClose(); } catch (e) { console.warn('[Modal] onClose error:', e); }
        }

        // Remove from stack
        _stack.splice(idx, 1);

        // Unlock body scroll if last modal
        if (_stack.length === 0) {
            document.body.style.overflow = '';
        }
    }

    /**
     * Close all open modals.
     */
    static closeAll() {
        // Close in reverse order (topmost first)
        while (_stack.length > 0) {
            Modal.close(_stack[_stack.length - 1].id);
        }
    }

    /**
     * Check if a modal is open.
     * @param {string} id
     * @returns {boolean}
     */
    static isOpen(id) {
        return _stack.some(m => m.id === id);
    }

    /**
     * Get the currently open modal count.
     * @returns {number}
     */
    static get count() {
        return _stack.length;
    }

    /**
     * Get the body element of an open modal (for dynamic content updates).
     * @param {string} id
     * @returns {HTMLElement|null}
     */
    static getBody(id) {
        const modal = _stack.find(m => m.id === id);
        if (!modal) return null;
        return modal.el.querySelector('.modal-body');
    }
}
