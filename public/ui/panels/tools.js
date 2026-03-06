/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Tools Panel
   ═══════════════════════════════════════════════════════════════════
   Extracted from monolith: createToolChipEl(), renderToolResults(),
   updateToolChip()

   Features:
     - Tool execution entries (name, timing, status)
     - Success/error visual states
     - Tool output display (expandable)
     - Tool inspector drawer integration

   Dependencies: engine.js
   ═══════════════════════════════════════════════════════════════════ */

import { OverlordUI, h } from '../engine.js';
import { PanelComponent } from '../components/panel.js';


export class ToolsPanel extends PanelComponent {

    constructor(el, opts = {}) {
        super(el, opts);
        this._contentEl = null;
        this._tools = [];
    }

    mount() {
        super.mount();
        this._contentEl = this.$('#tools') || this.$('.panel-content');

        // Listen for tool results via engine events
        const unsub = OverlordUI.subscribe('tool_result', (data) => {
            this._addToolEntry(data);
        });
        this._subs.push(unsub);

        // Tool entry click → open inspector
        this.on('click', '.tool-entry', (e, el) => {
            const toolId = el.dataset.toolId;
            if (toolId) {
                OverlordUI.dispatch('open_tool_inspector', { toolId });
            }
        });
    }

    render() {
        if (!this._contentEl) return;

        if (!this._tools.length) {
            OverlordUI.setContent(this._contentEl, h('div', {
                style: 'padding:12px;text-align:center;color:var(--text-muted);font-size:11px;'
            }, 'No tools executed yet'));
            return;
        }

        const frag = document.createDocumentFragment();
        for (const tool of this._tools) {
            frag.appendChild(this._buildToolEntry(tool));
        }

        this._contentEl.textContent = '';
        this._contentEl.appendChild(frag);
    }

    _addToolEntry(data) {
        this._tools.unshift(data);
        if (this._tools.length > 100) this._tools.pop();
        this.render();
    }

    _buildToolEntry(tool) {
        const status = tool.error ? 'error' : (tool.success !== false ? 'success' : '');
        const entry = h('div', {
            class: `tool-entry ${status}`.trim(),
            'data-tool-id': tool.id || tool.toolId
        });

        const header = h('div', { class: 'tool-header' },
            h('span', { class: 'tool-name' }, tool.name || tool.tool || 'Tool'),
            tool.time ? h('span', { class: 'tool-time' }, tool.time) : null
        );
        entry.appendChild(header);

        // Output preview (truncated)
        if (tool.output || tool.result) {
            const output = String(tool.output || tool.result);
            const preview = output.length > 200 ? output.slice(0, 200) + '…' : output;
            entry.appendChild(h('div', { class: 'tool-output' }, preview));
        }

        return entry;
    }
}
