// ==================== MESSAGE BUILDER MODULE ====================
// Build messages for AI communication

const os = require('os');
const { execSync } = require('child_process');
const aiClient = require('./ai-client');

let hub = null;
let config = null;

// Strip emoji from system prompt before sending to MiniMax
// MiniMax models corrupt emoji in responses — preventing them from seeing emoji reduces corruption
const EMOJI_TO_ASCII = {
    '\u2705': '[OK]',       // ✅
    '\u26A0\uFE0F': '[!]', // ⚠️
    '\u26A0': '[!]',        // ⚠ (without variation selector)
    '\u2728': '[*]',        // ✨
    '\u2764': '[heart]',    // ❤
    '\u274C': '[X]',        // ❌
    '\u2B50': '[star]',     // ⭐
    '\u2139\uFE0F': '[i]',  // ℹ️
    '\u{1F4E6}': '[pkg]',   // 📦
    '\u{1F9E0}': '[brain]', // 🧠
    '\u{1F30D}': '[web]',   // 🌐 (changed from globe with Americas)
    '\u{1F30E}': '[web]',   // 🌎
    '\u{1F30F}': '[web]',   // 🌏
    '\u{1F310}': '[web]',   // 🌐
    '\u{1F4C1}': '[dir]',   // 📁
    '\u{1F511}': '[key]',   // 🔑
    '\u{1F50C}': '[plug]',  // 🔌
    '\u{1F4BB}': '[pc]',    // 💻
    '\u{1F6E1}\uFE0F': '[shield]', // 🛡️
    '\u{1F6E1}': '[shield]', // 🛡
    '\u{1F525}': '[fire]',  // 🔥
    '\u{1F44B}': '[wave]',  // 👋
    '\u{26A1}': '[zap]',    // ⚡
};

function stripEmojiForMiniMax(str) {
    if (typeof str !== 'string') return str;
    let result = str;
    // Replace known emoji with ASCII equivalents
    for (const [emoji, ascii] of Object.entries(EMOJI_TO_ASCII)) {
        result = result.split(emoji).join(ascii);
    }
    // Strip any remaining emoji (broad match)
    result = result.replace(/(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*/gu, '');
    return result;
}

// ── Cached git info (refreshed at most every 60s) ────────────────────
let _gitCache = { log: '', changedFiles: '', fetchedAt: 0 };
const GIT_CACHE_TTL = 60000;

function _refreshGitCache() {
    const now = Date.now();
    if (now - _gitCache.fetchedAt < GIT_CACHE_TTL) return;
    try {
        _gitCache.log = execSync('git log --oneline -10', { timeout: 5000, encoding: 'utf8' }).trim();
    } catch { _gitCache.log = ''; }
    try {
        _gitCache.changedFiles = execSync('git diff --name-only HEAD~5 2>/dev/null || git diff --name-only HEAD', { timeout: 5000, encoding: 'utf8' }).trim();
    } catch { _gitCache.changedFiles = ''; }
    _gitCache.fetchedAt = now;
}

// Build a user message
function buildUserMessage(content) {
    return {
        role: 'user',
        content: content
    };
}

// Build an assistant message
function buildAssistantMessage(content, toolCalls = null) {
    const message = {
        role: 'assistant',
        content: content
    };

    if (toolCalls && toolCalls.length > 0) {
        message.tool_calls = toolCalls;
    }

    return message;
}

// Build a tool use block (for assistant messages with tool calls)
function buildToolBlock(toolName, toolId, input) {
    return {
        type: 'tool_use',
        id: toolId,
        name: toolName,
        input: input
    };
}

// Build a tool result block (for user messages following tool calls)
function buildToolResultBlock(toolCallId, content) {
    return {
        type: 'tool_result',
        tool_use_id: toolCallId,
        content: content
    };
}

// Build system prompt from tools
function buildSystemPrompt(toolsModule) {
    // Get services
    const cfg = hub.getService('config');
    const agents = hub.getService('agents') || hub.getService('agentSystem');
    const agentList = agents ? agents.formatAgentList() : 'No agents configured';
    const platformName = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux';

    // Get current context
    const aiInstance = aiClient.getAI ? aiClient.getAI() : null;
    const ctx = aiInstance?.getContext ? aiInstance.getContext() : null;

    // Get process state
    const processState = hub?.getProcessState ? hub.getProcessState() : { pid: process.pid, port: 3031 };

    // Build context info (guard every nested property to avoid crashes)
    let contextInfo = '';
    if (ctx) {
        const cu = ctx.contextUsage || {};
        const cl = ctx.chatLength || {};
        const cm = ctx.compaction || {};
        const md = ctx.model || {};
        const tl = ctx.tools || [];
        contextInfo = `
## CURRENT CONTEXT (ALWAYS INCLUDE THIS INFO)
- **Date/Time**: ${ctx.timestamp || 'unknown'}
- **Timezone**: ${ctx.timezone || 'unknown'}
- **Working Directory**: ${ctx.workingDirectory || 'unknown'}
- **Platform**: ${platformName}
- **OS Version**: ${os.version()} (${os.release()})
- **Node.js**: ${process.version}
- **Chat Length**: ${cl.messageCount ?? 0} messages, started ${cl.durationFormatted || 'just now'} ago
- **Last Request**: ${ctx.lastRequestDurationFormatted || 'n/a'}
- **Context Window**: ${cu.estimatedTokens ?? 0} / ${cu.maxTokens ?? 0} tokens (${cu.usagePercent ?? 0}% used)
- **Context Raw**: ${(cu.rawUsagePercent ?? 0).toFixed(1)}% (can exceed 100%)
- **Compaction**: ${cm.count ?? 0} total compactions, last ${cm.timeSinceLastCompactionFormatted || 'n/a'}
- **Context Status**: ${cu.status || 'unknown'} (normal/warning/critical)
- **Model**: ${md.name || 'unknown'} (${md.description || ''}, max ${md.maxTokens ?? 0} output, ${md.thinkingBudget ?? 0} thinking)
- **Tools Available**: ${tl.length} tools
- **Server PID**: ${processState.pid}
- **Server Port**: ${processState.port}
${ctx.contextWarning ? '- **⚠️ WARNING**: Context is ' + (cu.usagePercent ?? 0) + '% full - ' + (cu.status || 'unknown') : ''}
`;
    }

    // Custom instructions
    const customInstructions = cfg?.customInstructions || '';

    // Project memory
    const projectMemory = cfg?.projectMemory || '';

    // Cookbook reference
    const cookbookContent = cfg?.cookbookContent || '';
    const cookbookSection = cookbookContent ? `

## OFFICIAL MINIMAX DOCUMENTATION
Reference for MiniMax M2.5 APIs, tools, and best practices:
${cookbookContent}

` : '';

    // Skills reference
    let skillsSection = '';
    try {
        const skills = hub?.getService('skills');
        if (skills?.getSkillsMetadataPrompt) {
            const skillsPrompt = skills.getSkillsMetadataPrompt();
            if (skillsPrompt) {
                skillsSection = `

${skillsPrompt}

`;
            }
        }
    } catch (e) {
        // Skills module may not be loaded
    }

    // Project memory section
    const memorySection = projectMemory ? `

## PROJECT MEMORY (from .overlord/memory.md)
${projectMemory}

` : '';

    // Custom instructions section
    const instructionsSection = customInstructions ? `

## CUSTOM INSTRUCTIONS
${customInstructions}

` : '';

    // Available agents section — enhanced with session states
    let agentsSection = `

## AVAILABLE AGENTS
${agentList}
`;
    // Merge agent session states (current task, processing state, inbox)
    try {
        const agentSession = require('./agent-session');
        if (agentSession && agentSession.getAllAgentStates) {
            const states = agentSession.getAllAgentStates();
            if (states.length > 0) {
                agentsSection += '\n### Agent Session States\n';
                states.forEach(s => {
                    const taskInfo = s.task ? ` — task: "${s.task.substring(0, 80)}"` : '';
                    agentsSection += `- **${s.name}**: ${s.status}${taskInfo} (cycles: ${s.cycleCount}, tools: ${s.toolsUsed})\n`;
                });
                agentsSection += '\n';
            }
        }
    } catch (e) { /* agent-session may not be loaded yet */ }

    // Active chat rooms / meetings
    let roomsSection = '';
    try {
        const chatRoom = require('./chat-room');
        if (chatRoom && chatRoom.listChatRooms) {
            const rooms = chatRoom.listChatRooms();
            const activeRooms = rooms.filter(r => r.status === 'active');
            if (activeRooms.length > 0) {
                roomsSection = '\n## ACTIVE ROOMS\n';
                activeRooms.forEach(r => {
                    const meetingTag = r.isMeeting ? ' [MEETING]' : '';
                    roomsSection += `- ${r.id}${meetingTag}: ${r.participants.join(', ')} (${r.messageCount} messages)\n`;
                });
                roomsSection += '\n';
            }
        }
    } catch (e) { /* chat-room may not be loaded yet */ }

    // Recent git changes (cached, refreshed every 60s)
    let gitSection = '';
    try {
        _refreshGitCache();
        if (_gitCache.log) {
            gitSection = '\n## RECENT GIT ACTIVITY\n';
            gitSection += '### Last 10 Commits\n```\n' + _gitCache.log + '\n```\n';
            if (_gitCache.changedFiles) {
                gitSection += '### Recently Changed Files\n```\n' + _gitCache.changedFiles + '\n```\n';
            }
        }
    } catch (e) { /* git may not be available */ }

    // Combine all sections
    const systemPrompt = `You are **Overlord**, the AI orchestrator and coding assistant powering this system. You are NOT a generic assistant — you are Overlord, the central intelligence coordinating a team of specialized agents.

Your identity:
- Name: **Overlord**
- Role: AI orchestrator and senior coding assistant
- Powered by: MiniMax M2.5
- You speak as "Overlord", never as "assistant" or "AI"
- You use professional markdown formatting in all responses
- You respond with well-structured, rich markdown: headers, bullet lists, code blocks, bold/italic emphasis, and tables where appropriate

${contextInfo}${cookbookSection}${skillsSection}${memorySection}${instructionsSection}${agentsSection}${roomsSection}${gitSection}
## TOOL USE
Tools are available via the native function calling API — use them directly. Do NOT output [TOOL_CALL] text — just invoke the tool through the API mechanism.
- You can use read_file, list_dir, web_search, bash, and other tools directly
- Use delegate_to_agent when a task needs a specialist (code writing, testing, etc.)
- Use list_agents to see what agents are available before delegating

## EMOJI / SPECIAL CHARACTER RULES
- When writing or editing code, NEVER corrupt emoji or Unicode characters.
- If a source file contains emoji (e.g. UI labels, log messages), preserve them exactly as-is.
- When generating new code, use ASCII-safe alternatives for decorative emoji in strings (e.g. use "[OK]" instead of a checkmark emoji, "[!]" instead of a warning emoji) UNLESS the user explicitly requests emoji.
- This rule exists because MiniMax models can sometimes produce corrupted Unicode sequences. Prefer ASCII text in generated code to avoid this.`;

    // Strip emoji from system prompt — MiniMax corrupts emoji it sees in prompts
    return stripEmojiForMiniMax(systemPrompt);
}

// Initialize module
function init(h, cfg) {
    hub = h;
    config = cfg;
}

module.exports = {
    init,
    buildUserMessage,
    buildAssistantMessage,
    buildToolBlock,
    buildToolResultBlock,
    buildSystemPrompt
};
