/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Room List
   ═══════════════════════════════════════════════════════════════════
   Room list: buildRoomList(), room cards, meeting status badges

   Dependencies: engine.js
   ═══════════════════════════════════════════════════════════════════ */

import { h } from '../engine.js';
import { OverlordUI } from '../engine.js';

/**
 * Build a room card
 * @param {object} room - Room data
 * @param {object} opts - Options
 * @returns {HTMLElement}
 */
export function buildRoomCard(room, opts = {}) {
    const { onOpen = null, onEnd = null } = opts;
    
    const esc = (s) => OverlordUI.escapeHtml ? OverlordUI.escapeHtml(String(s)) : String(s);
    const participants = room.participants || [room.fromAgent, room.toAgent];
    const isActive = room.status === 'active';

    const card = h('div', {
        id: `room-card-${room.id}`,
        style: `background:var(--bg-secondary);border:1px solid ${room.isMeeting ? 'rgba(250,204,21,0.4)' : 'var(--border-color)'};border-radius:6px;margin:0 4px 4px;padding:8px 10px;`
    });

    // Header
    const header = h('div', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:4px;' });
    
    if (room.isMeeting) {
        header.appendChild(h('span', {
            style: 'font-size:9px;background:rgba(250,204,21,0.15);color:#fcd34d;padding:1px 5px;border-radius:3px;border:1px solid rgba(250,204,21,0.3);font-weight:700;'
        }, 'MEETING'));
    }
    
    header.appendChild(h('span', { 
        style: 'font-size:11px;font-weight:600;color:var(--text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' 
    }, participants.map(p => esc(p)).join(' \u2022 ')));
    
    if (room.tool) {
        header.appendChild(h('span', {
            style: 'font-size:9px;background:var(--bg-tertiary);color:var(--accent-primary);padding:1px 5px;border-radius:3px;flex-shrink:0;'
        }, esc(room.tool)));
    }
    
    header.appendChild(h('span', {
        style: `font-size:9px;flex-shrink:0;color:${isActive ? 'var(--accent-green)' : 'var(--text-muted)'};`
    }, isActive ? '\u25CF live' : esc(room.status)));
    
    card.appendChild(header);

    // Reason
    if (room.reason) {
        card.appendChild(h('div', {
            style: 'font-size:10px;color:var(--text-muted);margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
        }, esc(room.reason)));
    }

    // Actions
    const actions = h('div', { style: 'display:flex;align-items:center;gap:6px;' });
    
    actions.appendChild(h('span', { style: 'font-size:9px;color:var(--text-muted);' },
        `${room.messageCount || 0} msgs \u2022 ${participants.length} agents` +
        (room.userPresent ? ' \u2022 \u{1F464} you' : '')
    ));

    // Open Room button
    actions.appendChild(h('button', {
        style: 'margin-left:auto;padding:2px 10px;font-size:10px;background:var(--accent-primary);border:none;border-radius:3px;cursor:pointer;color:#000;font-weight:700;',
        onClick: (e) => { e.stopPropagation(); onOpen && onOpen(room); }
    }, 'Open Room'));

    // End button
    if (isActive) {
        actions.appendChild(h('button', {
            style: 'padding:2px 8px;font-size:10px;background:var(--accent-red, #f85149);border:none;border-radius:3px;cursor:pointer;color:#fff;font-weight:600;',
            onClick: (e) => { e.stopPropagation(); onEnd && onEnd(room); }
        }, room.isMeeting ? 'End Meeting' : 'End'));
    }

    // Notes button
    if (room.meetingNotes) {
        actions.appendChild(h('button', {
            style: 'padding:2px 8px;font-size:10px;background:rgba(250,204,21,0.2);border:1px solid rgba(250,204,21,0.3);border-radius:3px;cursor:pointer;color:#fcd34d;font-weight:600;',
            onClick: (e) => { e.stopPropagation(); onOpen && onOpen(room); }
        }, 'Notes'));
    }

    card.appendChild(actions);

    return card;
}

/**
 * Build a room list
 * @param {Array} rooms - Array of room objects
 * @param {object} opts - Options
 * @returns {HTMLElement}
 */
export function buildRoomList(rooms, opts = {}) {
    const frag = document.createDocumentFragment();
    
    for (const room of rooms) {
        frag.appendChild(buildRoomCard(room, opts));
    }
    
    return frag;
}

/**
 * Get room status
 * @param {object} room - Room object
 * @returns {string}
 */
export function getRoomStatus(room) {
    if (room.status === 'active') return 'live';
    if (room.isMeeting) return 'meeting';
    return room.status || 'unknown';
}

/**
 * Check if room is a meeting
 * @param {object} room - Room object
 * @returns {boolean}
 */
export function isMeeting(room) {
    return !!room.isMeeting;
}

/**
 * Get participant count
 * @param {object} room - Room object
 * @returns {number}
 */
export function getParticipantCount(room) {
    if (room.participants) return room.participants.length;
    if (room.fromAgent && room.toAgent) return 2;
    return 0;
}

/**
 * Filter rooms by status
 * @param {Array} rooms - Array of room objects
 * @param {string} status - Status to filter by
 * @returns {Array}
 */
export function filterRooms(rooms, status) {
    if (!status || status === 'all') return rooms;
    return rooms.filter(room => {
        switch (status) {
            case 'active':
                return room.status === 'active';
            case 'meeting':
                return room.isMeeting;
            case 'completed':
                return room.status === 'completed' || room.status === 'ended';
            default:
                return true;
        }
    });
}

/**
 * Sort rooms by activity
 * @param {Array} rooms - Array of room objects
 * @returns {Array}
 */
export function sortRoomsByActivity(rooms) {
    return [...rooms].sort((a, b) => {
        // Active first
        if (a.status === 'active' && b.status !== 'active') return -1;
        if (b.status === 'active' && a.status !== 'active') return 1;
        // Then meetings
        if (a.isMeeting && !b.isMeeting) return -1;
        if (b.isMeeting && !a.isMeeting) return 1;
        // Then by message count
        return (b.messageCount || 0) - (a.messageCount || 0);
    });
}
