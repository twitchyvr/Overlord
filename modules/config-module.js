// ==================== CONFIG MODULE ====================
// Handles configuration and environment loading

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

let config = {};

// User-adjustable keys that are persisted to disk across restarts
const PERSISTENT_KEYS = [
    'model',
    'customInstructions', 'projectMemory',
    'autoQA', 'autoQALint', 'autoQATypes', 'autoQATests',
    'autoCompact', 'compactKeepRecent',
    'maxAICycles', 'maxQAAttempts', 'approvalTimeoutMs', 'requestTimeoutMs',
    'sessionNotesLines', 'timelineLines',
    'rateLimitTokens', 'rateLimitRefillRate', 'messageQueueSize',
    'chatMode', 'maxParallelAgents', 'autoCreateIssues',
    'referenceDocumentation', 'taskEnforcement',
    'noTruncate', 'alwaysSecurity', 'neverStripFeatures', 'strictCompletion',
    'autoModelSwitch', 'pmModel',
    'queueDrainMode', 'thinkingEnabled', 'planLength',
    'gitOpsEnabled', 'gitOpsTrigger', 'gitOpsCommitStyle', 'gitOpsPush', 'gitOpsMinChanges',
    '_aiSet'
];

function init(hub) {
    // Load .env from parent directory
    const baseDir = path.join(__dirname, '..');
    const envPath = path.join(baseDir, '.env');

    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
    }

    // Detect OS
    const os = require('os');
    const platform = os.platform(); // 'win32', 'darwin', 'linux'
    const isWindows = platform === 'win32';
    const isMac = platform === 'darwin';
    const isLinux = platform === 'linux';

    // Thinking levels: 1=minimal, 2=low, 3=normal, 4=high, 5=maximum
    const thinkingLevelMap = {
        '1': 512,
        '2': 1024,
        '3': 2048,
        '4': 4096,
        '5': 8192
    };
    const defaultThinkingLevel = process.env.THINKING_LEVEL || '3';
    const defaultThinkingBudget = thinkingLevelMap[defaultThinkingLevel] || 2048;

    // MiniMax model specifications
    const modelSpecs = {
        'MiniMax-M2.5-highspeed': {
            contextWindow: 204800,
            maxOutput: 66000,
            description: 'Coding model - fast inference'
        },
        'MiniMax-M2.5': {
            contextWindow: 204800,
            maxOutput: 66000,
            description: 'Text model - standard'
        }
    };

    // Get model spec or use defaults
    const modelName = process.env.ANTHROPIC_MODEL || process.env.MODEL || 'MiniMax-M2.5-highspeed';
    const modelSpec = modelSpecs[modelName] || { contextWindow: 204800, maxOutput: 66000 };

    config = {
        baseUrl: process.env.ANTHROPIC_BASE_URL || process.env.BASE_URL || 'https://api.minimax.io/anthropic',
        apiKey: (process.env.ANTHROPIC_AUTH_TOKEN || process.env.API_KEY || process.env.MINIMAX_API_KEY || '').trim(),
        imgApiKey: (process.env.MINIMAX_IMG_API_KEY || '').trim(), // Separate API key for image understanding
        model: modelName,
        modelSpec: modelSpec,
        maxTokens: parseInt(process.env.MAX_TOKENS || modelSpec.maxOutput.toString()),
        temperature: parseFloat(process.env.TEMPERATURE || '0.7'),
        thinkingLevel: parseInt(defaultThinkingLevel),
        thinkingBudget: defaultThinkingBudget,
        baseDir: baseDir,
        // Custom instructions (up to 4000 chars) - passed with every prompt
        customInstructions: process.env.CUSTOM_INSTRUCTIONS || '',
        // Project-specific memory
        projectMemory: process.env.PROJECT_MEMORY || '',
        // ── AutoQA: code-enforced quality gates after file writes ──────────
        // These run automatically in code — the AI cannot skip or misinterpret them.
        // Results are injected into the conversation history as hard requirements.
        autoQA: process.env.AUTO_QA !== 'false',           // Master toggle (default: ON)
        autoQALint: process.env.AUTO_QA_LINT !== 'false',  // Run lint check (default: ON)
        autoQATypes: process.env.AUTO_QA_TYPES !== 'false', // Run tsc --noEmit for .ts files (default: ON)
        autoQATests: process.env.AUTO_QA_TESTS === 'true', // Run tests after writes (default: OFF — slow)
        autoQAOnlyOnErrors: false, // If true, only inject message when errors found (default: false = always log)
        // ── Context Compaction: AI-powered context summarization ──────────
        autoCompact: process.env.AUTO_COMPACT !== 'false',         // Auto-compact when context fills (default: ON)
        compactKeepRecent: parseInt(process.env.COMPACT_KEEP_RECENT) || 20, // Keep last N messages intact
        // ── AI Behavior Limits (prevent runaway loops / token waste) ──────
        maxAICycles: parseInt(process.env.MAX_AI_CYCLES) || 250,          // Max recursive AI→tool→AI cycles per message
        maxQAAttempts: parseInt(process.env.MAX_QA_ATTEMPTS) || 3,       // Max AutoQA inject-and-fix retries per file
        approvalTimeoutMs: parseInt(process.env.APPROVAL_TIMEOUT_MS) || 300000,  // Approval wait timeout (ms)
        requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS) || 90000,     // API request timeout (ms)
        // ── Context injection limits ──────────────────────────────────────
        sessionNotesLines: parseInt(process.env.SESSION_NOTES_LINES) || 50,   // Lines of session-notes.md to inject
        timelineLines: parseInt(process.env.TIMELINE_LINES) || 20,             // Lines of TIMELINE.md to inject
        // ── Socket rate limiting ──────────────────────────────────────────
        rateLimitTokens: parseInt(process.env.RATE_LIMIT_TOKENS) || 20,        // Token bucket max capacity
        rateLimitRefillRate: parseFloat(process.env.RATE_LIMIT_REFILL) || 4,   // Tokens refilled per second
        messageQueueSize: parseInt(process.env.MESSAGE_QUEUE_SIZE) || 3,        // Max queued messages while processing
        // ── Chat mode ────────────────────────────────────────────────────────
        chatMode: process.env.CHAT_MODE || 'auto',                              // 'auto' | 'plan' | 'ask' | 'pm'
        queueDrainMode: 'consolidated',                                          // 'consolidated' | 'sequential'
        thinkingEnabled: false,                                                   // Enable extended thinking (MiniMax M2.5)
        planLength: 'regular',                                                    // 'short' | 'regular' | 'long' | 'unlimited'
        // ── Per-mode model switching ──────────────────────────────────────────
        autoModelSwitch: false,                                                  // Auto-switch model when entering PM mode (opt-in, affects billing)
        pmModel: process.env.PM_MODEL || 'MiniMax-Text-01',                     // Model to use in PM mode when autoModelSwitch is enabled
        // ── GitOps Auto-Commit: AI-quality commit messages, configurable triggers ─
        gitOpsEnabled: process.env.GITOPS_ENABLED !== 'false',                  // Master toggle (default: ON)
        gitOpsTrigger: process.env.GITOPS_TRIGGER || 'task',                    // 'every' | 'task' | 'milestone' | 'count' | 'manual'
        gitOpsCommitStyle: process.env.GITOPS_COMMIT_STYLE || 'comprehensive',  // 'comprehensive' | 'conventional' | 'brief'
        gitOpsPush: process.env.GITOPS_PUSH || 'always',                        // 'always' | 'never' | 'ask'
        gitOpsMinChanges: parseInt(process.env.GITOPS_MIN_CHANGES) || 3,        // Min changed files when trigger='count'
        // ── Response Quality: guardrails injected into every system prompt ──
        noTruncate: process.env.NO_TRUNCATE === 'true',                          // Never truncate output (default: OFF)
        alwaysSecurity: process.env.ALWAYS_SECURITY === 'true',                  // Always add security measures (default: OFF)
        neverStripFeatures: process.env.NEVER_STRIP_FEATURES === 'true',         // Never strip requested features (default: OFF)
        // ── Strict Completion Mode: prevent agents simplifying/skipping work ─
        strictCompletion: process.env.STRICT_COMPLETION !== 'false',             // Cannot remove tests, must create tasks (default: ON)
        // Cookbook reference path
        cookbookPath: path.join(baseDir, '..', 'docs', 'minimax-m2.5_official_docs', 'cookbook', 'COOKBOOK.md'),
        // Load cookbook content if exists
        cookbookContent: (() => {
            const cbPath = path.join(baseDir, '..', 'docs', 'minimax-m2.5_official_docs', 'cookbook', 'COOKBOOK.md');
            try {
                if (fs.existsSync(cbPath)) {
                    return fs.readFileSync(cbPath, 'utf8').substring(0, 8000); // First 8000 chars
                }
            } catch (e) { /* ignore */ }
            return '';
        })(),
        // OS Detection
        platform: platform,
        isWindows: isWindows,
        isMac: isMac,
        isLinux: isLinux,
        shell: isWindows ? 'cmd.exe' : (isMac ? '/bin/zsh' : '/bin/bash'),
        shellArgs: isWindows ? ['/c'] : ['-c'],
        setThinkingLevel: (level) => {
            if (level >= 1 && level <= 5) {
                config.thinkingLevel = level;
                config.thinkingBudget = thinkingLevelMap[level] || 2048;
                hub.log('Thinking level set to ' + level + ' (' + config.thinkingBudget + ' tokens)', 'info');
                return { level, budget: config.thinkingBudget };
            }
            return { error: 'Level must be 1-5' };
        }
    };

    // ── Settings persistence ──────────────────────────────────────────────────
    // Saved to .overlord/settings.json; loaded on startup to override .env defaults.
    const settingsPath = path.join(baseDir, '.overlord', 'settings.json');

    // Attach save() to the config object so any module can call config.save()
    config.save = function() {
        try {
            const persisted = {};
            PERSISTENT_KEYS.forEach(k => { if (config[k] !== undefined) persisted[k] = config[k]; });
            fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
            fs.writeFileSync(settingsPath, JSON.stringify(persisted, null, 2), 'utf8');
        } catch (e) {
            hub.log('⚠️ Could not save settings: ' + e.message, 'warn');
        }
    };

    // Load persisted settings and overlay on top of .env defaults
    try {
        if (fs.existsSync(settingsPath)) {
            const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            PERSISTENT_KEYS.forEach(k => {
                if (persisted[k] !== undefined) config[k] = persisted[k];
            });
            hub.log('✅ Loaded persisted settings from .overlord/settings.json', 'info');
        }
    } catch (e) {
        hub.log('⚠️ Could not load persisted settings: ' + e.message, 'warn');
    }

    // Log config status using hub.log (masked key)
    hub?.log('=== CONFIG ===', 'info');
    hub?.log('baseUrl: ' + config.baseUrl, 'info');
    hub?.log('apiKey: ' + (config.apiKey.length > 0 ? 'Loaded (' + config.apiKey.length + ' chars)' : 'EMPTY'), 'info');
    hub?.log('imgApiKey: ' + (config.imgApiKey.length > 0 ? 'Loaded (' + config.imgApiKey.length + ' chars)' : 'NOT SET'), 'info');
    hub?.log('model: ' + config.model, 'info');
    hub?.log('OS: ' + platform + (isWindows ? ' (Windows)' : isMac ? ' (macOS)' : ' (Linux)'), 'info');
    hub?.log('shell: ' + config.shell, 'info');
    hub?.log('=============', 'info');

    hub.registerService('config', config);

    hub.log('Config module loaded', 'success');
}

function getConfig() {
    return config;
}

module.exports = { init, getConfig };
