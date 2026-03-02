// ==================== SUMMARIZATION MODULE ====================
// AI-powered context compaction to preserve important info while reducing token usage
// Implements Progressive Disclosure: keep user demands, failures, lessons, task state

let hub = null;

// ==================== INITIALIZATION ====================

async function init(h) {
    hub = h;

    hub.registerService('summarizer', {
        compactHistory,
        canCompact
    });

    hub.log('🗜️ Summarization module loaded', 'success');
}

// ==================== PUBLIC API ====================

/**
 * Check if history is large enough to benefit from compaction
 */
function canCompact(history) {
    if (!Array.isArray(history) || history.length < 10) return false;
    return true;
}

/**
 * Compact conversation history using AI summarization.
 * Keeps recent N messages intact; summarizes older messages via AI.
 * Returns new history: [summaryPair, ...recentMessages]
 */
async function compactHistory(history) {
    if (!canCompact(history)) return history;

    const config = hub?.getService('config');
    const keepRecent = config?.compactKeepRecent || 20;

    // Nothing to compact if history is barely above the keep-recent threshold
    if (history.length <= keepRecent + 4) return history;

    const splitAt = Math.max(0, history.length - keepRecent);
    const oldMessages = history.slice(0, splitAt);
    const recentMessages = history.slice(splitAt);

    // Build summarization text from old messages (text only, skip tool blocks)
    const parts = [];
    for (const msg of oldMessages) {
        let content = '';
        if (typeof msg.content === 'string') {
            content = msg.content.substring(0, 800);
        } else if (Array.isArray(msg.content)) {
            const textParts = msg.content
                .filter(b => b.type === 'text' || b.type === 'tool_result')
                .map(b => b.text || (typeof b.content === 'string' ? b.content : ''))
                .filter(t => t.length > 0)
                .map(t => t.substring(0, 400));
            content = textParts.join(' | ').substring(0, 800);
        }
        if (content.trim()) {
            parts.push(`[${msg.role.toUpperCase()}]: ${content}`);
        }
    }

    if (parts.length === 0) {
        hub.log('🗜️ Nothing to summarize in old messages, skipping', 'info');
        return history;
    }

    const contextText = parts.join('\n\n');

    try {
        hub.broadcast('summarization_start', {});
        hub.log('🗜️ Summarizing conversation context via AI...', 'info');

        const summary = await callAISummarize(contextText);

        // Build new history: summary pair + recent
        const summaryMessages = [
            {
                role: 'user',
                content: `[CONTEXT SUMMARY — conversation compacted]\n\nThe following is a structured summary of the earlier conversation:\n\n${summary}`
            },
            {
                role: 'assistant',
                content: 'Context summary acknowledged. I have the essential context and will continue accordingly.'
            }
        ];

        const newHistory = [...summaryMessages, ...recentMessages];

        // Record compaction in context tracker
        try {
            const tracker = hub?.getService('contextTracker');
            if (tracker?.recordCompaction) {
                tracker.recordCompaction({
                    messagesBefore: history.length,
                    messagesAfter: newHistory.length,
                    reason: 'ai_summarization'
                });
            }
        } catch (e) {}

        hub.broadcast('summarization_complete', {
            newLength: newHistory.length,
            oldLength: history.length
        });
        hub.log(`🗜️ Compacted: ${history.length} → ${newHistory.length} messages`, 'success');

        return newHistory;

    } catch (err) {
        hub.log(`⚠️ Summarization failed: ${err.message}`, 'warn');
        hub.broadcast('summarization_complete', { error: err.message });
        return history; // Return unchanged on failure
    }
}

// ==================== AI SUMMARIZATION ====================

/**
 * Call the AI service with a summarization prompt.
 * Wraps the streaming chatStream in a Promise that resolves with the full text.
 */
function callAISummarize(conversationText) {
    return new Promise((resolve, reject) => {
        const ai = hub?.getService('ai');
        if (!ai || !ai.chatStream) {
            reject(new Error('AI service not available for summarization'));
            return;
        }

        const messages = [
            {
                role: 'user',
                content: `You are a context summarizer assistant. Create a concise, well-structured summary of this conversation history.

Focus on preserving:
1. **User requirements and goals** — what the user wants built or fixed
2. **Errors and failures** — what went wrong and why, specific error messages
3. **Technical decisions** — architectural choices, libraries, approaches adopted
4. **Current task state** — what is complete, what is in-progress, what remains
5. **Lessons learned** — things to avoid, gotchas, constraints discovered
6. **Key files and code** — important file paths created or modified

Be specific and technical. Keep under 1500 words. Use markdown bullet points.

CONVERSATION TO SUMMARIZE:
---
${conversationText}
---

Provide the structured summary now:`
            }
        ];

        let fullText = '';

        ai.chatStream(
            messages,
            (event) => {
                // Accumulate streamed text
                if (event.type === 'content_block_delta') {
                    if (event.delta?.type === 'text_delta') {
                        fullText += event.delta.text || '';
                    }
                    // Ignore thinking_delta blocks
                }
            },
            () => {
                if (!fullText.trim()) {
                    reject(new Error('AI returned empty summary'));
                } else {
                    resolve(fullText.trim());
                }
            },
            (err) => {
                reject(err);
            }
        );
    });
}

// ==================== EXPORTS ====================

module.exports = { init };
