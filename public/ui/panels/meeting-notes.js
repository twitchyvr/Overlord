/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Meeting Notes
   ═══════════════════════════════════════════════════════════════════
   Notes viewer: renderMeetingNotes(), RAID log display, action items

   Dependencies: engine.js
   ═══════════════════════════════════════════════════════════════════ */

import { h } from '../engine.js';
import { OverlordUI } from '../engine.js';

/**
 * Build meeting notes viewer
 * @param {object} room - Room data with meetingNotes
 * @param {object} opts - Options
 * @returns {HTMLElement}
 */
export function renderMeetingNotes(room, opts = {}) {
    const { onClose = null } = opts;
    
    const notes = room.meetingNotes;
    if (!notes) {
        return h('div', {
            style: 'padding:20px;text-align:center;color:var(--text-muted);'
        }, 'No meeting notes available');
    }

    const container = h('div', {
        class: 'meeting-notes-viewer',
        style: 'padding:16px;max-height:400px;overflow-y:auto;'
    });

    // Header
    const header = h('div', {
        style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;'
    });
    
    header.appendChild(h('h3', {
        style: 'margin:0;font-size:14px;font-weight:600;color:var(--text-primary);'
    }, 'Meeting Notes'));
    
    if (onClose) {
        const closeBtn = h('button', {
            style: 'padding:4px 8px;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:12px;',
            onClick: () => onClose(room)
        }, 'Close');
        header.appendChild(closeBtn);
    }
    
    container.appendChild(header);

    // Summary
    if (notes.summary) {
        container.appendChild(h('div', {
            style: 'margin-bottom:16px;'
        },
            h('div', {
                style: 'font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;'
            }, 'Summary'),
            h('div', {
                style: 'font-size:13px;color:var(--text-primary);line-height:1.5;'
            }, notes.summary)
        ));
    }

    // RAID Log
    if (notes.raid) {
        const raidSection = h('div', { style: 'margin-bottom:16px;' });
        raidSection.appendChild(h('div', {
            style: 'font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;'
        }, 'RAID Log'));
        
        const raidGrid = h('div', { style: 'display:flex;flex-direction:column;gap:8px;' });
        
        // Risks
        if (notes.raid.risks?.length) {
            const risks = h('div', { style: 'padding:8px;background:rgba(248,81,73,0.1);border-left:3px solid var(--accent-red);border-radius:4px;' },
                h('div', { style: 'font-size:10px;color:var(--accent-red);font-weight:600;margin-bottom:4px;' }, 'Risks'),
                h('ul', { style: 'margin:0;padding-left:16px;font-size:12px;color:var(--text-primary);' },
                    notes.raid.risks.map(r => h('li', {}, r))
                )
            );
            raidGrid.appendChild(risks);
        }
        
        // Assumptions
        if (notes.raid.assumptions?.length) {
            const assumptions = h('div', { style: 'padding:8px;background:rgba(210,153,34,0.1);border-left:3px solid #d29922;border-radius:4px;' },
                h('div', { style: 'font-size:10px;color:#d29922;font-weight:600;margin-bottom:4px;' }, 'Assumptions'),
                h('ul', { style: 'margin:0;padding-left:16px;font-size:12px;color:var(--text-primary);' },
                    notes.raid.assumptions.map(a => h('li', {}, a))
                )
            );
            raidGrid.appendChild(assumptions);
        }
        
        // Dependencies
        if (notes.raid.dependencies?.length) {
            const deps = h('div', { style: 'padding:8px;background:rgba(88,166,255,0.1);border-left:3px solid var(--accent-primary);border-radius:4px;' },
                h('div', { style: 'font-size:10px;color:var(--accent-primary);font-weight:600;margin-bottom:4px;' }, 'Dependencies'),
                h('ul', { style: 'margin:0;padding-left:16px;font-size:12px;color:var(--text-primary);' },
                    notes.raid.dependencies.map(d => h('li', {}, d))
                )
            );
            raidGrid.appendChild(deps);
        }
        
        // Inputs
        if (notes.raid.inputs?.length) {
            const inputs = h('div', { style: 'padding:8px;background:rgba(63,185,80,0.1);border-left:3px solid var(--accent-green);border-radius:4px;' },
                h('div', { style: 'font-size:10px;color:var(--accent-green);font-weight:600;margin-bottom:4px;' }, 'Inputs'),
                h('ul', { style: 'margin:0;padding-left:16px;font-size:12px;color:var(--text-primary);' },
                    notes.raid.inputs.map(i => h('li', {}, i))
                )
            );
            raidGrid.appendChild(inputs);
        }
        
        raidSection.appendChild(raidGrid);
        container.appendChild(raidSection);
    }

    // Action Items
    if (notes.actionItems?.length) {
        const actionsSection = h('div', { style: 'margin-bottom:16px;' });
        actionsSection.appendChild(h('div', {
            style: 'font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;'
        }, 'Action Items'));
        
        const actionsList = h('div', { style: 'display:flex;flex-direction:column;gap:6px;' });
        
        for (const item of notes.actionItems) {
            const itemEl = h('div', {
                style: 'display:flex;align-items:flex-start;gap:8px;padding:8px;background:var(--bg-secondary);border-radius:4px;'
            });
            
            const checkbox = h('input', {
                type: 'checkbox',
                checked: item.completed || false,
                style: 'margin-top:2px;'
            });
            itemEl.appendChild(checkbox);
            
            const content = h('div', { style: 'flex:1;' },
                h('div', { style: 'font-size:12px;color:var(--text-primary);' }, item.description || item.text),
                item.assignee ? h('div', { 
                    style: 'font-size:10px;color:var(--text-muted);margin-top:2px;' 
                }, `Assigned: ${item.assignee}`) : null
            );
            itemEl.appendChild(content);
            
            actionsList.appendChild(itemEl);
        }
        
        actionsSection.appendChild(actionsList);
        container.appendChild(actionsSection);
    }

    // Decisions
    if (notes.decisions?.length) {
        const decisionsSection = h('div', { style: 'margin-bottom:16px;' });
        decisionsSection.appendChild(h('div', {
            style: 'font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;'
        }, 'Decisions'));
        
        const decisionsList = h('div', { style: 'display:flex;flex-direction:column;gap:6px;' });
        
        for (const decision of notes.decisions) {
            decisionsList.appendChild(h('div', {
                style: 'padding:8px;background:var(--bg-secondary);border-radius:4px;font-size:12px;color:var(--text-primary);'
            }, decision));
        }
        
        decisionsSection.appendChild(decisionsList);
        container.appendChild(decisionsSection);
    }

    // Timestamps
    if (notes.generatedAt) {
        container.appendChild(h('div', {
            style: 'font-size:10px;color:var(--text-muted);margin-top:16px;text-align:right;'
        }, `Generated: ${new Date(notes.generatedAt).toLocaleString()}`));
    }

    return container;
}

/**
 * Build a simple notes editor
 * @param {object} opts - Options
 * @returns {HTMLElement}
 */
export function buildNotesEditor(opts = {}) {
    const { onSave = null, onCancel = null } = opts;
    
    const container = h('div', {
        class: 'notes-editor',
        style: 'padding:16px;'
    });
    
    container.appendChild(h('h3', {
        style: 'margin:0 0 16px;font-size:14px;font-weight:600;'
    }, 'Edit Meeting Notes'));
    
    // Summary field
    container.appendChild(h('div', { style: 'margin-bottom:12px;' },
        h('label', {
            style: 'display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;'
        }, 'Summary'),
        h('textarea', {
            class: 'notes-summary',
            rows: '3',
            style: 'width:100%;padding:8px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary);font-size:12px;resize:vertical;'
        })
    ));
    
    // Action items
    container.appendChild(h('div', { style: 'margin-bottom:12px;' },
        h('label', {
            style: 'display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;'
        }, 'Action Items'),
        h('textarea', {
            class: 'notes-actions',
            rows: '5',
            placeholder: 'One action item per line',
            style: 'width:100%;padding:8px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary);font-size:12px;resize:vertical;'
        })
    ));
    
    // Buttons
    const buttons = h('div', { style: 'display:flex;gap:8px;justify-content:flex-end;' });
    
    if (onCancel) {
        buttons.appendChild(h('button', {
            style: 'padding:8px 16px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:4px;cursor:pointer;color:var(--text-primary);font-size:12px;',
            onClick: () => onCancel()
        }, 'Cancel'));
    }
    
    if (onSave) {
        buttons.appendChild(h('button', {
            style: 'padding:8px 16px;background:var(--accent-green);border:none;border-radius:4px;cursor:pointer;color:#000;font-size:12px;font-weight:600;',
            onClick: () => {
                const summary = container.querySelector('.notes-summary')?.value || '';
                const actions = container.querySelector('.notes-actions')?.value || '';
                onSave({ summary, actionItems: actions.split('\n').filter(a => a.trim()) });
            }
        }, 'Save'));
    }
    
    container.appendChild(buttons);
    
    return container;
}

/**
 * Parse meeting notes from text
 * @param {string} text - Raw notes text
 * @returns {object}
 */
export function parseMeetingNotes(text) {
    const notes = {
        summary: '',
        actionItems: [],
        decisions: [],
        raid: {}
    };
    
    if (!text) return notes;
    
    const lines = text.split('\n');
    let currentSection = 'summary';
    
    for (const line of lines) {
        const trimmed = line.trim();
        
        if (trimmed.match(/^#{1,3}\s/)) {
            // Markdown header
            const header = trimmed.replace(/^#{1,3}\s*/, '').toLowerCase();
            if (header.includes('summary')) currentSection = 'summary';
            else if (header.includes('action') || header.includes('todo')) currentSection = 'actions';
            else if (header.includes('decision')) currentSection = 'decisions';
            else if (header.includes('raid') || header.includes('risk')) currentSection = 'raid';
            continue;
        }
        
        if (trimmed.match(/^-\s*\[\s*\]/)) {
            // Action item checkbox
            const item = trimmed.replace(/^-\s*\[\s*\]\s*/, '');
            notes.actionItems.push({ description: item, completed: false });
            continue;
        }
        
        if (trimmed.startsWith('- ')) {
            // Bullet point
            const content = trimmed.replace(/^-\s*/, '');
            
            if (currentSection === 'actions') {
                notes.actionItems.push({ description: content, completed: false });
            } else if (currentSection === 'decisions') {
                notes.decisions.push(content);
            } else if (currentSection === 'raid') {
                // Determine RAID type
                if (content.toLowerCase().startsWith('risk:')) {
                    if (!notes.raid.risks) notes.raid.risks = [];
                    notes.raid.risks.push(content.replace(/^risk:?\s*/i, ''));
                } else if (content.toLowerCase().startsWith('assumption:')) {
                    if (!notes.raid.assumptions) notes.raid.assumptions = [];
                    notes.raid.assumptions.push(content.replace(/^assumption:?\s*/i, ''));
                } else if (content.toLowerCase().startsWith('dependency:')) {
                    if (!notes.raid.dependencies) notes.raid.dependencies = [];
                    notes.raid.dependencies.push(content.replace(/^dependency:?\s*/i, ''));
                } else if (content.toLowerCase().startsWith('input:')) {
                    if (!notes.raid.inputs) notes.raid.inputs = [];
                    notes.raid.inputs.push(content.replace(/^input:?\s*/i, ''));
                }
            } else {
                notes.summary += (notes.summary ? '\n' : '') + content;
            }
            continue;
        }
        
        if (trimmed && currentSection === 'summary') {
            notes.summary += (notes.summary ? '\n' : '') + trimmed;
        }
    }
    
    notes.generatedAt = new Date().toISOString();
    
    return notes;
}
