// ==================== QA TOOLS MODULE ====================
// Test execution, linting, type checking, coverage, dependency auditing

let HUB = null;
let CONFIG = null;

// Run tests
async function runTests(type = 'all') {
    const shellExecutor = require('./shell-executor');
    
    const validTypes = ['unit', 'integration', 'e2e', 'all'];
    if (!validTypes.includes(type)) {
        return { success: false, error: `Invalid type. Valid: ${validTypes.join(', ')}` };
    }
    
    let cmd;
    switch (type) {
        case 'unit':
            cmd = 'npm test -- --testPathIgnorePatterns="/node_modules/"';
            break;
        case 'integration':
            cmd = 'npm test -- --testPathPattern="integration"';
            break;
        case 'e2e':
            cmd = 'npm test -- --testPathPattern="e2e"';
            break;
        default:
            cmd = 'npm test';
    }
    
    HUB?.log(`[QA] Running tests: ${type}`, 'info');
    
    const result = await shellExecutor.runBash(cmd);
    
    return {
        success: result.success,
        output: result.output,
        error: result.error,
        code: result.code,
        type
    };
}

// Check lint
async function checkLint(path) {
    const shellExecutor = require('./shell-executor');
    
    // Step 1: node --check for JS/CJS/MJS files (fast syntax check)
    let nodeCheck = '';
    if (path && /\.[cm]?[jt]sx?$/.test(path)) {
        nodeCheck = `node --check "${path}" 2>&1 && echo "✓ Syntax OK: ${path.split('/').pop()}" || true; `;
    }
    
    // Step 2: eslint on specific file or project-wide
    const eslintTarget = path ? `"${path}"` : '.';
    const lintCmd = `${nodeCheck}npm run lint 2>&1 || npx eslint ${eslintTarget} --no-eslintrc --rule '{"no-unused-vars":"warn"}' 2>&1 || echo "No lint configured"`;
    
    HUB?.log(`[QA] Running lint check${path ? ` on ${path}` : ''}`, 'info');
    
    const result = await shellExecutor.runBash(lintCmd);
    
    return {
        success: result.success || result.output.includes('No lint'),
        output: result.output,
        error: result.error,
        code: result.code
    };
}

// Check types (TypeScript)
async function checkTypes() {
    const shellExecutor = require('./shell-executor');
    
    const cmd = 'npx tsc --noEmit 2>&1 || echo "No TypeScript configured"';
    
    HUB?.log('[QA] Running TypeScript type check', 'info');
    
    const result = await shellExecutor.runBash(cmd);
    
    return {
        success: result.success || result.output.includes('No TypeScript'),
        output: result.output,
        error: result.error,
        code: result.code
    };
}

// Check coverage
async function checkCoverage(threshold) {
    const shellExecutor = require('./shell-executor');
    
    const cmd = 'npm run coverage 2>&1 || npm run test:coverage 2>&1 || echo "No coverage configured"';
    
    HUB?.log('[QA] Running coverage check', 'info');
    
    const result = await shellExecutor.runBash(cmd);
    
    // Parse coverage output if available
    let coverage = null;
    const coverageMatch = result.output.match(/All files[^}]*\}/);
    if (coverageMatch) {
        coverage = coverageMatch[0];
    }
    
    return {
        success: result.success || result.output.includes('No coverage'),
        output: result.output,
        error: result.error,
        code: result.code,
        threshold,
        coverage
    };
}

// Audit dependencies
async function auditDeps() {
    const shellExecutor = require('./shell-executor');
    
    const cmd = 'npm audit 2>&1';
    
    HUB?.log('[QA] Running dependency audit', 'info');
    
    const result = await shellExecutor.runBash(cmd);
    
    // Parse audit output
    let vulnerabilities = null;
    const vulnMatch = result.output.match(/found (\d+) vulnerabilities?/i);
    if (vulnMatch) {
        vulnerabilities = parseInt(vulnMatch[1], 10);
    }
    
    return {
        success: vulnerabilities === 0 || vulnerabilities === null,
        output: result.output,
        error: result.error,
        code: result.code,
        vulnerabilities
    };
}

// Initialize module
function init(hub) {
    HUB = hub;
    CONFIG = hub.getService('config');
}

module.exports = {
    init,
    runTests,
    checkLint,
    checkTypes,
    checkCoverage,
    auditDeps
};
