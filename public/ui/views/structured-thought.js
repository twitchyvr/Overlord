/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Structured Thought
   ═══════════════════════════════════════════════════════════════════
   Structured thought rendering: _buildStructuredThought(),
   _extractPartialJSONFields(), JSON field extraction

   Dependencies: engine.js
   ═══════════════════════════════════════════════════════════════════ */

import { h } from '../engine.js';
import { looksLikeMarkdown, renderMarkdown } from './markdown-handler.js';

/**
 * Known structured thought fields
 */
export const KNOWN_THOUGHT_FIELDS = ['agent', 'context', 'task', 'reasoning', 'plan', 'goal', 'status'];

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
 * Check if text looks like structured thought JSON
 * @param {string} text - Text to check
 * @returns {boolean}
 */
export function looksLikeStructuredThought(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{')) return false;
    
    try {
        const obj = JSON.parse(trimmed);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            return KNOWN_THOUGHT_FIELDS.some(f => f in obj);
        }
    } catch (_) {
        // Check for partial fields
        const fields = extractPartialJSONFields(trimmed);
        return [...fields.keys()].some(k => KNOWN_THOUGHT_FIELDS.includes(k));
    }
    return false;
}

/**
 * Build a labeled structured thought DOM from an object
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
 * Try to render text as structured thought JSON
 * @param {string} text - Text to try
 * @returns {HTMLElement|null}
 */
export function tryRenderStructuredThought(text) {
    const trimmed = text.trim();
    const knownFields = KNOWN_THOUGHT_FIELDS;

    if (trimmed.startsWith('{')) {
        // Attempt 1: complete JSON parse
        let obj;
        try { obj = JSON.parse(trimmed); } catch (_) { obj = null; }

        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            if (knownFields.some(f => f in obj)) {
                return buildStructuredThought(obj, knownFields);
            }
        }

        // Attempt 2: incomplete/streaming JSON — extract "key": "value" pairs
        const fields = extractPartialJSONFields(trimmed);
        if (fields.size > 0 && [...fields.keys()].some(k => knownFields.includes(k))) {
            return buildStructuredThought(Object.fromEntries(fields), knownFields);
        }
    }

    // Attempt 3: if text has markdown indicators, render as markdown
    if (looksLikeMarkdown(text)) {
        const wrapper = document.createElement('div');
        wrapper.className = 'tb-text-seg tb-markdown';
        wrapper.innerHTML = renderMarkdown(text);
        return wrapper;
    }

    return null;
}

/**
 * Parse structured thought from streaming text
 * @param {string} text - Streaming text
 * @returns {object|null}
 */
export function parseStreamingStructuredThought(text) {
    const trimmed = text.trim();
    
    // Try complete JSON
    try {
        const obj = JSON.parse(trimmed);
        if (obj && typeof obj === 'object') {
            return { complete: true, data: obj };
        }
    } catch (_) {
        // Not complete JSON, try extracting fields
    }
    
    // Extract partial fields
    const fields = extractPartialJSONFields(trimmed);
    if (fields.size > 0) {
        return { 
            complete: false, 
            data: Object.fromEntries(fields),
            fields: fields 
        };
    }
    
    return null;
}

/**
 * Format structured thought for display
 * @param {object} obj - Structured thought object
 * @returns {string}
 */
export function formatStructuredThought(obj) {
    const lines = [];
    for (const [key, val] of Object.entries(obj)) {
        const formattedVal = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
        lines.push(`${key}: ${formattedVal}`);
    }
    return lines.join('\n');
}

/**
 * Get field order for structured thought display
 * @param {object} obj - Structured thought object
 * @returns {string[]}
 */
export function getFieldOrder(obj) {
    const knownFields = KNOWN_THOUGHT_FIELDS;
    return [
        ...knownFields.filter(f => f in obj),
        ...Object.keys(obj).filter(k => !knownFields.includes(k))
    ];
}

/**
 * Check if structured thought has all required fields
 * @param {object} obj - Structured thought object
 * @param {string[]} requiredFields - Required field names
 * @returns {boolean}
 */
export function hasRequiredFields(obj, requiredFields) {
    return requiredFields.every(f => f in obj);
}

/**
 * Validate structured thought structure
 * @param {object} obj - Object to validate
 * @returns {object} - { valid: boolean, errors: string[] }
 */
export function validateStructuredThought(obj) {
    const errors = [];
    
    if (!obj || typeof obj !== 'object') {
        return { valid: false, errors: ['Not an object'] };
    }
    
    if (Array.isArray(obj)) {
        return { valid: false, errors: ['Should be object, not array'] };
    }
    
    // Check for at least one known field
    const hasKnownField = KNOWN_THOUGHT_FIELDS.some(f => f in obj);
    if (!hasKnownField && Object.keys(obj).length > 0) {
        errors.push('No known thought fields found');
    }
    
    return { 
        valid: errors.length === 0, 
        errors 
    };
}
