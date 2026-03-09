/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Thought Bubble
   ═══════════════════════════════════════════════════════════════════
   Thinking bubble: _createThoughtBubble(), _updateThoughtBubble(),
   streaming display, expand/collapse

   Dependencies: engine.js
   ═══════════════════════════════════════════════════════════════════ */

import { h } from '../engine.js';
import { OverlordUI } from '../engine.js';
import { estimateTokens, looksLikeMarkdown } from './markdown-handler.js';
import { renderMarkdown } from './markdown-handler.js';
import { toolParamSummary } from './tool-chip-renderer.js';

/**
 * Map of active thinking timers
 */
const _thinkingTimers = new Map();

/**
 * Create a thoughts bubble element
 * @param {string} bId - Bubble ID
 * @param {Function} toggleCallback - Callback for toggle
 * @returns {HTMLElement}
 */
export function createThoughtsBubble(bId, toggleCallback) {
    const startTs = Date.now();

    const bubble = h('div', {
        class: 'thoughts-bubble is-streaming',
        id: bId,
        'data-thoughts': '',
        'data-start': String(startTs)
    });

    const header = h('div', { class: 'tb-header' });
    header.addEventListener('click', () => toggleCallback && toggleCallback(bId));

    header.appendChild(h('span', { class: 'tb-icon' }, '\ud83d\udcad'));

    const meta = h('span', { class: 'tb-meta' }, 'Thinking\u2026 0s');
    header.appendChild(meta);

    const badge = h('span', { class: 'tb-badge' });
    header.appendChild(badge);

    header.appendChild(h('span', { class: 'tb-chevron' }, '\u25b8'));

    const body = h('div', { class: 'tb-body' });
    body.appendChild(h('div', { class: 'tb-content' }));

    bubble.appendChild(header);
    bubble.appendChild(body);

    // Live timer: ticks every 100ms while is-streaming
    const timerId = setInterval(() => {
        if (bubble.classList.contains('is-streaming')) {
            const secs = ((Date.now() - startTs) / 1000).toFixed(1);
            meta.textContent = 'Thinking\u2026 ' + secs + 's';
        } else {
            clearInterval(timerId);
            _thinkingTimers.delete(bId);
        }
    }, 100);
    _thinkingTimers.set(bId, timerId);

    return bubble;
}

/**
 * Update thought bubble with new content
 * @param {HTMLElement} bubble - Bubble element
 * @param {string} thought - New thought text
 * @param {Function} renderContent - Content renderer
 */
export function updateThoughtBubble(bubble, thought, renderContent) {
    if (!bubble) return;

    // Accumulate raw thought text
    const prev = bubble.getAttribute('data-thoughts') || '';
    const combined = prev + thought;
    bubble.setAttribute('data-thoughts', combined);

    // Render content
    const contentEl = bubble.querySelector('.tb-content');
    if (contentEl && renderContent) {
        renderContent(contentEl, combined);
    }

    // Live token count
    const badge = bubble.querySelector('.tb-badge');
    if (badge) {
        const tok = estimateTokens(combined);
        badge.textContent = '~' + tok.toLocaleString() + ' tok';
        badge.style.display = 'inline';
    }

    // Auto-scroll expanded body
    const body = bubble.querySelector('.tb-body');
    if (body && bubble.classList.contains('tb-open')) {
        body.scrollTop = body.scrollHeight;
    }
}

/**
 * Mark thinking as done for a bubble
 * @param {HTMLElement} bubble - Bubble element
 * @param {object} data - Completion data (chars, words)
 */
export function markThinkingDone(bubble, data) {
    if (!bubble) return;

    bubble.classList.remove('is-streaming');

    const bId = bubble.id;
    const timerId = _thinkingTimers.get(bId);
    if (timerId) {
        clearInterval(timerId);
        _thinkingTimers.delete(bId);
    }

    const start = parseInt(bubble.getAttribute('data-start') || '0', 10);
    const elapsed = start
        ? ((Date.now() - start) / 1000).toFixed(1)
        : null;

    const meta = bubble.querySelector('.tb-meta');
    const badge = bubble.querySelector('.tb-badge');

    if (meta) {
        meta.textContent = elapsed ? 'Reasoned for ' + elapsed + 's' : 'Reasoned';
    }

    if (badge && data) {
        const finalTok = data.chars
            ? Math.ceil(data.chars / 3.5)
            : (data.words ? Math.ceil(data.words * 1.33) : null);
        if (finalTok) {
            badge.textContent = finalTok.toLocaleString() + ' tok';
            badge.style.display = 'inline';
        }
    }
}

/**
 * Toggle bubble expanded/collapsed
 * @param {string} bubbleId - Bubble ID
 * @returns {HTMLElement}
 */
export function toggleThoughts(bubbleId) {
    const bubble = document.getElementById(bubbleId);
    if (!bubble) return null;
    bubble.classList.toggle('tb-open');
    const body = bubble.querySelector('.tb-body');
    if (body && bubble.classList.contains('tb-open')) {
        body.scrollTop = body.scrollHeight;
    }
    return bubble;
}

/**
 * Render thoughts content with embedded tool chip sentinels
 * Chip sentinel format: \x00CHIP:{json}\x00
 * @param {HTMLElement} container - Container element
 * @param {string} raw - Raw thought text
 * @param {Function} createChip - Function to create chip element
 */
export function renderThoughtsContent(container, raw, createChip) {
    const CHIP_RE = /\x00CHIP:(\{[\s\S]*?\})\x00/g;
    const parts = [];
    let lastIdx = 0;
    let m;
    while ((m = CHIP_RE.exec(raw)) !== null) {
        if (m.index > lastIdx) {
            parts.push({ t: 'text', v: raw.slice(lastIdx, m.index) });
        }
        parts.push({ t: 'chip', j: m[1] });
        lastIdx = m.index + m[0].length;
    }
    if (lastIdx < raw.length) {
        parts.push({ t: 'text', v: raw.slice(lastIdx) });
    }

    // Preserve existing chip elements by id
    const existing = {};
    container.querySelectorAll('.tc[data-tc-id]').forEach(c => {
        existing[c.dataset.tcId] = c;
    });

    container.textContent = '';
    const frag = document.createDocumentFragment();

    parts.forEach(part => {
        if (part.t === 'text' && part.v) {
            const structured = tryRenderThoughtJSON(part.v);
            frag.appendChild(structured || _renderPlainText(part.v));
        } else if (part.t === 'chip') {
            try {
                const chip = JSON.parse(part.j);
                if (chip.id && existing[chip.id]) {
                    frag.appendChild(existing[chip.id]);
                } else if (createChip) {
                    frag.appendChild(createChip(chip));
                }
            } catch (_) {
                frag.appendChild(_renderPlainText(part.j));
            }
        }
    });

    container.appendChild(frag);
}

/**
 * Render plain text into paragraphs with proper line breaks.
 * \n\n → paragraph break (tight 4px margin)
 * \n   → <br> line break within a paragraph
 */
function _renderPlainText(text) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tb-text-seg tb-plain';
    const paragraphs = text.split(/\n{2,}/);
    for (const paraText of paragraphs) {
        if (!paraText.trim()) continue;
        const p = document.createElement('p');
        p.className = 'tb-para';
        const lines = paraText.split('\n');
        for (let j = 0; j < lines.length; j++) {
            if (j > 0) p.appendChild(document.createElement('br'));
            p.appendChild(document.createTextNode(lines[j]));
        }
        wrapper.appendChild(p);
    }
    return wrapper;
}

/**
 * Detect structured thinking content (JSON or markdown)
 * @param {string} text - Text to check
 * @returns {HTMLElement|null}
 */
export function tryRenderThoughtJSON(text) {
    const trimmed = text.trim();
    const knownFields = ['agent', 'context', 'task'];

    if (trimmed.startsWith('{')) {
        let obj;
        try { obj = JSON.parse(trimmed); } catch (_) { obj = null; }

        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            if (knownFields.some(f => f in obj)) {
                return buildStructuredThought(obj, knownFields);
            }
        }

        const fields = extractPartialJSONFields(trimmed);
        if (fields.size > 0 && [...fields.keys()].some(k => knownFields.includes(k))) {
            return buildStructuredThought(Object.fromEntries(fields), knownFields);
        }
    }

    if (looksLikeMarkdown(text)) {
        const wrapper = document.createElement('div');
        wrapper.className = 'tb-text-seg tb-markdown';
        wrapper.innerHTML = renderMarkdown(text);
        return wrapper;
    }

    return null;
}

/**
 * Extract "key": "value" pairs from partial/malformed JSON
 * @param {string} text - Text to parse
 * @returns {Map<string, string>}
 */
export function extractPartialJSONFields(text) {
    const fields = new Map();
    const pairRe = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)("?)/g;
    let m;
    while ((m = pairRe.exec(text)) !== null) {
        const key = m[1];
        const val = m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        const isComplete = m[3] === '"';
        fields.set(key, val + (isComplete ? '' : '\u2026'));
    }
    return fields;
}

/**
 * Build a labeled structured thought DOM
 * @param {object} obj - Data object
 * @param {string[]} knownFields - Known field names
 * @returns {HTMLElement}
 */
export function buildStructuredThought(obj, knownFields) {
    const wrapper = h('div', { class: 'tb-structured' });
    const orderedKeys = [...knownFields.filter(f => f in obj),
                         ...Object.keys(obj).filter(k => !knownFields.includes(k))];

    for (const key of orderedKeys) {
        const val = obj[key];
        wrapper.appendChild(h('span', { class: 'tc-lbl' }, key));
        const valText = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
        if (typeof val === 'string' && looksLikeMarkdown(val)) {
            const md = document.createElement('div');
            md.className = 'tb-text-seg tb-markdown';
            md.innerHTML = renderMarkdown(val);
            wrapper.appendChild(md);
        } else {
            wrapper.appendChild(h('pre', { class: 'tb-text-seg' }, valText));
        }
    }
    return wrapper;
}

/**
 * Clear all thinking timers
 */
export function clearThinkingTimers() {
    _thinkingTimers.forEach(timerId => clearInterval(timerId));
    _thinkingTimers.clear();
}

/**
 * Get active bubble count
 * @returns {number}
 */
export function getActiveBubbleCount() {
    return document.querySelectorAll('.thoughts-bubble.is-streaming').length;
}
