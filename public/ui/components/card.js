/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Card Component
   ═══════════════════════════════════════════════════════════════════
   Factory for standardized cards. Used by agent cards, task cards,
   recommendation cards, milestone cards, kanban cards.

   Variants: glass (default), solid, outlined
   Structure: .card > .card-header + .card-body + .card-footer + .card-actions

   Dependencies: engine.js (h)
   ═══════════════════════════════════════════════════════════════════ */

import { h } from '../engine.js';


export class Card {

    /**
     * Create a card element.
     *
     * @param {string} type — 'agent' | 'task' | 'recommendation' | 'milestone' | 'kanban' | 'generic'
     * @param {object} data — type-specific data
     * @param {object} [options]
     * @param {string} [options.variant='glass'] — 'glass' | 'solid' | 'outlined'
     * @param {string} [options.className]       — additional CSS class
     * @param {object} [options.actions]          — { label: handler } for action buttons
     * @returns {HTMLElement}
     */
    static create(type, data, options = {}) {
        const { variant = 'glass', className = '', actions = {} } = options;

        const card = h('div', {
            class: `card card-${type} card-${variant} ${className}`.trim(),
            'data-card-type': type
        });

        switch (type) {
            case 'agent':    Card._buildAgent(card, data);          break;
            case 'task':     Card._buildTask(card, data);           break;
            case 'recommendation': Card._buildRecommendation(card, data); break;
            case 'milestone': Card._buildMilestone(card, data);     break;
            case 'kanban':   Card._buildKanban(card, data);         break;
            default:         Card._buildGeneric(card, data);        break;
        }

        // Action buttons
        if (Object.keys(actions).length > 0) {
            const actionsEl = h('div', { class: 'card-actions' });
            for (const [label, handler] of Object.entries(actions)) {
                const btn = h('button', { class: 'card-action-btn' }, label);
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    handler(data, card);
                });
                actionsEl.appendChild(btn);
            }
            card.appendChild(actionsEl);
        }

        return card;
    }

    // ── Type-Specific Builders ───────────────────────────────────

    /** @private */
    static _buildAgent(card, data) {
        const header = h('div', { class: 'card-header' },
            h('div', { class: `agent-status-dot ${data.status || 'idle'}` }),
            h('span', { class: 'agent-card-name' }, data.name || 'Agent'),
            data.badge ? h('span', { class: 'agent-badge' }, data.badge) : null
        );
        card.appendChild(header);

        const body = h('div', { class: 'card-body' });
        if (data.role) body.appendChild(h('div', { class: 'agent-card-role' }, data.role));
        if (data.currentTask) body.appendChild(h('div', { class: 'agent-current-task' }, data.currentTask));
        if (data.capabilities && data.capabilities.length) {
            const caps = h('div', { class: 'agent-caps' });
            data.capabilities.forEach(c => caps.appendChild(h('span', { class: 'agent-cap' }, c)));
            body.appendChild(caps);
        }
        card.appendChild(body);

        // State classes
        if (data.status) card.classList.add(`agent-${data.status}`);
    }

    /** @private */
    static _buildTask(card, data) {
        const header = h('div', { class: 'card-header' },
            h('div', {
                class: `task-checkbox ${data.completed ? 'checked' : ''}`,
                'data-task-id': data.id
            }),
            h('span', { class: 'task-title' }, data.title || 'Untitled Task'),
            data.priority ? h('span', { class: `task-priority priority-${data.priority}` }, data.priority) : null,
            data.id ? h('span', { class: 'task-id' }, `#${data.id}`) : null
        );
        card.appendChild(header);

        if (data.description) {
            card.appendChild(h('div', { class: 'card-body task-description' }, data.description));
        }

        if (data.assignee || data.created) {
            const meta = h('div', { class: 'card-footer task-meta' });
            if (data.assignee) meta.appendChild(h('span', null, `👤 ${data.assignee}`));
            if (data.created) meta.appendChild(h('span', { class: 'task-created' }, data.created));
            card.appendChild(meta);
        }

        // State classes
        if (data.completed) card.classList.add('task-done');
        if (data.status) card.classList.add(`task-${data.status}`);
    }

    /** @private */
    static _buildRecommendation(card, data) {
        card.appendChild(h('div', { class: 'card-header rec-card-title' }, data.title || 'Recommendation'));
        if (data.description) {
            card.appendChild(h('div', { class: 'card-body' }, data.description));
        }
    }

    /** @private */
    static _buildMilestone(card, data) {
        const header = h('div', { class: 'card-header' },
            h('span', null, data.title || 'Milestone'),
            data.status ? h('span', { class: `ms-status-badge ms-${data.status}` }, data.status) : null
        );
        card.appendChild(header);
        if (data.description) {
            card.appendChild(h('div', { class: 'card-body' }, data.description));
        }
        if (data.progress !== undefined) {
            const bar = h('div', { class: 'card-footer' },
                h('div', { class: 'orch-gauge' },
                    h('div', {
                        class: 'orch-gauge-fill',
                        style: { width: `${data.progress}%`, background: 'var(--accent-cyan)' }
                    })
                )
            );
            card.appendChild(bar);
        }
    }

    /** @private */
    static _buildKanban(card, data) {
        card.appendChild(h('div', { class: 'card-header kb-title' }, data.title || 'Task'));
        if (data.assignee) {
            card.appendChild(h('div', { class: 'card-body' },
                h('span', { class: 'kb-chip' }, data.assignee)
            ));
        }
        if (data.priority) card.classList.add(`priority-${data.priority}`);
    }

    /** @private */
    static _buildGeneric(card, data) {
        if (data.title) {
            card.appendChild(h('div', { class: 'card-header' }, data.title));
        }
        if (data.body) {
            const body = h('div', { class: 'card-body' });
            if (data.body instanceof Node) body.appendChild(data.body);
            else body.textContent = data.body;
            card.appendChild(body);
        }
        if (data.footer) {
            card.appendChild(h('div', { class: 'card-footer' }, data.footer));
        }
    }
}
