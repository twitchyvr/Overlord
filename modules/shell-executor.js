// ==================== SHELL EXECUTOR MODULE ====================
// Shell command execution with timeout handling

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

let HUB = null;
let CONFIG = null;

// Task mode tracking (agents can cd temporarily, restored after)
let TASK_MODE = false;
let TASK_START_DIR = null;

// Timeout settings
const DEFAULT_TIMEOUT = 60000;
const LONG_TIMEOUT = 180000;

// Get configured shell based on platform
function getShell() {
    return CONFIG?.shell || (os.platform() === 'win32' ? 'cmd.exe' : os.platform() === 'darwin' ? '/bin/zsh' : '/bin/bash');
}

// Get current working directory
function getCWD() {
    const conv = HUB?.getService('conversation');
    return conv?.getWorkingDirectory ? conv.getWorkingDirectory() : process.cwd();
}

// Resolve path relative to working directory
function resolvePath(p) {
    if (!p) return getCWD();
    if (path.isAbsolute(p)) return p;
    return path.resolve(getCWD(), p);
}

// Execute bash command
async function runBash(cmd) {
    return runShell('bash', ['-c', cmd], DEFAULT_TIMEOUT);
}

// Execute PowerShell command (Windows)
async function runPS(cmd) {
    return runShell('powershell', ['-Command', cmd], DEFAULT_TIMEOUT);
}

// Execute CMD command (Windows)
async function runCmd(cmd) {
    return runShell('cmd.exe', ['/c', cmd], DEFAULT_TIMEOUT);
}

// Check if command is long-running
function isLongRunning(cmd) {
    const longRunningPatterns = [
        /npm\s+install/i,
        /npm\s+i$/i,
        /yarn\s+install/i,
        /pnpm\s+install/i,
        /pip\s+install/i,
        /cargo\s+build/i,
        /make\s+build/i,
        /webpack/i,
        /vite\s+build/i,
        /next\s+build/i,
        /jest\s+--watch/i,
        /nodemon/i,
        /pm2\s+start/i,
        /docker\s+build/i,
        /docker\s+run/i
    ];
    return longRunningPatterns.some(pattern => pattern.test(cmd));
}

// Main shell execution function
async function runShell(cmd, args, timeout = DEFAULT_TIMEOUT) {
    const isWin = os.platform() === 'win32';
    const shell = getShell();
    const cwd = getCWD();
    
    // Check if this is a long-running command
    const effectiveTimeout = isLongRunning(cmd) ? LONG_TIMEOUT : timeout;
    
    // Handle cd command specially for working directory
    if (cmd.trim().startsWith('cd ') || cmd.trim().startsWith('cd\t')) {
        const newDir = cmd.replace(/^(cd\s+)(.*)/, '$2').trim().replace(/^["']|["']$/g, '');
        const resolvedDir = path.resolve(cwd, newDir);
        
        // Check if directory exists
        const fs = require('fs');
        if (!fs.existsSync(resolvedDir)) {
            return { success: false, output: '', error: `Directory does not exist: ${resolvedDir}`, code: 1 };
        }
        
        const conv = HUB.getService('conversation');
        if (conv && conv.setWorkingDirectory) {
            conv.setWorkingDirectory(resolvedDir);
        }
        
        return { success: true, output: `Changed directory to: ${resolvedDir}`, error: '', code: 0 };
    }

    return new Promise((resolve) => {
        const startTime = Date.now();
        
        // Use cmd.exe on Windows for better compatibility
        let proc;
        const shellCmd = isWin ? 'cmd.exe' : shell;
        const shellArgs = isWin ? ['/c', cmd] : args;
        
        // For PowerShell, use -Command
        if (!isWin && (shell === 'powershell' || shell === 'pwsh')) {
            proc = spawn('powershell', ['-Command', cmd], {
                cwd,
                env: { ...process.env },
                shell: false
            });
        } else {
            proc = spawn(shellCmd, shellArgs, {
                cwd,
                env: { ...process.env },
                shell: false
            });
        }
        
        let stdout = '';
        let stderr = '';
        
        proc.stdout.on('data', (data) => {
            const text = data.toString();
            stdout += text;
            // Stream output to hub
            HUB?.broadcastVolatile('tool_output', { type: 'stdout', data: text });
        });
        
        proc.stderr.on('data', (data) => {
            const text = data.toString();
            stderr += text;
            HUB?.broadcastVolatile('tool_output', { type: 'stderr', data: text });
        });
        
        const timer = setTimeout(() => {
            proc.kill('SIGTERM');
            HUB?.log(`[Shell] Command timed out after ${effectiveTimeout}ms: ${cmd.substring(0, 50)}...`, 'warn');
        }, effectiveTimeout);
        
        proc.on('close', (code) => {
            clearTimeout(timer);
            const duration = Date.now() - startTime;
            
            // Truncate if too long
            const maxChars = 32000;
            if (stdout.length > maxChars) {
                stdout = stdout.substring(0, maxChars) + `\n\n[Output truncated - was ${stdout.length} chars]`;
            }
            if (stderr.length > maxChars) {
                stderr = stderr.substring(0, maxChars) + `\n\n[Error output truncated - was ${stderr.length} chars]`;
            }
            
            resolve({
                success: code === 0,
                output: stdout,
                error: stderr,
                code,
                duration
            });
        });
        
        proc.on('error', (err) => {
            clearTimeout(timer);
            resolve({
                success: false,
                output: '',
                error: err.message,
                code: 1
            });
        });
    });
}

// Set task mode (for agent cd handling)
function setTaskMode(enabled, startDir = null) {
    if (enabled) {
        TASK_MODE = true;
        TASK_START_DIR = startDir || getCWD();
    } else {
        TASK_MODE = false;
        // Restore working directory
        if (TASK_START_DIR) {
            const conv = HUB?.getService('conversation');
            if (conv?.setWorkingDirectory) {
                conv.setWorkingDirectory(TASK_START_DIR);
            }
        }
    }
}

// Initialize module
function init(hub) {
    HUB = hub;
    CONFIG = hub.getService('config');
}

module.exports = {
    init,
    runBash,
    runPS,
    runCmd,
    runShell,
    getShell,
    getCWD,
    resolvePath,
    isLongRunning,
    setTaskMode
};
