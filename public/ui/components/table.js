/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Table Component
   ═══════════════════════════════════════════════════════════════════
   Styled table renderer. Hooks into marked.js to automatically
   style markdown tables.

   Fixes the missing table borders:
     Every table rendered through the engine gets proper borders,
     padding, header highlighting, and alternating row stripes.

   Dependencies: engine.js (h)
   ═══════════════════════════════════════════════════════════════════ */

import { h } from '../engine.js';


export class Table {

    /**
     * Create a styled table from data.
     *
     * @param {object[]}  data     — array of row objects
     * @param {object[]}  columns  — [{ key, label, align?, width? }]
     * @param {object}    [opts]
     * @param {boolean}   [opts.striped=true]    — alternating row colors
     * @param {boolean}   [opts.hoverable=true]  — highlight rows on hover
     * @param {boolean}   [opts.compact=false]   — reduced padding
     * @param {string}    [opts.className]       — additional CSS class
     * @returns {HTMLElement}
     */
    static render(data, columns, opts = {}) {
        const { striped = true, hoverable = true, compact = false, className = '' } = opts;

        const tableClass = [
            'overlord-table',
            striped && 'table-striped',
            hoverable && 'table-hoverable',
            compact && 'table-compact',
            className
        ].filter(Boolean).join(' ');

        const table = h('table', { class: tableClass });

        // Header
        const thead = h('thead');
        const headerRow = h('tr');
        for (const col of columns) {
            const th = h('th', {
                style: {
                    textAlign: col.align || 'left',
                    width: col.width || 'auto'
                }
            }, col.label || col.key);
            headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Body
        const tbody = h('tbody');
        for (const row of data) {
            const tr = h('tr');
            for (const col of columns) {
                const td = h('td', {
                    style: { textAlign: col.align || 'left' }
                });
                const value = row[col.key];
                if (value instanceof Node) {
                    td.appendChild(value);
                } else {
                    td.textContent = value != null ? String(value) : '';
                }
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        // Wrap in scrollable container
        const wrapper = h('div', { class: 'table-wrapper' });
        wrapper.appendChild(table);
        return wrapper;
    }

    /**
     * Post-process an element to style all markdown tables within it.
     * Call this after marked.js renders HTML to add Overlord table styles.
     *
     * @param {HTMLElement} el — container element with rendered markdown
     */
    static styleMarkdownTables(el) {
        if (!el) return;
        el.querySelectorAll('table').forEach(table => {
            // Don't re-process already-styled tables
            if (table.classList.contains('overlord-table')) return;

            table.classList.add('overlord-table', 'table-striped', 'table-hoverable');

            // Wrap in scrollable container if not already wrapped
            if (!table.parentElement?.classList.contains('table-wrapper')) {
                const wrapper = document.createElement('div');
                wrapper.className = 'table-wrapper';
                table.parentNode.insertBefore(wrapper, table);
                wrapper.appendChild(table);
            }
        });
    }

    /**
     * Configure marked.js to auto-style tables.
     * Call once during initialization.
     *
     * @param {object} marked — the marked.js instance
     */
    static configureMarked(marked) {
        if (!marked || !marked.use) return;

        const renderer = {
            table(header, body) {
                return '<div class="table-wrapper">' +
                    '<table class="overlord-table table-striped table-hoverable">' +
                    '<thead>' + header + '</thead>' +
                    '<tbody>' + body + '</tbody>' +
                    '</table></div>';
            }
        };

        marked.use({ renderer });
    }
}
