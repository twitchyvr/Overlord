// ==================== TEST SERVER MODULE ====================
// Allows spawning a second sandboxed server instance for testing
// Can run on a different port to avoid conflicts with main server
//
// Usage:
// - Start test server on different port
// - Run tests against test server
// - Switch between test/production
// - Docker integration for containerized testing

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let HUB = null;
let CONFIG = null;

// Test server configuration
const TEST_CONFIG = {
    port: 3002,              // Default test port
    testDir: null,           // Working directory for tests
    serverProcess: null,     // Child process
    isRunning: false,
    logs: []                 // Accumulated logs
};

// Docker configuration (if available)
const DOCKER_CONFIG = {
    enabled: false,
    containerName: 'overlord-test',
    image: 'overlord-web:test',
    port: 3003
};

// ==================== INITIALIZATION ====================

function init(hub) {
    HUB = hub;
    CONFIG = hub.getService('config') || {};
    
    TEST_CONFIG.testDir = path.join(CONFIG.baseDir || process.cwd(), '..', 'overlord-test');
    
    // Check if Docker is available
    checkDockerAvailability();
    
    HUB.registerService('testServer', {
        // Server control
        start: startTestServer,
        stop: stopTestServer,
        status: getStatus,
        getLogs: getLogs,
        
        // Configuration
        setPort: setPort,
        getPort: () => TEST_CONFIG.port,
        
        // Docker
        dockerStart: dockerStart,
        dockerStop: dockerStop,
        dockerStatus: dockerStatus,
        
        // Utilities
        testEndpoint: testEndpoint,
        compareResponses: compareResponses,
        
        // Config
        CONFIG: TEST_CONFIG,
        DOCKER_CONFIG
    });
    
    HUB.log('🧪 Test Server module loaded', 'success');
}

// ==================== DOCKER CHECK ====================

function checkDockerAvailability() {
    try {
        const { execSync } = require('child_process');
        execSync('docker --version', { stdio: 'ignore' });
        DOCKER_CONFIG.enabled = true;
        HUB?.log('🐳 Docker available for test containers', 'info');
    } catch (e) {
        DOCKER_CONFIG.enabled = false;
        HUB?.log('⚠️ Docker not available', 'warn');
    }
}

// ==================== NATIVE TEST SERVER ====================

function startTestServer(options = {}) {
    return new Promise((resolve, reject) => {
        if (TEST_CONFIG.isRunning) {
            resolve({ 
                success: false, 
                error: 'Test server already running on port ' + TEST_CONFIG.port 
            });
            return;
        }
        
        const port = options.port || TEST_CONFIG.port;
        const workDir = options.workingDir || TEST_CONFIG.testDir;
        
        HUB?.log(`🧪 Starting test server on port ${port}...`, 'info');
        
        // Ensure test directory exists
        if (!fs.existsSync(workDir)) {
            fs.mkdirSync(workDir, { recursive: true });
        }
        
        // Copy necessary files to test directory
        const sourceDir = CONFIG.baseDir || process.cwd();
        copyTestFiles(sourceDir, workDir);
        
        // Start server process with test port
        const serverPath = path.join(sourceDir, 'server.js');
        
        const env = {
            ...process.env,
            PORT: port,
            NODE_ENV: 'test',
            TESTING: 'true'
        };
        
        TEST_CONFIG.serverProcess = spawn('node', [serverPath], {
            cwd: workDir,
            env: env,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        let started = false;
        let startupError = '';
        
        TEST_CONFIG.serverProcess.stdout.on('data', (data) => {
            const output = data.toString();
            TEST_CONFIG.logs.push({ type: 'stdout', data: output, time: Date.now() });
            
            if (output.includes('Server running') || output.includes('http://localhost:' + port)) {
                if (!started) {
                    started = true;
                    TEST_CONFIG.isRunning = true;
                    TEST_CONFIG.port = port;
                    HUB?.log(`🧪 Test server started on port ${port}`, 'success');
                    resolve({ success: true, port, pid: TEST_CONFIG.serverProcess.pid });
                }
            }
        });
        
        TEST_CONFIG.serverProcess.stderr.on('data', (data) => {
            const output = data.toString();
            TEST_CONFIG.logs.push({ type: 'stderr', data: output, time: Date.now() });
            startupError += output;
        });
        
        TEST_CONFIG.serverProcess.on('error', (err) => {
            TEST_CONFIG.logs.push({ type: 'error', data: err.message, time: Date.now() });
            HUB?.log(`🧪 Test server error: ${err.message}`, 'error');
            reject({ success: false, error: err.message });
        });
        
        TEST_CONFIG.serverProcess.on('exit', (code) => {
            TEST_CONFIG.isRunning = false;
            TEST_CONFIG.logs.push({ type: 'exit', data: 'Exit code: ' + code, time: Date.now() });
            HUB?.log(`🧪 Test server exited with code ${code}`, 'info');
        });
        
        // Timeout after 10 seconds
        setTimeout(() => {
            if (!started) {
                TEST_CONFIG.serverProcess.kill();
                reject({ success: false, error: 'Startup timeout', logs: TEST_CONFIG.logs });
            }
        }, 10000);
    });
}

function stopTestServer() {
    return new Promise((resolve) => {
        if (!TEST_CONFIG.isRunning || !TEST_CONFIG.serverProcess) {
            resolve({ success: true, message: 'No test server running' });
            return;
        }
        
        TEST_CONFIG.serverProcess.kill('SIGTERM');
        
        setTimeout(() => {
            if (TEST_CONFIG.serverProcess) {
                TEST_CONFIG.serverProcess.kill('SIGKILL');
            }
            TEST_CONFIG.isRunning = false;
            HUB?.log('🧪 Test server stopped', 'info');
            resolve({ success: true });
        }, 2000);
    });
}

function getStatus() {
    return {
        running: TEST_CONFIG.isRunning,
        port: TEST_CONFIG.port,
        pid: TEST_CONFIG.serverProcess?.pid || null,
        uptime: TEST_CONFIG.serverProcess ? Date.now() - TEST_CONFIG.startTime : 0,
        dockerAvailable: DOCKER_CONFIG.enabled,
        dockerRunning: false // Can check if needed
    };
}

function getLogs(limit = 100) {
    const logs = TEST_CONFIG.logs.slice(-limit);
    return {
        success: true,
        logs: logs,
        count: logs.length
    };
}

function setPort(port) {
    TEST_CONFIG.port = port;
    return { success: true, port };
}

// ==================== DOCKER OPERATIONS ====================

function dockerStart(options = {}) {
    return new Promise((resolve, reject) => {
        if (!DOCKER_CONFIG.enabled) {
            resolve({ success: false, error: 'Docker not available' });
            return;
        }
        
        const { execSync } = require('child_process');
        const port = options.port || DOCKER_CONFIG.port;
        const name = options.name || DOCKER_CONFIG.containerName;
        
        try {
            // Stop existing container if any
            try {
                execSync(`docker stop ${name}`, { stdio: 'ignore' });
                execSync(`docker rm ${name}`, { stdio: 'ignore' });
            } catch (e) { /* ignore */ }
            
            // Build command
            const cmd = `docker run -d --name ${name} -p ${port}:3031 overlord-web:test`;
            
            execSync(cmd, { stdio: 'inherit' });
            
            HUB?.log(`🐳 Docker container ${name} started on port ${port}`, 'success');
            resolve({ success: true, port, name });
            
        } catch (e) {
            HUB?.log(`🐳 Docker start failed: ${e.message}`, 'error');
            resolve({ success: false, error: e.message });
        }
    });
}

function dockerStop() {
    return new Promise((resolve) => {
        if (!DOCKER_CONFIG.enabled) {
            resolve({ success: false, error: 'Docker not available' });
            return;
        }
        
        const { execSync } = require('child_process');
        const name = DOCKER_CONFIG.containerName;
        
        try {
            execSync(`docker stop ${name}`, { stdio: 'ignore' });
            execSync(`docker rm ${name}`, { stdio: 'ignore' });
            HUB?.log(`🐳 Docker container ${name} stopped`, 'info');
            resolve({ success: true });
        } catch (e) {
            resolve({ success: false, error: e.message });
        }
    });
}

function dockerStatus() {
    if (!DOCKER_CONFIG.enabled) {
        return { available: false };
    }
    
    const { execSync } = require('child_process');
    
    try {
        const output = execSync(`docker ps --filter "name=${DOCKER_CONFIG.containerName}" --format "{{.Status}}"`, { encoding: 'utf8' });
        return {
            available: true,
            running: output.trim().length > 0,
            status: output.trim()
        };
    } catch (e) {
        return { available: true, running: false };
    }
}

// ==================== TEST UTILITIES ====================

function testEndpoint(endpoint, method = 'GET', data = null) {
    return new Promise((resolve) => {
        const http = require('http');
        const port = TEST_CONFIG.port;
        
        const options = {
            hostname: 'localhost',
            port: port,
            path: endpoint,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };
        
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                resolve({
                    success: true,
                    status: res.statusCode,
                    headers: res.headers,
                    body: body
                });
            });
        });
        
        req.on('error', (e) => {
            resolve({
                success: false,
                error: e.message
            });
        });
        
        if (data) {
            req.write(JSON.stringify(data));
        }
        
        req.end();
    });
}

function compareResponses(response1, response2) {
    const differences = [];
    
    // Compare status codes
    if (response1.status !== response2.status) {
        differences.push(`Status: ${response1.status} vs ${response2.status}`);
    }
    
    // Compare bodies
    try {
        const json1 = JSON.parse(response1.body);
        const json2 = JSON.parse(response2.body);
        
        if (JSON.stringify(json1) !== JSON.stringify(json2)) {
            differences.push('Body content differs');
        }
    } catch (e) {
        if (response1.body !== response2.body) {
            differences.push('Body differs (non-JSON)');
        }
    }
    
    return {
        match: differences.length === 0,
        differences
    };
}

// ==================== FILE HELPERS ====================

function copyTestFiles(sourceDir, testDir) {
    // Only copy essential files, not node_modules
    const toCopy = ['server.js', 'package.json', 'hub.js', 'modules'];
    
    for (const item of toCopy) {
        const src = path.join(sourceDir, item);
        const dest = path.join(testDir, item);
        
        if (fs.existsSync(src)) {
            if (fs.statSync(src).isDirectory()) {
                // For directories, create symlink to save space
                try {
                    if (fs.existsSync(dest)) {
                        fs.rmSync(dest, { recursive: true });
                    }
                    fs.symlinkSync(src, dest, 'junction');
                } catch (e) {
                    // Fallback: copy directory
                    copyDir(src, dest);
                }
            } else {
                fs.copyFileSync(src, dest);
            }
        }
    }
    
    // Create test-specific .env
    const envPath = path.join(testDir, '.env');
    if (!fs.existsSync(envPath)) {
        const testEnv = `
PORT=${TEST_CONFIG.port}
NODE_ENV=test
TESTING=true
`.trim();
        fs.writeFileSync(envPath, testEnv);
    }
}

function copyDir(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// ==================== EXPORTS ====================

module.exports = { init };
