/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Markdown Handler
   ═══════════════════════════════════════════════════════════════════
   Markdown rendering: _renderMarkdown(), _looksLikeMarkdown(),
   marked configuration, extractCodeBlocks()

   Dependencies: marked.js (global)
   ═══════════════════════════════════════════════════════════════════ */

import { OverlordUI } from '../engine.js';

/**
 * Render markdown text to HTML
 * @param {string} text - Markdown text
 * @returns {string} - HTML string
 */
export function renderMarkdown(text) {
    try {
        if (typeof marked !== 'undefined') {
            return marked.parse(text);
        }
    } catch (_) { /* fall through */ }
    return OverlordUI.escapeHtml(text);
}

/**
 * Check if text looks like markdown
 * @param {string} text - Text to check
 * @returns {boolean}
 */
export function looksLikeMarkdown(text) {
    return /^#{1,6}\s|^\s*[-*]\s|\*\*|__|\[.*\]\(|```|^\d+\.\s|^>\s|~~.*~~|-\s*\[ ?\]|\|.*\|.*\|/m.test(text);
}

/**
 * Check if text looks like a plan
 * @param {string} text - Text to check
 * @returns {boolean}
 */
export function looksLikePlan(text) {
    return typeof text === 'string' &&
        (text.startsWith('Plan Approved') || text.includes('Plan ready'));
}

/**
 * Extract code blocks from markdown text
 * @param {string} text - Markdown text
 * @returns {Array<{language: string, code: string}>}
 */
export function extractCodeBlocks(text) {
    const blocks = [];
    const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g;
    let match;
    
    while ((match = codeBlockRe.exec(text)) !== null) {
        blocks.push({
            language: match[1] || 'text',
            code: match[2].trim()
        });
    }
    
    return blocks;
}

/**
 * Check if text contains code blocks
 * @param {string} text - Text to check
 * @returns {boolean}
 */
export function hasCodeBlocks(text) {
    return /```[\s\S]*?```/.test(text);
}

/**
 * Get the primary language from code blocks
 * @param {string} text - Markdown text
 * @returns {string|null}
 */
export function getPrimaryCodeLanguage(text) {
    const blocks = extractCodeBlocks(text);
    if (blocks.length === 0) return null;
    
    // Return the language of the first/largest block
    const sorted = blocks.sort((a, b) => b.code.length - a.code.length);
    return sorted[0].language || null;
}

/**
 * Strip markdown formatting and return plain text
 * @param {string} text - Markdown text
 * @returns {string}
 */
export function stripMarkdown(text) {
    if (!text) return '';
    
    // Code blocks
    text = text.replace(/```[\s\S]*?```/g, '');
    
    // Inline code
    text = text.replace(/`[^`]+`/g, '');
    
    // Headers
    text = text.replace(/^#{1,6}\s+/gm, '');
    
    // Bold/italic
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
    text = text.replace(/\*([^*]+)\*/g, '$1');
    text = text.replace(/__([^_]+)__/g, '$1');
    text = text.replace(/_([^_]+)_/g, '$1');
    
    // Links
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    
    // Images
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
    
    // Lists
    text = text.replace(/^[\s]*[-*+]\s+/gm, '');
    text = text.replace(/^[\s]*\d+\.\s+/gm, '');
    
    // Blockquotes
    text = text.replace(/^>\s+/gm, '');
    
    // Horizontal rules
    text = text.replace(/^[-*_]{3,}\s*$/gm, '');
    
    return text.trim();
}

/**
 * Estimate token count for text
 * @param {string} text - Text to estimate
 * @returns {number}
 */
export function estimateTokens(text) {
    if (!text) return 0;
    return Math.max(1, Math.ceil(text.length / 3.5));
}

/**
 * Truncate text to a maximum length while preserving words
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string}
 */
export function truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    
    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > maxLength * 0.8) {
        return truncated.substring(0, lastSpace) + '...';
    }
    
    return truncated + '...';
}

/**
 * Configure marked options
 * @param {object} options - Marked options
 */
export function configureMarked(options) {
    if (typeof marked !== 'undefined' && marked.options) {
        marked.options(options);
    }
}

// Default marked configuration
export const DEFAULT_MARKED_OPTIONS = {
    breaks: true,
    gfm: true,
    headerIds: false,
    mangle: false
};
