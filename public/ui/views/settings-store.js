/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Settings Store
   ═══════════════════════════════════════════════════════════════════
   Persistence logic: load/save settings to backend, debouncing.

   Dependencies: engine.js (OverlordUI)
   ═══════════════════════════════════════════════════════════════════ */

import { OverlordUI } from '../engine.js';

// Default configuration values
export const DEFAULT_CONFIG = {
    model: 'MiniMax-M2.5-highspeed',
    maxAICycles: 250,
    customInstructions: '',
    projectMemory: '',
    obsidianVaultPath: '',
    sessionNotesLines: 50,
    timelineLines: 20,
    rateLimitTokens: 20,
    rateLimitRefillRate: 4,
    messageQueueSize: 3,
    maxParallelAgents: 3,
    thinkingBudget: 2048,
    ttsVoice: 'English_expressive_narrator',
    ttsSpeed: 1.0,
    ttsEnabled: false,
    ttsMode: 'read-aloud',
    autoCreateIssues: false,
    taskEnforcement: false,
    strictCompletion: false,
    thinkingEnabled: false,
    queueDrainMode: 'consolidated',
    planLength: 'regular',
    referenceDocumentation: '',
    gitOpsEnabled: false,
    gitOpsTrigger: 'task',
    gitOpsMinChanges: 3,
    gitOpsCommitStyle: 'comprehensive',
    gitOpsPush: 'ask',
    unlimitedCycles: false,
    longRunning: false
};

// Debounce helper
function debounce(fn, delay) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

/**
 * SettingsStore - handles loading, saving, and syncing settings
 */
export class SettingsStore {
    constructor(socket, options = {}) {
        this._socket = socket;
        this._config = { ...DEFAULT_CONFIG };
        this._listeners = new Set();
        this._debouncedEmit = debounce(this._emitUpdate.bind(this), options.debounceMs || 300);
        this._isDirty = false;
    }

    /**
     * Initialize the store and subscribe to config events
     */
    init() {
        // Subscribe to engine events
        this._subs = [
            OverlordUI.subscribe('config_data', (data) => this._applyConfig(data)),
            OverlordUI.subscribe('config_updated', (data) => this._applyConfig(data)),
            OverlordUI.subscribe('config_updated_by_ai', (data) => this._onAiSetConfig(data))
        ];

        // Load initial config
        this.load();
    }

    /**
     * Cleanup subscriptions
     */
    destroy() {
        this._subs?.forEach(unsub => unsub());
        this._subs = [];
        this._listeners.clear();
    }

    /**
     * Load configuration from server
     */
    load() {
        if (this._socket) {
            this._socket.emit('get_config', (data) => {
                if (data) {
                    this._applyConfig(data);
                }
            });
        }
    }

    /**
     * Get current config value
     */
    get(key) {
        if (key) {
            return this._config[key];
        }
        return { ...this._config };
    }

    /**
     * Set config value (persists to server)
     */
    set(key, value) {
        this._config[key] = value;
        this._isDirty = true;
        this._debouncedEmit({ [key]: value });
        this._notifyListeners();
    }

    /**
     * Set multiple config values at once
     */
    setMany(updates) {
        Object.assign(this._config, updates);
        this._isDirty = true;
        this._debouncedEmit(updates);
        this._notifyListeners();
    }

    /**
     * Apply config from server response
     */
    _applyConfig(data) {
        if (!data) return;
        const changed = {};
        for (const [key, value] of Object.entries(data)) {
            if (this._config[key] !== value) {
                this._config[key] = value;
                changed[key] = value;
            }
        }
        if (Object.keys(changed).length > 0) {
            this._notifyListeners();
        }
    }

    /**
     * Emit update to server
     */
    _emitUpdate(patch) {
        if (this._socket) {
            this._socket.emit('update_config', patch);
        }
    }

    /**
     * Handle AI-set config
     */
    _onAiSetConfig(data) {
        if (!data || !data.key) return;
        this._config[data.key] = data.value;
        
        // Track AI-set keys
        const aiSetKeys = new Set(
            JSON.parse(localStorage.getItem('overlord_ai_set_keys') || '[]')
        );
        aiSetKeys.add(data.key);
        localStorage.setItem('overlord_ai_set_keys', JSON.stringify([...aiSetKeys]));
        
        this._notifyListeners();
    }

    /**
     * Add listener for config changes
     */
    addListener(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    /**
     * Notify all listeners of config change
     */
    _notifyListeners() {
        this._listeners.forEach(fn => fn(this._config));
    }

    /**
     * Get AI-set keys
     */
    getAiSetKeys() {
        return new Set(
            JSON.parse(localStorage.getItem('overlord_ai_set_keys') || '[]')
        );
    }

    /**
     * Mark a key as AI-set
     */
    markAiSet(key) {
        const aiSetKeys = this.getAiSetKeys();
        aiSetKeys.add(key);
        localStorage.setItem('overlord_ai_set_keys', JSON.stringify([...aiSetKeys]));
    }

    /**
     * Check if settings are dirty (have unsaved changes)
     */
    isDirty() {
        return this._isDirty;
    }

    /**
     * Reset to defaults
     */
    reset() {
        this._config = { ...DEFAULT_CONFIG };
        this._emitUpdate(DEFAULT_CONFIG);
    }
}

/**
 * Create a settings store instance
 */
export function createSettingsStore(socket, options) {
    return new SettingsStore(socket, options);
}

// Export constants
export { MODEL_OPTIONS, TTS_VOICES } from './settings-panels/ai.js';
