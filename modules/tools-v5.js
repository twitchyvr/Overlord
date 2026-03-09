// ==================== OVERLORD TOOLS v5 (BACKWARD COMPATIBILITY) ====================
// This file re-exports all tool modules for backward compatibility.
// New code should import directly from specific modules:
//
// - tools-registry.js: Tool definitions, execution routing
// - shell-executor.js: Shell command execution
// - file-operations.js: File read/write/patch operations
// - web-fetch.js: Web search, page fetching, image analysis
// - system-tools.js: System info, config, UI actions, KV store
// - qa-tools.js: Tests, linting, type checking, coverage
// - github-tools.js: GitHub operations via gh CLI

// Import all modules
const toolsRegistry = require('./tools-registry');
const shellExecutor = require('./shell-executor');
const fileOperations = require('./file-operations');
const webFetch = require('./web-fetch');
const systemTools = require('./system-tools');
const qaTools = require('./qa-tools');
const githubTools = require('./github-tools');

// Re-export everything for backward compatibility
module.exports = {
    // Main init
    init: toolsRegistry.init,
    
    // Tool execution
    execute: toolsRegistry.execute,
    getInitialContext: toolsRegistry.getInitialContext,
    
    // Tool definitions
    TOOL_DEFS: toolsRegistry.TOOL_DEFS,
    TOOL_ALIASES: toolsRegistry.TOOL_ALIASES,
    
    // Shell executor
    runBash: shellExecutor.runBash,
    runPS: shellExecutor.runPS,
    runCmd: shellExecutor.runCmd,
    runShell: shellExecutor.runShell,
    getShell: shellExecutor.getShell,
    getCWD: shellExecutor.getCWD,
    resolvePath: shellExecutor.resolvePath,
    isLongRunning: shellExecutor.isLongRunning,
    
    // File operations
    readFile: fileOperations.readFile,
    readFileLines: fileOperations.readFileLines,
    writeFile: fileOperations.writeFile,
    patchFile: fileOperations.patchFile,
    appendFile: fileOperations.appendFile,
    listDir: fileOperations.listDir,
    sanitizeFilename: fileOperations.sanitizeFilename,
    sanitizeFileContent: fileOperations.sanitizeFileContent,
    getOverlordDir: fileOperations.getOverlordDir,
    writeSessionNote: fileOperations.writeSessionNote,
    appendTimeline: fileOperations.appendTimeline,
    
    // Web fetch
    fetchWebpage: webFetch.fetchWebpage,
    fetchViaJina: webFetch.fetchViaJina,
    saveWebpageToVault: webFetch.saveWebpageToVault,
    webSearch: webFetch.webSearch,
    understandImage: webFetch.understandImage,
    stripTags: webFetch.stripTags,
    decodeEntities: webFetch.decodeEntities,
    inlineToMarkdown: webFetch.inlineToMarkdown,
    extractTextFromHtml: webFetch.extractTextFromHtml,
    
    // System tools
    systemInfo: systemTools.systemInfo,
    getWorkingDir: systemTools.getWorkingDir,
    setWorkingDir: systemTools.setWorkingDir,
    setThinkingLevel: systemTools.setThinkingLevel,
    uiAction: systemTools.uiAction,
    showChart: systemTools.showChart,
    askUser: systemTools.askUser,
    kvSet: systemTools.kvSet,
    kvGet: systemTools.kvGet,
    kvList: systemTools.kvList,
    kvDelete: systemTools.kvDelete,
    socketPush: systemTools.socketPush,
    
    // QA tools
    runTests: qaTools.runTests,
    checkLint: qaTools.checkLint,
    checkTypes: qaTools.checkTypes,
    checkCoverage: qaTools.checkCoverage,
    auditDeps: qaTools.auditDeps,
    
    // GitHub tools
    handleGithub: githubTools.handleGithub,
    runGh: githubTools.runGh
};
