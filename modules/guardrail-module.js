// ==================== GUARDRAIL MODULE ====================
// Comprehensive input/output sanitization and security
// All code outputs and file operations pass through here

const fs = require('fs');
const path = require('path');

let HUB = null;

// Character sanitization map - problematic chars to safe alternatives
const CHAR_MAP = {
    // Zero-width characters
    '\u200B': '',  // Zero-width space
    '\u200C': '',  // Zero-width non-joiner
    '\u200D': '',  // Zero-width joiner
    '\uFEFF': '',  // Byte order mark
    
    // Directional formatting
    '\u202A': '',  // Left-to-right embedding
    '\u202B': '',  // Right-to-left embedding
    '\u202C': '',  // Pop directional formatting
    '\u202D': '',  // Left-to-right override
    '\u202E': '',  // Right-to-left override
    
    // Control characters (except newlines, tabs)
    '\u0000': '',
    '\u0001': '',
    '\u0002': '',
    '\u0003': '',
    '\u0004': '',
    '\u0005': '',
    '\u0006': '',
    '\u0007': '',
    '\u0008': '',
    '\u000B': '',  // Vertical tab
    '\u000C': '',  // Form feed
    '\u000E': '',
    '\u000F': '',
    '\u0010': '',
    '\u0011': '',
    '\u0012': '',
    '\u0013': '',
    '\u0014': '',
    '\u0015': '',
    '\u0016': '',
    '\u0017': '',
    '\u0018': '',
    '\u0019': '',
    '\u001A': '',
    '\u001B': '',
    '\u001C': '',
    '\u001D': '',
    '\u001E': '',
    '\u001F': '',
};

// HTML entities that must be decoded
const HTML_ENTITIES = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&mdash;': '--',
    '&ndash;': '-',
    '&copy;': '(c)',
    '&reg;': '(R)',
    '&trade;': '(TM)',
};

// Unicode quotes to ASCII
const QUOTE_MAP = {
    '\u201C': '"',  // Left double quote
    '\u201D': '"',  // Right double quote
    '\u2018': "'",  // Left single quote
    '\u2019': "'",  // Right single quote
    '\u201B': "'",  // Single high-reversed-9 quote
    '\u201F': "'",  // Double high-reversed-9 quote
};

// Unicode dashes to ASCII
const DASH_MAP = {
    '\u2010': '-',  // Hyphen
    '\u2011': '-',  // Non-breaking hyphen
    '\u2012': '-',  // Figure dash
    '\u2013': '-',  // En dash
    '\u2014': '-',  // Em dash
    '\u2015': '--', // Horizontal bar
    '\u00AD': '-',  // Soft hyphen
};

// Prompt injection patterns to detect
const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?|constraints?)/i,
    /disregard\s+(all\s+)?(previous|prior|above)/i,
    /forget\s+(all\s+)?(previous|prior|above)/i,
    /new\s+instruction(s)?:/i,
    /system\s*:\s*/i,
    /you\s+(are\s+)?(now\s+)?(allowed|permitted)\s+to/i,
    /override\s+(the\s+)?(safety|security)/i,
    /bypass\s+(the\s+)?(safety|security)/i,
    /disable\s+(safety|security)/i,
    /pretend\s+(to\s+be|you\s+are)/i,
    /roleplay\s+as/i,
    /\\(user\\)|\\(system\\)|\\(assistant\\)/i,
    /<\|user\|>|<\|system\|>|<\|assistant\|>/i,
    /\[INST\]|\[\/INST\]/i,
    /<s>.*?<\/s>/i,
    /<\|endofprompt\|>/i,
];

// Dangerous shell patterns
const DANGEROUS_PATTERNS = [
    /rm\s+-rf\s+\//i,
    /rmdir\s+\//i,
    /mkfs\./i,
    /dd\s+if=.*of=\/dev\//i,
    /:\(\)\s*\{/i,  // Fork bomb
    /chmod\s+777\s+/i,
    /chown\s+-R\s+root/i,
    /wget.*\|\s*sh/i,
    /curl.*\|\s*sh/i,
    /;\s*rm\s+/i,
    /&&\s*rm\s+/i,
    /\|\s*rm\s+/i,
    /\>\s*\/dev\//i,
    /sed\s+-i.*\/etc\//i,
    /patch\s+-p0.*\/etc\//i,
];

// ==================== CORE FUNCTIONS ====================

// Primary sanitization function - use for ALL output
function sanitizeForOutput(str) {
    if (typeof str !== 'string') return str;
    
    let sanitized = str;
    
    // Step 1: Decode HTML entities FIRST (before other processing)
    for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
        sanitized = sanitized.split(entity).join(char);
    }
    
    // Step 2: Remove zero-width and control characters
    for (const [bad, good] of Object.entries(CHAR_MAP)) {
        sanitized = sanitized.split(bad).join(good);
    }
    
    // Step 3: Normalize quotes
    for (const [smart, ascii] of Object.entries(QUOTE_MAP)) {
        sanitized = sanitized.split(smart).join(ascii);
    }
    
    // Step 4: Normalize dashes
    for (const [unicodeDash, asciiDash] of Object.entries(DASH_MAP)) {
        sanitized = sanitized.split(unicodeDash).join(asciiDash);
    }
    
    // Step 5: Remove line continuation for safety
    sanitized = sanitized.replace(/\\\s*[\r\n]/g, ' ');
    
    return sanitized;
}

// Sanitize for search operations
function sanitizeForSearch(str) {
    return sanitizeForOutput(str);
}

// Sanitize for file paths
function sanitizePath(str) {
    if (!str) return str;
    let sanitized = sanitizeForOutput(str);
    // Remove path traversal attempts
    sanitized = sanitized.replace(/\.\./g, '');
    // Remove null bytes
    sanitized = sanitized.replace(/\0/g, '');
    return sanitized;
}

// Check for prompt injection
function detectInjection(str) {
    if (!str) return { safe: true, issues: [] };
    
    const issues = [];
    
    for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(str)) {
            issues.push(`Potential injection detected: ${pattern.source}`);
        }
    }
    
    return {
        safe: issues.length === 0,
        issues
    };
}

// Check for dangerous shell commands
function detectDangerousCommand(str) {
    if (!str) return { safe: true, issues: [] };
    
    const issues = [];
    
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(str)) {
            issues.push(`Dangerous pattern detected: ${pattern.source}`);
        }
    }
    
    return {
        safe: issues.length === 0,
        issues
    };
}

// Safe file write - sanitizes content before writing
function safeWriteFile(filePath, content, encoding = 'utf8') {
    // Sanitize the path
    const safePath = sanitizePath(filePath);
    
    // Sanitize the content
    const safeContent = sanitizeForOutput(content);
    
    // Check for dangerous content
    const injectionCheck = detectInjection(safeContent);
    if (!injectionCheck.safe) {
        return { 
            success: false, 
            error: 'Content blocked: ' + injectionCheck.issues.join('; ') 
        };
    }
    
    try {
        // Ensure directory exists
        const dir = path.dirname(safePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(safePath, safeContent, encoding);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// Safe file read - sanitizes content after reading
function safeReadFile(filePath, encoding = 'utf8') {
    const safePath = sanitizePath(filePath);
    
    try {
        if (!fs.existsSync(safePath)) {
            return { success: false, error: 'File not found' };
        }
        
        let content = fs.readFileSync(safePath, encoding);
        
        // Sanitize the read content
        content = sanitizeForOutput(content);
        
        return { success: true, content };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// Validate patch operation
function validatePatch(search, replace) {
    const issues = [];
    
    // Check search string
    const searchInjection = detectInjection(search);
    if (!searchInjection.safe) {
        issues.push('Search contains injection: ' + searchInjection.issues.join('; '));
    }
    
    // Check replace string
    const replaceInjection = detectInjection(replace);
    if (!replaceInjection.safe) {
        issues.push('Replace contains injection: ' + replaceInjection.issues.join('; '));
    }
    
    // Check for dangerous commands in replace
    if (replace) {
        const dangerous = detectDangerousCommand(replace);
        if (!dangerous.safe) {
            issues.push('Replace contains dangerous commands: ' + dangerous.issues.join('; '));
        }
    }
    
    return {
        valid: issues.length === 0,
        issues
    };
}

// Safe patch - validates and sanitizes
function safePatch(filePath, search, replace) {
    const validation = validatePatch(search, replace);
    if (!validation.valid) {
        return { success: false, error: 'Validation failed: ' + validation.issues.join('; ') };
    }
    
    // Normalize strings
    const normalizedSearch = sanitizeForSearch(search);
    const normalizedReplace = sanitizeForOutput(replace);
    
    // Read file
    const readResult = safeReadFile(filePath);
    if (!readResult.success) {
        return readResult;
    }
    
    // Check if search exists
    if (!readResult.content.includes(normalizedSearch)) {
        return { 
            success: false, 
            error: 'Search string not found in file' 
        };
    }
    
    // Apply patch
    const newContent = readResult.content.split(normalizedSearch).join(normalizedReplace);
    
    // Write back
    return safeWriteFile(filePath, newContent);
}

// ==================== INITIALIZATION ====================

function init(hub) {
    HUB = hub;
    
    // Register the guardrail service
    hub.registerService('guardrail', {
        sanitizeForOutput,
        sanitizeForSearch,
        sanitizePath,
        detectInjection,
        detectDangerousCommand,
        safeWriteFile,
        safeReadFile,
        validatePatch,
        safePatch,
        // Expose constants for other modules
        CHAR_MAP,
        HTML_ENTITIES,
        QUOTE_MAP,
        DASH_MAP,
        INJECTION_PATTERNS,
        DANGEROUS_PATTERNS
    });
    
    hub.log('🛡️ Guardrail module initialized', 'success');
}

// Export for direct use
module.exports = { 
    init,
    sanitizeForOutput,
    sanitizeForSearch,
    sanitizePath,
    detectInjection,
    detectDangerousCommand,
    safeWriteFile,
    safeReadFile,
    validatePatch,
    safePatch
};
