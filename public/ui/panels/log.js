/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Log Panel
   ═══════════════════════════════════════════════════════════════════
   System log with drillable entries. Shows infrastructure events
   (connection, config, context, errors) with type filtering and
   inline expand for long messages.

   Features:
     - DrillItem-based entries with inline expand
     - Type filter chips (All / Info / Warnings / Errors)
     - Auto-scroll toggle
     - Max 500 entries (FIFO)
     - Timestamped, type-colored entries

   Dependencies: engine.js, drill-item.js
   ═══════════════════════════════════════════════════════════════════ */

import { OverlordUI, h } from '../engine.js';
import { PanelComponent } from '../components/panel.js';
import { DrillItem } from '../components/drill-item.js';

const LOG_TYPE_ICONS = {
    info:    '\u2139\uFE0F',
    success: '\u2705',
    warning: '\u26A0\uFE0F',
    error:   '\u274C',
    debug:   '\uD83D\uDD0D'
};

const LOG_MAX_ENTRIES = 500;

const FILTER_TABS = [
    { id: 'all',      label: 'All' },
    { id: 'info',     label: 'Info' },
    { id: 'warnings', label: 'Warn' },
    { id: 'errors',   label: 'Errors' }
];

function matchesFilter(type, filter) {
    if (filter === 'all') return true;
    if (filter === 'info') return type === 'info' || type === 'success' || type === 'debug';
    if (filter === 'warnings') return type === 'warning';
    if (filter === 'errors') return type === 'error';
    return true;
}


export class LogPanel extends PanelComponent {

    constructor(el, opts = {}) {
        super(el, opts);
        this._contentEl = null;
        this._entries = [];
        this._autoScroll = true;
        this._filter = 'all';
    }

    mount() {
        super.mount();
        this._contentEl = this.$('#log') || this.$('.panel-content');

        // Build filter bar
        this._buildFilterBar();

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

    _buildFilterBar() {
        if (!this._contentEl) return;
        const parent = this._contentEl.parentElement;
        if (!parent || parent.querySelector('.activity-filter-bar')) return;

        const bar = h('div', { class: 'activity-filter-bar' });
        for (const tab of FILTER_TABS) {
            const chip = h('button', {
                class: `activity-filter-chip${tab.id === this._filter ? ' active' : ''}`,
                'data-filter': tab.id
            }, tab.label);
            chip.addEventListener('click', () => {
                this._filter = tab.id;
                bar.querySelectorAll('.activity-filter-chip').forEach(c =>
                    c.classList.toggle('active', c.dataset.filter === tab.id)
                );
                this.render();
            });
            bar.appendChild(chip);
        }
        parent.insertBefore(bar, this._contentEl);
    }

    render() {
        if (!this._contentEl) return;

        const filtered = this._entries.filter(e => matchesFilter(e.type, this._filter));

        if (!filtered.length) {
            OverlordUI.setContent(this._contentEl, h('div', {
                style: 'padding:12px;text-align:center;color:var(--text-muted);font-size:11px;'
            }, 'No log entries yet'));
            return;
        }

        const frag = document.createDocumentFragment();
        for (const entry of filtered) {
            frag.appendChild(this._buildDrillEntry(entry));
        }

        this._contentEl.textContent = '';
        this._contentEl.appendChild(frag);

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
            }),
            ts: Date.now()
        };

        this._entries.push(entry);
        if (this._entries.length > LOG_MAX_ENTRIES) {
            this._entries.shift();
        }

        this.render();
    }

    _buildDrillEntry(entry) {
        const icon = LOG_TYPE_ICONS[entry.type] || LOG_TYPE_ICONS.info;
        const firstLine = (entry.message || '').split('\n')[0].substring(0, 120);
        const isMultiLine = (entry.message || '').includes('\n') || (entry.message || '').length > 120;

        return DrillItem.create('log', entry, {
            icon,
            summary: () => firstLine,
            meta: () => entry.time,
            detail: isMultiLine ? [
                { label: 'Full Message', value: () => entry.message }
            ] : [],
            badge: entry.type !== 'info' ? () => ({ text: entry.type, color: entry.type === 'error' ? '#ef4444' : entry.type === 'warning' ? '#eab308' : entry.type === 'success' ? '#10b981' : null }) : null
        });
    }
}
