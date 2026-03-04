// ==================== OVERLORD TOOLS v5 ====================
// Complete tool suite for AI-driven coding assistant
//
// Architecture:
//   - TOOL_DEFS: Anthropic-compatible tool definitions with descriptions
//     (these get sent to the model so it knows what tools are available)
//   - execute(): Routes tool calls to handler functions
//   - Working directory: managed by conversation service (persists across requests)
//   - Task mode: agents can cd temporarily, restored after task completes
//
// Tool Categories:
//   Shell:    bash, powershell, cmd
//   Files:    read_file, read_file_lines, write_file, patch_file, append_file, list_dir
//   AI/MCP:   web_search, understand_image
//   System:   system_info, get_working_dir, set_working_dir, set_thinking_level
//   Agents:   (managed via orchestration-module dynamic tools)
//   QA:       qa_run_tests, qa_check_lint, qa_check_types, qa_check_coverage, qa_audit_deps
//   GitHub:   github (multi-action: get_repo, list_issues, create_issue, etc.)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const https = require('https');

let HUB = null;
let CONFIG = null;

// Task mode tracking (agents can cd temporarily, restored after)
let TASK_MODE = false;
let TASK_START_DIR = null;

// Dynamic tool registry for modules that register tools at runtime
const DYNAMIC_TOOL_HANDLERS = new Map();
const DYNAMIC_TOOL_DEFS = [];

// Shell command timeout (ms) - 60s default, longer for installs/tests
const DEFAULT_TIMEOUT = 60000;
const LONG_TIMEOUT = 180000;

// Max tool result size before truncation (chars)
const MAX_RESULT_CHARS = 32000;

// ==================== INITIALIZATION ====================

function init(hub) {
    HUB = hub;

    // Wait for config service (loaded before tools in server.js)
    CONFIG = HUB.getService('config') || {};

    HUB.registerService('tools', {
        execute: execute,
        getDefinitions: () => [...TOOL_DEFS, ...DYNAMIC_TOOL_DEFS],
        startTask: startTask,
        endTask: endTask,
        registerTool: (def, handler) => {
            if (!def || !def.name || typeof handler !== 'function') {
                HUB.log('[Tools] registerTool: invalid def or handler for ' + (def && def.name), 'warn');
                return;
            }
            // Avoid duplicates
            const existing = DYNAMIC_TOOL_DEFS.findIndex(d => d.name === def.name);
            if (existing >= 0) {
                DYNAMIC_TOOL_DEFS[existing] = def;
            } else {
                DYNAMIC_TOOL_DEFS.push(def);
            }
            DYNAMIC_TOOL_HANDLERS.set(def.name, handler);
            HUB.log(`[Tools] Registered dynamic tool: ${def.name}`, 'info');
        }
    });

    // Send initial context to client on new connection
    HUB.on('user_message', onNewUserRequest);

    HUB.log(`🔧 Tools v5 ready (${TOOL_DEFS.length} tools, shell: ${getShell()})`, 'success');
}

// ==================== TOOL DEFINITIONS ====================
// Sent to MiniMax API so the model knows what tools exist.
// CRITICAL: Each tool MUST have a description or the model can't use it.

const TOOL_DEFS = [
    // --- Shell ---
    {
        name: 'bash',
        description: 'Execute a shell command using bash (or zsh on macOS). Use for running scripts, git commands, npm commands, file system operations, and any other terminal command. Returns stdout, stderr, and exit code.',
        input_schema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'The shell command to execute' }
            },
            required: ['command']
        }
    },
    {
        name: 'powershell',
        description: 'Execute a PowerShell command (Windows only). Use for Windows-specific scripting and automation.',
        input_schema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'The PowerShell command to execute' }
            },
            required: ['command']
        }
    },
    {
        name: 'cmd',
        description: 'Execute a Windows CMD command. Use for Windows batch commands and legacy scripts.',
        input_schema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'The CMD command to execute' }
            },
            required: ['command']
        }
    },

    // --- File Operations ---
    {
        name: 'read_file',
        description: 'Read the entire contents of a file. Use for files under 50KB. For larger files, use read_file_lines instead. Supports relative paths (resolved from working directory) and absolute paths.',
        input_schema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path to the file to read (relative or absolute)' }
            },
            required: ['path']
        }
    },
    {
        name: 'read_file_lines',
        description: 'Read specific lines from a file. Use for large files or when you only need a section. Line numbers are 1-based.',
        input_schema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path to the file' },
                start_line: { type: 'number', description: 'Starting line number (1-based)' },
                end_line: { type: 'number', description: 'Ending line number (inclusive)' }
            },
            required: ['path', 'start_line', 'end_line']
        }
    },
    {
        name: 'write_file',
        description: 'Write content to a file, creating it if it does not exist. IMPORTANT: Always read_file first before overwriting an existing file to avoid data loss. Creates parent directories automatically.',
        input_schema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path to write the file to' },
                content: { type: 'string', description: 'The complete file content to write' }
            },
            required: ['path', 'content']
        }
    },
    {
        name: 'patch_file',
        description: 'Find and replace a specific string in a file. Use for targeted edits without rewriting the entire file. The search string must match exactly.',
        input_schema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path to the file to patch' },
                search: { type: 'string', description: 'Exact string to find in the file' },
                replace: { type: 'string', description: 'String to replace the search string with' }
            },
            required: ['path', 'search', 'replace']
        }
    },
    {
        name: 'append_file',
        description: 'Append content to the end of a file. Creates the file if it does not exist. Use for adding to log files, configuration, or any file where you want to add without overwriting.',
        input_schema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path to the file' },
                content: { type: 'string', description: 'Content to append to the file' }
            },
            required: ['path', 'content']
        }
    },
    {
        name: 'list_dir',
        description: 'List files and directories in a given path. Shows directories first (prefixed DIR), then files (prefixed FILE). Defaults to the current working directory if no path is given.',
        input_schema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Directory path to list (optional, defaults to working directory)' }
            },
            required: []
        }
    },

    // --- AI & MCP ---
    {
        name: 'web_search',
        description: 'Search the web for current information. Returns relevant results for the given query. Use when you need up-to-date information not in your training data.',
        input_schema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'The search query' }
            },
            required: ['query']
        }
    },
    {
        name: 'understand_image',
        description: 'Analyze an image using AI vision. Provide a file path or URL. Returns a description of the image content. Use for understanding screenshots, diagrams, UI mockups, etc.',
        input_schema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path to the image file or a URL' },
                prompt: { type: 'string', description: 'What to analyze about the image (default: general description)' }
            },
            required: ['path']
        }
    },

    // --- System & Config ---
    {
        name: 'system_info',
        description: 'Get current system information including platform, OS, Node.js version, working directory, shell, AI model, and current date/time.',
        input_schema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'get_working_dir',
        description: 'Get the current working directory path. All relative file paths are resolved against this directory.',
        input_schema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'set_working_dir',
        description: 'Change the working directory. All subsequent file operations and shell commands will use this as the base path.',
        input_schema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'New working directory path (must exist)' }
            },
            required: ['path']
        }
    },
    {
        name: 'set_thinking_level',
        description: 'Adjust the AI thinking depth. Level 1=minimal (512 tokens), 2=low (1024), 3=normal (2048), 4=high (4096), 5=maximum (8192). Higher levels give deeper analysis but use more tokens.',
        input_schema: {
            type: 'object',
            properties: {
                level: { type: 'number', description: 'Thinking level from 1 (minimal) to 5 (maximum)' }
            },
            required: ['level']
        }
    },

    // --- QA & Testing ---
    {
        name: 'qa_run_tests',
        description: 'Run project tests. Supports types: "unit", "integration", "e2e", or "all" (default). Uses npm test with appropriate filters.',
        input_schema: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['unit', 'integration', 'e2e', 'all'], description: 'Type of tests to run' }
            },
            required: []
        }
    },
    {
        name: 'qa_check_lint',
        description: 'Run linting checks on the project. Tries npm run lint, then falls back to npx eslint.',
        input_schema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'qa_check_types',
        description: 'Run TypeScript type checking (npx tsc --noEmit). Reports type errors without emitting files.',
        input_schema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'qa_check_coverage',
        description: 'Run test coverage report. Uses npm run coverage if configured.',
        input_schema: {
            type: 'object',
            properties: {
                threshold: { type: 'number', description: 'Minimum coverage percentage (informational)' }
            },
            required: []
        }
    },
    {
        name: 'qa_audit_deps',
        description: 'Audit project dependencies for security vulnerabilities using npm audit.',
        input_schema: {
            type: 'object',
            properties: {},
            required: []
        }
    },

    // --- Notes (Session Memory) ---
    {
        name: 'record_note',
        description: 'Record important information as session notes for future reference. Use this to record key facts, user preferences, decisions, or context that should be recalled later in the agent execution chain. Each note is timestamped.',
        input_schema: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: 'The information to record as a note. Be concise but specific.'
                },
                category: {
                    type: 'string',
                    description: 'Optional category/tag for this note (e.g., "user_preference", "project_info", "decision", "general")'
                }
            },
            required: ['content']
        }
    },
    {
        name: 'recall_notes',
        description: 'Recall all previously recorded session notes. Use this to retrieve important information, context, or decisions from earlier in the session or previous agent execution chains.',
        input_schema: {
            type: 'object',
            properties: {
                category: {
                    type: 'string',
                    description: 'Optional: filter notes by category (e.g., "user_preference", "project_info")'
                }
            },
            required: []
        }
    },

    // --- Skills (Claude Skills) ---
    {
        name: 'list_skills',
        description: 'List all available skills. Use this to see what specialized skills are available.',
        input_schema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    {
        name: 'get_skill',
        description: 'Get detailed information about a specific skill including its full content and capabilities.',
        input_schema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Name of the skill to retrieve'
                }
            },
            required: ['name']
        }
    },
    {
        name: 'activate_skill',
        description: 'Activate a skill to add its specialized guidance to the current context. Use list_skills first to see available skills.',
        input_schema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Name of the skill to activate'
                }
            },
            required: ['name']
        }
    },
    {
        name: 'deactivate_skill',
        description: 'Deactivate a previously activated skill.',
        input_schema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Name of the skill to deactivate'
                }
            },
            required: ['name']
        }
    },

    // --- Session Notes (persistent across context compaction) ---
    {
        name: 'session_note',
        description: 'Write a persistent session note. Use to capture important decisions, failures, lessons learned, or things to avoid. Notes survive context compaction and are injected into every subsequent system prompt.',
        input_schema: {
            type: 'object',
            properties: {
                note: { type: 'string', description: 'The note to save' },
                category: { type: 'string', enum: ['decision', 'failure', 'lesson', 'avoid', 'progress', 'info'], description: 'Category for this note (default: progress)' }
            },
            required: ['note']
        }
    },

    // --- GitHub ---
    {
        name: 'github',
        description: 'Interact with GitHub using the gh CLI. Actions: get_repo (view repo info), list_issues, create_issue, close_issue, list_prs, create_pr. Requires gh CLI to be installed and authenticated.',
        input_schema: {
            type: 'object',
            properties: {
                action: { type: 'string', description: 'GitHub action: get_repo, list_issues, create_issue, close_issue, list_prs, create_pr' },
                repo: { type: 'string', description: 'Repository name or issue/PR number (for close_issue)' },
                title: { type: 'string', description: 'Title for new issue or PR' },
                body: { type: 'string', description: 'Body text for new issue or PR' },
                state: { type: 'string', description: 'Filter state: open, closed, all (for list operations)' }
            },
            required: ['action']
        }
    },

    // --- Socket.IO UI tools ---
    {
        name: 'ui_action',
        description: 'Send a UI action to all connected browser clients. Use to open/close panels, show toast notifications, set the status bar message, or switch chat modes. Never use for destructive or irreversible operations.',
        input_schema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['open_panel', 'close_panel', 'show_toast', 'set_status', 'open_url', 'set_mode', 'scroll_to_bottom'],
                    description: 'UI action to perform'
                },
                params: {
                    type: 'object',
                    description: 'Action params. open_panel/close_panel: {panelId}. show_toast: {message, type: "info"|"success"|"warning"|"error", duration?}. set_status: {message}. open_url: {url}. set_mode: {mode: "auto"|"plan"|"pm"|"ask"}. scroll_to_bottom: no params.'
                }
            },
            required: ['action']
        }
    },
    {
        name: 'show_chart',
        description: 'Render an interactive chart as an overlay in the browser. Supports bar, line, and pie charts. Great for visualising data, metrics, task progress, agent performance, etc.',
        input_schema: {
            type: 'object',
            properties: {
                type:   { type: 'string', enum: ['bar', 'line', 'pie'], description: 'Chart type' },
                title:  { type: 'string', description: 'Chart title' },
                labels: { type: 'array', items: { type: 'string' }, description: 'X-axis labels or slice names' },
                values: { type: 'array', items: { type: 'number' }, description: 'Corresponding data values' },
                colors: { type: 'array', items: { type: 'string' }, description: 'Optional hex color for each bar/slice (e.g. "#00d4ff")' }
            },
            required: ['type', 'labels', 'values']
        }
    },
    {
        name: 'ask_user',
        description: 'Request structured input from the user and wait for their answer before continuing. Ideal for confirmations, picking from choices, or collecting a short text/number input. Times out after 2 minutes.',
        input_schema: {
            type: 'object',
            properties: {
                question: { type: 'string', description: 'The question or prompt to show the user' },
                type: {
                    type: 'string',
                    enum: ['text', 'confirm', 'choice', 'number'],
                    description: 'Input type: text=free text, confirm=yes/no, choice=pick one of choices, number=numeric'
                },
                choices:  { type: 'array', items: { type: 'string' }, description: 'Options for type=choice' },
                default:  { type: 'string', description: 'Pre-filled default value' }
            },
            required: ['question', 'type']
        }
    },
    {
        name: 'kv_set',
        description: 'Store a value in the persistent key-value store. Survives server restarts. Use for cross-session memory, caching, flags, and small data blobs.',
        input_schema: {
            type: 'object',
            properties: {
                key:       { type: 'string', description: 'Key (use namespace prefix for organisation, e.g. "proj:status")' },
                value:     { description: 'Value — any JSON-serialisable type (string, number, object, array)' },
                ttl_ms:    { type: 'number', description: 'Optional time-to-live in milliseconds; entry auto-deletes after expiry' }
            },
            required: ['key', 'value']
        }
    },
    {
        name: 'kv_get',
        description: 'Retrieve a value from the persistent key-value store. Returns null if the key does not exist or has expired.',
        input_schema: {
            type: 'object',
            properties: {
                key: { type: 'string' }
            },
            required: ['key']
        }
    },
    {
        name: 'kv_list',
        description: 'List keys in the persistent key-value store, optionally filtered by prefix.',
        input_schema: {
            type: 'object',
            properties: {
                prefix: { type: 'string', description: 'Only return keys starting with this prefix' },
                limit:  { type: 'number', description: 'Max entries to return (default 50)' }
            }
        }
    },
    {
        name: 'kv_delete',
        description: 'Delete one or more keys from the persistent key-value store.',
        input_schema: {
            type: 'object',
            properties: {
                key:    { type: 'string', description: 'Single key to delete' },
                prefix: { type: 'string', description: 'Delete all keys starting with this prefix' }
            }
        }
    },
    {
        name: 'socket_push',
        description: 'Emit a custom Socket.IO event to all connected browser clients. Event name must start with "agent_". Useful for custom UI integrations and live data feeds captured by onAgentEvent() in the browser.',
        input_schema: {
            type: 'object',
            properties: {
                event: { type: 'string', description: 'Event name — MUST start with "agent_" (e.g. "agent_progress", "agent_metric")' },
                data:  { type: 'object', description: 'Payload object sent with the event' }
            },
            required: ['event']
        }
    }
];

// ==================== TASK MODE ====================
// Agents can temporarily change working directory during task execution

function startTask() {
    TASK_MODE = true;
    TASK_START_DIR = getCWD();
    HUB.log('[Tools] Task mode started, dir: ' + TASK_START_DIR, 'info');
}

function endTask() {
    if (TASK_MODE && TASK_START_DIR) {
        const conv = HUB?.getService('conversation');
        if (conv?.setWorkingDirectory) {
            conv.setWorkingDirectory(TASK_START_DIR);
        }
    }
    TASK_MODE = false;
    TASK_START_DIR = null;
    HUB.log('[Tools] Task mode ended', 'info');
}

// ==================== INITIAL CONTEXT ====================
// Sent to client on each new user request

async function onNewUserRequest(text, socket) {
    const initialInfo = await getInitialContext();
    if (socket) {
        socket.emit('initial_context', initialInfo);
    }
}

async function getInitialContext() {
    return {
        workingDirectory: getCWD(),
        dateTime: new Date().toISOString(),
        platform: os.platform(),
        os: os.type() + ' ' + os.release(),
        nodeVersion: process.version,
        model: CONFIG?.model || 'MiniMax-M2.5-highspeed',
        baseUrl: CONFIG?.baseUrl || 'https://api.minimax.io',
        shell: getShell()
    };
}

// ==================== TOOL ROUTER ====================

async function execute(tool, inputOverride) {
    // Normalize: accept (name, input), {name, input}, {name, command}, or string
    let name, input;
    if (typeof tool === 'string') {
        // Called as execute('bash', {command: '...'})
        name = tool;
        input = inputOverride || {};
    } else if (tool.name) {
        // Called as execute({name: 'bash', input: {command: '...'}})
        name = tool.name;
        input = tool.input || {};
    } else if (tool.command) {
        // Called as execute({command: '...'})
        name = 'bash';
        input = { command: tool.command };
    } else {
        name = 'bash';
        input = {};
    }

    HUB.log(`[Tools] Executing: ${name}`, 'info');

    try {
        let result;

        switch (name) {
            // Shell
            case 'bash':        result = await runBash(input.command); break;
            case 'powershell':  result = await runPS(input.command); break;
            case 'cmd':         result = await runCmd(input.command); break;

            // Files
            case 'read_file':       result = readFile(input.path); break;
            case 'read_file_lines': result = readFileLines(input.path, input.start_line, input.end_line); break;
            case 'write_file':      result = writeFile(input.path, input.content); break;
            case 'list_dir':        result = listDir(input.path); break;
            case 'patch_file':      result = patchFile(input.path, input.search, input.replace); break;
            case 'append_file':     result = appendFile(input.path, input.content); break;

            // AI & MCP
            case 'web_search':       
                HUB.log(`[Tools] web_search called with query: ${input.query}`, 'info');
                result = await webSearch(input.query); 
                HUB.log(`[Tools] web_search result: ${result.success}`, 'info');
                break;
            case 'understand_image': result = await understandImage(input.path, input.prompt); break;

            // System
            case 'system_info':       result = await systemInfo(); break;
            case 'get_working_dir':   result = getWorkingDir(); break;
            case 'set_working_dir':   result = setWorkingDir(input.path); break;
            case 'set_thinking_level': result = setThinkingLevel(input.level); break;

            // QA
            case 'qa_run_tests':     result = await runTests(input.type || 'all'); break;
            case 'qa_check_lint': {
                // Step 1: node --check for JS/CJS/MJS files (fast, always-available syntax enforcement)
                const lintPath = input && input.path;
                const isJsFile = lintPath && /\.[cm]?[jt]sx?$/.test(lintPath);
                const nodeCheck = isJsFile
                    ? `node --check "${lintPath}" 2>&1 && echo "✓ Syntax OK: ${lintPath.split('/').pop()}" || true; `
                    : '';
                // Step 2: eslint on the specific file (falls back to project-wide, then "no lint")
                const eslintTarget = lintPath ? `"${lintPath}"` : '.';
                const lintCmd = `${nodeCheck}npm run lint 2>&1 || npx eslint ${eslintTarget} --no-eslintrc --rule '{"no-undef":0}' 2>&1 || echo "No lint configured"`;
                result = await runBash(lintCmd);
                break;
            }
            case 'qa_check_types':   result = await runBash('npx tsc --noEmit 2>&1 || echo "No TypeScript configured"'); break;
            case 'qa_check_coverage': result = await runBash('npm run coverage 2>&1 || echo "No coverage configured"'); break;
            case 'qa_audit_deps':    result = await runBash('npm audit 2>&1 || echo "No audit available"'); break;

            // GitHub
            case 'github': result = await handleGithub(input); break;

            // Notes (Session Memory)
            case 'record_note':
            case 'recall_notes': {
                const notesModule = require('./notes-module');
                result = notesModule.executeNoteTool(name, input);
                break;
            }

            // Session Notes (persistent across context compaction)
            case 'session_note': {
                result = writeSessionNote(input.note, input.category || 'progress');
                break;
            }

            // Skills (Claude Skills)
            case 'list_skills':
            case 'get_skill':
            case 'activate_skill':
            case 'deactivate_skill': {
                const skillsModule = require('./skills-module');
                result = skillsModule.executeSkillTool(name, input);
                break;
            }

            // Init context (internal)
            case 'init_context': result = await getInitialContext(); break;

            // Socket.IO UI tools
            case 'ui_action':    result = uiAction(input); break;
            case 'show_chart':   result = showChart(input); break;
            case 'ask_user':     result = await askUser(input); break;
            case 'kv_set':       result = kvSet(input.key, input.value, input.ttl_ms); break;
            case 'kv_get':       result = kvGet(input.key); break;
            case 'kv_list':      result = kvList(input.prefix, input.limit); break;
            case 'kv_delete':    result = kvDelete(input.key, input.prefix); break;
            case 'socket_push':  result = socketPush(input.event, input.data); break;

            default: {
                // Check dynamic tool registry (modules registered at init time)
                const dynHandler = DYNAMIC_TOOL_HANDLERS.get(name);
                if (dynHandler) {
                    result = await dynHandler(input);
                } else {
                    result = { success: false, content: 'Unknown tool: ' + name };
                }
            }
        }

        // Truncate large results to prevent context blowup
        return truncateResult(result);
    } catch (e) {
        return { success: false, content: 'Tool error: ' + e.message };
    }
}

// ==================== WORKING DIRECTORY ====================

function getShell() {
    return CONFIG?.shell || (os.platform() === 'win32' ? 'cmd.exe' : os.platform() === 'darwin' ? '/bin/zsh' : '/bin/bash');
}

function getCWD() {
    if (TASK_MODE && TASK_START_DIR) {
        return TASK_START_DIR;
    }
    const conv = HUB?.getService('conversation');
    return conv?.getWorkingDirectory?.() || CONFIG?.baseDir || process.cwd();
}

function resolvePath(p) {
    if (!p) return getCWD();
    return path.isAbsolute(p) ? p : path.join(getCWD(), p);
}

// ==================== SHELL EXECUTION ====================

async function runBash(cmd) {
    const shell = getShell();
    const args = CONFIG?.shellArgs || ['-c'];
    // Longer timeout for install/test commands
    const timeout = isLongRunning(cmd) ? LONG_TIMEOUT : DEFAULT_TIMEOUT;
    return runShell(shell, [...args, cmd], timeout);
}

async function runPS(cmd) {
    return runShell('powershell', ['-Command', cmd], DEFAULT_TIMEOUT);
}

async function runCmd(cmd) {
    return runShell('cmd', ['/c', cmd], DEFAULT_TIMEOUT);
}

function isLongRunning(cmd) {
    if (!cmd) return false;
    const c = cmd.toLowerCase();
    return c.includes('npm install') || c.includes('npm test') || c.includes('npm run build') ||
           c.includes('yarn install') || c.includes('pip install') || c.includes('brew install') ||
           c.includes('cargo build') || c.includes('make') || c.includes('docker');
}

async function runShell(cmd, args, timeout = DEFAULT_TIMEOUT) {
    const cwd = getCWD();

    return new Promise(resolve => {
        // Verify working directory exists
        if (!fs.existsSync(cwd)) {
            resolve({ success: false, content: 'Working directory not found: ' + cwd });
            return;
        }

        const proc = spawn(cmd, args, {
            cwd: cwd,
            env: { ...process.env },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', d => { stdout += d.toString(); });
        proc.stderr.on('data', d => { stderr += d.toString(); });

        // Timeout protection
        const timer = setTimeout(() => {
            proc.kill('SIGTERM');
            resolve({
                success: false,
                content: `TIMEOUT (${timeout / 1000}s)\n${stdout.substring(0, 4000)}`
            });
        }, timeout);

        proc.on('close', code => {
            clearTimeout(timer);
            let output = stdout;
            if (stderr) output += '\n[STDERR] ' + stderr;
            if (code) output += '\n[Exit ' + code + ']';
            resolve({
                success: !code,
                content: output || '[No output]'
            });
        });

        proc.on('error', err => {
            clearTimeout(timer);
            resolve({ success: false, content: 'Shell error: ' + err.message });
        });
    });
}

// ==================== FILE OPERATIONS ====================

// Sanitize filename/path to remove characters that cause issues.
// Only applies to the basename, not the directory structure.
function sanitizeFilename(filePath) {
    if (!filePath) return filePath;
    const dir = path.dirname(filePath);
    let base = path.basename(filePath);

    // Remove control characters (U+0000-U+001F, U+007F)
    base = base.replace(/[\x00-\x1f\x7f]/g, '');

    // Replace characters that are problematic on any OS
    // Windows-illegal: < > : " | ? *
    // Also replace spaces (can cause shell issues) and leading dots
    base = base.replace(/[<>:"|?*\\]/g, '_');

    // Strip lone Unicode surrogates
    base = base.replace(/[\uD800-\uDFFF]/g, '');

    // Remove leading/trailing spaces and dots (Windows issue)
    base = base.replace(/^[\s.]+|[\s.]+$/g, '');

    // Prevent empty basename
    if (!base) base = 'unnamed-file';

    // Warn if filename was changed
    const original = path.basename(filePath);
    if (base !== original) {
        if (HUB) HUB.log(`[Tools] Filename sanitized: "${original}" → "${base}"`, 'warn');
    }

    return dir === '.' ? base : path.join(dir, base);
}

// Sanitize file content: strip null bytes and lone surrogates that break file writes
function sanitizeFileContent(content) {
    if (typeof content !== 'string') return content;
    let cleaned = content;

    // Strip null bytes
    if (cleaned.includes('\x00')) {
        cleaned = cleaned.replace(/\x00/g, '');
        if (HUB) HUB.log('[Tools] Stripped null bytes from file content', 'warn');
    }

    // Replace lone surrogates with replacement character
    cleaned = cleaned.replace(/[\uD800-\uDFFF]/g, '\uFFFD');

    return cleaned;
}

function readFile(p) {
    try {
        const f = resolvePath(p);
        if (!fs.existsSync(f)) {
            return { success: false, content: 'File not found: ' + f };
        }
        const stats = fs.statSync(f);
        if (stats.size > 50000) {
            return {
                success: false,
                content: `File too large (${stats.size} bytes, max 50KB). Use read_file_lines for large files.`
            };
        }
        const content = fs.readFileSync(f, 'utf8');
        return { success: true, content: content };
    } catch (e) {
        return { success: false, content: 'Read error: ' + e.message };
    }
}

function readFileLines(p, startLine, endLine) {
    try {
        const f = resolvePath(p);
        if (!fs.existsSync(f)) {
            return { success: false, content: 'File not found: ' + f };
        }
        const content = fs.readFileSync(f, 'utf8');
        const lines = content.split('\n');
        const start = Math.max(1, startLine || 1);
        const end = Math.min(lines.length, endLine || lines.length);
        const selected = lines.slice(start - 1, end);
        return {
            success: true,
            content: `Lines ${start}-${end} of ${lines.length}:\n` + selected.join('\n'),
            totalLines: lines.length
        };
    } catch (e) {
        return { success: false, content: 'Read error: ' + e.message };
    }
}

function writeFile(p, content) {
    try {
        // Sanitize path and content for safety
        const safePath = sanitizeFilename(p);
        const safeContent = sanitizeFileContent(content);
        const f = resolvePath(safePath);
        const dir = path.dirname(f);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        // Capture before content for diff (skip binary/large files)
        let beforeContent = null;
        try {
            if (fs.existsSync(f)) {
                const stat = fs.statSync(f);
                if (stat.size < 200000) { // skip files > 200KB
                    beforeContent = fs.readFileSync(f, 'utf8');
                }
            }
        } catch(e) {}

        fs.writeFileSync(f, safeContent, 'utf8');
        const note = safePath !== p ? ` (path sanitized from "${path.basename(p)}")` : '';
        // Log to TIMELINE.md
        appendTimeline('WROTE ' + safePath + ' (' + safeContent.length + ' chars)');

        // Emit file_diff event if content changed
        if (beforeContent !== null && beforeContent !== safeContent) {
            try { HUB?.broadcast('file_diff', { file: safePath, before: beforeContent, after: safeContent }); } catch(e) {}
        }

        // Stream file content to frontend in 25-line chunks (purely visual)
        try {
            const lines = safeContent.split('\n');
            const totalLines = lines.length;
            HUB?.broadcast('file_write_start', { file: safePath, totalLines, ts: Date.now() });
            const CHUNK = 25;
            let lineStart = 0;
            const _streamChunks = () => {
                if (lineStart >= totalLines) {
                    HUB?.broadcast('file_write_end', { file: safePath, totalLines, ts: Date.now() });
                    return;
                }
                const chunk = lines.slice(lineStart, lineStart + CHUNK).join('\n') + '\n';
                HUB?.broadcastVolatile('file_write_chunk', { file: safePath, chunk, lineStart });
                lineStart += CHUNK;
                setTimeout(_streamChunks, 10);
            };
            setTimeout(_streamChunks, 20);
        } catch(e) {}

        return { success: true, content: 'Written: ' + safePath + ' (' + safeContent.length + ' chars)' + note };
    } catch (e) {
        return { success: false, content: 'Write error: ' + e.message };
    }
}

// ==================== SESSION NOTES ====================

function getOverlordDir() {
    const config = HUB?.getService('config');
    const base = config?.baseDir || process.cwd();
    const d = path.join(base, '.overlord');
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return d;
}

function writeSessionNote(note, category) {
    try {
        const notesFile = path.join(getOverlordDir(), 'session-notes.md');
        const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const line = `\n## [${ts}] [${category}]\n${note}\n`;
        fs.appendFileSync(notesFile, line, 'utf8');
        appendTimeline('SESSION NOTE [' + category + ']: ' + note.substring(0, 80));
        return { success: true, content: 'Session note saved (' + category + ')' };
    } catch (e) {
        return { success: false, content: 'Failed to save session note: ' + e.message };
    }
}

function appendTimeline(event) {
    try {
        const timelineFile = path.join(getOverlordDir(), 'TIMELINE.md');
        const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const line = `[${ts}] ${event}\n`;
        fs.appendFileSync(timelineFile, line, 'utf8');
        // Broadcast to frontend activity feed
        HUB?.broadcast('timeline_event', { ts, event });
    } catch (e) {
        // Non-critical — don't crash on timeline write errors
    }
}

function listDir(p) {
    try {
        const f = resolvePath(p || '.');
        const entries = fs.readdirSync(f, { withFileTypes: true });

        // Sort: directories first, then files, alphabetically within each group
        entries.sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        let output = '# ' + f + '\n\n';
        for (const entry of entries) {
            output += (entry.isDirectory() ? 'DIR  ' : 'FILE ') + entry.name + '\n';
        }
        return { success: true, content: output };
    } catch (e) {
        return { success: false, content: 'List error: ' + e.message };
    }
}

function patchFile(p, search, replace) {
    try {
        const f = resolvePath(p);
        if (!fs.existsSync(f)) {
            return { success: false, content: 'File not found: ' + f };
        }
        const content = fs.readFileSync(f, 'utf8');
        if (!content.includes(search)) {
            return { success: false, content: 'Search string not found in file. Verify exact match including whitespace.' };
        }
        const newContent = content.split(search).join(replace);
        fs.writeFileSync(f, newContent, 'utf8');
        return { success: true, content: 'Patched: ' + p };
    } catch (e) {
        return { success: false, content: 'Patch error: ' + e.message };
    }
}

function appendFile(p, content) {
    try {
        const f = resolvePath(p);
        const dir = path.dirname(f);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.appendFileSync(f, content, 'utf8');
        return { success: true, content: 'Appended to: ' + p + ' (' + content.length + ' chars)' };
    } catch (e) {
        return { success: false, content: 'Append error: ' + e.message };
    }
}

// ==================== WEB SEARCH ====================

async function webSearch(query) {
    // Use MCP service if available (real web search via MiniMax MCP)
    const mcp = HUB?.getService('mcp');
    if (mcp?.webSearch) {
        try {
            const result = await mcp.webSearch(query);
            return { success: true, content: '# Search: ' + query + '\n\n' + result };
        } catch (e) {
            HUB.log('[web_search] MCP search failed: ' + e.message, 'warn');
        }
    }

    // Fallback: use MiniMax API to generate a search-like response
    const key = CONFIG?.apiKey;
    if (key && key.length > 10) {
        try {
            const response = await httpRequest('/v1/chat/completions', {
                model: CONFIG?.model || 'MiniMax-M2.5-highspeed',
                messages: [{
                    role: 'user',
                    content: `Search the web for: "${query}". Provide factual, current information with sources where possible.`
                }],
                max_tokens: 2000
            }, key);
            if (response.choices && response.choices[0]) {
                return {
                    success: true,
                    content: '# Search: ' + query + '\n\n' + response.choices[0].message.content
                };
            }
        } catch (e) {
            HUB.log('[web_search] API fallback failed: ' + e.message, 'warn');
        }
    }

    return { success: false, content: 'Web search unavailable (no API key or MCP service)' };
}

// ==================== IMAGE UNDERSTANDING ====================

async function understandImage(imagePath, prompt) {
    const mcp = HUB?.getService('mcp');
    if (mcp?.understandImage) {
        try {
            const result = await mcp.understandImage(resolvePath(imagePath), prompt || 'Describe this image in detail.', CONFIG);
            if (typeof result === 'object' && result.content) {
                return { success: result.success !== false, content: result.content };
            }
            return { success: true, content: String(result) };
        } catch (e) {
            return { success: false, content: 'Image analysis error: ' + e.message };
        }
    }
    return { success: false, content: 'Image understanding not available. MCP module not loaded or not registered.' };
}

// ==================== SYSTEM INFO ====================

async function systemInfo() {
    const ctx = await getInitialContext();
    return {
        success: true,
        content: `# System Information

**Date/Time**: ${ctx.dateTime}
**Working Directory**: ${ctx.workingDirectory}
**Platform**: ${ctx.platform}
**OS**: ${ctx.os}
**Node.js**: ${ctx.nodeVersion}
**Shell**: ${ctx.shell}
**AI Model**: ${ctx.model}
**API Base**: ${ctx.baseUrl}
**Memory**: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB total, ${Math.round(os.freemem() / 1024 / 1024 / 1024)}GB free
**CPU**: ${os.cpus()[0]?.model || 'unknown'} (${os.cpus().length} cores)`
    };
}

// ==================== QA TOOLS ====================

async function runTests(type) {
    let cmd;
    switch (type) {
        case 'unit':        cmd = 'npm test -- --testPathPattern=unit 2>&1 || echo "No unit tests configured"'; break;
        case 'integration': cmd = 'npm test -- --testPathPattern=integration 2>&1 || echo "No integration tests configured"'; break;
        case 'e2e':         cmd = 'npm test -- --testPathPattern=e2e 2>&1 || echo "No e2e tests configured"'; break;
        default:            cmd = 'npm test 2>&1 || echo "No tests configured"'; break;
    }
    return runBash(cmd);
}

// ==================== GITHUB ====================
// Uses gh CLI for all GitHub operations. Input is sanitized to prevent injection.

async function handleGithub(input) {
    const action = (input.action || '').toLowerCase();
    const validActions = ['get_repo', 'list_issues', 'create_issue', 'close_issue', 'list_prs', 'create_pr'];

    if (!validActions.includes(action)) {
        return { success: false, content: 'Unknown GitHub action. Valid: ' + validActions.join(', ') };
    }

    // Sanitize inputs to prevent shell injection
    const sanitize = (str) => {
        if (!str) return '';
        return str.replace(/["`$\\!]/g, '');
    };

    let cmd = '';
    switch (action) {
        case 'get_repo':
            cmd = 'gh repo view ' + sanitize(input.repo || '');
            break;
        case 'list_issues':
            cmd = 'gh issue list --state ' + sanitize(input.state || 'open');
            break;
        case 'create_issue':
            cmd = `gh issue create --title "${sanitize(input.title || 'New Issue')}" --body "${sanitize(input.body || '')}"`;
            break;
        case 'close_issue':
            cmd = 'gh issue close ' + sanitize(input.repo || '');
            break;
        case 'list_prs':
            cmd = 'gh pr list --state ' + sanitize(input.state || 'open');
            break;
        case 'create_pr':
            cmd = `gh pr create --title "${sanitize(input.title || 'New PR')}" --body "${sanitize(input.body || '')}"`;
            break;
    }

    return await runBash(cmd);
}

// ==================== CONFIG TOOLS ====================

function getWorkingDir() {
    return { success: true, content: getCWD() };
}

function setWorkingDir(p) {
    if (!p) {
        return { success: false, content: 'Path is required' };
    }

    // Verify the path exists
    const resolved = path.isAbsolute(p) ? p : path.join(getCWD(), p);
    if (!fs.existsSync(resolved)) {
        return { success: false, content: 'Directory not found: ' + resolved };
    }

    if (!TASK_MODE) {
        const conv = HUB?.getService('conversation');
        if (conv?.setWorkingDirectory) {
            conv.setWorkingDirectory(resolved);
            return { success: true, content: 'Working directory set to: ' + resolved };
        }
    }
    return { success: false, content: 'Cannot set working directory (no conversation service)' };
}

function setThinkingLevel(level) {
    if (!level || level < 1 || level > 5) {
        return { success: false, content: 'Level must be 1-5 (1=minimal, 3=normal, 5=maximum)' };
    }
    const config = HUB?.getService('config');
    if (config && config.setThinkingLevel) {
        const result = config.setThinkingLevel(level);
        return { success: true, content: `Thinking level set to ${level} (${result.budget} tokens)` };
    }
    return { success: false, content: 'Config service not available' };
}

// ==================== UTILITIES ====================

// Truncate tool results to prevent context overflow
function truncateResult(result) {
    if (!result) return result;

    // If result has content field, truncate it
    if (typeof result === 'object' && result.content) {
        if (typeof result.content === 'string' && result.content.length > MAX_RESULT_CHARS) {
            result.content = result.content.substring(0, MAX_RESULT_CHARS) +
                `\n\n[... Result truncated (${result.content.length} chars, showing first ${MAX_RESULT_CHARS}) ...]`;
        }
    }

    return result;
}

// Make HTTP request to MiniMax API (for web_search fallback)
function httpRequest(endpoint, payload, apiKey) {
    return new Promise((resolve, reject) => {
        const baseUrl = (CONFIG?.baseUrl || 'https://api.minimax.io').replace(/\/anthropic$/, '');
        const url = new URL(baseUrl + endpoint);

        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            }
        };

        const req = https.request(options, res => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(new Error('JSON parse error: ' + body.substring(0, 200)));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy(new Error('HTTP request timeout'));
        });
        req.write(JSON.stringify(payload));
        req.end();
    });
}

// ==================== SOCKET.IO UI TOOLS ====================

function uiAction(input) {
    if (!input.action) return { success: false, content: 'action is required' };
    HUB?.broadcast('ui_action', { action: input.action, params: input.params || {} });
    return { success: true, content: `UI action dispatched: ${input.action}` };
}

function showChart(input) {
    if (!input.type || !input.labels || !input.values)
        return { success: false, content: 'type, labels, and values are required' };
    if (input.labels.length !== input.values.length)
        return { success: false, content: 'labels and values arrays must be the same length' };
    HUB?.broadcast('show_chart', {
        type: input.type, title: input.title || '', labels: input.labels,
        values: input.values, colors: input.colors || []
    });
    return { success: true, content: `Chart "${input.title || input.type}" sent to client` };
}

// Pending input resolvers: reqId → { resolve, timer }
const _pendingInputs = new Map();

async function askUser(input) {
    if (!input.question || !input.type)
        return { success: false, content: 'question and type are required' };
    const reqId = 'inreq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    HUB?.broadcast('input_request', {
        id: reqId, question: input.question, type: input.type,
        choices: input.choices || [], default: input.default || ''
    });
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            _pendingInputs.delete(reqId);
            HUB?.removeListener('input_response', handler);
            resolve({ success: false, content: 'Timed out — user did not respond in 2 minutes' });
        }, 120000);

        function handler(data) {
            if (data.id !== reqId) return;
            clearTimeout(timer);
            _pendingInputs.delete(reqId);
            HUB?.removeListener('input_response', handler);
            resolve({ success: true, content: String(data.value) });
        }
        _pendingInputs.set(reqId, { resolve, timer });
        HUB?.on('input_response', handler);
    });
}

// ==================== KV STORE ====================

const _kvPath = () => {
    const os = require('os');
    const path = require('path');
    return path.join(os.homedir(), '.overlord', 'kv-store.json');
};

function _kvLoad() {
    try {
        const p = _kvPath();
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) { /* ignore */ }
    return {};
}

function _kvSave(store) {
    try {
        const p = _kvPath();
        const dir = path.dirname(p);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(p, JSON.stringify(store, null, 2), 'utf8');
    } catch (e) {
        HUB?.log('[KV] Save error: ' + e.message, 'warn');
    }
}

function kvSet(key, value, ttlMs) {
    if (!key) return { success: false, content: 'key is required' };
    const store = _kvLoad();
    store[key] = { value, updatedAt: Date.now(), expiresAt: ttlMs ? Date.now() + ttlMs : null };
    _kvSave(store);
    return { success: true, content: `Stored key: ${key}` };
}

function kvGet(key) {
    if (!key) return { success: false, content: 'key is required' };
    const store = _kvLoad();
    const entry = store[key];
    if (!entry) return { success: true, content: null };
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
        delete store[key]; _kvSave(store);
        return { success: true, content: null };
    }
    return { success: true, content: entry.value };
}

function kvList(prefix, limit) {
    const store = _kvLoad();
    const now = Date.now();
    let keys = Object.keys(store).filter(k => {
        const e = store[k];
        if (e.expiresAt && now > e.expiresAt) return false;
        return !prefix || k.startsWith(prefix);
    });
    if (limit) keys = keys.slice(0, limit);
    return { success: true, content: keys.map(k => ({ key: k, updatedAt: store[k].updatedAt })) };
}

function kvDelete(key, prefix) {
    const store = _kvLoad();
    let deleted = 0;
    if (key) {
        if (store[key]) { delete store[key]; deleted++; }
    } else if (prefix) {
        Object.keys(store).filter(k => k.startsWith(prefix)).forEach(k => { delete store[k]; deleted++; });
    } else {
        return { success: false, content: 'Provide key or prefix' };
    }
    _kvSave(store);
    return { success: true, content: `Deleted ${deleted} key(s)` };
}

function socketPush(event, data) {
    if (!event) return { success: false, content: 'event is required' };
    if (!event.startsWith('agent_')) return { success: false, content: 'Event name must start with "agent_"' };
    HUB?.broadcast(event, data || {});
    return { success: true, content: `Event "${event}" pushed` };
}

module.exports = { init };
