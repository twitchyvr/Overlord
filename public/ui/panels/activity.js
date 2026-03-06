/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Activity Feed Panel
   ═══════════════════════════════════════════════════════════════════
   Displays real-time agent activity events: task starts, tool
   calls, message routing, errors, etc.

   Features:
     - Auto-scrolling activity feed
     - Type-colored entries (info, success, warning, error, tool, task)
     - Clear button
     - Max 50 items (FIFO)

   Dependencies: engine.js
   ═══════════════════════════════════════════════════════════════════ */

import { OverlordUI, h } from '../engine.js';
import { PanelComponent } from '../components/panel.js';


export class ActivityPanel extends PanelComponent {

    constructor(el, opts = {}) {
        super(el, opts);
        this._feedEl = null;
    }

    mount() {
        super.mount();
        this._feedEl = this.$('.activity-feed') || this.$('.panel-content');

        // Subscribe to activity items
        if (OverlordUI._store) {
            this.subscribe(OverlordUI._store, 'activity.items', (items) => {
                this.render(items);
            });
        }

        // Clear button
        this.on('click', '.activity-clear-btn', () => {
            if (OverlordUI._store) {
                OverlordUI._store.set('activity.items', []);
            }
        });
    }

    render(items) {
        if (!this._feedEl) return;
        items = items || [];

        if (!items.length) {
            OverlordUI.setContent(this._feedEl, h('div', {
                style: 'padding:12px;text-align:center;color:var(--text-muted);font-size:11px;'
            }, 'No activity yet'));
            return;
        }

        const frag = document.createDocumentFragment();
        for (const item of items) {
            frag.appendChild(this._buildActivityItem(item));
        }

        this._feedEl.textContent = '';
        this._feedEl.appendChild(frag);

        // Auto-scroll to latest
        this._feedEl.scrollTop = 0;
    }

    _buildActivityItem(item) {
        const type = item.type || 'info';
        const el = h('div', {
            class: `activity-item activity-${type}`,
            'data-activity-type': type
        });

        // Timestamp
        if (item.time || item.timestamp) {
            const time = new Date(item.time || item.timestamp);
            el.appendChild(h('span', { class: 'activity-time' },
                time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            ));
        }

        // Agent name
        if (item.agent) {
            el.appendChild(h('span', { class: 'activity-agent' }, item.agent));
        }

        // Message
        el.appendChild(h('span', { class: 'activity-msg' }, item.message || item.text || ''));

        return el;
    }
}
