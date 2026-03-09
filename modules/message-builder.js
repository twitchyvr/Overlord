// ==================== MESSAGE BUILDER MODULE ====================
// Build messages for AI communication

const os = require('os');
const { execSync } = require('child_process');
const { getAI } = require('./ai-client');

let hub = null;
let config = null;

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
    const aiClient = getAI();
    const ctx = aiClient?.getContext ? aiClient.getContext() : null;

    // Get process state
    const processState = hub?.getProcessState ? hub.getProcessState() : { pid: process.pid, port: 3031 };

    // Build context info
    const contextInfo = ctx ? `
## CURRENT CONTEXT (ALWAYS INCLUDE THIS INFO)
- **Date/Time**: ${ctx.timestamp}
- **Timezone**: ${ctx.timezone}
- **Working Directory**: ${ctx.workingDirectory}
- **Platform**: ${platformName}
- **OS Version**: ${os.version()} (${os.release()})
- **Node.js**: ${process.version}
- **Chat Length**: ${ctx.chatLength.messageCount} messages, started ${ctx.chatLength.durationFormatted} ago
- **Last Request**: ${ctx.lastRequestDurationFormatted}
- **Context Window**: ${ctx.contextUsage.estimatedTokens} / ${ctx.contextUsage.maxTokens} tokens (${ctx.contextUsage.usagePercent}% used)
- **Context Raw**: ${ctx.contextUsage.rawUsagePercent.toFixed(1)}% (can exceed 100%)
- **Compaction**: ${ctx.compaction.count} total compactions, last ${ctx.compaction.timeSinceLastCompactionFormatted}
- **Context Status**: ${ctx.contextUsage.status} (normal/warning/critical)
- **Model**: ${ctx.model.name} (${ctx.model.description}, max ${ctx.model.maxTokens} output, ${ctx.model.thinkingBudget} thinking)
- **Tools Available**: ${ctx.tools.length} tools
- **Server PID**: ${processState.pid}
- **Server Port**: ${processState.port}
${ctx.contextWarning ? '- **⚠️ WARNING**: Context is ' + ctx.contextUsage.usagePercent + '% full - ' + ctx.contextUsage.status : ''}
` : '';

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

    // Build tools section
    let toolsSection = '';
    if (toolsModule) {
        const toolDefs = toolsModule.getDefinitions ? toolsModule.getDefinitions() : [];
        if (toolDefs.length > 0) {
            toolsSection = `

## TOOLS
You may call one or more tools to assist with the user query.

`;
            toolDefs.forEach(tool => {
                toolsSection += `### ${tool.name} (${tool.category || 'general'})\n`;
                toolsSection += `${tool.description}\n`;
                if (tool.input_schema && tool.input_schema.properties) {
                    toolsSection += '\nParameters:\n';
                    Object.entries(tool.input_schema.properties).forEach(([key, prop]) => {
                        const required = tool.input_schema.required?.includes(key) ? ' (required)' : '';
                        toolsSection += `- \`${key}\`${required}: ${prop.description || ''}\n`;
                    });
                }
                toolsSection += '\n';
            });
        }
    }

    // Combine all sections
    const systemPrompt = `You are Overlord, an AI coding assistant powered by MiniMax M2.5.
${contextInfo}${cookbookSection}${skillsSection}${memorySection}${instructionsSection}${agentsSection}${roomsSection}${gitSection}${toolsSection}

## RESPONSE FORMAT
When you need to use tools, respond with JSON in this format:
{"role": "assistant", "content": "your text here", "tool_calls": [{"type": "tool_use", "id": "unique_id", "name": "tool_name", "input": {"param1": "value1"}}]}

When you have no more tools to call, respond with:
{"role": "assistant", "content": "your final response here"}

Remember: Think carefully, use tools when needed, and provide accurate, helpful responses.`;

    return systemPrompt;
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
