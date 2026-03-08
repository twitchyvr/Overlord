/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Project / Roadmap Panel
   ═══════════════════════════════════════════════════════════════════
   Dashboard with drillable KPIs, roadmap items, milestone progress,
   and burndown ring chart (ported from monolith renderBurndown).

   Features:
     - Drillable KPI cards (tap to see filtered task lists)
     - Roadmap items with DrillItem expand
     - SVG ring burndown chart per milestone
     - Active milestone progress bar

   Dependencies: engine.js, drill-item.js
   ═══════════════════════════════════════════════════════════════════ */

import { OverlordUI, h } from '../engine.js';
import { PanelComponent } from '../components/panel.js';
import { DrillItem } from '../components/drill-item.js';


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

            // Also re-render when tasks change (for KPIs and burndown)
            this.subscribe(OverlordUI._store, 'tasks.list', () => {
                this.render(this._items);
            });
        }
    }

    render(items) {
        if (!this._contentEl) return;
        this._items = items || this._items;

        const frag = document.createDocumentFragment();

        // KPI cards (always show, even without roadmap items)
        frag.appendChild(this._buildKPIs());

        // Active milestone progress
        const activeMilestone = this._getActiveMilestone();
        if (activeMilestone) {
            frag.appendChild(this._buildMilestoneProgress(activeMilestone));
        }

        // Burndown chart
        frag.appendChild(this._buildBurndown());

        // Roadmap items (drillable)
        if (this._items.length > 0) {
            const roadmapHeader = h('div', {
                style: 'font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);padding:8px 10px 4px;border-top:1px solid var(--border);'
            }, 'ROADMAP');
            frag.appendChild(roadmapHeader);

            for (const item of this._items) {
                frag.appendChild(this._buildRoadmapDrillItem(item));
            }
        }

        this._contentEl.textContent = '';
        this._contentEl.appendChild(frag);
    }

    // ── KPI Cards ────────────────────────────────────────────────

    _buildKPIs() {
        const tasks = OverlordUI._store?.peek('tasks.list', []) || [];
        const agents = OverlordUI._store?.peek('team.agents', []) || [];

        const tasksDone = tasks.filter(t => t.completed || t.status === 'completed' || t.status === 'done');
        const tasksActive = tasks.filter(t => t.status === 'in_progress' || t.status === 'working' || t.status === 'running');
        const tasksBlocked = tasks.filter(t => t.status === 'blocked' || t.status === 'skipped');
        const activeAgents = agents.filter(a => {
            const s = (a.status || '').toLowerCase();
            return s === 'active' || s === 'working' || s === 'thinking';
        });
        const milestones = this._items.filter(i => i.type === 'milestone');

        const kpis = [
            { label: 'Done', value: `${tasksDone.length}/${tasks.length}`, color: '#10b981', tasks: tasksDone },
            { label: 'Active', value: String(tasksActive.length), color: '#6366f1', tasks: tasksActive },
            { label: 'Agents', value: String(activeAgents.length), color: '#f59e0b', tasks: null },
            { label: 'Blocked', value: String(tasksBlocked.length), color: '#ef4444', tasks: tasksBlocked },
            { label: 'Milestones', value: String(milestones.length), color: '#3b82f6', tasks: null }
        ];

        const row = h('div', {
            style: 'display:flex;gap:0;padding:8px;'
        });

        kpis.forEach((k, i) => {
            const card = h('div', {
                class: 'project-kpi-card',
                style: `flex:1;text-align:center;padding:8px 2px;${i < kpis.length - 1 ? 'border-right:1px solid var(--border);' : ''}cursor:${k.tasks ? 'pointer' : 'default'};`,
                title: k.tasks ? `Click to see ${k.label.toLowerCase()} tasks` : ''
            },
                h('div', { style: `font-size:18px;font-weight:800;color:${k.color};` }, k.value),
                h('div', { style: 'font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;margin-top:2px;' }, k.label)
            );

            // Drill: click KPI card → show task list in bottom sheet
            if (k.tasks) {
                card.addEventListener('click', () => this._drillKPI(k.label, k.tasks));
            }

            row.appendChild(card);
        });

        return row;
    }

    _drillKPI(label, tasks) {
        const { Modal } = window._overlordModules || {};
        // Import Modal dynamically
        import('../components/modal.js').then(({ Modal: M }) => {
            const content = h('div', { style: 'padding:4px;' });
            if (!tasks.length) {
                content.appendChild(h('div', { style: 'color:var(--text-muted);text-align:center;padding:16px;' }, 'No tasks'));
            } else {
                for (const t of tasks) {
                    const item = h('div', {
                        style: 'padding:8px 10px;border-bottom:1px solid var(--border);font-size:12px;'
                    });
                    item.appendChild(h('div', { style: 'color:var(--text-primary);font-weight:500;' }, t.title || 'Untitled'));
                    if (t.assignee) {
                        const assigneeText = Array.isArray(t.assignee) ? t.assignee.join(', ') : t.assignee;
                        item.appendChild(h('div', { style: 'font-size:10px;color:var(--electric);margin-top:2px;' }, assigneeText));
                    }
                    if (t.description) {
                        item.appendChild(h('div', { style: 'font-size:10px;color:var(--text-muted);margin-top:2px;' }, t.description.substring(0, 100)));
                    }
                    content.appendChild(item);
                }
            }
            const isMobile = window.innerWidth < 768;
            M.open('kpi-drill-' + label, {
                title: `${label} Tasks (${tasks.length})`,
                content,
                size: isMobile ? 'full' : 'md',
                position: isMobile ? 'bottom-sheet' : 'center'
            });
        });
    }

    // ── Active Milestone ─────────────────────────────────────────

    _getActiveMilestone() {
        const milestones = this._items.filter(i => i.type === 'milestone');
        return milestones.find(m => m.status === 'active' && !m.done) || milestones.find(m => !m.done);
    }

    _buildMilestoneProgress(ms) {
        const section = h('div', { style: 'padding:6px 10px;border-top:1px solid var(--border);' });
        section.appendChild(h('div', { style: 'font-size:9px;font-weight:700;color:var(--text-muted);letter-spacing:0.05em;margin-bottom:4px;' }, 'ACTIVE MILESTONE'));
        section.appendChild(h('div', { style: 'font-size:12px;color:var(--electric);font-weight:600;' }, ms.title || ms.text || ms.name || 'Unnamed'));
        if (ms.progress !== undefined) {
            const bar = h('div', { class: 'orch-gauge', style: 'margin-top:4px;' },
                h('div', {
                    class: 'orch-gauge-fill',
                    style: `width:${ms.progress}%;background:${ms.progress >= 100 ? 'var(--accent-green)' : 'var(--electric)'}`
                })
            );
            section.appendChild(bar);
            section.appendChild(h('div', { style: 'font-size:9px;color:var(--text-muted);margin-top:2px;text-align:right;' }, `${ms.progress}%`));
        }
        return section;
    }

    // ── Burndown Ring Chart ──────────────────────────────────────

    _buildBurndown() {
        const tasks = OverlordUI._store?.peek('tasks.list', []) || [];
        const milestones = this._items.filter(r => r.type === 'milestone' && r.id);

        const section = h('div', { class: 'burndown-section' });

        if (milestones.length === 0) return section; // empty if no milestones

        section.appendChild(h('div', { class: 'burndown-title' }, 'Milestone Progress'));

        const circumference = 2 * Math.PI * 18;

        for (const ms of milestones) {
            const msTasks = tasks.filter(t => t.milestoneId === ms.id);
            const msDone = msTasks.filter(t => t.completed || t.status === 'completed').length;
            const msTotal = msTasks.length;
            const pct = msTotal > 0 ? Math.round((msDone / msTotal) * 100) : 0;
            const dashOffset = circumference - (pct / 100) * circumference;
            const color = ms.done ? '#3fb950' : 'var(--electric)';

            const row = h('div', { class: 'burndown-row' });

            // SVG ring
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'burndown-ring');
            svg.setAttribute('width', '44');
            svg.setAttribute('height', '44');
            svg.setAttribute('viewBox', '0 0 44 44');

            const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            bgCircle.setAttribute('cx', '22');
            bgCircle.setAttribute('cy', '22');
            bgCircle.setAttribute('r', '18');
            bgCircle.setAttribute('fill', 'none');
            bgCircle.setAttribute('stroke', 'var(--border)');
            bgCircle.setAttribute('stroke-width', '3');
            svg.appendChild(bgCircle);

            const fgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            fgCircle.setAttribute('cx', '22');
            fgCircle.setAttribute('cy', '22');
            fgCircle.setAttribute('r', '18');
            fgCircle.setAttribute('fill', 'none');
            fgCircle.setAttribute('stroke', color);
            fgCircle.setAttribute('stroke-width', '3');
            fgCircle.setAttribute('stroke-dasharray', circumference.toFixed(2));
            fgCircle.setAttribute('stroke-dashoffset', dashOffset.toFixed(2));
            fgCircle.setAttribute('stroke-linecap', 'round');
            fgCircle.setAttribute('transform', 'rotate(-90 22 22)');
            svg.appendChild(fgCircle);

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', '22');
            text.setAttribute('y', '26');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('font-size', '9');
            text.setAttribute('fill', 'var(--text-secondary)');
            text.textContent = `${pct}%`;
            svg.appendChild(text);

            row.appendChild(svg);

            // Info
            const info = h('div', { class: 'burndown-info' },
                h('div', { class: 'burndown-ms-name' }, ms.text || ms.title || ms.name || ''),
                h('div', { class: 'burndown-ms-count' }, `${msDone}/${msTotal} tasks`)
            );
            row.appendChild(info);

            section.appendChild(row);
        }

        return section;
    }

    // ── Roadmap DrillItem ────────────────────────────────────────

    _buildRoadmapDrillItem(item) {
        return DrillItem.create('roadmap', item, {
            icon: item.type === 'milestone' ? '\uD83C\uDFC1' : '\u2022',
            summary: () => item.title || item.name || 'Item',
            badge: item.status ? () => ({
                text: item.status,
                color: item.status === 'done' ? '#10b981' : item.status === 'active' ? '#6366f1' : null
            }) : null,
            meta: item.progress !== undefined ? () => `${item.progress}%` : null,
            detail: [
                { label: 'Description', key: 'description' },
                { label: 'Status', key: 'status' },
                { label: 'Progress', key: 'progress', value: (d) => d.progress !== undefined ? `${d.progress}%` : null },
                { label: 'Type', key: 'type' },
                { label: 'Branch', key: 'branch' }
            ]
        });
    }
}
