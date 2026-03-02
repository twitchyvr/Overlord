// ==================== AGENT FRAMEWORK ====================
// Based on MiniMax official documentation patterns
// Provides: tool execution, sandboxing, proper error handling

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ==================== SANDBOX EXECUTION ====================
// Execute commands in a controlled environment

class CommandSandbox {
    constructor(workingDir, options = {}) {
        this.workingDir = workingDir;
        this.timeout = options.timeout || 60000; // 60s default
        this.env = { ...process.env };
    }
    
    // Execute a command safely
    async execute(command, shell = 'bash') {
        return new Promise((resolve) => {
            const startTime = Date.now();
            let stdout = '';
            let stderr = '';
            
            // Determine shell based on platform
            const isWindows = process.platform === 'win32';
            const shellCmd = isWindows ? 'cmd.exe' : '/bin/bash';
            const shellArgs = isWindows ? ['/c', command] : ['-c', command];
            
            console.log(`[Sandbox] Executing: ${command} in ${this.workingDir}`);
            
            // FIXED: Don't pass timeout to spawn - it breaks on some platforms
            // Use setTimeout + kill instead for timeout handling
            const proc = spawn(shellCmd, shellArgs, {
                cwd: this.workingDir,
                env: this.env
            });
            
            proc.stdout.on('data', (data) => { stdout += data.toString(); });
            proc.stderr.on('data', (data) => { stderr += data.toString(); });
            
            // Set timeout manually
            const timeoutId = setTimeout(() => {
                proc.kill('SIGTERM');
                resolve({
                    success: false,
                    stdout: stdout.trim(),
                    stderr: 'Command timed out after ' + (this.timeout / 1000) + ' seconds',
                    exitCode: -1,
                    duration: this.timeout
                });
            }, this.timeout);
            
            proc.on('close', (code) => {
                clearTimeout(timeoutId);
                const duration = Date.now() - startTime;
                resolve({
                    success: code === 0,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    exitCode: code,
                    duration
                });
            });
            
            proc.on('error', (err) => {
                clearTimeout(timeoutId);
                resolve({
                    success: false,
                    stdout: '',
                    stderr: err.message,
                    exitCode: -1,
                    duration: Date.now() - startTime
                });
            });
        });
    }
}

// ==================== TOOL REGISTRY ====================
// Central registry for all available tools

class ToolRegistry {
    constructor(hub) {
        this.hub = hub;
        this.tools = new Map();
        this.registerCoreTools();
    }
    
    registerCoreTools() {
        // File Tools
        this.register('read_file', {
            description: 'Read a file entirely (max 50KB)',
            parameters: {
                path: { type: 'string', required: true }
            },
            handler: this.handleReadFile.bind(this)
        });
        
        this.register('read_file_lines', {
            description: 'Read specific line range from a file',
            parameters: {
                path: { type: 'string', required: true },
                start_line: { type: 'number', required: true },
                end_line: { type: 'number', required: true }
            },
            handler: this.handleReadFileLines.bind(this)
        });
        
        this.register('write_file', {
            description: 'Write content to a file',
            parameters: {
                path: { type: 'string', required: true },
                content: { type: 'string', required: true }
            },
            handler: this.handleWriteFile.bind(this)
        });
        
        this.register('patch_file', {
            description: 'Replace a block of text in a file',
            parameters: {
                path: { type: 'string', required: true },
                search: { type: 'string', required: true },
                replace: { type: 'string', required: true }
            },
            handler: this.handlePatchFile.bind(this)
        });
        
        // Shell Tools
        this.register('bash', {
            description: 'Execute a bash/command command',
            parameters: {
                command: { type: 'string', required: true }
            },
            handler: this.handleBash.bind(this)
        });
        
        this.register('powershell', {
            description: 'Execute a PowerShell command (Windows)',
            parameters: {
                command: { type: 'string', required: true }
            },
            handler: this.handlePowershell.bind(this)
        });
        
        this.register('cmd', {
            description: 'Execute a Windows CMD command',
            parameters: {
                command: { type: 'string', required: true }
            },
            handler: this.handleCmd.bind(this)
        });
        
        // Web Tools
        this.register('web_search', {
            description: 'Perform a web search',
            parameters: {
                query: { type: 'string', required: true }
            },
            handler: this.handleWebSearch.bind(this)
        });
        
        this.register('understand_image', {
            description: 'Analyze an image using AI',
            parameters: {
                path: { type: 'string', required: true },
                prompt: { type: 'string', required: false }
            },
            handler: this.handleUnderstandImage.bind(this)
        });
        
        // System Tools
        this.register('system_info', {
            description: 'Get system/platform information',
            parameters: {},
            handler: this.handleSystemInfo.bind(this)
        });
        
        this.register('get_agent_info', {
            description: 'Get info about a specific agent',
            parameters: {
                agent_name: { type: 'string', required: true }
            },
            handler: this.handleGetAgentInfo.bind(this)
        });
        
        this.register('assign_task', {
            description: 'Assign a task to an agent',
            parameters: {
                agent_name: { type: 'string', required: true },
                task: { type: 'string', required: true }
            },
            handler: this.handleAssignTask.bind(this)
        });
    }
    
    register(name, definition) {
        this.tools.set(name, definition);
    }
    
    getDefinitions() {
        return [
            // File Tools
            { name: "read_file", description: "Read a file entirely (max 50KB)", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }},
            { name: "read_file_lines", description: "Read specific line range from a file", input_schema: { type: "object", properties: { path: { type: "string" }, start_line: { type: "number" }, end_line: { type: "number" } }, required: ["path", "start_line", "end_line"] }},
            { name: "write_file", description: "Write content to a file", input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }},
            { name: "patch_file", description: "Replace a block of text in a file", input_schema: { type: "object", properties: { path: { type: "string" }, search: { type: "string" }, replace: { type: "string" } }, required: ["path", "search", "replace"] }},
            { name: "append_file", description: "Append content to a file", input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }},
            { name: "reveal", description: "Get path to open in file explorer", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }},
            
            // Shell Tools
            { name: "bash", description: "Execute a bash/command prompt command (macOS/Linux/WSL)", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] }},
            { name: "powershell", description: "Execute a PowerShell command (Windows)", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] }},
            { name: "cmd", description: "Execute a Windows CMD command prompt command", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] }},
            
            // Agent Tools
            { name: "list_agents", description: "List all available team agents", input_schema: { type: "object", properties: {}, required: [] }},
            { name: "get_agent_info", description: "Get info about a specific agent", input_schema: { type: "object", properties: { agent_name: { type: "string" } }, required: ["agent_name"] }},
            { name: "assign_task", description: "Assign a task to an agent", input_schema: { type: "object", properties: { agent_name: { type: "string" }, task: { type: "string" } }, required: ["agent_name", "task"] }},
            { name: "set_thinking_level", description: "Adjust AI thinking depth (1=minimal, 2=low, 3=normal, 4=high, 5=maximum)", input_schema: { type: "object", properties: { level: { type: "number", minimum: 1, maximum: 5 } }, required: ["level"] }},
            
            // Web Tools
            { name: "web_search", description: "Perform a web search", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }},
            { name: "understand_image", description: "Analyze an image using AI vision", input_schema: { type: "object", properties: { path: { type: "string" }, prompt: { type: "string" } }, required: ["path"] }},
            
            // System Tools
            { name: "system_info", description: "Get system/platform information", input_schema: { type: "object", properties: {}, required: [] }},
            { name: "weather", description: "Check current weather conditions for a location", input_schema: { type: "object", properties: { location: { type: "string" } }, required: ["location"] }},
            
            // GitHub Tools (placeholder - need GitHub module)
            { name: "github_get_repo", description: "Get GitHub repository info", input_schema: { type: "object", properties: {}, required: [] }},
            { name: "github_list_issues", description: "List GitHub issues", input_schema: { type: "object", properties: { state: { type: "string", enum: ["open", "closed", "all"] } }, required: [] }},
            
            // QA Tools
            { name: "qa_run_tests", description: "Run test suite (unit/integration/e2e/all)", input_schema: { type: "object", properties: { type: { type: "string", enum: ["unit", "integration", "e2e", "all"] } }, required: [] }},
            { name: "qa_check_lint", description: "Run linting checks", input_schema: { type: "object", properties: {}, required: [] }},
            { name: "qa_check_types", description: "Run TypeScript type checking", input_schema: { type: "object", properties: {}, required: [] }},
            { name: "qa_check_coverage", description: "Run code coverage analysis", input_schema: { type: "object", properties: { threshold: { type: "number" } }, required: [] }},
            { name: "qa_audit_deps", description: "Audit dependencies for vulnerabilities", input_schema: { type: "object", properties: {}, required: [] }}
        ];
    }
    
    findNameByTool(tool) {
        for (const [name, t] of this.tools) {
            if (t === tool) return name;
        }
        return 'unknown';
    }
    
    // Get working directory
    getWorkingDir() {
        const conv = this.hub?.getService('conversation');
        return conv?.getWorkingDirectory ? conv.getWorkingDirectory() : process.cwd();
    }
    
    // Get project root
    getProjectRoot() {
        const config = this.hub?.getService('config');
        return config?.baseDir || process.cwd();
    }
    
    // Resolve path relative to working directory
    resolvePath(filePath) {
        if (path.isAbsolute(filePath)) return filePath;
        return path.join(this.getWorkingDir(), filePath);
    }
    
    // Tool Handlers
    async handleReadFile(params) {
        const fullPath = this.resolvePath(params.path);
        try {
            const stats = await fs.promises.stat(fullPath);
            if (stats.size > 50000) {
                return { success: false, error: `File too large (${stats.size} bytes). Use read_file_lines.` };
            }
            const content = await fs.promises.readFile(fullPath, 'utf8');
            return { success: true, content };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
    
    async handleReadFileLines(params) {
        const fullPath = this.resolvePath(params.path);
        try {
            const content = await fs.promises.readFile(fullPath, 'utf8');
            const lines = content.split('\n');
            const start = Math.max(1, params.start_line);
            const end = Math.min(lines.length, params.end_line);
            const selected = lines.slice(start - 1, end);
            return { success: true, content: selected.join('\n'), totalLines: lines.length };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
    
    async handleWriteFile(params) {
        const fullPath = this.resolvePath(params.path);
        try {
            await fs.promises.writeFile(fullPath, params.content, 'utf8');
            return { success: true, content: `Written to: ${params.path}` };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
    
    async handlePatchFile(params) {
        const fullPath = this.resolvePath(params.path);
        try {
            const content = await fs.promises.readFile(fullPath, 'utf8');
            if (!content.includes(params.search)) {
                return { success: false, error: 'Search string not found in file' };
            }
            const newContent = content.replace(params.search, params.replace);
            await fs.promises.writeFile(fullPath, newContent, 'utf8');
            return { success: true, content: `Patched: ${params.path}` };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
    
    async handleBash(params) {
        const sandbox = new CommandSandbox(this.getWorkingDir());
        const result = await sandbox.execute(params.command, 'bash');
        return {
            success: result.success,
            content: result.stdout || result.stderr,
            exitCode: result.exitCode,
            duration: result.duration
        };
    }
    
    async handlePowershell(params) {
        const sandbox = new CommandSandbox(this.getWorkingDir());
        const result = await sandbox.execute(params.command, 'powershell');
        return {
            success: result.success,
            content: result.stdout || result.stderr,
            exitCode: result.exitCode,
            duration: result.duration
        };
    }
    
    async handleCmd(params) {
        const sandbox = new CommandSandbox(this.getWorkingDir());
        const result = await sandbox.execute(params.command, 'cmd');
        return {
            success: result.success,
            content: result.stdout || result.stderr,
            exitCode: result.exitCode,
            duration: result.duration
        };
    }
    
    async handleWebSearch(params) {
        // Use MiniMax MCP for web search if available
        const mcp = this.hub?.getService('mcp');
        if (mcp?.webSearch) {
            try {
                return await mcp.webSearch(params.query);
            } catch (e) {
                return { success: false, error: e.message };
            }
        }
        
        // Fallback: use a simple fetch-based search
        return { 
            success: false, 
            error: 'Web search not configured. Configure MiniMax MCP for web search.' 
        };
    }
    
    async handleUnderstandImage(params) {
        const mcp = this.hub?.getService('mcp');
        if (mcp?.understandImage) {
            const fullPath = this.resolvePath(params.path);
            const prompt = params.prompt || 'Describe this image in detail.';
            return await mcp.understandImage(fullPath, prompt, this.hub?.getService('config'));
        }
        return { success: false, error: 'Image understanding not configured' };
    }
    
    handleSystemInfo() {
        const os = require('os');
        return {
            success: true,
            content: `# System Information

- **Platform**: ${os.platform()}
- **OS**: ${os.type()} ${os.release()}
- **Shell**: ${process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'}
- **Node**: ${process.version}
- **Working Directory**: ${this.getWorkingDir()}
- **Project Root**: ${this.getProjectRoot()}`
        };
    }
    
    handleGetAgentInfo(params) {
        const agentSystem = this.hub?.getService('agentSystem');
        if (!agentSystem) {
            return { success: false, error: 'Agent system not available' };
        }
        const info = agentSystem.formatAgentInfo(params.agent_name);
        return { success: true, content: info };
    }
    
    async handleAssignTask(params) {
        const agentSystem = this.hub?.getService('agentSystem');
        if (!agentSystem) {
            return { success: false, error: 'Agent system not available' };
        }
        try {
            const result = await agentSystem.assignTask(params.agent_name, params.task);
            return { success: true, content: result };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
    
    // Execute a tool by name
    async execute(toolName, params) {
        const tool = this.tools.get(toolName);
        if (!tool) {
            return { success: false, error: `Unknown tool: ${toolName}` };
        }
        
        // Validate parameters
        for (const [param, spec] of Object.entries(tool.parameters)) {
            if (spec.required && !params[param]) {
                return { success: false, error: `Missing required parameter: ${param}` };
            }
        }
        
        try {
            return await tool.handler(params);
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
}

module.exports = { CommandSandbox, ToolRegistry };
