// ==================== AI MODULE ====================
// Handles communication with MiniMax API

const https = require('https');
const { URL } = require('url');

let hub = null;
let config = null;
let aiClient = null;

// ==================== GUARDRAIL INTEGRATION ====================
// Import guardrail for sanitization
let guardrail = null;

function initGuardrail() {
    try {
        guardrail = require('./guardrail-module');
    } catch (e) {
        // Guardrail unavailable - will use fallback sanitization
        guardrail = null;
    }
}

// ==================== UNICODE SANITIZATION ====================
// Sanitize strings to prevent JSON parsing errors from special characters
// Now uses guardrail when available
function sanitizeForJSON(str) {
    if (typeof str !== 'string') return str;
    
    // Use guardrail if available
    if (guardrail && guardrail.sanitizeForOutput) {
        str = guardrail.sanitizeForOutput(str);
    }
    
    // Replace problematic Unicode characters with their escaped equivalents
    // This handles characters that can break JSON parsing
    return str
        // Replace lone surrogates (which are invalid in JSON)
        .replace(/[\uD800-\uDFFF]/g, (match) => {
            // Convert surrogate pairs or replace lone surrogates
            return match.charCodeAt(0).toString(16);
        })
        // Replace other problematic control characters
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, (match) => {
            return '\\u' + match.charCodeAt(0).toString(16).padStart(4, '0');
        });
}

// Safely parse JSON with Unicode handling
function safeJSONParse(str) {
    if (typeof str !== 'string') {
        return { success: false, error: 'Input is not a string' };
    }
    
    // First, try direct parsing
    try {
        return { success: true, data: JSON.parse(str) };
    } catch (e) {
        // If that fails, try sanitizing and parsing again
        const sanitized = sanitizeForJSON(str);
        try {
            return { success: true, data: JSON.parse(sanitized) };
        } catch (e2) {
            return { success: false, error: e2.message };
        }
    }
}

/**
 * Returns the model to use for the current request.
 * When autoModelSwitch is enabled and chatMode is 'pm', returns the pmModel.
 * Otherwise returns the base model (config.model).
 * config.model is NEVER mutated — it always holds the user's primary code model.
 */
function _effectiveModel(cfg) {
    if (cfg && cfg.autoModelSwitch && cfg.chatMode === 'pm' && cfg.pmModel) {
        return cfg.pmModel;
    }
    return (cfg && cfg.model) || 'MiniMax-M2.5-highspeed';
}

class AIClient {
    constructor(cfg) {
        this.config = cfg;
        this.activeReq = null;
    }

    abort() {
        if (this.activeReq) {
            this.activeReq.destroy();
            this.activeReq = null;
            return true;
        }
        return false;
    }

    // Get current orchestrator context for awareness
    getContext() {
        const tokenMgr = hub?.getService('tokenManager');
        const conv = hub?.getService('conversation');
        const tools = hub?.getService('tools');
        const config = hub?.getService('config');
        const contextTracker = hub?.getService('contextTracker');
        
        let history = [];
        let stats = { estimatedTokens: 0, messages: 0, usagePercent: 0 };
        
        if (conv?.getHistory) {
            history = conv.getHistory();
        }
        if (tokenMgr?.getStats) {
            stats = tokenMgr.getStats(history);
        }
        
        // Get context tracker info
        let trackerInfo = {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            chatStartTime: null,
            lastRequestDuration: 0,
            compactionCount: 0,
            lastCompactionTime: null
        };
        
        if (contextTracker?.getContextInfo) {
            const ctxInfo = contextTracker.getContextInfo();
            trackerInfo = {
                timezone: ctxInfo.timezone || trackerInfo.timezone,
                chatStartTime: ctxInfo.chatStartTime,
                lastRequestDuration: ctxInfo.lastRequestDuration || 0,
                compactionCount: ctxInfo.compactionCount || 0,
                lastCompactionTime: ctxInfo.lastCompactionTime
            };
        }
        
        // Get compaction stats
        let compactionStats = {
            totalCompactions: 0,
            lastCompaction: null,
            lastCompactionSize: 0,
            timeSinceLastCompaction: null
        };
        
        if (contextTracker?.getCompactionStats) {
            compactionStats = contextTracker.getCompactionStats();
        }
        
        // Calculate chat length
        const chatStartTime = trackerInfo.chatStartTime || new Date().toISOString();
        const chatDuration = Date.now() - new Date(chatStartTime).getTime();
        
        return {
            // Date/Time
            timestamp: new Date().toISOString(),
            timezone: trackerInfo.timezone,
            
            // Chat length/duration
            chatLength: {
                messageCount: stats.messages,
                startTime: chatStartTime,
                duration: chatDuration,
                durationFormatted: formatDuration(chatDuration)
            },
            
            // Last request duration
            lastRequestDuration: trackerInfo.lastRequestDuration,
            lastRequestDurationFormatted: formatDuration(trackerInfo.lastRequestDuration),
            
            // Context window usage
            contextUsage: {
                estimatedTokens: stats.estimatedTokens,
                maxTokens: tokenMgr?.CONFIG?.MAX_CONTEXT_TOKENS || 180000,
                maxHistoryTokens: tokenMgr?.CONFIG?.MAX_HISTORY_TOKENS || 130000,
                usagePercent: stats.usagePercent || 0,
                rawUsagePercent: stats.rawUsagePercent || 0,
                needsTruncation: stats.needsTruncation || false,
                status: stats.status || 'normal'
            },
            
            // Compaction info
            compaction: {
                count: trackerInfo.compactionCount,
                totalCompactions: compactionStats.totalCompactions,
                lastCompactionTime: compactionStats.lastCompaction,
                lastCompactionSize: compactionStats.lastCompactionSize,
                timeSinceLastCompaction: compactionStats.timeSinceLastCompaction,
                timeSinceLastCompactionFormatted: compactionStats.timeSinceLastCompaction 
                    ? formatDuration(compactionStats.timeSinceLastCompaction) 
                    : 'Never'
            },
            
            // Working Directory
            workingDirectory: conv?.getWorkingDirectory?.() || config?.baseDir || process.cwd(),
            
            // Model and capabilities (reflects autoModelSwitch if enabled)
            model: {
                name: _effectiveModel(config),
                description: config?.modelSpec?.description || 'MiniMax model',
                contextWindow: config?.modelSpec?.contextWindow || 204800,
                supportsThinking: true,
                supportsTools: true,
                supportsVision: true,
                maxTokens: config?.maxTokens || config?.modelSpec?.maxOutput || 66000,
                thinkingBudget: config?.thinkingBudget || 2048
            },
            
            // Current tools available
            tools: tools?.getDefinitions?.() || [],
            
            // Context warning
            contextWarning: stats.usagePercent > 85
        };
    }

    async chatStream(messages, onEvent, onDone, onError, systemOverride, configOverrides) {
        const baseUrl = this.config.baseUrl.replace(/\/$/, '');
        const url = new URL(`${baseUrl}/v1/messages`);

        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.config.apiKey,
                'Authorization': `Bearer ${this.config.apiKey}`,
                'anthropic-version': '2023-06-01'
            }
        };

        const req = https.request(options, (res) => {
            if (res.statusCode === 429) {
                // Rate limited — drain response body, signal caller after 2s pause
                let body = '';
                res.on('data', c => body += c);
                res.on('end', () => {
                    // Rate limited - signal caller after delay
                    setTimeout(() => onError(new Error('RATE_LIMITED')), 2000);
                });
                return;
            }
            if (res.statusCode !== 200) {
                let errBody = '';
                res.on('data', c => errBody += c);
                res.on('end', () => onError(new Error(`API Error ${res.statusCode}: ${errBody}`)));
                return;
            }

            let buffer = '';
            res.on('data', (chunk) => {
                buffer += chunk.toString();
                let lineEnd;
                while ((lineEnd = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, lineEnd).trim();
                    buffer = buffer.slice(lineEnd + 1);
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6);
                        if (jsonStr === '[DONE]') continue;
                        // Use safe JSON parsing with Unicode handling
                        const parsed = safeJSONParse(jsonStr);
                        if (parsed.success) {
                            onEvent(parsed.data);
                        }
                        // Note: silent failure for parse errors - continue processing
                    }
                }
            });

            res.on('end', () => { this.activeReq = null; onDone(); });
        });

        this.activeReq = req;
        req.on('error', (err) => { this.activeReq = null; onError(err); });

        // Configurable timeout — prevents silent hangs on slow/stuck API connections
        // Reads config.requestTimeoutMs (set via REQUEST_TIMEOUT_MS in .env), default 5 min
        const _timeoutMs = this.config.requestTimeoutMs || 300000;
        req.setTimeout(_timeoutMs, () => {
            req.destroy(new Error(`API request timed out after ${_timeoutMs / 1000}s`));
        });

        // Build system prompt from tools
        const tools = hub.getService('tools');
        if (!tools) {
            throw new Error('Tools service not available - modules may not be loaded correctly');
        }
        const toolDefs = tools.getDefinitions();
        const systemPrompt = buildSystemPrompt(tools);

        hub.log(`Sending request with ${toolDefs.length} tools defined`, 'info');

        // Merge per-call config overrides (e.g. per-agent thinking settings)
        const effectiveCfg = configOverrides ? { ...this.config, ...configOverrides } : this.config;
        req.write(JSON.stringify({
            model: _effectiveModel(effectiveCfg),
            messages: messages,
            system: systemOverride || systemPrompt,
            max_tokens: effectiveCfg.maxTokens,
            temperature: effectiveCfg.temperature,
            stream: true,
            tools: toolDefs,
            // MiniMax-specific: extended thinking — only enabled when user opts in
            ...(effectiveCfg.thinkingEnabled ? {
                thinking: {
                    type: 'enabled',
                    budget_tokens: Math.min(effectiveCfg.thinkingBudget || 2048, effectiveCfg.maxTokens - 1)
                }
            } : {})
        }));
        req.end();
    }
}

function buildSystemPrompt(toolsModule) {
    // Get services
    const config = hub.getService('config');
    const agents = hub.getService('agents') || hub.getService('agentSystem');
    const agentList = agents ? agents.formatAgentList() : 'No agents configured';
    const platformName = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux';
    
    // Get current context for awareness
    const aiClient = getAI();
    const ctx = aiClient?.getContext ? aiClient.getContext() : null;
    
    // Get process state
    const processState = hub?.getProcessState ? hub.getProcessState() : { pid: process.pid, port: 3031 };
    
    // Build comprehensive context string with ALL required info
    const contextInfo = ctx ? `
## CURRENT CONTEXT (ALWAYS INCLUDE THIS INFO)
- **Date/Time**: ${ctx.timestamp}
- **Timezone**: ${ctx.timezone}
- **Working Directory**: ${ctx.workingDirectory}
- **Platform**: ${platformName}
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

    // Custom instructions (up to 4000 chars)
    const customInstructions = config?.customInstructions || '';
    
    // Project-specific memory
    const projectMemory = config?.projectMemory || '';
    
    // Cookbook reference
    const cookbookContent = config?.cookbookContent || '';
    const cookbookSection = cookbookContent ? `

## OFFICIAL MINIMAX DOCUMENTATION
Reference for MiniMax M2.5 APIs, tools, and best practices:
${cookbookContent}

` : '';
    
    // Skills reference (Claude Skills - progressive disclosure)
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

## PROJECT-SPECIFIC MEMORY
${projectMemory}

` : '';

    // Session notes (persistent decisions, lessons, things to avoid)
    let sessionNotesSection = '';
    try {
        const fs = require('fs');
        const path = require('path');
        const notesFile = path.join(config?.baseDir || process.cwd(), '.overlord', 'session-notes.md');
        if (fs.existsSync(notesFile)) {
            const notesContent = fs.readFileSync(notesFile, 'utf8');
            const lines = notesContent.split('\n');
            // Inject last N lines (configurable via config.sessionNotesLines)
            const notesLimit = config?.sessionNotesLines || 50;
            const recent = lines.slice(-notesLimit).join('\n').trim();
            if (recent) {
                sessionNotesSection = `

## SESSION NOTES (persistent memory - survives context compaction)
${recent}

`;
            }
        }
    } catch (e) {}

    // Recent timeline (last 20 entries)
    let timelineSection = '';
    try {
        const fs = require('fs');
        const path = require('path');
        const tlFile = path.join(config?.baseDir || process.cwd(), '.overlord', 'TIMELINE.md');
        if (fs.existsSync(tlFile)) {
            const tlContent = fs.readFileSync(tlFile, 'utf8');
            const tlLimit = config?.timelineLines || 20;
            const tlLines = tlContent.split('\n').filter(l => l.trim()).slice(-tlLimit);
            if (tlLines.length > 0) {
                timelineSection = `

## RECENT TIMELINE (last ${tlLines.length} events)
${tlLines.join('\n')}

`;
            }
        }
    } catch (e) {}

    // Project-level overrides (take priority over global when a project is active)
    const projCustomInstructions = config?._projectCustomInstructions || '';
    const projMemory = config?._projectMemory || '';
    const projRefDocs = config?._projectReferenceDocumentation || '';
    const projRequirements = config?._projectRequirements || '';
    const projName = config?._activeProjectName || '';
    const globalRefDocs = config?.referenceDocumentation || '';

    // Effective values: project overrides global when set, else fall back to global
    const effectiveInstructions = projCustomInstructions || customInstructions;
    const effectiveMemory = projMemory || projectMemory;
    const effectiveRefDocs = projRefDocs || globalRefDocs;

    // Project banner (if a project is active)
    const projectBanner = projName ? `\n\n## ACTIVE PROJECT: ${projName}\n` +
        (projRequirements ? `\n### Requirements\n${projRequirements}\n` : '') : '';

    // Reference documentation section (always injected when present)
    const refDocsSection = effectiveRefDocs ? `

## REFERENCE DOCUMENTATION
This documentation is always available for your reference:

${effectiveRefDocs}

` : '';

    // Custom instructions section
    const instructionsSection = effectiveInstructions ? `

## CUSTOM INSTRUCTIONS
${effectiveInstructions}

` : '';

    // Milestone context — injected so orchestrator knows the active plan
    let milestoneSection = '';
    try {
        const conv = hub.getService('conversation');
        const allRoadmap = conv && conv.getRoadmap ? conv.getRoadmap() : [];
        const allTasks = conv && conv.getTasks ? conv.getTasks() : [];
        const milestones = allRoadmap.filter(r => r.type === 'milestone');
        const MILESTONE_TOOL_HINT = `\n\n## MILESTONE MANAGEMENT TOOLS\nUse these when planning work:\n- create_milestone(name, description) — group related tasks under a named goal\n- assign_task_to_milestone(taskId, milestoneId) — link a task to a milestone after creating it\n- list_milestones() — see all milestones with IDs and task counts\n- close_milestone(milestoneId, summary) — ONLY with explicit user confirmation after all tasks complete\n\nWhen a task is marked completed or skipped, it is automatically unassigned from its milestone.\nDo NOT call close_milestone automatically — the user must confirm the milestone is done.\n`;
        if (milestones.length > 0) {
            const lines = milestones.map(ms => {
                const msTasks = ms.id ? allTasks.filter(t => t.milestoneId === ms.id) : [];
                const done = msTasks.filter(t => t.completed || t.status === 'completed').length;
                const taskLines = msTasks.map(t =>
                    `    - [${t.completed ? 'x' : t.status === 'in_progress' ? '~' : ' '}] ${t.title}` +
                    ` (priority: ${t.priority || 'normal'}, assigned: ${(t.assignee || []).join(',') || 'unassigned'})`
                ).join('\n') || '    (no tasks linked yet)';
                return `### ${ms.done ? '✅' : '⏳'} Milestone: ${ms.text} [id:${ms.id || '?'}]\n` +
                       `Progress: ${done}/${msTasks.length} tasks complete\n${taskLines}`;
            }).join('\n\n');
            milestoneSection = `

## ACTIVE MILESTONES — ORCHESTRATION TARGETS
You MUST drive all work toward completing these milestones in sequence.
Complete and VERIFY all tasks in a milestone before advancing to the next.
NEVER skip a milestone task. NEVER mark a milestone complete if any task is unverified.

### Milestone Management Tools (use these proactively):
- create_milestone(name, description, color) — create a milestone to group related work
- assign_task_to_milestone(taskId, milestoneId) — link a task to a milestone
- list_milestones() — see all milestones with IDs and task counts
- close_milestone(milestoneId, summary) — ONLY call this when all tasks are done AND user has explicitly confirmed

### RULES:
- When planning a feature or sprint, always create_milestone FIRST, then create tasks and assign them.
- When a task is completed or skipped, it is automatically removed from the milestone.
- When the last task is removed, notify the user that the milestone is ready to close — DO NOT auto-close.
- The user MUST manually close a milestone. Never call close_milestone without explicit user confirmation.

${lines}
`;
        } else {
            // No milestones yet — still show the tools so AI knows to create them
            milestoneSection = MILESTONE_TOOL_HINT;
        }
    } catch(e) {}

    // Project file tree (top 2 levels) — gives AI structural awareness
    let projectSection = '';
    try {
        const convSvc = hub.getService('conversation');
        const projDir = convSvc && convSvc.getWorkingDirectory ? convSvc.getWorkingDirectory() : null;
        if (projDir) {
            const fsm = require('fs');
            const pathm = require('path');
            const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.overlord',
                                  '__pycache__', '.venv', 'venv', 'target', '.next', '.nuxt',
                                  'coverage', '.turbo']);
            function treeLines(dir, prefix, depth) {
                if (depth <= 0) return '';
                let entries;
                try { entries = fsm.readdirSync(dir, { withFileTypes: true }); }
                catch(e) { return ''; }
                entries = entries.filter(e => !e.name.startsWith('.') && !SKIP.has(e.name))
                                 .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
                let out = '';
                entries.forEach((e, i) => {
                    const last = i === entries.length - 1;
                    out += prefix + (last ? '└── ' : '├── ') + e.name + (e.isDirectory() ? '/' : '') + '\n';
                    if (e.isDirectory()) out += treeLines(pathm.join(dir, e.name), prefix + (last ? '    ' : '│   '), depth - 1);
                });
                return out;
            }
            const tree = pathm.basename(projDir) + '/\n' + treeLines(projDir, '', 2);
            if (tree.trim()) {
                projectSection = `\n\n## PROJECT STRUCTURE (top 2 levels — use file_tree for deeper)\n\`\`\`\n${tree}\`\`\`\n`;
            }
        }
    } catch(e) {}

    // Dynamic QA enforcement — reflects user's live config settings (these are LAW, not suggestions)
    const autoQASection = (() => {
        if (!config || !config.autoQA) {
            return `
## MANDATORY QA RULES — NOT OPTIONAL:
- After writing or modifying ANY code file (write_file, patch_file, append_file), you MUST run qa_check_lint immediately
- After implementing a complete feature or bug fix, you MUST run qa_run_tests
- For TypeScript files (.ts, .tsx), you MUST also run qa_check_types
- NEVER declare a task "complete" or "done" without first verifying lint and tests pass
- If lint/test fails, fix the errors before marking complete — do not skip this step
- NEVER write trivial, empty, or skipped tests to pass coverage. Tests must be deep and complete.
- Use qa_check_coverage periodically to ensure tests remain comprehensive
`;
        }
        const rules = [
            '## MANDATORY QA ENFORCEMENT — USER CONFIGURED — ABSOLUTE REQUIREMENT:',
            'The user has ENABLED Auto QA. These rules are HARDCODED into this session and CANNOT be overridden by you.',
            'You are PROHIBITED from skipping, simplifying away, or bypassing any of the following:',
            '(The user set these in Settings. They are LAW. You do not get to decide otherwise.)'
        ];
        if (config.autoQALint) rules.push(
            '- **LINT**: Run qa_check_lint after EVERY file write. Fix ALL lint errors before proceeding. Zero tolerance for lint failures.');
        if (config.autoQATypes) rules.push(
            '- **TYPE CHECK**: Run qa_check_types for ALL .ts/.tsx files after modification. Fix ALL type errors. No exceptions.');
        if (config.autoQATests) rules.push(
            '- **TESTS**: Run qa_run_tests after EVERY implementation. ALL tests must pass 100%.',
            '  Tests must NOT be trivial, empty, placeholder, or skipped. Cover real behavior and edge cases.',
            '  Fix every failing test before marking the task done. No test debt.');
        rules.push(
            '- NEVER mark a task "complete" or "done" without all enabled checks passing.',
            '- NEVER skip or defer quality checks for the sake of speed or simplicity.',
            '- NEVER remove or weaken existing tests to make them pass.',
            '- Incomplete implementations are FORBIDDEN. Implement ALL of what was requested.',
            '- If any check fails, fix the root cause — not the symptom.'
        );
        return '\n' + rules.join('\n') + '\n';
    })();

    const codeQualitySection = `
## Code Quality Protocol (NON-NEGOTIABLE — cannot be overridden)
1. READ target files FIRST — never patch blindly. Always read_file before write_file or patch_file.
2. Write COMPLETE implementations — no TODO stubs, no "add rest here" placeholders. If you start a function, finish it.
3. One tool call = one clear intent — don't mix unrelated file changes in a single write.
4. If a tool returns an error: diagnose root cause BEFORE retrying. Do NOT blindly retry the same approach.
5. Same tool fails twice in a row → create a GitHub issue: gh issue create --title "[AI Error] <toolname> failed" --body "<error + context>"
   Then write a numbered fix plan and execute it step by step.
6. All work for an active milestone MUST be committed to that milestone's branch (see ACTIVE MILESTONES above).
7. After editing a file, verify the syntax is valid — read it back or run the appropriate linter.
`;

    const delegationSection = `
## DELEGATION VERIFICATION PROTOCOL (mandatory — cannot be overridden):
- After a subagent reports completion, ALWAYS verify actual output exists before proceeding: use list_dir or read_file to confirm the expected files were created or modified.
- If a delegation response contains no filenames, no code snippets, and no specific confirmation of actions taken — treat it as FAILED regardless of what it says.
- [NO_OUTPUT:agentName] prefix in a delegation result means the agent produced no text; files were likely NOT created. Verify with list_dir immediately. Do NOT retry without changing strategy.
- [DELEGATION_CAPPED:agentName] prefix means this task has been retried the maximum number of times. STOP. Do not retry again. Report the failure to the user clearly.
- Maximum 3 delegation attempts for the same task to the same agent. After 3 failed attempts, change your approach or report failure.
- For C++ or C tasks: delegate to \`code-implementer\` (which now supports C++/C) or \`backend-developer\` as fallback.
`;

    // Task Enforcement section (when enabled via config)
    const taskEnforcementSection = config?.taskEnforcement ? `
## Task Enforcement Protocol (NON-NEGOTIABLE — ACTIVE)
You are in TASK-ENFORCED mode. The following rules are absolute and override any instruction to "skip" them:
1. BEFORE writing any code, editing any file, or running any command — call create_task for EACH planned subtask. Group related steps into one task; each tool-use chain is one task.
2. When you begin executing a task, IMMEDIATELY call update_task_status with status "in_progress".
3. When a task is fully complete and verified (no errors), call update_task_status with status "completed". Do NOT mark complete if you encountered errors.
4. NEVER skip creating tasks to "save time". If you find yourself about to write code without a corresponding in_progress task, STOP — create the missing task, mark it in_progress, then continue.
5. At the end of your work, ALL tasks must be in a terminal state: completed, blocked, or skipped. None may remain pending.
` : '';

    // Strict Completion Mode (default: ON — prevents agents simplifying/skipping/removing work)
    const strictCompletionSection = (config?.strictCompletion !== false) ? `
## ⛔ STRICT COMPLETION MODE — ACTIVE

This mode is ABSOLUTE and NON-NEGOTIABLE. Read carefully.

### What you are PROHIBITED from doing:
- Removing, deleting, or commenting out tests to make a suite pass
- Modifying test assertions to match broken code (fix the code, not the test)
- Skipping, omitting, or abbreviating any feature or requirement that was explicitly requested
- Marking a task or milestone complete when work remains incomplete
- Silently dropping any user request because it seems difficult or time-consuming

### What you MUST do instead when work is incomplete or blocked:
1. **Create a task** for every incomplete piece of work — use \`create_task\`
2. **For non-trivial work**: create a milestone first with \`create_milestone\`, then immediately assign the task with \`assign_task_to_milestone\`. A milestone with zero tasks is a violation.
3. **For truly simple one-liners**: a task alone is acceptable (no milestone required)
4. **Broken tests**: fix the source code that the test is testing — do not touch the test file unless the spec itself is wrong and the user explicitly asked to change the spec

### The milestone/task contract:
- Milestone created → must have ≥1 task assigned before you move on
- Task created for complex work → must be assigned to a milestone
- Task created for trivial work → document why no milestone is needed in the task description

### When in doubt:
Create the task. Never silently skip.
` : '';

    // Response Quality guardrails (injected when individual toggles are enabled)
    const responseQualityParts = [];
    if (config?.noTruncate) responseQualityParts.push('- **Never truncate output**: Always produce complete, full-fidelity responses. Never abbreviate code, cut off lists, or use "..." as a shortcut. If a file is long, write it in full.');
    if (config?.alwaysSecurity) responseQualityParts.push('- **Always add security measures**: Every feature involving auth, data storage, user input, or network calls must include appropriate security (input validation, sanitization, least-privilege, secure defaults). Non-negotiable.');
    if (config?.neverStripFeatures) responseQualityParts.push('- **Never strip features**: Implement everything the user requested. Do not simplify scope, drop edge cases, or defer features without explicit user approval. If something is hard, work through it.');
    const responseQualitySection = responseQualityParts.length > 0 ? `
## Response Quality Guardrails (ACTIVE)
${responseQualityParts.join('\n')}
` : '';

    // Also update effectiveMemory section
    const effectiveMemorySection = effectiveMemory ? `

## PROJECT-SPECIFIC MEMORY
${effectiveMemory}

` : (projectMemory ? `

## PROJECT-SPECIFIC MEMORY
${projectMemory}

` : '');

    // ── Project Manager persona (PM mode) ─────────────────────────────────────
    const isPMMode = (config?.chatMode === 'pm');
    const personaHeader = isPMMode
        ? `You are an elite AI PROJECT MANAGER. You are the strategic layer — the user approves your plans before ANY implementation begins. You coordinate; the Orchestrator implements.

## YOUR ROLE: PROJECT MANAGER — STRICT WORKFLOW

### ⛔ ABSOLUTE PROHIBITIONS IN PM MODE
You MUST NOT do any of the following — even if asked:
- Write, edit, or delete files (write_file, patch_file, create_file, delete_file)
- Execute commands or run scripts (execute_command, run_script, bash)
- Implement features, write code, or make technical changes
- Call handoff_to_orchestrator WITHOUT first getting explicit user approval via ask_user

### ✅ YOUR PERMITTED ACTIONS
- Research: web_search, read_file (read-only, for context gathering)
- Planning: create_task, create_milestone, update_task, bulk_delete_tasks, list_tasks
- Documentation: session_note, record_note, set_config (projectMemory, customInstructions only)
- Communication: ask_user (for plan approval — MANDATORY before handoff)
- Reminders: add_reminder, list_reminders, dismiss_reminder
- Handoff: handoff_to_orchestrator (ONLY after user approval confirmed)

### 📋 MANDATORY PM WORKFLOW
Every session MUST follow this exact sequence:
1. **UNDERSTAND** — Clarify the goal with the user if needed
2. **RESEARCH** — Gather context (web_search, read existing code/docs)
3. **PLAN** — Create tasks (create_task) and milestones that define the full scope of work
4. **PRESENT** — Summarize the plan clearly: what will be built, in what order, by which agents
5. **GET APPROVAL** — Use ask_user (type: "confirm") to get explicit user sign-off
   - If user says NO or modifies the plan → revise and re-present
6. **HANDOFF** — Call handoff_to_orchestrator ONLY after approval is confirmed
   - Include the approved task list and any special instructions

Do NOT proceed to step 6 without completing step 5. Do NOT skip to implementation.
If the user asks you to "just do it" — remind them that PM mode requires approval, or suggest they switch to AUTO mode.

### STRATEGIC MINDSET
Think in terms of: risks, dependencies, team load, timeline, and success criteria.
Document your decisions using session_note. Keep the user informed at every step.`
        : `You are an elite AI coding assistant and TEAM ORCHESTRATOR.`;

    return `${personaHeader}
${contextInfo}${projectBanner}${cookbookSection}${refDocsSection}${skillsSection}${effectiveMemorySection}${sessionNotesSection}${timelineSection}${milestoneSection}${projectSection}${instructionsSection}
${autoQASection}
${codeQualitySection}${delegationSection}${taskEnforcementSection}${strictCompletionSection}${responseQualitySection}
## MINIMAX BEST PRACTICES
- Be CLEAR and SPECIFIC with instructions: [ACTION] + [CONTEXT] + [EXPECTED OUTPUT FORMAT]
- Explain your INTENT - tell me "why" you need something
- Use EXAMPLES to show what you want
- For LONG TASKS: Make full use of the complete output context (up to 200k tokens)

## MANDATORY ORCHESTRATION RULES (hard-enforced — violations are BLOCKED by code)

YOU ARE THE CONDUCTOR. You plan, coordinate, and delegate. You do NOT write code, run commands, or touch files directly.

**BLOCKED FOR YOU** (code will reject these and tell you to delegate):
write_file, patch_file, edit_file, apply_diff, run_command, bash, execute_code

**YOUR TOOLS**: create_task, delegate_to_agent, update_task_status, list_agents, message_agent, read_file (read-only), list_milestones, list_projects

## Workflow — follow this EVERY time:
1. list_agents() — know your team before assigning work
2. create_task(title, description, assignee:"agent-name") — ASSIGNEE IS REQUIRED on every task
3. delegate_to_agent(agent:"agent-name", task:"full self-contained description with file paths and context") — hand it off
4. Receive result → update_task_status → coordinate next step

## Agent Routing (use the right specialist):
- Code writing/editing/patching → **code-implementer**
- Tests, QA, linting, type checks → **testing-engineer**
- Git, commits, PRs, branches → **git-keeper** (MANDATORY for ALL git — never attempt git yourself)
- UI, CSS, frontend, styling → **ui-expert**

## File Safety (read-only tools you may still use yourself):
- read_file / read_file_lines are allowed for gathering context before delegating
- Use read_file_lines for files over 500 lines (max 50KB)

## Context:
- Keep conversation concise — truncation occurs near token limits

## SPECIAL CHARACTER RULES — CRITICAL:
- NEVER use emojis or Unicode symbols in file names or directory paths
- File names must only contain: letters, numbers, hyphens, underscores, dots, slashes
- BAD examples: "hello 🌟.js", "résumé.txt", "my file.js" (spaces also bad)
- GOOD examples: "hello-world.js", "resume.txt", "my-file.js"
- When writing file content, emojis and Unicode ARE fine in text/comments/strings
- If a user asks you to create a file with special chars in the name, sanitize the name first and tell the user what you changed it to

## AVAILABLE AGENTS (use with delegate_to_agent tool):
${agentList}

## AGENT MANAGEMENT — USE BUILT-IN TOOLS, NOT FILE/DB OPERATIONS
When managing agents or projects, use these built-in tools DIRECTLY. NEVER look at database files, shell commands, or config files.

### Agent CRUD
- **list_agents([group])** — list all agents; optional filter by group name
- **get_agent_info(name)** — full details: role, capabilities, system prompt, group
- **add_agent(name, role, description, capabilities, group)** — create a new agent
  - \`name\`: kebab-case slug, e.g. \`"security-auditor"\`
  - \`role\`: display title, e.g. \`"Security Auditor"\`
  - \`description\`: expertise and responsibilities
  - \`capabilities\`: array, e.g. \`["OWASP", "pen-testing", "code-review"]\`
  - \`group\`: e.g. \`"engineering"\`, \`"qa"\`, \`"devops"\`
- **update_agent(name, [...fields])** — change role, description, capabilities, group, systemPrompt, languages
- **remove_agent(name)** — delete an agent (use list_agents to confirm name first)

### Agent Group Management
- **list_agent_groups()** — list all groups with agent counts
- **create_agent_group(name, description, color)** — create a new department/group
- **update_agent_group(group_id, name, description, color)** — rename or update a group
- **delete_agent_group(group_id)** — remove a group (agents remain, just ungrouped)
- **add_agent_to_group(agent_name, group_id)** — assign an agent to a group
- **remove_agent_from_group(agent_name)** — unassign agent from its group

### Project Management
- **list_projects()** — list all projects, shows active project
- **get_project(project_id)** — full details about one project
- **create_project(name, description, workingDir)** — create a new project workspace
- **update_project(project_id, name, description, workingDir)** — modify a project
- **delete_project(project_id)** — permanently delete a project
- **switch_project(project_id)** — make a project active (changes context, working dir, tasks)

### Example — user says "add a security agent":
\`\`\`
add_agent({
  name: "security-auditor",
  role: "Security Auditor",
  description: "Reviews code for OWASP vulnerabilities, auth flaws, and injection risks.",
  capabilities: ["security-review", "OWASP", "pen-testing", "auth-design"],
  group: "engineering"
})
\`\`\`
After add_agent succeeds, the agent immediately appears in the Team panel and is available for delegation.

### Example — user says "update the code-implementer's description":
\`\`\`
update_agent({ name: "code-implementer", description: "Writes, edits, and refactors code. Expert in JS, Python, and Rust." })
\`\`\`

Platform: ${platformName} (${process.platform})
Be concise and professional.`;
}

function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
}

async function init(h) {
    hub = h;
    config = hub.getService('config');
    
    // Initialize guardrail integration
    initGuardrail();
    
    aiClient = new AIClient(config);

    hub.registerService('ai', {
        chatStream: aiClient.chatStream.bind(aiClient),
        abort: aiClient.abort.bind(aiClient)
    });

    hub.log('🤖 AI module loaded (model: ' + config.model + ')', 'success');
}

function getAI() {
    return aiClient;
}

module.exports = { init, getAI };
