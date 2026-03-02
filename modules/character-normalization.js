// ==================== CHARACTER NORMALIZATION UTILITY ====================
// Ensures consistent character handling across all code updates
// Prevents encoding issues like > becoming &gt; etc.

const NORMALIZATION_RULES = {
    // HTML entities that should never appear in code
    htmlEntities: {
        '&gt;': '>',
        '&lt;': '<',
        '&amp;': '&',
        '&quot;': '"',
        '&#39;': "'",
        '&apos;': "'",
        '&nbsp;': ' '
    },
    
    // Unicode quotes that cause issues - use ASCII escapes
    smartQuotes: {
        '\u201C': '\u0022',  // " -> "
        '\u201D': '\u0022',  // " -> "
        '\u2018': '\u0027',  // ' -> '
        '\u2019': '\u0027'   // ' -> '
    },
    
    // Unicode dashes
    dashes: {
        '\u2013': '-',  // en dash
        '\u2014': '-',  // em dash
        '\u2011': '-',  // non-breaking hyphen
        '\u00AD': '-'   // soft hyphen
    },
    
    // Common Unicode characters that break searches
    problemChars: {
        '\u200B': '',  // Zero-width space
        '\u200C': '',  // Zero-width non-joiner
        '\u200D': '',  // Zero-width joiner
        '\uFEFF': ''   // Byte order mark
    }
};

// Normalize a string for search operations
function normalizeForSearch(str) {
    if (typeof str !== 'string') return '';
    
    let normalized = str;
    
    // Remove problem characters
    for (const [bad, good] of Object.entries(NORMALIZATION_RULES.problemChars)) {
        normalized = normalized.split(bad).join(good);
    }
    
    // Convert HTML entities
    for (const [entity, char] of Object.entries(NORMALIZATION_RULES.htmlEntities)) {
        normalized = normalized.split(entity).join(char);
    }
    
    // Normalize quotes
    for (const [smart, plain] of Object.entries(NORMALIZATION_RULES.smartQuotes)) {
        normalized = normalized.split(smart).join(plain);
    }
    
    // Normalize dashes
    for (const [unicodeDash, plainDash] of Object.entries(NORMALIZATION_RULES.dashes)) {
        normalized = normalized.split(unicodeDash).join(plainDash);
    }
    
    return normalized;
}

// Check if a string contains HTML entities (problem!)
function containsHtmlEntities(str) {
    if (typeof str !== 'string') return false;
    return /&[a-z]+;|&#[0-9]+;/i.test(str);
}

// Normalize for file operations
function normalizeForFile(str) {
    return normalizeForSearch(str);
}

// Check if patch would introduce HTML entities
function validatePatch(search, replace) {
    const issues = [];
    
    if (containsHtmlEntities(search)) {
        issues.push('Search string contains HTML entities');
    }
    
    if (containsHtmlEntities(replace)) {
        issues.push('Replace string contains HTML entities');
    }
    
    // Check for mismatched brackets that would break searches
    const openBrackets = (search.match(/[{[(]/g) || []).length;
    const closeBrackets = (search.match(/[}\])]/g) || []).length;
    if (openBrackets !== closeBrackets) {
        issues.push(`Unmatched brackets in search: ${openBrackets} open, ${closeBrackets} close`);
    }
    
    return {
        valid: issues.length === 0,
        issues
    };
}

// Safe patch function with validation
function safePatch(path, search, replace) {
    const fs = require('fs');
    
    // First validate
    const validation = validatePatch(search, replace);
    if (!validation.valid) {
        console.error('⚠️ Patch validation failed:', validation.issues);
        return { success: false, error: validation.issues.join('; ') };
    }
    
    // Normalize both strings
    const normalizedSearch = normalizeForSearch(search);
    const normalizedReplace = normalizeForSearch(replace);
    
    // Read file
    let content = fs.readFileSync(path, 'utf8');
    
    // Check if normalized search exists
    if (!content.includes(normalizedSearch)) {
        // Try to find similar string
        const similar = findSimilarString(content, normalizedSearch);
        return {
            success: false,
            error: 'Search string not found',
            suggestion: similar ? `Did you mean:\n${similar}` : null
        };
    }
    
    // Apply patch
    const newContent = content.split(normalizedSearch).join(normalizedReplace);
    
    // Write back
    fs.writeFileSync(path, newContent, 'utf8');
    
    return { success: true };
}

// Find similar string for suggestions
function findSimilarString(content, search, maxDistance = 10) {
    const lines = content.split('\n');
    const searchWords = search.split(/\s+/).slice(0, 3).join(' ');
    
    for (const line of lines) {
        const lineWords = line.split(/\s+/).slice(0, 3).join(' ');
        if (levenshteinDistance(searchWords.toLowerCase(), lineWords.toLowerCase()) < maxDistance) {
            return line;
        }
    }
    
    return null;
}

// Simple Levenshtein distance
function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    
    const matrix = [];
    
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    
    return matrix[b.length][a.length];
}

// Export utilities
module.exports = {
    init: () => {}, // No initialization needed - utility module
    normalizeForSearch,
    normalizeForFile,
    containsHtmlEntities,
    validatePatch,
    safePatch,
    NORMALIZATION_RULES
};
