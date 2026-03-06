/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Project / Roadmap Panel
   ═══════════════════════════════════════════════════════════════════
   Extracted from monolith: updateRoadmap(), renderDashboard(),
   renderDashStats()

   Features:
     - Roadmap milestone list with progress bars
     - Dashboard stats (completion, velocity)
     - Burndown chart section

   Dependencies: engine.js
   ═══════════════════════════════════════════════════════════════════ */

import { OverlordUI, h } from '../engine.js';
import { PanelComponent } from '../components/panel.js';


export class ProjectPanel extends PanelComponent {

    constructor(el, opts = {}) {
        super(el, opts);
        this._contentEl = null;
        this._items = [];
    }

    mount() {
        super.mount();
        this._contentEl = this.$('.panel-content') || this.$('#roadmap');

        // Subscribe to roadmap updates
        if (OverlordUI._store) {
            this.subscribe(OverlordUI._store, 'roadmap.items', (items) => {
                this._items = items || [];
                this.render(this._items);
            });
        }
    }

    render(items) {
        if (!this._contentEl) return;
        this._items = items || this._items;

        if (!this._items.length) {
            OverlordUI.setContent(this._contentEl, h('div', {
                style: 'padding:16px;text-align:center;color:var(--text-muted);font-size:12px;'
            }, 'No roadmap items'));
            return;
        }

        const frag = document.createDocumentFragment();

        // Dashboard stats
        frag.appendChild(this._buildStats());

        // Roadmap items
        for (const item of this._items) {
            frag.appendChild(this._buildRoadmapItem(item));
        }

        // Burndown section
        frag.appendChild(this._buildBurndownSection());

        this._contentEl.textContent = '';
        this._contentEl.appendChild(frag);
    }

    _buildStats() {
        const milestones = this._items.filter(i => i.type === 'milestone');
        const total = this._items.length;
        const completed = this._items.filter(i => i.status === 'done' || i.completed).length;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

        // Get task data from store for KPIs
        const tasks = OverlordUI._store?.peek('tasks.list', []) || [];
        const agents = OverlordUI._store?.peek('team.agents', []) || [];
        const tasksDone = tasks.filter(t => t.completed || t.status === 'completed' || t.status === 'done').length;
        const tasksActive = tasks.filter(t => t.status === 'in_progress' || t.status === 'working' || t.status === 'running').length;
        const tasksBlocked = tasks.filter(t => t.status === 'blocked' || t.status === 'skipped').length;
        const activeAgents = agents.filter(a => {
            const s = (a.status || '').toLowerCase();
            return s === 'active' || s === 'working' || s === 'thinking';
        }).length;

        const section = h('div', { style: 'padding:8px;' });

        // KPI Row
        const kpiRow = h('div', { id: 'dash-kpi-row', style: 'display:flex;gap:0;margin-bottom:10px;' });
        const kpis = [
            { label: 'Done', value: `${tasksDone}/${tasks.length}`, color: '#10b981' },
            { label: 'Active', value: String(tasksActive), color: '#6366f1' },
            { label: 'Agents', value: String(activeAgents), color: '#f59e0b' },
            { label: 'Blocked', value: String(tasksBlocked), color: '#ef4444' },
            { label: 'Milestones', value: String(milestones.length), color: '#3b82f6' }
        ];
        kpis.forEach((k, i) => {
            const card = h('div', {
                style: `flex:1;text-align:center;padding:6px 2px;${i < kpis.length - 1 ? 'border-right:1px solid var(--border);' : ''}`
            },
                h('div', { style: `font-size:16px;font-weight:800;color:${k.color};` }, k.value),
                h('div', { style: 'font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;' }, k.label)
            );
            kpiRow.appendChild(card);
        });
        section.appendChild(kpiRow);

        // Progress bar for active milestone
        const activeMilestone = milestones.find(m => m.status === 'active' && !m.done) || milestones.find(m => !m.done);
        if (activeMilestone) {
            const msSection = h('div', { style: 'padding:6px 0;border-top:1px solid var(--border);' });
            msSection.appendChild(h('div', { style: 'font-size:10px;font-weight:700;color:var(--text-muted);letter-spacing:0.05em;margin-bottom:4px;' }, 'ACTIVE MILESTONE'));
            msSection.appendChild(h('div', { style: 'font-size:12px;color:var(--electric);font-weight:600;' }, activeMilestone.title || activeMilestone.text || activeMilestone.name || 'Unnamed'));
            if (activeMilestone.progress !== undefined) {
                const bar = h('div', { class: 'orch-gauge', style: 'margin-top:4px;' },
                    h('div', {
                        class: 'orch-gauge-fill',
                        style: `width:${activeMilestone.progress}%;background:${activeMilestone.progress >= 100 ? 'var(--accent-green)' : 'var(--electric)'}`
                    })
                );
                msSection.appendChild(bar);
                msSection.appendChild(h('div', { style: 'font-size:9px;color:var(--text-muted);margin-top:2px;text-align:right;' }, `${activeMilestone.progress}%`));
            }
            section.appendChild(msSection);
        }

        // Overall completion
        section.appendChild(h('div', { style: 'padding:6px 0;border-top:1px solid var(--border);display:flex;gap:16px;' },
            h('div', { style: 'text-align:center;flex:1;' },
                h('div', { style: 'font-size:18px;font-weight:600;color:var(--accent-cyan);' }, `${pct}%`),
                h('div', { style: 'font-size:9px;color:var(--text-muted);' }, 'Roadmap')
            ),
            h('div', { style: 'text-align:center;flex:1;' },
                h('div', { style: 'font-size:18px;font-weight:600;color:var(--text-primary);' }, String(total)),
                h('div', { style: 'font-size:9px;color:var(--text-muted);' }, 'Items')
            ),
            h('div', { style: 'text-align:center;flex:1;' },
                h('div', { style: 'font-size:18px;font-weight:600;color:var(--accent-green);' }, String(completed)),
                h('div', { style: 'font-size:9px;color:var(--text-muted);' }, 'Done')
            )
        ));

        return section;
    }

    _buildRoadmapItem(item) {
        const el = h('div', { class: 'roadmap-item', 'data-item-id': item.id });

        const title = h('div', { style: 'display:flex;justify-content:space-between;align-items:center;' },
            h('span', { style: 'font-size:11px;color:var(--text-primary);font-weight:500;' }, item.title || item.name || 'Item'),
            item.status ? h('span', {
                class: `ms-status-badge ms-${item.status}`,
                style: 'font-size:9px;'
            }, item.status) : null
        );
        el.appendChild(title);

        if (item.description) {
            el.appendChild(h('div', {
                style: 'font-size:10px;color:var(--text-secondary);margin-top:2px;'
            }, item.description));
        }

        // Progress bar
        if (item.progress !== undefined) {
            const gauge = h('div', { class: 'orch-gauge', style: 'margin-top:6px;' },
                h('div', {
                    class: 'orch-gauge-fill',
                    style: { width: `${item.progress}%`, background: item.progress >= 100 ? 'var(--accent-green)' : 'var(--accent-cyan)' }
                })
            );
            el.appendChild(gauge);
        }

        return el;
    }

    _buildBurndownSection() {
        const section = h('div', { class: 'burndown-section', id: 'burndown-container' },
            h('div', { class: 'burndown-title' }, 'Burndown')
        );
        // Burndown content is rendered dynamically by the engine
        return section;
    }
}
