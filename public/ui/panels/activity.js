/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Activity Feed Panel (Execution Timeline)
   ═══════════════════════════════════════════════════════════════════
   Rich execution feed showing all agent activity: tool calls,
   thinking, QA suggestions, errors — with full drill-down detail.

   Features:
     - DrillItem-based entries with inline expand + bottom sheet
     - Type-based icons and color-coded left borders
     - Filter tabs (All / Tools / Thinking / Errors)
     - Max 100 items (FIFO)
     - Rich detail: input, output, duration, tier, agent

   Dependencies: engine.js, drill-item.js
   ═══════════════════════════════════════════════════════════════════ */

import { OverlordUI, h } from '../engine.js';
import { PanelComponent } from '../components/panel.js';
import { DrillItem } from '../components/drill-item.js';

const MAX_ITEMS = 100;

const TYPE_ICONS = {
    tool_start:           '\u2699',    // gear
    tool_complete:        '\u2713',    // checkmark
    tool_error:           '\u2717',    // x
    agent_thinking_start: '\uD83E\uDDE0', // brain
    agent_thinking:       '\uD83D\uDCAD', // thought
    agent_thinking_done:  '\u2713',
    qa_suggested:         '\uD83D\uDCCB', // clipboard
    context_recovery:     '\u26A0',    // warning
    issue_created:        '\uD83D\uDD17', // link
    milestone_launched:   '\uD83D\uDE80', // rocket
    milestone_merged:     '\u2714',
    info:                 '\u2139',
    success:              '\u2713',
    warning:              '\u26A0',
    error:                '\u2717'
};

const TYPE_LABELS = {
    tool_start:           'Tool Started',
    tool_complete:        'Tool Done',
    tool_error:           'Tool Error',
    agent_thinking_start: 'Thinking',
    agent_thinking:       'Thinking',
    agent_thinking_done:  'Done Thinking',
    qa_suggested:         'QA Suggestion',
    context_recovery:     'Context Recovery',
    issue_created:        'Issue Created',
    milestone_launched:   'Milestone Launched',
    milestone_merged:     'Milestone Merged'
};

const FILTER_TABS = [
    { id: 'all',      label: 'All' },
    { id: 'tools',    label: 'Tools' },
    { id: 'thinking', label: 'Thinking' },
    { id: 'errors',   label: 'Errors' }
];

function matchesFilter(type, filter) {
    if (filter === 'all') return true;
    if (filter === 'tools') return type === 'tool_start' || type === 'tool_complete' || type === 'tool_error';
    if (filter === 'thinking') return type === 'agent_thinking_start' || type === 'agent_thinking' || type === 'agent_thinking_done';
    if (filter === 'errors') return type === 'tool_error' || type === 'error';
    return true;
}


export class ActivityPanel extends PanelComponent {

    constructor(el, opts = {}) {
        super(el, opts);
        this._feedEl = null;
        this._filter = 'all';
        this._items = [];
    }

    mount() {
        super.mount();
        this._feedEl = this.$('.activity-feed') || this.$('.panel-content');

        // Build filter bar
        this._buildFilterBar();

        // Subscribe to activity items
        if (OverlordUI._store) {
            this.subscribe(OverlordUI._store, 'activity.items', (items) => {
                this._items = items || [];
                this.render(this._items);
            });
        }

        // Clear button
        this.on('click', '.activity-clear-btn', () => {
            if (OverlordUI._store) {
                OverlordUI._store.set('activity.items', []);
            }
        });
    }

    _buildFilterBar() {
        if (!this._feedEl) return;
        const parent = this._feedEl.parentElement;
        if (!parent) return;

        // Check if filter bar already exists
        if (parent.querySelector('.activity-filter-bar')) return;

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
                this.render(this._items);
            });
            bar.appendChild(chip);
        }
        parent.insertBefore(bar, this._feedEl);
    }

    render(items) {
        if (!this._feedEl) return;
        this._items = items || this._items;

        const filtered = this._items.filter(item => matchesFilter(item.type || 'info', this._filter));

        if (!filtered.length) {
            OverlordUI.setContent(this._feedEl, h('div', {
                style: 'padding:12px;text-align:center;color:var(--text-muted);font-size:11px;'
            }, this._filter === 'all' ? 'No activity yet' : `No ${this._filter} events`));
            return;
        }

        const frag = document.createDocumentFragment();
        for (const item of filtered) {
            frag.appendChild(this._buildDrillItem(item));
        }

        this._feedEl.textContent = '';
        this._feedEl.appendChild(frag);

        // Scroll to top (newest first)
        this._feedEl.scrollTop = 0;
    }

    _buildDrillItem(item) {
        const type = item.type || 'info';
        const icon = TYPE_ICONS[type] || '\u2022';

        // Format timestamp
        const ts = item.ts || item.time || item.timestamp;
        const timeStr = ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

        // Build summary text
        let summaryText = '';
        if (item.agent) summaryText += item.agent + ' ';
        if (item.tool) summaryText += item.tool;
        else if (TYPE_LABELS[type]) summaryText += TYPE_LABELS[type];
        else if (item.message || item.text) summaryText += (item.message || item.text);

        // Duration for completed tools
        let metaText = timeStr;
        if (item.durationMs && item.durationMs > 0) {
            const dur = item.durationMs < 1000 ? `${item.durationMs}ms` : `${(item.durationMs / 1000).toFixed(1)}s`;
            metaText = dur + '  ' + timeStr;
        } else if (item.duration && item.duration > 0) {
            const dur = item.duration < 1000 ? `${item.duration}ms` : `${(item.duration / 1000).toFixed(1)}s`;
            metaText = dur + '  ' + timeStr;
        }

        // Badge
        let badge = null;
        if (item.tier) {
            const tierColors = { 1: '#22c55e', 2: '#06b6d4', 3: '#f7931e', 4: '#ef4444' };
            badge = { text: `T${item.tier}`, color: tierColors[item.tier] || '#6b7280' };
        } else if (type === 'tool_error' || type === 'error') {
            badge = { text: 'ERR', color: '#ef4444' };
        } else if (item.success === true) {
            badge = { text: 'OK', color: '#10b981' };
        } else if (item.success === false) {
            badge = { text: 'FAIL', color: '#ef4444' };
        }

        // Detail fields
        const detail = [];
        if (item.agent) detail.push({ label: 'Agent', key: 'agent' });
        if (item.tool) detail.push({ label: 'Tool', key: 'tool' });
        if (item.inputSummary) detail.push({ label: 'Input', key: 'inputSummary' });
        if (item.message || item.text) detail.push({ label: 'Message', value: () => item.message || item.text });
        if (item.durationMs) detail.push({ label: 'Duration', key: 'durationMs', format: 'duration' });
        if (item.duration) detail.push({ label: 'Duration', key: 'duration', format: 'duration' });
        if (item.output) detail.push({ label: 'Output', value: () => typeof item.output === 'string' ? item.output.substring(0, 500) : JSON.stringify(item.output, null, 2).substring(0, 500) });
        if (item.file) detail.push({ label: 'File', key: 'file' });
        if (item.task) detail.push({ label: 'Task', key: 'task' });
        if (item.tier) detail.push({ label: 'Tier', value: () => `T${item.tier}` });
        if (item.toolId) detail.push({ label: 'Tool ID', key: 'toolId' });

        const el = DrillItem.create('activity', item, {
            icon,
            summary: () => summaryText,
            badge: () => badge,
            meta: () => metaText,
            detail
        });

        // Add type class for CSS border coloring
        el.classList.add(type);

        return el;
    }
}
