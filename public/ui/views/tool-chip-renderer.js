/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Tool Chip Renderer
   ═══════════════════════════════════════════════════════════════════
   Tool chip rendering: _createToolChipEl(), tool result display, tool status updates

   Dependencies: engine.js
   ═══════════════════════════════════════════════════════════════════ */

import { h } from '../engine.js';
import { OverlordUI } from '../engine.js';
import { looksLikeMarkdown } from './markdown-handler.js';

/**
 * Create a tool chip element
 * @param {object} chip - Chip data object
 * @returns {HTMLElement}
 */
export function createToolChipEl(chip) {
    const el = document.createElement('details');
    const isDelegate = chip.name === 'delegate_to_agent';
    el.className = 'tc' + (isDelegate ? ' tc-delegate' : '');
    const safeId = (chip.id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    if (chip.id) el.dataset.tcId = chip.id;

    const sum = document.createElement('summary');
    const icon = isDelegate ? '\u2728' : '\u2699\ufe0f';

    sum.appendChild(h('span', { class: 'tc-chevron' }, '\u25b8'));
    sum.appendChild(h('span', { class: 'tc-icon' }, icon));
    sum.appendChild(h('span', { class: 'tc-name' }, chip.name || ''));
    sum.appendChild(h('span', { class: 'tc-param', id: 'tcp-' + safeId }));
    sum.appendChild(h('span', { class: 'tc-dur', id: 'tcd-' + safeId }));
    sum.appendChild(h('span', { class: 'tc-dot run', id: 'tcdot-' + safeId }));

    const body = h('div', { class: 'tc-body', id: 'tcbody-' + safeId });
    OverlordUI.setContent(body, h('span', {
        class: 'tc-lbl',
        style: 'opacity:0.4;'
    }, 'awaiting execution\u2026'));

    el.appendChild(sum);
    el.appendChild(body);
    return el;
}

/**
 * Get a short human-readable param summary
 * @param {string} name - Tool name
 * @param {object} input - Tool input
 * @returns {string}
 */
export function toolParamSummary(name, input) {
    if (!input || typeof input !== 'object') return '';
    const pk = 'path' in input ? 'path' : 'file_path' in input ? 'file_path' : 'filepath' in input ? 'filepath' : null;
    if (pk) {
        const fname = String(input[pk]).split(/[/\\]/).pop();
        const lines = input.start_line != null && input.end_line != null ? ':' + input.start_line + '\u2013' + input.end_line
                    : input.start_line != null ? ':' + input.start_line + '+'
                    : input.line != null       ? ':' + input.line : '';
        return fname + lines;
    }
    if ('command' in input) return String(input.command).substring(0, 55);
    if ('query' in input) return '"' + String(input.query).substring(0, 45) + '"';
    if ('url' in input) { try { const u = new URL(String(input.url)); return u.hostname + u.pathname.substring(0, 30); } catch (e) { return String(input.url).substring(0, 50); } }
    if ('taskId' in input && 'status' in input) return String(input.taskId).substring(0, 8) + ' \u2192 ' + input.status;
    const first = Object.values(input)[0];
    return first != null ? String(first).substring(0, 50) : '';
}

/**
 * Render tool input into body element
 * @param {HTMLElement} bodyEl - Body element
 * @param {string} name - Tool name
 * @param {object} input - Tool input
 */
export function renderToolInput(bodyEl, name, input) {
    const inLbl = document.createElement('span');
    inLbl.className = 'tc-lbl';
    inLbl.textContent = 'Input';
    bodyEl.appendChild(inLbl);

    if (name === 'delegate_to_agent' && typeof input === 'object') {
        const fieldOrder = ['agent', 'task', 'context'];
        const orderedKeys = [...fieldOrder.filter(f => f in input),
                             ...Object.keys(input).filter(k => !fieldOrder.includes(k))];
        for (const key of orderedKeys) {
            const val = input[key];
            const lbl = document.createElement('span');
            lbl.className = 'tc-lbl tc-lbl-field';
            lbl.textContent = key;
            bodyEl.appendChild(lbl);
            const valText = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
            if (typeof val === 'string' && looksLikeMarkdown(val)) {
                const md = document.createElement('div');
                md.className = 'tc-pre tc-pre-readable tb-markdown';
                md.innerHTML = renderMarkdown(val);
                bodyEl.appendChild(md);
            } else {
                const pre = document.createElement('pre');
                pre.className = 'tc-pre tc-pre-readable';
                pre.textContent = valText;
                bodyEl.appendChild(pre);
            }
        }
    } else {
        const inPre = document.createElement('pre');
        inPre.className = 'tc-pre';
        inPre.textContent = JSON.stringify(input, null, 2);
        bodyEl.appendChild(inPre);
    }
}

/**
 * Render tool output into body element
 * @param {HTMLElement} bodyEl - Body element
 * @param {string} name - Tool name
 * @param {any} output - Tool output
 */
export function renderToolOutput(bodyEl, name, output) {
    let text = output;
    if (typeof output === 'object' && output !== null) {
        text = output.content || output.result || output.text || JSON.stringify(output, null, 2);
    } else {
        text = String(output);
    }

    const isSearchTool = ['web_search', 'search_web', 'google'].includes(name);
    if ((isSearchTool || name === 'delegate_to_agent') && typeof text === 'string' && looksLikeMarkdown(text)) {
        const md = document.createElement('div');
        md.className = 'tc-pre tc-pre-readable tb-markdown';
        md.innerHTML = renderMarkdown(text);
        bodyEl.appendChild(md);
        return;
    }

    if (typeof text === 'string' && text.length > 0 && looksLikeMarkdown(text)) {
        const md = document.createElement('div');
        md.className = 'tc-pre tc-pre-readable tb-markdown';
        md.innerHTML = renderMarkdown(text);
        bodyEl.appendChild(md);
        return;
    }

    const outPre = document.createElement('pre');
    outPre.className = 'tc-pre';
    outPre.textContent = typeof text === 'string' ? text : String(text);
    bodyEl.appendChild(outPre);
}

/**
 * Apply tool chip updates to DOM elements
 * @param {string} safeId - Safe element ID
 * @param {string} name - Tool name
 * @param {object} input - Tool input
 * @param {any} output - Tool output
 * @param {number} durationMs - Duration in milliseconds
 * @param {boolean} success - Success flag
 * @returns {boolean}
 */
export function applyToolChip(safeId, name, input, output, durationMs, success) {
    const paramEl = document.getElementById('tcp-' + safeId);
    if (paramEl && input) {
        paramEl.textContent = '';
        paramEl.appendChild(document.createTextNode(' \u00b7 '));
        if (name === 'delegate_to_agent') {
            const agentName = toolParamSummary(name, input) || (input.agent || '');
            const magic = document.createElement('span');
            magic.className = 'tc-agent-magic';
            magic.textContent = agentName;
            paramEl.appendChild(magic);
        } else {
            paramEl.appendChild(document.createTextNode(toolParamSummary(name, input)));
        }
    }
    const dotEl = document.getElementById('tcdot-' + safeId);
    if (dotEl) dotEl.className = 'tc-dot ' + (output != null ? (success ? 'ok' : 'err') : 'run');
    const durEl = document.getElementById('tcd-' + safeId);
    if (durEl && durationMs != null) {
        durEl.textContent = durationMs < 1000 ? durationMs + 'ms' : (durationMs / 1000).toFixed(1) + 's';
    }
    const bodyEl = document.getElementById('tcbody-' + safeId);
    if (!bodyEl) return false;
    if (output != null) {
        bodyEl.replaceChildren();
        if (input) {
            renderToolInput(bodyEl, name, input);
        }
        const outLbl = document.createElement('span'); outLbl.className = 'tc-lbl'; outLbl.textContent = 'Output';
        bodyEl.appendChild(outLbl);
        renderToolOutput(bodyEl, name, output);
    } else if (input) {
        bodyEl.replaceChildren();
        renderToolInput(bodyEl, name, input);
        const runLbl = document.createElement('span'); runLbl.className = 'tc-lbl'; runLbl.style.opacity = '0.4'; runLbl.textContent = 'Running\u2026';
        bodyEl.appendChild(runLbl);
    }
    return true;
}

/**
 * Update tool chip by toolId
 * @param {string} toolId - Tool ID
 * @param {string} name - Tool name
 * @param {object} input - Tool input
 * @param {any} output - Tool output
 * @param {number} durationMs - Duration in milliseconds
 * @param {boolean} success - Success flag
 * @returns {boolean}
 */
export function updateToolChip(toolId, name, input, output, durationMs, success) {
    if (!toolId) return false;
    const safeId = toolId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return applyToolChip(safeId, name, input, output, durationMs, success);
}

/**
 * Show delegation toast
 * @param {string} title - Toast title
 * @param {string} preview - Preview text
 */
export function showDelegateToast(title, preview) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast toast-agent';
    const row = document.createElement('div'); row.className = 'toast-agent-row';
    const titleEl = document.createElement('span'); titleEl.className = 'toast-agent-title'; titleEl.textContent = title;
    row.appendChild(titleEl);
    const closeBtn = document.createElement('button'); closeBtn.className = 'toast-close'; closeBtn.textContent = '\u2715';
    closeBtn.onclick = (e) => { e.stopPropagation(); toast.remove(); };
    row.appendChild(closeBtn);
    toast.appendChild(row);
    if (preview) {
        const prevEl = document.createElement('div'); prevEl.className = 'toast-agent-preview'; prevEl.textContent = preview;
        toast.appendChild(prevEl);
    }
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 6000);
}

// Import markdown rendering
import { renderMarkdown } from './markdown-handler.js';
