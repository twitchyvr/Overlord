/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Meeting Controls
   ═══════════════════════════════════════════════════════════════════
   Meeting controls: pull-in button, leave button, end meeting button

   Dependencies: engine.js
   ═══════════════════════════════════════════════════════════════════ */

import { h } from '../engine.js';
import { OverlordUI } from '../engine.js';

/**
 * Build meeting controls
 * @param {object} room - Room data
 * @param {object} opts - Options
 * @returns {HTMLElement}
 */
export function buildMeetingControls(room, opts = {}) {
    const { onPullIn = null, onLeave = null, onEnd = null, onJoin = null } = opts;
    
    const container = h('div', {
        class: 'meeting-controls',
        style: 'display:flex;gap:8px;padding:8px;background:var(--bg-secondary);border-radius:6px;'
    });

    // Pull-in button
    if (onPullIn) {
        const pullInBtn = h('button', {
            class: 'meeting-control-btn',
            style: 'padding:6px 12px;background:var(--accent-primary);border:none;border-radius:4px;cursor:pointer;color:#000;font-size:11px;font-weight:600;',
            onClick: () => onPullIn(room)
        }, 'Pull In Agent');
        container.appendChild(pullInBtn);
    }

    // Join button
    if (onJoin && !room.userPresent) {
        const joinBtn = h('button', {
            class: 'meeting-control-btn',
            style: 'padding:6px 12px;background:var(--accent-green);border:none;border-radius:4px;cursor:pointer;color:#000;font-size:11px;font-weight:600;',
            onClick: () => onJoin(room)
        }, 'Join Meeting');
        container.appendChild(joinBtn);
    }

    // Leave button
    if (onLeave && room.userPresent) {
        const leaveBtn = h('button', {
            class: 'meeting-control-btn',
            style: 'padding:6px 12px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:4px;cursor:pointer;color:var(--text-primary);font-size:11px;',
            onClick: () => onLeave(room)
        }, 'Leave');
        container.appendChild(leaveBtn);
    }

    // End meeting button
    if (onEnd && room.isMeeting) {
        const endBtn = h('button', {
            class: 'meeting-control-btn',
            style: 'padding:6px 12px;background:var(--accent-red);border:none;border-radius:4px;cursor:pointer;color:#fff;font-size:11px;font-weight:600;',
            onClick: () => onEnd(room)
        }, 'End Meeting');
        container.appendChild(endBtn);
    }

    return container;
}

/**
 * Build a pull-in agent dropdown
 * @param {object} room - Room data
 * @param {Array} availableAgents - Available agents not in the room
 * @param {object} opts - Options
 * @returns {HTMLElement}
 */
export function buildPullInDropdown(room, availableAgents, opts = {}) {
    const { onPullIn = null } = opts;
    
    const container = h('div', {
        class: 'pull-in-dropdown',
        style: 'display:flex;flex-direction:column;gap:6px;'
    });

    const label = h('div', {
        style: 'font-size:11px;color:var(--text-muted);font-weight:600;'
    }, 'Pull in agent:');
    container.appendChild(label);

    const select = h('select', {
        style: 'padding:6px;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary);font-size:12px;'
    });
    select.appendChild(h('option', { value: '' }, 'Select agent...'));
    
    for (const agent of availableAgents) {
        select.appendChild(h('option', { value: agent.name }, agent.name));
    }
    container.appendChild(select);

    const pullInBtn = h('button', {
        style: 'padding:6px 12px;background:var(--accent-primary);border:none;border-radius:4px;cursor:pointer;color:#000;font-size:11px;font-weight:600;',
        disabled: true,
        onClick: () => {
            if (select.value && onPullIn) {
                onPullIn(room, select.value);
            }
        }
    }, 'Pull In');
    select.addEventListener('change', () => {
        pullInBtn.disabled = !select.value;
    });
    container.appendChild(pullInBtn);

    return container;
}

/**
 * Build participant list for a room
 * @param {object} room - Room data
 * @param {object} opts - Options
 * @returns {HTMLElement}
 */
export function buildParticipantList(room, opts = {}) {
    const { onRemove = null } = opts;
    
    const participants = room.participants || [];
    const container = h('div', {
        class: 'participant-list',
        style: 'display:flex;flex-direction:column;gap:4px;'
    });

    const label = h('div', {
        style: 'font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;'
    }, `Participants (${participants.length})`);
    container.appendChild(label);

    for (const participant of participants) {
        const isUser = participant === 'user' || participant === 'You';
        const row = h('div', {
            style: 'display:flex;align-items:center;gap:8px;padding:4px 8px;background:var(--bg-primary);border-radius:4px;'
        });

        // Status indicator
        row.appendChild(h('span', {
            style: `width:8px;height:8px;border-radius:50%;background:${isUser ? 'var(--accent-green)' : 'var(--accent-primary)'};`
        }));

        row.appendChild(h('span', {
            style: 'flex:1;font-size:12px;color:var(--text-primary);'
        }, participant));

        // Remove button (for non-user participants)
        if (!isUser && onRemove) {
            const removeBtn = h('button', {
                style: 'padding:2px 6px;background:none;border:none;color:var(--accent-red);cursor:pointer;font-size:10px;',
                onClick: () => onRemove(room, participant)
            }, '✕');
            row.appendChild(removeBtn);
        }

        container.appendChild(row);
    }

    return container;
}

/**
 * Build meeting status badge
 * @param {object} room - Room data
 * @returns {HTMLElement}
 */
export function buildMeetingBadge(room) {
    if (!room.isMeeting) return null;

    return h('span', {
        style: 'font-size:9px;background:rgba(250,204,21,0.15);color:#fcd34d;padding:2px 6px;border-radius:3px;border:1px solid rgba(250,204,21,0.3);font-weight:700;'
    }, 'LIVE MEETING');
}

/**
 * Build meeting timer
 * @param {number} startTime - Meeting start timestamp
 * @returns {HTMLElement}
 */
export function buildMeetingTimer(startTime) {
    const container = h('div', {
        class: 'meeting-timer',
        style: 'font-size:11px;color:var(--text-muted);font-family:monospace;'
    });

    const updateTimer = () => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        container.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    // Return cleanup function
    return { element: container, cleanup: () => clearInterval(interval) };
}
