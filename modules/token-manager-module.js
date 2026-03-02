// ==================== TOKEN MANAGER MODULE ====================
// Handles token limits, context truncation, and throttling
// Following MiniMax best practices for API usage

let hub = null;

// Configuration
// MiniMax M2.5: 204,800 context window, ~66,000 max output
// Safe input headroom: 204,800 - 66,000 = ~138,800 tokens usable for input
//
// SYSTEM_OVERHEAD_RESERVE: tokens reserved for system prompt + tool definitions.
//   System prompt grows with: cookbook docs, session notes, timeline, agent list,
//   custom instructions, milestone section.  42 tool JSON schemas ≈ 5,000 tokens.
//   Conservative reserve = 55,000 — leaves 83,800 tokens for conversation history.
let CONFIG = {
    MAX_CONTEXT_TOKENS: 204800,        // Full model context window (for display)
    MAX_INPUT_TOKENS: 138800,          // Safe input limit (204800 - 66000 output)
    SYSTEM_OVERHEAD_RESERVE: 55000,    // Reserved for system prompt + tool definitions
    MAX_HISTORY_TOKENS: 83800,         // = MAX_INPUT_TOKENS - SYSTEM_OVERHEAD_RESERVE
    ESTIMATE_TOKENS_MULTI: 0.25,       // Rough estimate: 1 token ≈ 4 chars
    MAX_OUTPUT_TOKENS: 66000,          // Default max output (~66k)
    TRUNCATE_THRESHOLD: 0.85,          // Legacy field (kept for compatibility)
};

// Simple tokenizer (approximate)
function estimateTokens(text) {
    if (!text) return 0;
    // Basic estimation: ~4 characters per token
    return Math.ceil(text.length * CONFIG.ESTIMATE_TOKENS_MULTI);
}

// Estimate tokens for a message
function estimateMessageTokens(msg) {
    if (!msg) return 0;
    
    let tokens = 0;
    
    if (typeof msg.content === 'string') {
        tokens += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
            if (block.text) {
                tokens += estimateTokens(block.text);
            } else if (block.input) {
                // Tool input
                tokens += estimateTokens(JSON.stringify(block.input));
            } else if (block.content) {
                tokens += estimateTokens(block.content);
            }
        }
    }
    
    // Add overhead for role and structure
    tokens += 20; 
    
    return tokens;
}

// Calculate total tokens in conversation history
function calculateHistoryTokens(history) {
    if (!Array.isArray(history)) return 0;
    return history.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

// Truncate conversation history to stay within token limit
// CRITICAL: Must preserve complete tool_use + tool_result pairs - NEVER split them
function truncateHistory(history, maxTokens = CONFIG.MAX_HISTORY_TOKENS) {
    if (!Array.isArray(history) || history.length === 0) return [];

    const messagesBefore = history.length;
    let totalTokens = calculateHistoryTokens(history);

    // If we're under the limit, no need to truncate
    if (totalTokens <= maxTokens) return [...history];
    
    // First, sanitize to remove any broken tool chains
    const sanitized = sanitizeHistory(history);
    
    // If still over limit, do smart truncation
    totalTokens = calculateHistoryTokens(sanitized);
    if (totalTokens <= maxTokens) return sanitized;
    
    // Strategy: 
    // 1. Always keep first message (system)
    // 2. Find all tool_use + tool_result pairs and treat as atomic units
    // 3. Keep recent pairs intact, drop oldest pairs if needed
    // 4. Fill remaining space with regular messages from the end
    
    const result = [];
    
    // Always keep first message (system prompt)
    if (sanitized.length > 0) {
        result.push(sanitized[0]);
    }
    
    // Build list of "atomic units" - either single messages or tool pairs
    const units = [];
    let i = 1; // Start after system message
    
    while (i < sanitized.length) {
        const msg = sanitized[i];
        const isToolUse = msg.role === 'assistant' && Array.isArray(msg.content) && 
                          msg.content.some(c => c.type === 'tool_use');
        
        if (isToolUse) {
            // This is a tool_use message - check if next message is its tool_result
            const nextMsg = sanitized[i + 1];
            const isToolResult = nextMsg && nextMsg.role === 'user' && 
                                Array.isArray(nextMsg.content) &&
                                nextMsg.content.some(c => c.type === 'tool_result');
            
            if (isToolResult) {
                // Atomic pair: tool_use + tool_result
                units.push({ type: 'pair', msgs: [msg, nextMsg], tokens: estimateMessageTokens(msg) + estimateMessageTokens(nextMsg) });
                i += 2;
            } else {
                // Orphan tool_use (shouldn't happen after sanitize, but handle anyway)
                units.push({ type: 'orphan', msgs: [msg], tokens: estimateMessageTokens(msg) });
                i++;
            }
        } else {
            // Regular message
            units.push({ type: 'single', msgs: [msg], tokens: estimateMessageTokens(msg) });
            i++;
        }
    }
    
    // Calculate tokens used by system message
    const systemTokens = estimateMessageTokens(sanitized[0]);
    let availableTokens = maxTokens - systemTokens;
    
    // Add units from the end (most recent first)
    for (let j = units.length - 1; j >= 0 && availableTokens > 0; j--) {
        const unit = units[j];
        if (unit.tokens <= availableTokens) {
            // Add all messages from this unit
            for (const m of unit.msgs) {
                result.push(m);
            }
            availableTokens -= unit.tokens;
        }
    }
    
    // Sort result to maintain chronological order (excluding first message)
    if (result.length > 1) {
        const system = result[0];
        const rest = result.slice(1);
        rest.sort((a, b) => {
            const aIdx = sanitized.findIndex(m => m === a);
            const bIdx = sanitized.findIndex(m => m === b);
            return aIdx - bIdx;
        });
        result.length = 0;
        result.push(system, ...rest);
    }

    // Record that compaction occurred
    try {
        const tracker = hub?.getService('contextTracker');
        if (tracker?.recordCompaction) {
            tracker.recordCompaction({
                messagesBefore,
                messagesAfter: result.length,
                tokensBefore: totalTokens,
                tokensAfter: calculateHistoryTokens(result),
                reason: 'token_limit'
            });
        }
    } catch (e) {}

    hub?.log(`[TokenManager] Compacted: ${messagesBefore} → ${result.length} messages`, 'info');

    return result;
}

// Check if we need to truncate
function needsTruncation(history) {
    const tokens = calculateHistoryTokens(history);
    // Use MAX_HISTORY_TOKENS (soft limit) as truncation threshold for consistency
    return tokens > CONFIG.MAX_HISTORY_TOKENS;
}

// Truncate file content if too large
function truncateFileContent(content, maxTokens = CONFIG.MAX_INPUT_TOKENS) {
    const tokens = estimateTokens(content);
    
    if (tokens <= maxTokens) return content;
    
    // Estimate chars to keep
    const maxChars = Math.floor(maxTokens / CONFIG.ESTIMATE_TOKENS_MULTI);
    
    // Truncate and add note
    const truncated = content.substring(0, maxChars);
    const note = `\n\n[... Content truncated. Original was ~${tokens} tokens, now ~${maxTokens} tokens ...]\n`;
    
    return truncated + note;
}

// Truncate tool result if too large (prevents huge context)
function truncateToolResult(result, maxTokens = 8000) {
    if (!result) return result;
    
    const str = typeof result === 'string' ? result : JSON.stringify(result);
    const tokens = estimateTokens(str);
    
    if (tokens <= maxTokens) return result;
    
    const maxChars = Math.floor(maxTokens / CONFIG.ESTIMATE_TOKENS_MULTI);
    const truncated = str.substring(0, maxChars);
    
    return truncated + `\n\n[... Result truncated (~${tokens} → ~${maxTokens} tokens) ...]`;
}

// Sanitize conversation history (fix broken tool chains)
// CRITICAL: Must preserve ALL tool_use + tool_result pairs - not just check for presence
function sanitizeHistory(history) {
    if (!Array.isArray(history) || history.length === 0) return [];
    
    const clean = [];
    const msgs = [...history];
    
    // First pass: collect all valid tool_use IDs (those that have matching tool_results)
    const validToolUseIds = new Set();
    
    for (let i = 0; i < msgs.length; i++) {
        const msg = msgs[i];
        
        // Pass through non-assistant messages without content arrays
        if (msg.role !== 'assistant' || !Array.isArray(msg.content)) {
            continue;
        }
        
        // Check if this message has tool_use blocks
        const toolUseBlocks = msg.content.filter(c => c.type === 'tool_use');
        
        if (toolUseBlocks.length === 0) {
            continue;
        }
        
        // Has tool_use - check if it has matching tool_result
        const toolUseIds = new Set(toolUseBlocks.map(t => t.id));
        
        // Look at subsequent messages for tool_results
        let foundResults = new Map();
        let j = i + 1;
        while (j < msgs.length && foundResults.size < toolUseIds.size) {
            const nextMsg = msgs[j];
            if (nextMsg.role !== 'user' || !Array.isArray(nextMsg.content)) {
                j++;
                continue;
            }
            
            // Extract tool_result blocks
            const results = nextMsg.content.filter(c => c.type === 'tool_result');
            for (const result of results) {
                if (result.tool_use_id) {
                    foundResults.set(result.tool_use_id, true);
                }
            }
            j++;
        }
        
        // If ALL tool_use IDs have matching tool_results, mark them as valid
        let allFound = true;
        for (const id of toolUseIds) {
            if (!foundResults.has(id)) {
                allFound = false;
                break;
            }
        }
        
        if (allFound) {
            for (const id of toolUseIds) {
                validToolUseIds.add(id);
            }
        }
    }
    
    // Second pass: build clean history, filtering out broken chains
    for (let i = 0; i < msgs.length; i++) {
        const msg = msgs[i];
        
        // Pass through messages without content arrays
        if (!Array.isArray(msg.content)) {
            clean.push(msg);
            continue;
        }
        
        // For assistant messages with tool_use: only keep if ALL tool_uses are valid
        if (msg.role === 'assistant') {
            const toolUses = msg.content.filter(c => c.type === 'tool_use');
            if (toolUses.length === 0) {
                clean.push(msg);
            } else {
                // Check if all tool_uses are in valid set
                const allValid = toolUses.every(t => validToolUseIds.has(t.id));
                if (allValid) {
                    clean.push(msg);
                }
                // Otherwise skip (broken chain)
            }
            continue;
        }
        
        // For user messages with tool_result: only keep if ALL tool_results reference valid tool_uses
        if (msg.role === 'user') {
            const results = msg.content.filter(c => c.type === 'tool_result');
            if (results.length === 0) {
                clean.push(msg);
            } else {
                // Check if all tool_result tool_use_ids are in valid set
                const allValid = results.every(r => !r.tool_use_id || validToolUseIds.has(r.tool_use_id));
                if (allValid) {
                    clean.push(msg);
                }
                // Otherwise skip (orphan tool_result)
            }
            continue;
        }
        
        // All other messages pass through
        clean.push(msg);
    }
    
    return clean;
}

// Strip base64 screenshot payloads from old tool_result messages.
// Screenshots are identified by tool_result content that is a JSON string
// containing a "base64" field (set by screenshot-module.js).
//
// keepLast = 1  → keep the most recent screenshot intact (AI may still need it)
// keepLast = 0  → strip ALL screenshots (use during emergency context recovery)
//
// Stripped content becomes a compact text placeholder so the AI still knows
// a screenshot was taken without carrying tens-of-thousands of token overhead.
function stripScreenshots(history, keepLast = 1) {
    if (!Array.isArray(history)) return history;

    // First pass: collect indices of screenshot tool_result messages (oldest → newest)
    const screenshotIndices = [];
    for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        if (msg.role !== 'user' || !Array.isArray(msg.content)) continue;
        for (const block of msg.content) {
            if (
                block.type === 'tool_result' &&
                typeof block.content === 'string' &&
                block.content.includes('"base64":') &&
                block.content.includes('"success":true')
            ) {
                screenshotIndices.push(i);
                break; // one entry per message
            }
        }
    }

    if (screenshotIndices.length === 0) return history; // nothing to strip

    // Indices to preserve (the last keepLast screenshots are kept as-is)
    // keepLast=0 means strip ALL screenshots (keepSet should be empty)
    const keepCount = Math.max(0, keepLast);
    const keepSet = keepCount > 0 
        ? new Set(screenshotIndices.slice(-keepCount)) 
        : new Set();
    let stripped = 0;

    const result = history.map((msg, i) => {
        if (!screenshotIndices.includes(i) || keepSet.has(i)) return msg;

        // Strip base64 from each tool_result block in this message
        const newContent = msg.content.map(block => {
            if (
                block.type !== 'tool_result' ||
                typeof block.content !== 'string' ||
                !block.content.includes('"base64":')
            ) return block;

            try {
                const data = JSON.parse(block.content);
                const sizeKB = data.sizeKB || '?';
                const url    = data.url    || '(unknown)';
                // Replace the base64 blob with a tiny descriptor
                data.base64 = `[stripped — ${sizeKB} KB image data removed from context after initial analysis]`;
                stripped++;
                return { ...block, content: JSON.stringify(data) };
            } catch {
                return block; // Can't parse — leave untouched
            }
        });

        return { ...msg, content: newContent };
    });

    return result;
}

// Quick check: does history contain screenshot base64 payloads that could be stripped?
function hasStrippableScreenshots(history, keepLast = 1) {
    if (!Array.isArray(history)) return false;
    let count = 0;
    for (const msg of history) {
        if (msg.role !== 'user' || !Array.isArray(msg.content)) continue;
        for (const block of msg.content) {
            if (
                block.type === 'tool_result' &&
                typeof block.content === 'string' &&
                block.content.includes('"base64":') &&
                block.content.includes('"success":true')
            ) { count++; break; }
        }
    }
    // keepLast=0 means strip all, so any screenshot can be stripped
    // keepLast>=1 means keep that many, so strippable if count > keepLast
    return keepLast === 0 ? count > 0 : count > keepLast;
}

// Get conversation stats
function getStats(history) {
    const tokens = calculateHistoryTokens(history);
    const msgs = Array.isArray(history) ? history.length : 0;
    
    // FIXED: Use correct max tokens for calculation
    // The issue was using MAX_CONTEXT_TOKENS for calculation but exceeding it
    // Now we use MAX_HISTORY_TOKENS as the actual limit for history
    const maxHistoryTokens = CONFIG.MAX_HISTORY_TOKENS;
    const maxContextTokens = CONFIG.MAX_CONTEXT_TOKENS;
    
    // Calculate percentage based on history limit (not context limit)
    // This is what we're actually trying to stay under
    let usagePercent = Math.round((tokens / maxHistoryTokens) * 100);
    
    // Cap at 100% for display (actual can exceed during transition)
    const displayPercent = Math.min(usagePercent, 100);
    
    // Determine status based on actual context usage
    let status = 'normal';
    if (tokens > maxContextTokens) {
        status = 'critical'; // Over context limit!
    } else if (tokens > maxHistoryTokens) {
        status = 'warning'; // Over history limit, will be truncated
    } else if (usagePercent >= 85) {
        status = 'caution'; // Getting close
    }
    
    // Get compaction stats from context tracker if available
    let compactionStats = {
        totalCompactions: 0,
        lastCompaction: null,
        compactionPreserved: 0,
        compactionDropped: 0
    };

    try {
        const tracker = hub?.getService('contextTracker');
        if (tracker?.getCompactionStats) {
            const trackerStats = tracker.getCompactionStats();
            const totalCompactions = trackerStats.totalCompactions || 0;
            compactionStats = {
                totalCompactions,
                lastCompaction: trackerStats.lastCompaction,
                compactionPreserved: totalCompactions > 0 ? maxHistoryTokens : 0,
                compactionDropped: totalCompactions > 0 ? Math.max(0, tokens - maxHistoryTokens) : 0
            };
        }
    } catch (e) {
        // Tracker not available
    }
    
    return {
        messages: msgs,
        estimatedTokens: tokens,
        maxTokens: maxContextTokens,
        maxHistoryTokens: maxHistoryTokens,
        usagePercent: displayPercent, // Capped at 100 for display
        rawUsagePercent: usagePercent, // Actual value (can exceed 100)
        needsTruncation: tokens > maxHistoryTokens,
        status: status,
        truncationWillTrigger: Math.round((tokens / maxHistoryTokens) * 100) + '% of history limit',
        // Compaction info
        compaction: compactionStats
    };
}

// Validate history has complete tool_use + tool_result pairs
// Returns { valid: true } or { valid: false, errors: [...] }
function validateHistory(history) {
    if (!Array.isArray(history)) return { valid: false, errors: ['Not an array'] };
    
    const errors = [];
    const toolUseIds = new Map(); // id -> found_result
    
    for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        
        if (!Array.isArray(msg.content)) continue;
        
        // Check for tool_use
        const toolUses = msg.content.filter(c => c.type === 'tool_use');
        for (const tool of toolUses) {
            if (!tool.id) {
                errors.push(`Message ${i}: tool_use without id`);
            } else {
                toolUseIds.set(tool.id, false); // Not yet matched
            }
        }
        
        // Check for tool_result
        const results = msg.content.filter(c => c.type === 'tool_result');
        for (const result of results) {
            if (!result.tool_use_id) {
                errors.push(`Message ${i}: tool_result without tool_use_id`);
            } else if (!toolUseIds.has(result.tool_use_id)) {
                errors.push(`Message ${i}: tool_result references unknown id ${result.tool_use_id}`);
            } else {
                toolUseIds.set(result.tool_use_id, true); // Matched
            }
        }
    }
    
    // Check for unmatched tool_uses
    for (const [id, matched] of toolUseIds) {
        if (!matched) {
            errors.push(`tool_use ${id} has no matching tool_result`);
        }
    }
    
    return {
        valid: errors.length === 0,
        errors: errors
    };
}

async function init(h) {
    hub = h;
    
    // Get model-specific config from config service
    const config = hub.getService('config');
    if (config && config.modelSpec) {
        const ctxWindow = config.modelSpec.contextWindow || 204800;
        const maxOutput = config.modelSpec.maxOutput || 66000;
        // Full context window for display
        CONFIG.MAX_CONTEXT_TOKENS = ctxWindow;
        // Safe input: context window minus max output headroom
        CONFIG.MAX_INPUT_TOKENS = Math.floor(ctxWindow - maxOutput);
        // History limit = safe input minus system overhead reserve.
        // The system prompt + 42 tool defs can be 40,000–60,000 tokens, especially
        // when cookbook docs / project memory are loaded.  We reserve 55,000 tokens
        // for that overhead so the history budget doesn't crowd it out.
        CONFIG.MAX_HISTORY_TOKENS = Math.max(40000, CONFIG.MAX_INPUT_TOKENS - CONFIG.SYSTEM_OVERHEAD_RESERVE);
        CONFIG.MAX_OUTPUT_TOKENS = maxOutput;

        hub.log('Token Manager initialized: ' + config.model + ' | Context: ' + ctxWindow + ', Max Output: ' + maxOutput, 'info');
    }
    
    hub.registerService('tokenManager', {
        estimateTokens,
        estimateMessageTokens,
        calculateHistoryTokens,
        truncateHistory,
        needsTruncation,
        truncateFileContent,
        truncateToolResult,
        sanitizeHistory,
        stripScreenshots,
        hasStrippableScreenshots,
        getStats,
        validateHistory,
        CONFIG
    });
    
    hub.log('🔢 Token Manager loaded (max: ' + CONFIG.MAX_CONTEXT_TOKENS + ' tokens)', 'success');
}

module.exports = { 
    init, 
    estimateTokens, 
    truncateHistory, 
    sanitizeHistory, 
    stripScreenshots, 
    hasStrippableScreenshots, 
    getStats, 
    validateHistory, 
    CONFIG,
    // Also export internal functions needed by tests
    calculateHistoryTokens,
    needsTruncation,
    estimateMessageTokens
};
