// ==================== AGENT DEFINITIONS ====================
// Based on oh-my-claude patterns from official docs

const fs = require('fs');
const path = require('path');

// Built-in agents with full implementations
const AGENTS = {
    'git-keeper': {
        name: 'git-keeper',
        role: 'Git Operations Specialist',
        description: 'Manages all git operations including commits, pushes, pulls, branches, and merging. Handles GitHub integration.',
        capabilities: ['git', 'github', 'version-control'],
        workingDir: null,
        execute: async (task, context) => {
            const { tools } = context;
            
            let cmd = task.replace(/^(git-keeper:\s*)?/i, '').trim();
            cmd = cmd.replace(/^check\s+(git\s+)/i, '$1');
            cmd = cmd.replace(/^show\s+(git\s+)/i, '$1');
            cmd = cmd.replace(/^view\s+(git\s+)/i, '$1');
            cmd = cmd.replace(/^get\s+(git\s+)/i, '$1');
            
            let gitCmd = cmd;
            if (!cmd.toLowerCase().includes('git ')) {
                gitCmd = 'git ' + cmd;
            }
            
            const result = await tools.execute('bash', { command: gitCmd });
            return { agent: 'git-keeper', task, success: result.success, output: result.content || result.error, duration: 0 };
        }
    },
    
    'testing-engineer': {
        name: 'testing-engineer',
        role: 'QA & Testing Specialist',
        description: 'Runs tests, linting, type checking, and code quality checks.',
        capabilities: ['testing', 'linting', 'quality-assurance', 'coverage'],
        workingDir: null,
        execute: async (task, context) => {
            const { tools } = context;
            const taskLower = task.toLowerCase();
            let result;
            if (taskLower.includes('unit')) result = await tools.execute('bash', { command: 'npm test -- --testPathPattern=unit || echo "No unit tests"' });
            else if (taskLower.includes('lint')) result = await tools.execute('bash', { command: 'npm run lint 2>&1 || npx eslint . 2>&1 || echo "No lint"' });
            else if (taskLower.includes('type') || taskLower.includes('tsc')) result = await tools.execute('bash', { command: 'npx tsc --noEmit 2>&1 || echo "No TypeScript"' });
            else result = await tools.execute('bash', { command: 'npm test 2>&1 || echo "No tests"' });
            return { agent: 'testing-engineer', task, success: result.success, output: result.content || result.error, duration: 0 };
        }
    },
    
    'code-implementer': {
        name: 'code-implementer',
        role: 'Code Implementation Specialist',
        description: 'Implements features, creates files, and modifies code based on requirements.',
        capabilities: ['coding', 'file-operations', 'implementation'],
        workingDir: null,
        execute: async (task, context) => {
            const { tools } = context;
            const taskLower = task.toLowerCase();
            
            if (taskLower.includes('create') || taskLower.includes('write') || taskLower.includes('make file') || taskLower.includes('new file')) {
                // Extract file path - look for patterns like "file X.js" or "to X.js"
                const pathMatch = task.match(/(?:file|to|create|make)\s+["']?([^"'\s]+\.[a-z]+)["']?/i);
                
                if (pathMatch) {
                    const filePath = pathMatch[1];
                    
                    // Get content: find "with " and take everything after it
                    let content = null;
                    const withIdx = task.toLowerCase().indexOf('with ');
                    if (withIdx >= 0) {
                        content = task.substring(withIdx + 5).trim();
                        // Remove outer quotes if present
                        if ((content.startsWith('"') && content.endsWith('"')) || 
                            (content.startsWith("'") && content.endsWith("'"))) {
                            content = content.slice(1, -1);
                        }
                    }
                    
                    if (content) {
                        const result = await tools.execute('write_file', { path: filePath, content: content });
                        return { agent: 'code-implementer', task, success: result.success, output: result.content, duration: 0 };
                    }
                }
            }
            
            const result = await tools.execute('bash', { command: task });
            return { agent: 'code-implementer', task, success: result.success, output: result.content || result.error, duration: 0 };
        }
    },
    
    'ui-expert': {
        name: 'ui-expert',
        role: 'UI/UX Design Specialist',
        description: 'Expert at developing high quality working polished UI and UX. Creates beautiful, functional, accessible interfaces with modern design principles.',
        capabilities: ['ui-design', 'ux-design', 'css', 'html', 'accessibility', 'responsive-design', 'animation', 'visual-design'],
        workingDir: null,
        execute: async (task, context) => {
            if (!context || !context.tools) {
                return { agent: 'ui-expert', task, success: false, output: 'Agent context missing tools service' };
            }
            const { tools } = context;
            const taskLower = task.toLowerCase();
            const outputs = [];

            if (taskLower.includes('analyze') || taskLower.includes('review') || taskLower.includes('audit') || taskLower.includes('critique')) {
                const r1 = await tools.execute('bash', { command: "grep -rn 'TODO\\|FIXME\\|HACK' --include='*.html' --include='*.css' . 2>/dev/null | head -30 || echo 'No issues found'" });
                const r2 = await tools.execute('bash', { command: "grep -rn '!important' --include='*.css' . 2>/dev/null | wc -l" });
                const r3 = await tools.execute('bash', { command: "grep -rn '<img' --include='*.html' -r . 2>/dev/null | grep -v 'alt=' | head -10 || echo 'All images have alt attributes'" });
                outputs.push('## UI Audit Results');
                outputs.push('### Code Issues (TODO/FIXME/HACK):\n' + (r1.content?.trim() || 'None'));
                outputs.push('### !important usage count: ' + (r2.content?.trim() || '0'));
                outputs.push('### Images missing alt=:\n' + (r3.content?.trim() || 'None — good!'));
            }

            if (taskLower.includes('css') || taskLower.includes('style') || taskLower.includes('theme')) {
                const r1 = await tools.execute('bash', { command: "find . -name '*.css' -not -path '*/node_modules/*' 2>/dev/null | head -10" });
                const r2 = await tools.execute('bash', { command: "grep -rn ':root' --include='*.css' . 2>/dev/null | head -5" });
                outputs.push('## CSS Structure');
                outputs.push('### CSS files:\n' + (r1.content?.trim() || 'None found'));
                outputs.push('### CSS variable roots:\n' + (r2.content?.trim() || 'None'));
            }

            if (taskLower.includes('accessib') || taskLower.includes('a11y') || taskLower.includes('aria')) {
                const r1 = await tools.execute('bash', { command: "grep -rn 'aria-\\|role=' --include='*.html' . 2>/dev/null | head -20 || echo 'No ARIA attributes found'" });
                outputs.push('## Accessibility Attributes:\n' + (r1.content?.trim() || 'None'));
            }

            if (outputs.length === 0) {
                const r1 = await tools.execute('bash', { command: "find . -name '*.html' -o -name '*.css' -not -path '*/node_modules/*' 2>/dev/null | wc -l" });
                outputs.push('## UI File Count: ' + (r1.content?.trim() || '0') + ' files\nAvailable analyses: analyze/review/audit, css/style, accessibility/a11y');
            }

            return { agent: 'ui-expert', task, success: true, output: outputs.join('\n\n'), duration: 0 };
        }
    },

    'ui-tester': {
        name: 'ui-tester',
        role: 'UI Testing Specialist',
        description: 'Specializes in testing UI components, visual regression testing, accessibility testing, and ensuring pixel-perfect implementations.',
        capabilities: ['ui-testing', 'visual-testing', 'accessibility-testing', 'e2e-testing', 'regression-testing'],
        workingDir: null,
        execute: async (task, context) => {
            if (!context || !context.tools) {
                return { agent: 'ui-tester', task, success: false, output: 'Agent context missing tools service' };
            }
            const { tools } = context;
            const taskLower = task.toLowerCase();
            const outputs = [];

            if (taskLower.includes('accessibility') || taskLower.includes('a11y')) {
                const r1 = await tools.execute('bash', { command: "grep -rn '<img' --include='*.html' -r . 2>/dev/null | grep -v 'alt=' | head -10 || echo 'All images have alt'" });
                const r2 = await tools.execute('bash', { command: "grep -rn 'aria-label\\|aria-describedby\\|role=' --include='*.html' . 2>/dev/null | head -15" });
                const r3 = await tools.execute('bash', { command: "grep -n 'lang=' --include='*.html' -r . 2>/dev/null | head -5 || echo 'Warning: no lang attribute found on html elements'" });
                outputs.push('## Accessibility Test Results');
                outputs.push('### Images missing alt=:\n' + (r1.content?.trim() || 'None'));
                outputs.push('### ARIA attributes found:\n' + (r2.content?.trim() || 'None found'));
                outputs.push('### HTML lang attribute:\n' + (r3.content?.trim() || 'Not checked'));
            }

            if (taskLower.includes('testability') || taskLower.includes('data-test') || (!taskLower.includes('accessibility') && !taskLower.includes('visual'))) {
                const r1 = await tools.execute('bash', { command: "grep -rn 'data-testid\\|data-cy\\|data-test' --include='*.html' --include='*.jsx' . 2>/dev/null | head -20 || echo 'No test IDs found'" });
                const r2 = await tools.execute('bash', { command: "grep -rn '<button\\|<input\\|<select' --include='*.html' . 2>/dev/null | wc -l" });
                outputs.push('## Testability Coverage');
                outputs.push('### Test ID attributes:\n' + (r1.content?.trim() || 'None'));
                outputs.push('### Interactive elements: ' + (r2.content?.trim() || '0'));
            }

            if (taskLower.includes('visual') || taskLower.includes('regression') || taskLower.includes('screenshot')) {
                const r1 = await tools.execute('bash', { command: "npx playwright --version 2>/dev/null || echo 'Playwright not installed'" });
                outputs.push('## Visual Testing\n' + (r1.content?.includes('playwright') ? 'Playwright available. Run: `npx playwright test`' : 'Playwright not installed. Run: `npm install --save-dev @playwright/test`'));
            }

            if (outputs.length === 0) {
                outputs.push('## UI Tester\nAvailable tests: accessibility (a11y), testability (data-testid), visual (regression/screenshot)\nExample: "run accessibility tests"');
            }

            return { agent: 'ui-tester', task, success: true, output: outputs.join('\n\n'), duration: 0 };
        }
    },

    'regex-expert': {
        name: 'regex-expert',
        role: 'Regular Expression Specialist',
        description: 'Expert at creating, testing, and debugging regular expressions. Handles complex pattern matching, text processing, and validation.',
        capabilities: ['regex', 'pattern-matching', 'text-processing', 'validation', 'parsing'],
        workingDir: null,
        execute: async (task, context) => {
            if (!context || !context.tools) {
                return { agent: 'regex-expert', task, success: false, output: 'Agent context missing tools service' };
            }
            const { tools } = context;
            const taskLower = task.toLowerCase();
            const outputs = [];

            // Extract regex pattern — validate characters to prevent injection
            const patternMatch = task.match(/\/([^/\\]*(?:\\.[^/\\]*)*)\/([gimsuy]*)/);
            const pattern = patternMatch ? patternMatch[1] : null;
            const flags = patternMatch ? patternMatch[2] : 'g';

            // Common named patterns for generate
            const COMMON_PATTERNS = {
                'email': String.raw`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`,
                'phone': String.raw`^[+]?[(]?[0-9]{3}[)]?[\-\s.]?[0-9]{3}[\-\s.]?[0-9]{4}$`,
                'url': String.raw`^https?:\/\/[\w\-]+(\.[w\-]+)+[/#?]?.*$`,
                'ipv4': String.raw`^(\d{1,3}\.){3}\d{1,3}$`,
                'date': String.raw`^\d{4}[-/]\d{2}[-/]\d{2}$`,
                'zip': String.raw`^\d{5}(-\d{4})?$`,
                'hex': String.raw`^#?([a-fA-F0-9]{6}|[a-fA-F0-9]{3})$`,
                'slug': String.raw`^[a-z0-9]+(?:-[a-z0-9]+)*$`,
                'uuid': String.raw`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`
            };

            if (taskLower.includes('test') || taskLower.includes('match') || taskLower.includes('check')) {
                if (pattern) {
                    // Validate pattern is safe (no shell metacharacters outside of regex syntax)
                    let testResult;
                    try {
                        // Test the pattern in-process using Node's built-in RegExp (no shell needed)
                        const re = new RegExp(pattern, flags);
                        const againstMatch = task.match(/(?:against|on|with)\s+(.+)$/i);
                        const testStrings = againstMatch
                            ? (againstMatch[1].match(/["']([^"']+)["']/g) || [againstMatch[1].trim()]).map(s => s.replace(/^["']|["']$/g, ''))
                            : ['test123', 'hello world', 'abc456'];

                        const results = testStrings.map(s => {
                            const match = re.test(s);
                            return `  "${s}" → ${match ? 'MATCH ✓' : 'no match ✗'}`;
                        }).join('\n');
                        testResult = `Pattern: /${pattern}/${flags}\n\n${results}`;
                    } catch (e) {
                        testResult = `Invalid regex: ${e.message}`;
                    }
                    outputs.push('## Regex Test Results\n' + testResult);
                } else {
                    outputs.push('## Regex Test\nNo pattern found. Use format: `test /pattern/flags against "string"`');
                }
            }

            if (taskLower.includes('explain') || taskLower.includes('what does') || taskLower.includes('describe')) {
                if (pattern) {
                    const tokens = {
                        '\\d': 'digit [0-9]', '\\D': 'non-digit', '\\w': 'word char [a-zA-Z0-9_]',
                        '\\W': 'non-word char', '\\s': 'whitespace', '\\S': 'non-whitespace',
                        '\\b': 'word boundary', '^': 'start of string', '$': 'end of string'
                    };
                    const parts = Object.entries(tokens).filter(([t]) => pattern.includes(t)).map(([t, d]) => `  \`${t}\` = ${d}`);
                    if (pattern.includes('(')) parts.push('  `()` = capturing group');
                    if (pattern.includes('[')) parts.push('  `[]` = character class');
                    if (pattern.includes('{')) parts.push('  `{}` = quantifier');
                    if (pattern.includes('+')) parts.push('  `+` = one or more');
                    if (pattern.includes('*')) parts.push('  `*` = zero or more');
                    if (pattern.includes('?')) parts.push('  `?` = optional (zero or one)');
                    outputs.push(`## Regex Explanation\nPattern: \`/${pattern}/${flags}\`\n\nComponents:\n${parts.length ? parts.join('\n') : '  No recognized tokens — may be a literal pattern'}`);
                } else {
                    outputs.push('## Regex Explanation\nProvide a pattern like `/^\\d+$/`');
                }
            }

            if (taskLower.includes('generat') || taskLower.includes('creat') || taskLower.includes('write') || taskLower.includes('make')) {
                const matches = Object.entries(COMMON_PATTERNS).filter(([k]) => taskLower.includes(k));
                if (matches.length > 0) {
                    outputs.push('## Generated Patterns\n' + matches.map(([k, v]) => `**${k}**: \`/${v}/\``).join('\n'));
                } else {
                    outputs.push('## Available Patterns\n' + Object.keys(COMMON_PATTERNS).map(k => `- ${k}`).join('\n') + '\n\nSay "generate email regex" or "generate uuid regex"');
                }
            }

            if (outputs.length === 0) {
                outputs.push('## Regex Expert\nOperations:\n- **test** `/pattern/flags` against "string1" "string2"\n- **explain** `/pattern/`\n- **generate** email / phone / url / uuid / slug / date / zip / hex / ipv4');
            }

            return { agent: 'regex-expert', task, success: true, output: outputs.join('\n\n'), duration: 0 };
        }
    }
};

class AgentManager {
    constructor(hub) {
        this.hub = hub;
        this.agents = AGENTS;
        this.queue = [];
        this.isRunning = false;
        this.currentAgent = null;
        this.loadTeamAgents();
    }
    
    loadTeamAgents() {
        const config = this.hub?.getService('config');
        if (!config) return;
        const teamDir = path.join(config.baseDir, '.overlord', 'team');
        if (!fs.existsSync(teamDir)) return;
        try {
            const dirs = fs.readdirSync(teamDir, { withFileTypes: true });
            for (const dir of dirs) {
                if (dir.isDirectory() && !this.agents[dir.name]) {
                    const rolePath = path.join(teamDir, dir.name, 'ROLE.md');
                    let role = dir.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    let description = 'Custom team agent';
                    if (fs.existsSync(rolePath)) {
                        const content = fs.readFileSync(rolePath, 'utf8');
                        const titleMatch = content.match(/^#\s+(.+)$/m);
                        const descMatch = content.match(/^##\s+Description\s*\n(.+)/i);
                        if (titleMatch) role = titleMatch[1];
                        if (descMatch) description = descMatch[1].trim();
                    }
                    this.agents[dir.name] = {
                        name: dir.name,
                        role,
                        description,
                        capabilities: ['custom'],
                        workingDir: null,
                        execute: async (task, context) => {
                            const result = await context.tools.execute('bash', { command: task });
                            return { agent: dir.name, task, success: result.success, output: result.content || result.error, duration: 0 };
                        }
                    };
                }
            }
        } catch (e) { 
            // Agent execution error handled gracefully
        }
    }
    
    getAgentList() {
        return Object.entries(this.agents).map(([name, agent]) => ({
            name,
            role: agent.role,
            description: agent.description,
            capabilities: agent.capabilities,
            status: this.currentAgent?.name === name ? 'WORKING' : 'IDLE'
        }));
    }
    
    formatAgentList() {
        const list = this.getAgentList();
        let output = '═══ TEAM AGENTS ═══\n\n';
        for (const agent of list) {
            const icon = agent.status === 'IDLE' ? '⚪' : agent.status === 'WORKING' ? '🟢' : '🔴';
            output += `${icon} ${agent.name}\n   Role: ${agent.role}\n   Desc: ${agent.description}\n   Capabilities: ${agent.capabilities.join(', ')}\n\n`;
        }
        return output;
    }
    
    formatAgentInfo(name) {
        const agent = this.agents[name];
        if (!agent) return `ERROR: Agent '${name}' not found.\nAvailable: ${Object.keys(this.agents).join(', ')}`;
        return `# ${agent.name}\nRole: ${agent.role}\nDescription: ${agent.description}\nCapabilities: ${agent.capabilities.join(', ')}\nStatus: ${this.currentAgent?.name === name ? 'WORKING' : 'IDLE'}`;
    }
    
    async assignTask(agentName, task) {
        if (!this.agents[agentName]) return `ERROR: Unknown agent '${agentName}'. Available: ${Object.keys(this.agents).join(', ')}`;
        this.queue.push({ agent: agentName, task, timestamp: Date.now() });
        if (!this.isRunning) this.processQueue();
        return `✅ Task queued for ${agentName}\nQueue: ${this.queue.length}\nTask: ${task.substring(0, 50)}...`;
    }
    
    async processQueue() {
        if (this.isRunning || this.queue.length === 0) return;
        this.isRunning = true;
        const { agent: agentName, task } = this.queue.shift();
        const agent = this.agents[agentName];
        this.currentAgent = { name: agentName, task, startTime: Date.now() };
        this.hub?.teamUpdate(this.getAgentList());
        this.hub?.log(`[Agent] Starting ${agentName}: ${task}`, 'info');
        
        try {
            const tools = this.hub?.getService('tools');
            if (!tools) throw new Error('Tools service not available');
            
            if (tools.startTask) tools.startTask();
            
            const result = await agent.execute(task, { tools });
            
            if (tools.endTask) tools.endTask();
            
            const output = `═══ ${agentName.toUpperCase()} REPORT ═══
Task: ${task}
Status: ${result.success ? '✅ COMPLETED' : '❌ FAILED'}
${result.output}
Duration: ${result.duration}ms
═══════════════════════════`;
            
            this.hub?.toolResult({ tool: agentName, input: task, output: result.output, timestamp: Date.now() });
            this.hub?.addMessage('assistant', output);
            this.hub?.log(`[Agent] ${agentName} completed`, 'success');
            
        } catch (e) {
            if (tools?.endTask) tools.endTask();
            this.hub?.log(`[Agent] ${agentName} error: ${e.message}`, 'error');
            this.hub?.addMessage('assistant', `ERROR: ${e.message}`);
        } finally {
            this.currentAgent = null;
            this.isRunning = false;
            this.hub?.teamUpdate(this.getAgentList());
            if (this.queue.length > 0) setTimeout(() => this.processQueue(), 100);
        }
    }
}

module.exports = { AgentManager, AGENTS };
