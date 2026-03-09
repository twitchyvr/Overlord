// ==================== TOOLS REGISTRY MODULE ====================
// Tool definitions, categories, and execution routing
// Main entry point for tool execution

const fs = require('fs');
const path = require('path');

let HUB = null;
let CONFIG = null;

// Dynamic tool registry for modules that register tools at runtime
const DYNAMIC_TOOL_HANDLERS = new Map();
const DYNAMIC_TOOL_DEFS = [];

// ==================== TOOL ALIAS REGISTRY ====================
// Maps common misnomers and alternative names to canonical tool names.
const TOOL_ALIASES = new Map([
    // Shell aliases
    ['run_command', 'bash'],
    ['execute_command', 'bash'],
    ['execute_shell', 'bash'],
    ['shell', 'bash'],
    ['run_bash', 'bash'],
    ['terminal', 'bash'],
    ['exec', 'bash'],
    // File aliases
    ['edit_file', 'patch_file'],
    ['modify_file', 'patch_file'],
    ['update_file', 'patch_file'],
    ['apply_diff', 'patch_file'],
    ['create_file', 'write_file'],
    ['save_file', 'write_file'],
    ['cat', 'read_file'],
    ['view_file', 'read_file'],
    ['open_file', 'read_file'],
    ['ls', 'list_dir'],
    ['list_directory', 'list_dir'],
    ['dir', 'list_dir'],
    // AI/MCP aliases
    ['search_web', 'web_search'],
    ['google', 'web_search'],
    ['analyze_image', 'understand_image'],
    ['read_image', 'understand_image'],
    ['describe_image', 'understand_image'],
    // Web fetch aliases
    ['fetch_url', 'fetch_webpage'],
    ['get_url', 'fetch_webpage'],
    ['read_url', 'fetch_webpage'],
    ['read_webpage', 'fetch_webpage'],
    ['get_webpage', 'fetch_webpage'],
    ['curl', 'fetch_webpage'],
    // Save-to-vault aliases
    ['save_to_vault', 'save_webpage_to_vault'],
    ['webpage_to_vault', 'save_webpage_to_vault'],
    ['clip_to_vault', 'save_webpage_to_vault'],
    // Notes aliases
    ['get_notes', 'recall_notes'],
    ['read_notes', 'recall_notes'],
    ['add_note', 'record_note'],
    ['write_note', 'record_note'],
    ['save_note', 'record_note'],
    // QA aliases
    ['run_tests', 'qa_run_tests'],
    ['test', 'qa_run_tests'],
    ['check_lint', 'qa_check_lint'],
    ['lint', 'qa_check_lint'],
    ['check_types', 'qa_check_types'],
    ['typecheck', 'qa_check_types'],
    ['check_coverage', 'qa_check_coverage'],
    ['audit_deps', 'qa_audit_deps'],
    // Agent aliases
    ['assign_agent', 'delegate_to_agent'],
    ['delegate', 'delegate_to_agent'],
]);

// ==================== TOOL DEFINITIONS ====================
// Anthropic-compatible tool definitions
const TOOL_DEFS = [
    // Shell Tools
    {
        name: 'bash',
        category: 'shell',
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
        category: 'shell',
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
        category: 'shell',
        description: 'Execute a Windows CMD command. Use for Windows batch commands and legacy scripts.',
        input_schema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'The CMD command to execute' }
            },
            required: ['command']
        }
    },

    // File Operations
    {
        name: 'read_file',
        category: 'files',
        description: 'Read the entire contents of a file. Use for files under 50KB. For larger files, use read_file_lines instead.',
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
        category: 'files',
        description: 'Read specific lines from a file. Use for large files or when you only need a section. Line numbers are 1-based.',
        input_schema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path to the file' },
                start_line: { type: 'integer', description: 'Starting line number (1-based)' },
                end_line: { type: 'integer', description: 'Ending line number (inclusive)' }
            },
            required: ['path', 'start_line', 'end_line']
        }
    },
    {
        name: 'write_file',
        category: 'files',
        description: 'Write content to a file, creating it if it does not exist. IMPORTANT: Always read_file first before modifying it to avoid data loss. Creates parent directories automatically.',
        input_schema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'The complete file content to write' },
                path: { type: 'string', description: 'Path to write the file to' }
            },
            required: ['path', 'content']
        }
    },
    {
        name: 'patch_file',
        category: 'files',
        description: 'Find and replace a specific string in a file. Use for targeted edits without rewriting the entire file. The search string must match exactly.',
        input_schema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path to the file to patch' },
                replace: { type: 'string', description: 'String to replace the search string with' },
                search: { type: 'string', description: 'Exact string to find in the file' }
            },
            required: ['path', 'search', 'replace']
        }
    },
    {
        name: 'append_file',
        category: 'files',
        description: 'Append content to the end of a file. Creates the file if it does not exist. Use for adding to log files, configuration, or any file where you want to add without overwriting.',
        input_schema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'Content to append to the file' },
                path: { type: 'string', description: 'Path to the file' }
            },
            required: ['path', 'content']
        }
    },
    {
        name: 'list_dir',
        category: 'files',
        description: 'List files and directories in a given path. Shows directories first (prefixed DIR), then files (prefixed FILE). Defaults to the current working directory if no path is given.',
        input_schema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Directory path to list (optional, defaults to working directory)' }
            }
        }
    },

    // Web & AI Tools
    {
        name: 'web_search',
        category: 'ai',
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
        category: 'ai',
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
    {
        name: 'fetch_webpage',
        category: 'ai',
        description: 'Fetch the text content of a webpage by URL and return it as clean Markdown. Automatically handles JavaScript-rendered pages (React, Vue, SPAs) by retrying via a headless-browser proxy (Jina Reader) when the initial fetch returns minimal content. HTTPS-only.',
        input_schema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The full HTTPS URL to fetch (must start with https://)' }
            },
            required: ['url']
        }
    },
    {
        name: 'save_webpage_to_vault',
        category: 'ai',
        description: 'Fetch a webpage (including JavaScript-rendered pages) and save it as a Markdown note in the configured Obsidian vault. Adds YAML frontmatter with the source URL and fetch date.',
        input_schema: {
            type: 'object',
            properties: {
                filename: { type: 'string', description: 'Override the auto-generated filename. Do not include the .md extension. Optional.' },
                folder: { type: 'string', description: 'Subfolder within the vault to save into (e.g. "References/Web"). Created if it does not exist. Optional — defaults to vault root.' },
                url: { type: 'string', description: 'Full HTTPS URL of the page to fetch and save' }
            },
            required: ['url']
        }
    },

    // System Tools
    {
        name: 'system_info',
        category: 'system',
        description: 'Get current system information including platform, OS, Node.js version, working directory, shell, AI model, and current date/time.',
        input_schema: { type: 'object', properties: {} }
    },
    {
        name: 'get_working_dir',
        category: 'system',
        description: 'Get the current working directory path. All relative file paths are resolved against this directory.',
        input_schema: { type: 'object', properties: {} }
    },
    {
        name: 'set_working_dir',
        category: 'system',
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
        category: 'system',
        description: 'Adjust the AI thinking depth. Level 1=minimal (512 tokens), 2=low (1024), 3=normal (2048), 4=high (4096), 5=maximum (8192). Higher levels give deeper analysis but use more tokens.',
        input_schema: {
            type: 'object',
            properties: {
                level: { type: 'integer', description: 'Thinking level from 1 (minimal) to 5 (maximum)' }
            },
            required: ['level']
        }
    },

    // QA Tools
    {
        name: 'qa_run_tests',
        category: 'qa',
        description: 'Run project tests. Supports types: "unit", "integration", "e2e", or "all" (default). Uses npm test with appropriate filters.',
        input_schema: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['unit', 'integration', 'e2e', 'all'], description: 'Type of tests to run' }
            }
        }
    },
    {
        name: 'qa_check_lint',
        category: 'qa',
        description: 'Run linting checks on the project. Tries npm run lint, then falls back to npx eslint.',
        input_schema: { type: 'object', properties: {} }
    },
    {
        name: 'qa_check_types',
        category: 'qa',
        description: 'Run TypeScript type checking (npx tsc --noEmit). Reports type errors without emitting files.',
        input_schema: { type: 'object', properties: {} }
    },
    {
        name: 'qa_check_coverage',
        category: 'qa',
        description: 'Run test coverage report. Uses npm run coverage if configured.',
        input_schema: {
            type: 'object',
            properties: {
                threshold: { type: 'integer', description: 'Minimum coverage percentage (informational)' }
            }
        }
    },
    {
        name: 'qa_audit_deps',
        category: 'qa',
        description: 'Audit project dependencies for security vulnerabilities using npm audit.',
        input_schema: { type: 'object', properties: {} }
    },

    // Notes & Skills
    {
        name: 'record_note',
        category: 'memory',
        description: 'Record important information as session notes for future reference. Use this to record key facts, user preferences, decisions, or context that should be recalled later in the agent execution chain. Each note is timestamped.',
        input_schema: {
            type: 'object',
            properties: {
                category: { type: 'string', description: 'Optional category/tag for this note (e.g., "user_preference", "project_info", "decision", "general")' },
                content: { type: 'string', description: 'The information to record as a note. Be concise but specific.' }
            },
            required: ['content']
        }
    },
    {
        name: 'recall_notes',
        category: 'memory',
        description: 'Recall all previously recorded session notes. Use this to retrieve important information, context, or decisions from earlier in the session or previous agent execution chains.',
        input_schema: {
            type: 'object',
            properties: {
                category: { type: 'string', description: 'Optional: filter notes by category (e.g., "user_preference", "project_info")' },
                limit: { type: 'integer', description: 'Max notes to return (default 10)' }
            }
        }
    },
    {
        name: 'list_skills',
        category: 'skills',
        description: 'List all available skills. Use this to see what specialized skills are available.',
        input_schema: { type: 'object', properties: {} }
    },
    {
        name: 'get_skill',
        category: 'skills',
        description: 'Get detailed information about a specific skill including its full content and capabilities.',
        input_schema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Name of the skill to retrieve' }
            },
            required: ['name']
        }
    },
    {
        name: 'activate_skill',
        category: 'skills',
        description: 'Activate a skill to add its specialized guidance to the current context. Use list_skills first to see available skills.',
        input_schema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Name of the skill to activate' }
            },
            required: ['name']
        }
    },
    {
        name: 'deactivate_skill',
        category: 'skills',
        description: 'Deactivate a previously activated skill.',
        input_schema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Name of the skill to deactivate' }
            },
            required: ['name']
        }
    },
    {
        name: 'session_note',
        category: 'memory',
        description: 'Write a persistent session note. Use to capture important decisions, failures, lessons learned, or things to avoid. Notes survive context compaction and are injected into every subsequent system prompt.',
        input_schema: {
            type: 'object',
            properties: {
                category: { type: 'string', description: 'Category for this note (default: progress)', enum: ['decision', 'failure', 'lesson', 'avoid', 'progress', 'info'] },
                note: { type: 'string', description: 'The note content to save' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for searchability' }
            },
            required: ['note', 'category']
        }
    },

    // GitHub
    {
        name: 'github',
        category: 'github',
        description: 'Interact with GitHub (gh CLI) and local git. Actions: get_repo, get_status, list_issues, create_issue, close_issue, list_prs, create_pr, merge_pr, list_branches, create_branch, checkout_branch, delete_branch, push, pull.',
        input_schema: {
            type: 'object',
            properties: {
                action: { type: 'string', description: 'Action: get_repo | get_status | list_issues | create_issue | close_issue | list_prs | create_pr | merge_pr | list_branches | create_branch | checkout_branch | delete_branch | push | pull' },
                title: { type: 'string', description: 'Title for issue or PR' },
                body: { type: 'string', description: 'Body/description for issue or PR (markdown supported)' },
                repo: { type: 'string', description: 'GitHub repo (owner/repo format). Omit to use current repo.' },
                branch: { type: 'string', description: 'Branch name for create_branch, checkout_branch, delete_branch, create_pr, push' },
                base: { type: 'string', description: 'Base branch for create_pr or create_branch (defaults to main/master)' },
                number: { type: 'number', description: 'Issue or PR number for close_issue or merge_pr' },
                state: { type: 'string', description: 'Filter: open | closed | all (for list operations)' },
                labels: { type: 'string', description: 'Comma-separated labels for create_issue or create_pr' },
                assignees: { type: 'string', description: 'Comma-separated GitHub usernames to assign' },
                milestone: { type: 'string', description: 'Milestone name or number for create_issue' }
            },
            required: ['action']
        }
    },

    // UI Tools
    {
        name: 'ui_action',
        category: 'ui',
        description: 'Send a UI action to all connected browser clients. Use to open/close panels, show toast notifications, set the status bar message, or switch chat modes. Never use for destructive or irreversible operations.',
        input_schema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['open_panel', 'close_panel', 'show_toast', 'set_status', 'open_url', 'set_mode', 'scroll_to_bottom'], description: 'UI action to perform' },
                params: { type: 'object', description: 'Action params. open_panel/close_panel: {panelId}. show_toast: {message, type: "info"|"success"|"warning"|"error", duration?}. set_status: {message}. open_url: {url}. set_mode: {mode: "auto"|"plan"|"pm"|"ask"}. scroll_to_bottom: no params.' }
            },
            required: ['action']
        }
    },
    {
        name: 'show_chart',
        category: 'ui',
        description: 'Render an interactive chart as an overlay in the browser. Supports bar, line, and pie charts. Great for visualising data, metrics, task progress, agent performance, etc.',
        input_schema: {
            type: 'object',
            properties: {
                colors: { type: 'array', items: { type: 'string' }, description: 'Optional hex color for each bar/slice (e.g. "#00d4ff")' },
                labels: { type: 'array', items: { type: 'string' }, description: 'X-axis labels or slice names' },
                title: { type: 'string', description: 'Chart title' },
                type: { type: 'string', enum: ['bar', 'line', 'pie'], description: 'Chart type' },
                values: { type: 'array', items: { type: 'number' }, description: 'Corresponding data values' }
            },
            required: ['type', 'labels', 'values']
        }
    },
    {
        name: 'ask_user',
        category: 'ui',
        description: 'Request structured input from the user and wait for their answer before continuing. Ideal for confirmations, picking from choices, or collecting a short text/number input. Times out after 2 minutes.',
        input_schema: {
            type: 'object',
            properties: {
                choices: { type: 'array', items: { type: 'string' }, description: 'Options for type=choice' },
                default: { type: 'string', description: 'Pre-filled default value' },
                question: { type: 'string', description: 'The question or prompt to show the user' },
                type: { type: 'string', enum: ['text', 'confirm', 'choice', 'number'], description: 'Input type: text=free text, confirm=yes/no, choice=pick one of choices, number=numeric' }
            },
            required: ['question', 'type']
        }
    },

    // KV Store
    {
        name: 'kv_set',
        category: 'kv',
        description: 'Store a value in the persistent key-value store. Survives server restarts. Use for cross-session memory, caching, flags, and small data blobs.',
        input_schema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Key (use namespace prefix for organisation, e.g. "proj:status")' },
                ttl_ms: { type: 'integer', description: 'Optional time-to-live in milliseconds; entry auto-deletes after expiry' },
                value: { type: 'object', description: 'Value — any JSON-serialisable type (string, number, object, array)' }
            },
            required: ['key', 'value']
        }
    },
    {
        name: 'kv_get',
        category: 'kv',
        description: 'Retrieve a value from the persistent key-value store. Returns null if the key does not exist or has expired.',
        input_schema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Key to retrieve' }
            },
            required: ['key']
        }
    },
    {
        name: 'kv_list',
        category: 'kv',
        description: 'List keys in the persistent key-value store, optionally filtered by prefix.',
        input_schema: {
            type: 'object',
            properties: {
                limit: { type: 'integer', description: 'Max entries to return (default 50)' },
                prefix: { type: 'string', description: 'Only return keys starting with this prefix' }
            }
        }
    },
    {
        name: 'kv_delete',
        category: 'kv',
        description: 'Delete one or more keys from the persistent key-value store.',
        input_schema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Single key to delete' },
                prefix: { type: 'string', description: 'Delete all keys starting with this prefix' }
            }
        }
    },
    {
        name: 'socket_push',
        category: 'ui',
        description: 'Emit a custom Socket.IO event to all connected browser clients. Event name must start with "agent_". Useful for custom UI integrations and live data feeds captured by onAgentEvent() in the browser.',
        input_schema: {
            type: 'object',
            properties: {
                data: { type: 'object', description: 'Payload object sent with the event' },
                event: { type: 'string', description: 'Event name — MUST start with "agent_" (e.g. "agent_progress", "agent_metric")' }
            },
            required: ['event']
        }
    },

    // Todo Tools
    {
        name: 'add_todo',
        category: 'tasks',
        description: 'Add a checklist item (todo) to an existing task. Use for breaking tasks into atomic sub-items that can be individually checked off.',
        input_schema: {
            type: 'object',
            properties: {
                task_id: { type: 'string', description: 'ID of the task to add the todo to' },
                text: { type: 'string', description: 'Text of the todo item' }
            },
            required: ['task_id', 'text']
        }
    },
    {
        name: 'toggle_todo',
        category: 'tasks',
        description: 'Toggle the done/undone state of a todo item within a task.',
        input_schema: {
            type: 'object',
            properties: {
                task_id: { type: 'string', description: 'ID of the parent task' },
                todo_id: { type: 'string', description: 'ID of the todo item to toggle' }
            },
            required: ['task_id', 'todo_id']
        }
    }
];

// ==================== TOOL EXECUTION ====================
// Main execute function that routes to specific tool implementations

async function executeToolCall(tool, inputOverride) {
    const shellExecutor = require('./shell-executor');
    const fileOps = require('./file-operations');
    const webFetch = require('./web-fetch');
    const systemTools = require('./system-tools');
    const qaTools = require('./qa-tools');
    const githubTools = require('./github-tools');

    // Normalize input
    let name, input;
    if (typeof tool === 'string') {
        name = tool;
        input = inputOverride || {};
    } else if (tool.name) {
        name = tool.name;
        input = tool.input || {};
    } else if (tool.command) {
        name = 'bash';
        input = { command: tool.command };
    } else {
        name = 'bash';
        input = {};
    }

    // Alias resolution
    if (TOOL_ALIASES.has(name)) {
        const resolved = TOOL_ALIASES.get(name);
        HUB.log(`[Tools] Alias resolved: ${name} → ${resolved}`, 'info');
        name = resolved;
    }

    HUB.log(`[Tools] Executing: ${name}`, 'info');

    try {
        let result;

        switch (name) {
            // Shell
            case 'bash':
                result = await shellExecutor.runBash(input.command);
                break;
            case 'powershell':
                result = await shellExecutor.runPS(input.command);
                break;
            case 'cmd':
                result = await shellExecutor.runCmd(input.command);
                break;

            // Files
            case 'read_file':
                result = fileOps.readFile(input.path);
                break;
            case 'read_file_lines':
                result = fileOps.readFileLines(input.path, input.start_line, input.end_line);
                break;
            case 'write_file':
                result = fileOps.writeFile(input.path, input.content);
                break;
            case 'list_dir':
                result = fileOps.listDir(input.path);
                break;
            case 'patch_file':
                result = fileOps.patchFile(input.path, input.search, input.replace);
                break;
            case 'append_file':
                result = fileOps.appendFile(input.path, input.content);
                break;

            // Web & AI
            case 'web_search':
                HUB.log(`[Tools] web_search called with query: ${input.query}`, 'info');
                result = await webFetch.webSearch(input.query);
                HUB.log(`[Tools] web_search result: ${result.success}`, 'info');
                break;
            case 'understand_image':
                result = await webFetch.understandImage(input.path, input.prompt);
                break;
            case 'fetch_webpage':
                result = await webFetch.fetchWebpage(input.url);
                break;
            case 'save_webpage_to_vault':
                result = await webFetch.saveWebpageToVault(input);
                break;

            // System
            case 'system_info':
                result = await systemTools.systemInfo();
                break;
            case 'get_working_dir':
                result = systemTools.getWorkingDir();
                break;
            case 'set_working_dir':
                result = systemTools.setWorkingDir(input.path);
                break;
            case 'set_thinking_level':
                result = systemTools.setThinkingLevel(input.level);
                break;

            // QA
            case 'qa_run_tests':
                result = await qaTools.runTests(input.type || 'all');
                break;
            case 'qa_check_lint':
                result = await qaTools.checkLint(input && input.path);
                break;
            case 'qa_check_types':
                result = await qaTools.checkTypes();
                break;
            case 'qa_check_coverage':
                result = await qaTools.checkCoverage(input && input.threshold);
                break;
            case 'qa_audit_deps':
                result = await qaTools.auditDeps();
                break;

            // GitHub
            case 'github':
                result = await githubTools.handleGithub(input);
                break;

            // Notes
            case 'record_note':
            case 'recall_notes': {
                const notesModule = require('./notes-module');
                result = notesModule.executeNoteTool(name, input);
                break;
            }

            // Session Notes
            case 'session_note':
                result = fileOps.writeSessionNote(input.note, input.category || 'progress');
                break;

            // Skills
            case 'list_skills':
            case 'get_skill':
            case 'activate_skill':
            case 'deactivate_skill': {
                const skillsModule = require('./skills-module');
                result = skillsModule.executeSkillTool(name, input);
                break;
            }

            // UI Tools
            case 'ui_action':
                result = systemTools.uiAction(input);
                break;
            case 'show_chart':
                result = systemTools.showChart(input);
                break;
            case 'ask_user':
                result = await systemTools.askUser(input);
                break;

            // KV Store
            case 'kv_set':
                result = systemTools.kvSet(input.key, input.value, input.ttl_ms);
                break;
            case 'kv_get':
                result = systemTools.kvGet(input.key);
                break;
            case 'kv_list':
                result = systemTools.kvList(input.prefix, input.limit);
                break;
            case 'kv_delete':
                result = systemTools.kvDelete(input.key, input.prefix);
                break;
            case 'socket_push':
                result = systemTools.socketPush(input.event, input.data);
                break;

            // Todo tools
            case 'add_todo': {
                const tasks = HUB.getService('tasks');
                if (!tasks || !tasks.addTodo) { result = { error: 'Tasks service unavailable' }; break; }
                result = tasks.addTodo(input.task_id, input.text);
                break;
            }
            case 'toggle_todo': {
                const tasks = HUB.getService('tasks');
                if (!tasks || !tasks.toggleTodo) { result = { error: 'Tasks service unavailable' }; break; }
                result = tasks.toggleTodo(input.task_id, input.todo_id);
                break;
            }

            // Dynamic tools
            case 'init_context':
                result = await getInitialContext();
                break;

            default:
                // Check dynamic tools
                if (DYNAMIC_TOOL_HANDLERS.has(name)) {
                    const handler = DYNAMIC_TOOL_HANDLERS.get(name);
                    result = await handler(input);
                } else {
                    result = { error: `Unknown tool: ${name}` };
                }
        }

        return result;
    } catch (error) {
        HUB.log(`[Tools] Error executing ${name}: ${error.message}`, 'error');
        return { error: error.message };
    }
}

// Initial context helper
async function getInitialContext() {
    const conv = HUB.getService('conversation');
    if (!conv) return { workingDir: process.cwd() };
    
    const ctx = conv.getContextUsage ? conv.getContextUsage() : {};
    const cfg = HUB.getService('config');
    
    return {
        workingDir: conv.getWorkingDirectory ? conv.getWorkingDirectory() : process.cwd(),
        model: cfg?.model || 'unknown',
        baseUrl: cfg?.baseUrl || 'unknown',
        ...ctx
    };
}

// ==================== INITIALIZATION ====================

function init(hub) {
    HUB = hub;
    CONFIG = hub.getService('config');

    // Register tools
    const tools = hub.getService('tools');
    if (tools && tools.registerTool) {
        TOOL_DEFS.forEach(def => {
            tools.registerTool(def, null);
        });
    }

    HUB.log('✅ Tools registry initialized', 'info');
}

// Register a dynamic tool at runtime
function registerDynamicTool(name, definition, handler) {
    DYNAMIC_TOOL_DEFS.push({ name, ...definition });
    DYNAMIC_TOOL_HANDLERS.set(name, handler);
    
    // Register with tools service if available
    if (HUB) {
        const tools = HUB.getService('tools');
        if (tools && tools.registerTool) {
            tools.registerTool({ name, ...definition }, handler);
        }
    }
}

module.exports = {
    init,
    execute: executeToolCall,
    TOOL_DEFS,
    TOOL_ALIASES,
    DYNAMIC_TOOL_DEFS,
    registerDynamicTool,
    getInitialContext
};
