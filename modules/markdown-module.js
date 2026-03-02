// ==================== MARKDOWN MODULE ====================
// Uses marked library for proper markdown parsing

let marked = null;
let hub = null;

async function init(h) {
    hub = h;
    
    // Load marked library
    try {
        marked = require('marked');
        
        // Configure marked for security and proper rendering
        marked.setOptions({
            gfm: true,           // GitHub Flavored Markdown
            breaks: true,        // Convert \n to <br>
            sanitize: false,      // Allow HTML (we escape before)
            smartLists: true,     // Smarter lists
            smartypants: false
        });
        
    } catch (e) {
        hub.log('marked not installed, using fallback', 'warning');
    }
    
    hub.registerService('markdown', {
        parse: (text) => parseMarkdown(text),
        toPlainText: (text) => toPlainText(text),
        escape: (text) => escapeHtml(text)
    });
    
    hub.log('📝 Markdown module loaded (marked)', 'success');
}

function parseMarkdown(text) {
    if (!text) return '';
    
    // First escape any HTML
    text = escapeHtml(text);
    
    // Use marked if available
    if (marked) {
        try {
            return marked.parse(text);
        } catch (e) {
            // Fallback to simple parsing
            return simpleParse(text);
        }
    }
    
    return simpleParse(text);
}

function simpleParse(text) {
    // Simple markdown parser fallback
    // Code blocks
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    // Inline code
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Headers
    text = text.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    text = text.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // Lists
    text = text.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    // Links
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    // Line breaks
    text = text.replace(/\n/g, '<br>');
    
    return text;
}

function toPlainText(text) {
    if (!text) return '';
    
    return text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1')
        .replace(/^#+\s*/gm, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/<[^>]+>/g, '')
        .trim();
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

module.exports = { init, parseMarkdown, escapeHtml };
