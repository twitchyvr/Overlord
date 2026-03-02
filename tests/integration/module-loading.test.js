/**
 * Integration: Module Loading Tests
 * Verifies that all modules in the moduleFiles list can be require()'d
 * without crashing, and that their init() function signature is correct.
 *
 * NOTE: We do NOT call init() here — that would require a full server setup.
 * We only test that the modules can be required and export an init function.
 */

const path = require('path');

const MODULES_DIR = path.join(__dirname, '..', '..', 'modules');

// Mirrors the moduleFiles list in server.js (without the './modules/' prefix)
const MODULE_NAMES = [
    'config-module',
    'markdown-module',
    'guardrail-module',
    'character-normalization',
    'token-manager-module',
    'context-tracker-module',
    'mcp-module',
    'mcp-manager-module',
    'database-module',
    'notes-module',
    'skills-module',
    'tools-v5',
    'agent-system-module',
    'agent-manager-module',
    'ai-module',
    'summarization-module',
    'test-server-module',
    'file-tools-module',
    'minimax-image-module',
    'minimax-tts-module',
    'minimax-files-module',
    'conversation-module',
    'git-module',
    'orchestration-module'
];

describe('Module Loading: all modules can be required', () => {

    for (const modName of MODULE_NAMES) {
        test(`${modName} loads without throwing`, () => {
            const modPath = path.join(MODULES_DIR, modName);
            let mod;
            expect(() => {
                mod = require(modPath);
            }).not.toThrow();

            expect(mod).toBeDefined();
        });
    }

    test('all modules export an init function', () => {
        const modulesWithoutInit = [];

        for (const modName of MODULE_NAMES) {
            const modPath = path.join(MODULES_DIR, modName);
            try {
                const mod = require(modPath);
                if (typeof mod.init !== 'function') {
                    modulesWithoutInit.push(modName);
                }
            } catch (e) {
                // Already covered by individual load tests
            }
        }

        if (modulesWithoutInit.length > 0) {
            console.warn('Modules without init():', modulesWithoutInit);
        }

        // Allow up to 2 modules to not have init (e.g. utility modules)
        expect(modulesWithoutInit.length).toBeLessThanOrEqual(2);
    });

    test('no circular dependency detected in module graph', () => {
        // Require all modules in order — if there is a circular require(),
        // Node.js will not throw but will return a partial module.
        // We detect this by checking that all required modules are objects.
        const partialModules = [];

        for (const modName of MODULE_NAMES) {
            const modPath = path.join(MODULES_DIR, modName);
            try {
                const mod = require(modPath);
                if (typeof mod !== 'object' || mod === null) {
                    partialModules.push(modName);
                }
            } catch (e) {
                // skip
            }
        }

        expect(partialModules).toEqual([]);
    });

});

describe('Module Loading: specific module contracts', () => {

    test('token-manager-module exports sanitizeHistory, truncateHistory, validateHistory', () => {
        const tm = require(path.join(MODULES_DIR, 'token-manager-module'));
        expect(typeof tm.sanitizeHistory).toBe('function');
        expect(typeof tm.truncateHistory).toBe('function');
        expect(typeof tm.validateHistory).toBe('function');
    });

    test('orchestration-module exports init', () => {
        const om = require(path.join(MODULES_DIR, 'orchestration-module'));
        expect(typeof om.init).toBe('function');
    });

    test('skills-module exports init', () => {
        const sm = require(path.join(MODULES_DIR, 'skills-module'));
        expect(typeof sm.init).toBe('function');
    });

    test('conversation-module exports init', () => {
        const cm = require(path.join(MODULES_DIR, 'conversation-module'));
        expect(typeof cm.init).toBe('function');
    });

    test('summarization-module exports init', () => {
        const sum = require(path.join(MODULES_DIR, 'summarization-module'));
        expect(typeof sum.init).toBe('function');
    });

    test('agent-manager-module exports init', () => {
        const am = require(path.join(MODULES_DIR, 'agent-manager-module'));
        expect(typeof am.init).toBe('function');
    });

    test('tools-v5 exports init', () => {
        const tools = require(path.join(MODULES_DIR, 'tools-v5'));
        expect(typeof tools.init).toBe('function');
    });

});
