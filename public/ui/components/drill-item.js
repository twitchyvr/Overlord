/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — DrillItem Component
   ═══════════════════════════════════════════════════════════════════
   Generic drillable list item. Every panel uses this to render
   expandable, detail-rich list entries.

   Usage:
     DrillItem.create('task', taskObj, {
         summary: (d) => 'My task title',
         badge:   (d) => ({ text: 'done', color: '#10b981' }),
         icon:    (d) => '✅',
         detail:  [
             { label: 'Description', key: 'description' },
             { label: 'Created', key: 'created', format: 'date' },
         ],
         actions: (d) => [
             { label: 'Edit', onClick: () => ... },
             { label: 'Delete', onClick: () => ..., variant: 'danger' },
         ],
         sheet:   (d) => customDOMElement  // optional override for bottom sheet content
     })

   Behaviors:
     - Click → inline expand (accordion within parent container)
     - Long-press (500ms) or ⋯ button → bottom sheet (mobile) / center modal (desktop)
     - data-drill-type / data-drill-id attributes for external targeting

   Dependencies: engine.js (h), modal.js (Modal)
   ═══════════════════════════════════════════════════════════════════ */

import { h } from '../engine.js';
import { Modal } from './modal.js';

const LONG_PRESS_MS = 500;

export class DrillItem {

    /**
     * Create a drillable list item element.
     * @param {string} type   — semantic type (task, activity, log, kpi, etc.)
     * @param {object} data   — the raw data object
     * @param {object} config — rendering config
     * @returns {HTMLElement}
     */
    static create(type, data, config) {
        const id = data.id || data.toolId || data.ts || Math.random().toString(36).slice(2);

        const el = h('div', {
            class: 'drill-item',
            'data-drill-type': type,
            'data-drill-id': String(id),
            'data-expanded': '0'
        });

        // ── Summary row (always visible) ────────────────────────────
        const summaryRow = h('div', { class: 'drill-summary' });

        // Icon
        if (config.icon) {
            const iconText = typeof config.icon === 'function' ? config.icon(data) : config.icon;
            if (iconText) summaryRow.appendChild(h('span', { class: 'drill-icon' }, iconText));
        }

        // Main summary text
        const summaryText = typeof config.summary === 'function' ? config.summary(data) : String(config.summary || '');
        summaryRow.appendChild(h('span', { class: 'drill-summary-text' }, summaryText));

        // Badge
        if (config.badge) {
            const badgeData = typeof config.badge === 'function' ? config.badge(data) : config.badge;
            if (badgeData) {
                const badgeText = typeof badgeData === 'string' ? badgeData : badgeData.text;
                const badgeColor = typeof badgeData === 'object' ? badgeData.color : null;
                const badgeEl = h('span', { class: 'drill-badge' }, badgeText || '');
                if (badgeColor) badgeEl.style.color = badgeColor;
                summaryRow.appendChild(badgeEl);
            }
        }

        // Right side: meta + more button
        if (config.meta) {
            const metaText = typeof config.meta === 'function' ? config.meta(data) : config.meta;
            if (metaText) summaryRow.appendChild(h('span', { class: 'drill-meta' }, metaText));
        }

        // ⋯ button for bottom sheet
        const moreBtn = h('button', {
            class: 'drill-more-btn',
            title: 'View details',
            'aria-label': 'View details'
        }, '\u22EF');
        moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            DrillItem._openSheet(type, data, config);
        });
        summaryRow.appendChild(moreBtn);

        el.appendChild(summaryRow);

        // ── Detail panel (hidden by default) ────────────────────────
        const detailPanel = h('div', { class: 'drill-detail' });
        DrillItem._buildDetailContent(detailPanel, data, config);
        el.appendChild(detailPanel);

        // ── Click → toggle inline expand ────────────────────────────
        summaryRow.addEventListener('click', (e) => {
            if (e.target.closest('.drill-more-btn') || e.target.closest('button') || e.target.closest('input')) return;
            const isExpanded = el.getAttribute('data-expanded') === '1';

            // Accordion: collapse siblings
            const parent = el.parentElement;
            if (parent && !isExpanded) {
                parent.querySelectorAll('.drill-item[data-expanded="1"]').forEach(sib => {
                    if (sib !== el) {
                        sib.setAttribute('data-expanded', '0');
                        const sibDetail = sib.querySelector('.drill-detail');
                        if (sibDetail) sibDetail.style.maxHeight = '0';
                    }
                });
            }

            el.setAttribute('data-expanded', isExpanded ? '0' : '1');
            if (!isExpanded) {
                detailPanel.style.maxHeight = detailPanel.scrollHeight + 'px';
            } else {
                detailPanel.style.maxHeight = '0';
            }
        });

        // ── Long-press → open bottom sheet ──────────────────────────
        let pressTimer = null;
        summaryRow.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button') || e.target.closest('input')) return;
            pressTimer = setTimeout(() => {
                DrillItem._openSheet(type, data, config);
                pressTimer = null;
            }, LONG_PRESS_MS);
        });
        summaryRow.addEventListener('pointerup', () => { clearTimeout(pressTimer); });
        summaryRow.addEventListener('pointerleave', () => { clearTimeout(pressTimer); });
        summaryRow.addEventListener('pointercancel', () => { clearTimeout(pressTimer); });

        return el;
    }

    /**
     * Build detail content into a container element.
     */
    static _buildDetailContent(container, data, config) {
        // Detail fields
        if (config.detail && Array.isArray(config.detail)) {
            for (const field of config.detail) {
                const value = typeof field.value === 'function' ? field.value(data) : data[field.key];
                if (value == null || value === '') continue;

                const row = h('div', { class: 'drill-detail-row' });
                row.appendChild(h('span', { class: 'drill-detail-label' }, field.label));

                let displayValue = value;
                if (field.format === 'date' && value) {
                    const d = new Date(value);
                    displayValue = isNaN(d) ? String(value) : d.toLocaleDateString();
                } else if (field.format === 'duration' && typeof value === 'number') {
                    displayValue = value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`;
                } else if (field.format === 'json' && typeof value === 'object') {
                    displayValue = JSON.stringify(value, null, 2);
                }

                if (typeof displayValue === 'object' && displayValue instanceof HTMLElement) {
                    row.appendChild(displayValue);
                } else {
                    row.appendChild(h('span', { class: 'drill-detail-value' }, String(displayValue)));
                }

                container.appendChild(row);
            }
        }

        // Custom detail renderer
        if (typeof config.detailRender === 'function') {
            const custom = config.detailRender(data);
            if (custom instanceof HTMLElement) container.appendChild(custom);
        }

        // Action buttons
        if (config.actions) {
            const actions = typeof config.actions === 'function' ? config.actions(data) : config.actions;
            if (actions && actions.length > 0) {
                const actionRow = h('div', { class: 'drill-actions' });
                for (const action of actions) {
                    const btn = h('button', {
                        class: `drill-action-btn${action.variant === 'danger' ? ' danger' : ''}`,
                        title: action.label
                    }, action.label);
                    if (action.onClick) btn.addEventListener('click', (e) => { e.stopPropagation(); action.onClick(data); });
                    actionRow.appendChild(btn);
                }
                container.appendChild(actionRow);
            }
        }
    }

    /**
     * Open a bottom sheet (mobile) or center modal (desktop) with full detail.
     */
    static _openSheet(type, data, config) {
        const modalId = `drill-sheet-${type}-${data.id || data.ts || 'x'}`;

        const content = h('div', { class: 'drill-sheet-content' });

        // Full detail
        DrillItem._buildDetailContent(content, data, {
            ...config,
            // In sheet mode, show ALL fields (no truncation)
            detail: config.sheetDetail || config.detail
        });

        // Custom sheet content
        if (typeof config.sheet === 'function') {
            const custom = config.sheet(data);
            if (custom instanceof HTMLElement) content.appendChild(custom);
        }

        const title = typeof config.summary === 'function' ? config.summary(data) : String(config.summary || type);
        const isMobile = window.innerWidth < 768;

        Modal.open(modalId, {
            title,
            content,
            size: isMobile ? 'full' : 'md',
            position: isMobile ? 'bottom-sheet' : 'center'
        });
    }
}
