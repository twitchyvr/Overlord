/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Log Panel
   ═══════════════════════════════════════════════════════════════════
   Extracted from monolith: log() function, log entry rendering.

   Features:
     - Typed log entries (info, success, warning, error, debug)
     - Auto-scroll to latest entry
     - Clear log button
     - Max entries cap (500)
     - Timestamped entries

   Dependencies: engine.js
   ═══════════════════════════════════════════════════════════════════ */

import { OverlordUI, h } from '../engine.js';
import { PanelComponent } from '../components/panel.js';


const LOG_TYPE_ICONS = {
    info:    'ℹ️',
    success: '✅',
    warning: '⚠️',
    error:   '❌',
    debug:   '🔍'
};

const LOG_MAX_ENTRIES = 500;


export class LogPanel extends PanelComponent {

    constructor(el, opts = {}) {
        super(el, opts);
        this._contentEl = null;
        this._entries = [];
        this._autoScroll = true;
    }

    mount() {
        super.mount();
        this._contentEl = this.$('#log') || this.$('.panel-content');

        // Listen for log events
        const unsub = OverlordUI.subscribe('log', (entry) => {
            this._addEntry(entry);
        });
        this._subs.push(unsub);

        // Clear button handler
        this.on('click', '[data-action="clear-log"]', () => {
            this._entries = [];
            this.render();
        });

        // Toggle auto-scroll
        this.on('click', '[data-action="toggle-autoscroll"]', (e, el) => {
            this._autoScroll = !this._autoScroll;
            el.classList.toggle('active', this._autoScroll);
        });

        this.render();
    }

    render() {
        if (!this._contentEl) return;

        if (!this._entries.length) {
            OverlordUI.setContent(this._contentEl, h('div', {
                style: 'padding:12px;text-align:center;color:var(--text-muted);font-size:11px;'
            }, 'No log entries yet'));
            return;
        }

        const wrapper = h('div', { class: 'log-entries' });

        for (const entry of this._entries) {
            wrapper.appendChild(this._buildEntry(entry));
        }

        this._contentEl.textContent = '';
        this._contentEl.appendChild(wrapper);

        // Auto-scroll to bottom
        if (this._autoScroll) {
            requestAnimationFrame(() => {
                this._contentEl.scrollTop = this._contentEl.scrollHeight;
            });
        }
    }

    _addEntry(data) {
        const entry = {
            message: typeof data === 'string' ? data : (data.message || String(data)),
            type: (data && data.type) || 'info',
            time: new Date().toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            })
        };

        this._entries.push(entry);
        if (this._entries.length > LOG_MAX_ENTRIES) {
            this._entries.shift();
        }

        this.render();
    }

    _buildEntry(entry) {
        const icon = LOG_TYPE_ICONS[entry.type] || LOG_TYPE_ICONS.info;

        return h('div', { class: `log-entry log-${entry.type}` },
            h('span', { class: 'log-time' }, entry.time),
            h('span', { class: 'log-icon' }, icon),
            h('span', { class: 'log-message' }, entry.message)
        );
    }
}
