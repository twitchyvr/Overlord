/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Settings View
   ═══════════════════════════════════════════════════════════════════
   Modal-based settings manager. Organises configuration across four
   tabs: General, AI, Tools/MCP, and Display.

   Manages: model selection, max AI cycles, custom instructions,
   project memory, theme switching, notification prefs, MCP server
   list (enable/disable/add), long-running mode, TTS voice selector,
   and AI-set config badges.

   Dependencies: engine.js, modal.js, tabs.js, button.js
   ═══════════════════════════════════════════════════════════════════ */

import { Component, OverlordUI, h } from '../engine.js';
import { Modal } from '../components/modal.js';
import { Tabs } from '../components/tabs.js';
import { Button } from '../components/button.js';

const MODAL_ID = 'settings-modal';

const MODEL_OPTIONS = [
    { value: 'MiniMax-M2.5-highspeed', label: 'MiniMax-M2.5-highspeed — Coding (fast)' },
    { value: 'MiniMax-M2.5',           label: 'MiniMax-M2.5 — Reasoning (standard)' },
    { value: 'MiniMax-Text-01',        label: 'MiniMax-Text-01 — Text / PM' }
];

const TTS_VOICES = [
    // Official MiniMax English System Voices
    { value: 'English_expressive_narrator',    label: 'Expressive Narrator' },
    { value: 'English_radiant_girl',           label: 'Radiant Girl' },
    { value: 'English_magnetic_voiced_man',    label: 'Magnetic-voiced Man' },
    { value: 'English_Upbeat_Woman',           label: 'Upbeat Woman' },
    { value: 'English_Trustworth_Man',         label: 'Trustworthy Man' },
    { value: 'English_CalmWoman',              label: 'Calm Woman' },
    { value: 'English_Gentle-voiced_man',      label: 'Gentle-voiced Man' },
    { value: 'English_Diligent_Man',           label: 'Diligent Man' },
    { value: 'English_Graceful_Lady',          label: 'Graceful Lady' },
    { value: 'English_PlayfulGirl',            label: 'Playful Girl' },
    { value: 'English_ManWithDeepVoice',       label: 'Man With Deep Voice' },
    { value: 'English_FriendlyPerson',         label: 'Friendly Guy' },
    { value: 'English_CaptivatingStoryteller', label: 'Captivating Storyteller' },
    { value: 'English_WiseScholar',            label: 'Wise Scholar' },
    { value: 'English_ConfidentWoman',         label: 'Confident Woman' },
    { value: 'English_PatientMan',             label: 'Patient Man' },
    { value: 'English_Comedian',               label: 'Comedian' },
    // Legacy voices (still supported)
    { value: 'smart_adam',                     label: 'Adam (legacy)' },
    { value: 'smart_bella',                    label: 'Bella (legacy)' }
];

export class SettingsView extends Component {

    constructor(el, opts = {}) {
        super(el, opts);
        this._socket     = opts.socket || null;
        this._config     = {};
        this._mcpServers = [];
        this._aiSetKeys  = new Set(
            JSON.parse(localStorage.getItem('overlord_ai_set_keys') || '[]')
        );
        this._tabs       = null;
        this._tabPanels  = {};
    }

    // ══════════════════════════════════════════════════════════════
    //  LIFECYCLE
    // ══════════════════════════════════════════════════════════════

    mount() {
        this._mounted = true;

        // Subscribe to engine events
        this._subs.push(
            OverlordUI.subscribe('config_data', (d) => this._applyConfig(d))
        );
        this._subs.push(
            OverlordUI.subscribe('config_updated', (d) => this._applyConfig(d))
        );
        this._subs.push(
            OverlordUI.subscribe('config_updated_by_ai', (d) => this._onAiSetConfig(d))
        );
        this._subs.push(
            OverlordUI.subscribe('mcp_servers_updated', (d) => {
                this._mcpServers = d.servers || [];
                this._renderMcpServers(this._mcpServers);
            })
        );
        this._subs.push(
            OverlordUI.subscribe('mcp_server_result', (d) => this._onMcpResult(d))
        );
    }

    // ══════════════════════════════════════════════════════════════
    //  OPEN / CLOSE
    // ══════════════════════════════════════════════════════════════

    open() {
        if (Modal.isOpen(MODAL_ID)) return;

        const content = this._buildContent();

        Modal.open(MODAL_ID, {
            title: 'Settings',
            content,
            size: 'lg',
            className: 'settings-view-modal',
            onOpen: () => {
                // Request fresh config + MCP list
                if (this._socket) {
                    this._socket.emit('get_config');
                    this._socket.emit('get_mcp_servers');
                }
                this._syncDisplayPrefs();
            },
            onClose: () => {
                this._tabs = null;
                this._tabPanels = {};
            }
        });
    }

    close() {
        Modal.close(MODAL_ID);
    }

    // ══════════════════════════════════════════════════════════════
    //  BUILD UI
    // ══════════════════════════════════════════════════════════════

    _buildContent() {
        const wrapper = h('div', { class: 'settings-view' });

        // Tab bar container
        const tabBar = h('div', { class: 'settings-tab-bar' });
        wrapper.appendChild(tabBar);

        // Tab panels container
        const panelHost = h('div', { class: 'settings-panels' });
        wrapper.appendChild(panelHost);

        // Create tab panels
        this._tabPanels = {
            general: this._renderGeneralTab(),
            ai:      this._renderAITab(),
            tools:   this._renderToolsTab(),
            display: this._renderDisplayTab(),
            gitops:  this._renderGitOpsTab(),
            prompt:  this._renderPromptTab()
        };

        Object.values(this._tabPanels).forEach(p => {
            p.style.display = 'none';
            panelHost.appendChild(p);
        });
        this._tabPanels.general.style.display = 'block';

        // Tabs component
        this._tabs = new Tabs(tabBar, {
            items: [
                { id: 'general', label: 'General' },
                { id: 'ai',      label: 'AI' },
                { id: 'tools',   label: 'Tools' },
                { id: 'display', label: 'Display' },
                { id: 'gitops',  label: '⚡ GitOps' },
                { id: 'prompt',  label: '🧠 Prompt' }
            ],
            activeId: 'general',
            style: 'underline',
            onChange: (id) => {
                Object.entries(this._tabPanels).forEach(([key, panel]) => {
                    panel.style.display = key === id ? 'block' : 'none';
                });
                if (id === 'prompt') this._refreshSystemPrompt();
            }
        });
        this._tabs.mount();

        // Footer actions
        const footer = h('div', { class: 'settings-actions' },
            Button.create('Cancel', {
                variant: 'ghost', size: 'sm',
                onClick: () => this.close()
            }),
            Button.create('Save', {
                variant: 'primary', size: 'sm',
                onClick: () => this._saveConfig()
            })
        );
        wrapper.appendChild(footer);

        return wrapper;
    }

    // ── General Tab ──────────────────────────────────────────────

    _renderGeneralTab() {
        const panel = h('div', { class: 'settings-tab-panel' });

        // Model selector
        const modelSelect = h('select', { class: 'settings-select-full', 'data-field': 'model' });
        MODEL_OPTIONS.forEach(opt => {
            modelSelect.appendChild(h('option', { value: opt.value }, opt.label));
        });
        modelSelect.addEventListener('change', () => {
            this._emitUpdate({ model: modelSelect.value });
        });

        panel.appendChild(this._section('Model',
            'Base model for AUTO & PLAN modes.',
            modelSelect
        ));

        // Custom Instructions
        const instrArea = h('textarea', {
            class: 'settings-textarea',
            'data-field': 'customInstructions',
            maxlength: '4000',
            placeholder: 'Enter custom instructions...'
        });
        const charCount = h('span', { class: 'char-count', 'data-ref': 'instrCount' }, '0/4000');
        instrArea.addEventListener('input', () => {
            OverlordUI.setContent(charCount, instrArea.value.length + '/4000');
        });

        panel.appendChild(this._section('Custom Instructions',
            'Injected with every prompt. Max 4000 chars.',
            instrArea, charCount
        ));

        // Project Memory
        const memArea = h('textarea', {
            class: 'settings-textarea',
            'data-field': 'projectMemory',
            placeholder: 'File paths, architecture notes, conventions...'
        });
        panel.appendChild(this._section('Project Memory',
            'Persistent project context injected every session.',
            memArea
        ));

        // ── Obsidian Vault Integration ──
        const obsidianWrap = h('div', { class: 'obsidian-vault-section' });

        const vaultPathInput = h('input', {
            type: 'text',
            class: 'settings-input-full',
            'data-field': 'obsidianVaultPath',
            placeholder: '/path/to/your/vault',
            style: 'font-family:monospace;font-size:11px;'
        });

        const discoverBtn = Button.create('🔍 Discover Vaults', {
            variant: 'ghost', size: 'sm',
            onClick: () => {
                if (!this._socket) return;
                OverlordUI.setContent(discoverBtn, '⏳ Scanning…');
                this._socket.emit('discover_vaults', (vaults) => {
                    // fallback: listen for event if callback not supported
                });
            }
        });

        const saveVaultBtn = Button.create('💾 Set Vault', {
            variant: 'primary', size: 'sm',
            onClick: () => {
                const vaultPath = vaultPathInput.value.trim();
                if (!vaultPath) return;
                if (this._socket) {
                    this._socket.emit('set_vault_path', { path: vaultPath });
                }
            }
        });

        const clearVaultBtn = Button.create('✕ Clear', {
            variant: 'ghost', size: 'sm',
            onClick: () => {
                vaultPathInput.value = '';
                if (this._socket) {
                    this._socket.emit('clear_vault_path');
                }
            }
        });

        const vaultResultsEl = h('div', {
            'data-ref': 'vault-results',
            style: 'margin-top:8px;font-size:11px;color:var(--text-secondary);'
        });

        // Listen for vault discovery results
        if (this._socket) {
            this._socket.on('vaults_discovered', (vaults) => {
                OverlordUI.setContent(discoverBtn, '🔍 Discover Vaults');
                if (!vaults || vaults.length === 0) {
                    OverlordUI.setContent(vaultResultsEl, 'No Obsidian vaults found.');
                    return;
                }
                vaultResultsEl.textContent = '';
                vaults.forEach(v => {
                    const row = h('div', {
                        style: 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.15);margin-bottom:4px;cursor:pointer;',
                    },
                        h('span', { style: 'font-size:14px;' }, '📗'),
                        h('span', { style: 'font-weight:600;color:var(--text-primary);flex:1;' }, v.name),
                        h('span', { style: 'font-size:10px;color:var(--text-muted);font-family:monospace;' }, v.path)
                    );
                    row.addEventListener('click', () => {
                        vaultPathInput.value = v.path;
                    });
                    vaultResultsEl.appendChild(row);
                });
            });
        }

        const btnRow = h('div', { style: 'display:flex;gap:6px;margin-top:8px;' },
            discoverBtn, saveVaultBtn, clearVaultBtn
        );

        obsidianWrap.appendChild(vaultPathInput);
        obsidianWrap.appendChild(btnRow);
        obsidianWrap.appendChild(vaultResultsEl);

        panel.appendChild(this._section('Obsidian Vault',
            'Connect to an Obsidian vault. AI will use vault tools (read, write, search notes) when you reference Obsidian.',
            obsidianWrap
        ));

        return panel;
    }

    // ── AI Tab ───────────────────────────────────────────────────

    _renderAITab() {
        const panel = h('div', { class: 'settings-tab-panel' });

        // Max AI Cycles
        const cyclesInput = h('input', {
            type: 'number', class: 'settings-input-full',
            'data-field': 'maxAICycles',
            value: '250', min: '1', max: '9999'
        });
        const unlimitedWrap = this._toggle('unlimitedCycles', 'Unlimited', (checked) => {
            cyclesInput.disabled = checked;
            if (checked) {
                this._emitUpdate({ maxAICycles: 0 });
            } else {
                const val = parseInt(cyclesInput.value) || 250;
                this._emitUpdate({ maxAICycles: val });
            }
        });
        cyclesInput.addEventListener('change', () => {
            const v = parseInt(cyclesInput.value);
            if (!isNaN(v) && v > 0) this._emitUpdate({ maxAICycles: v });
        });

        panel.appendChild(this._section('Max AI Cycles',
            'Maximum autonomous cycles before pausing. Set to 0 for unlimited.',
            cyclesInput, unlimitedWrap
        ));

        // Long-Running Mode
        const lrWrap = this._toggle('longRunning', 'Long-running mode', (checked) => {
            const store = OverlordUI._store;
            if (store) store.set('settings.longRunning', checked ? 'on' : 'off');
            else localStorage.setItem('overlord_long_running', checked ? 'on' : 'off');
        });
        panel.appendChild(this._section('Session Behavior',
            'Keeps sessions alive for extended autonomous runs.',
            lrWrap
        ));

        // ── Advanced Numeric Inputs (2-column grid) ───────────────────────
        const makeNumField = (key, def, min, max, step) => {
            const inp = h('input', {
                type: 'number', class: 'settings-input-sm',
                'data-field': key, value: String(def), min: String(min), max: String(max)
            });
            if (step) inp.step = String(step);
            inp.addEventListener('change', () => {
                const v = parseFloat(inp.value);
                if (!isNaN(v)) this._emitUpdate({ [key]: v });
            });
            return inp;
        };
        const numGrid = h('div', { class: 'settings-num-grid' },
            h('div', { class: 'settings-num-cell' },
                h('label', { class: 'settings-num-label' }, 'Session Notes Lines'),
                makeNumField('sessionNotesLines', 50, 1, 500),
                h('span', { class: 'settings-num-hint' }, 'injected')
            ),
            h('div', { class: 'settings-num-cell' },
                h('label', { class: 'settings-num-label' }, 'Timeline Lines'),
                makeNumField('timelineLines', 20, 1, 200),
                h('span', { class: 'settings-num-hint' }, 'injected')
            ),
            h('div', { class: 'settings-num-cell' },
                h('label', { class: 'settings-num-label' }, 'Rate Limit Tokens'),
                makeNumField('rateLimitTokens', 20, 1, 100),
                h('span', { class: 'settings-num-hint' }, 'max burst')
            ),
            h('div', { class: 'settings-num-cell' },
                h('label', { class: 'settings-num-label' }, 'Rate Refill / sec'),
                makeNumField('rateLimitRefillRate', 4, 0.5, 20, 0.5),
                h('span', { class: 'settings-num-hint' }, 'tokens/sec')
            ),
            h('div', { class: 'settings-num-cell' },
                h('label', { class: 'settings-num-label' }, 'Message Queue'),
                makeNumField('messageQueueSize', 3, 0, 20),
                h('span', { class: 'settings-num-hint' }, 'buffered msgs')
            ),
            h('div', { class: 'settings-num-cell' },
                h('label', { class: 'settings-num-label' }, 'Max Parallel Agents'),
                makeNumField('maxParallelAgents', 3, 1, 8),
                h('span', { class: 'settings-num-hint' }, 'at once')
            )
        );
        panel.appendChild(this._section('Processing Limits',
            'Fine-tune context injection, rate limiting, and parallelism.',
            numGrid
        ));

        // ── AI Self-Correction ────────────────────────────────────────────────
        const selfCorrWrap = this._toggleField('autoCreateIssues', 'Enable AI self-correction (auto-create GitHub issues on errors)', (v) => {
            this._emitUpdate({ autoCreateIssues: v });
        });
        panel.appendChild(this._section('AI Self-Correction',
            'AI creates GitHub issues for its own errors and retries until resolved.',
            selfCorrWrap
        ));

        // ── Task Enforcement ──────────────────────────────────────────────────
        const taskEnfWrap = this._toggleField('taskEnforcement', 'Enforce task creation (AI must use task tools)', (v) => {
            this._emitUpdate({ taskEnforcement: v });
        });
        panel.appendChild(this._section('Task Enforcement',
            'Require AI to create and complete tasks before reporting done.',
            taskEnfWrap
        ));

        // ── Strict Completion Mode ────────────────────────────────────────────
        const strictWrap = this._toggleField('strictCompletion', 'Strict completion mode — AI cannot skip or simplify work', (v) => {
            this._emitUpdate({ strictCompletion: v });
        });
        panel.appendChild(this._section('Strict Completion Mode',
            'Prevents the AI from removing tests, truncating output, or marking tasks done prematurely.',
            strictWrap
        ));

        // ── Queue Drain Mode ──────────────────────────────────────────────────
        const makeQueueRadio = (value, label) => {
            const rb = h('input', { type: 'radio', name: 'queueDrainMode', value, 'data-field': 'queueDrainMode-' + value });
            rb.addEventListener('change', () => { if (rb.checked) this._emitUpdate({ queueDrainMode: value }); });
            return h('label', { class: 'radio-wrap' }, rb, h('span', {}, label));
        };
        const queueDrainWrap = h('div', { class: 'radio-group' },
            makeQueueRadio('consolidated', 'Consolidated — merge queued messages into one request'),
            makeQueueRadio('sequential',   'Sequential — process each queued message in turn')
        );
        panel.appendChild(this._section('Queue Drain Mode',
            'How buffered messages are processed when the AI finishes a request.',
            queueDrainWrap
        ));

        // ── Extended Thinking Mode ────────────────────────────────────────────
        const thinkingBudgetInput = h('input', {
            type: 'number', class: 'settings-input-sm',
            'data-field': 'thinkingBudget',
            value: '2048', min: '512', max: '65536', step: '512'
        });
        thinkingBudgetInput.addEventListener('change', () => {
            const v = parseInt(thinkingBudgetInput.value, 10);
            if (!isNaN(v) && v >= 512) this._emitUpdate({ thinkingBudget: v });
        });
        const thinkingWrap = this._toggleField('thinkingEnabled', 'Enable extended thinking', (v) => {
            this._emitUpdate({ thinkingEnabled: v });
            thinkingBudgetInput.disabled = !v;
        });
        const thinkingRow = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
            thinkingWrap,
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                h('label', { class: 'settings-num-label', style: { minWidth: '80px' } }, 'Token budget'),
                thinkingBudgetInput,
                h('span', { class: 'settings-num-hint' }, 'tokens (512–65536, step 512)')
            )
        );
        panel.appendChild(this._section('Extended Thinking Mode',
            'Enables chain-of-thought reasoning. Requires MiniMax-M2.5 model. Uses more tokens.',
            thinkingRow
        ));

        // ── Plan Mode Length ──────────────────────────────────────────────────
        const makePlanRadio = (value, label) => {
            const rb = h('input', { type: 'radio', name: 'planLength', value, 'data-field': 'planLength-' + value });
            rb.addEventListener('change', () => { if (rb.checked) this._emitUpdate({ planLength: value }); });
            return h('label', { class: 'radio-wrap' }, rb, h('span', {}, label));
        };
        const planLengthWrap = h('div', { class: 'radio-group' },
            makePlanRadio('short',     'Short — concise action list (faster, fewer tokens)'),
            makePlanRadio('regular',   'Regular — balanced detail (recommended)'),
            makePlanRadio('long',      'Long — full rationale and implementation notes'),
            makePlanRadio('unlimited', 'Unlimited — no length constraints')
        );
        panel.appendChild(this._section('Plan Mode Length',
            'Controls the verbosity of PLAN mode outputs.',
            planLengthWrap
        ));

        // ── Reference Documentation ───────────────────────────────────────────
        const refDocArea = h('textarea', {
            class: 'settings-textarea settings-textarea-mono',
            'data-field': 'referenceDocumentation',
            placeholder: 'Paste API docs, architecture notes, or any reference material here...\nThis is injected into every AI request as reference context.',
            rows: '8'
        });
        refDocArea.addEventListener('change', () => {
            this._emitUpdate({ referenceDocumentation: refDocArea.value });
        });
        panel.appendChild(this._section('Reference Documentation',
            'Injected into every AI request as additional context. Useful for API docs, architecture diagrams, or team conventions.',
            refDocArea
        ));

        // ── TTS Voice (existing, updated) ─────────────────────────────────────
        const voiceSelect = h('select', { class: 'settings-select-full', 'data-field': 'ttsVoice' });
        TTS_VOICES.forEach(v => {
            voiceSelect.appendChild(h('option', { value: v.value }, v.label));
        });
        voiceSelect.addEventListener('change', () => {
            this._emitUpdate({ ttsVoice: voiceSelect.value });
        });
        const testBtn = Button.create('Test Voice', {
            variant: 'ghost', size: 'sm',
            onClick: () => {
                if (this._socket) {
                    this._socket.emit('user_input',
                        'speak Hello! I am your AI assistant using the ' + voiceSelect.value + ' voice.'
                    );
                }
            }
        });
        const voiceRow = h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
            voiceSelect, testBtn
        );
        panel.appendChild(this._section('TTS Voice',
            'Voice used for the speak tool and auto-narration. Audio saved to .overlord/audio/.',
            voiceRow
        ));

        // ── Voice Narration Mode ──────────────────────────────────────────────
        const ttsEnabledWrap = this._toggleField('ttsEnabled', 'Enable auto voice narration', (v) => {
            this._emitUpdate({ ttsEnabled: v });
            ttsModesWrap.style.display = v ? '' : 'none';
        });

        const makeTtsRadio = (value, labelText) => {
            const rb = h('input', { type: 'radio', name: 'ttsMode', value, 'data-field': 'ttsMode-' + value });
            rb.addEventListener('change', () => { if (rb.checked) this._emitUpdate({ ttsMode: value }); });
            return h('label', { class: 'radio-wrap' }, rb, h('span', {}, labelText));
        };

        const ttsSpeedInput = h('input', {
            type: 'number', class: 'settings-input-sm',
            'data-field': 'ttsSpeed',
            value: '1.0', min: '0.5', max: '2.0', step: '0.1'
        });
        ttsSpeedInput.addEventListener('change', () => {
            const s = parseFloat(ttsSpeedInput.value);
            if (!isNaN(s) && s >= 0.5 && s <= 2.0) this._emitUpdate({ ttsSpeed: s });
        });

        const ttsModesWrap = h('div', { style: { display: 'none', marginTop: '8px' } },
            h('div', { class: 'radio-group' },
                makeTtsRadio('read-aloud',    'Read Aloud — speaks AI responses verbatim (long responses are summarized)'),
                makeTtsRadio('quick-updates', 'Quick Updates — brief 2–3 sentence summary of what was done'),
                makeTtsRadio('thinking-aloud','Thinking Aloud — AI reflects on what it noticed and considered')
            ),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' } },
                h('label', { class: 'settings-num-label', style: { minWidth: '50px' } }, 'Speed'),
                ttsSpeedInput,
                h('span', { class: 'settings-num-hint' }, '× normal speed (0.5–2.0)')
            )
        );

        panel.appendChild(this._section('Voice Narration Mode',
            'AI automatically speaks after each response completes. Voice and mode are applied together.',
            ttsEnabledWrap, ttsModesWrap
        ));

        // ── Voice Clone ───────────────────────────────────────────────────────
        const cloneStatusEl = h('div', { class: 'voice-clone-status', style: { fontSize: '11px', marginTop: '6px', color: 'var(--text-secondary)' } }, '');
        const cloneFileInput = h('input', { type: 'file', accept: 'audio/mpeg,audio/mp4,audio/wav,audio/x-m4a,.mp3,.m4a,.wav', style: { fontSize: '11px' } });
        const cloneVoiceIdInput = h('input', {
            type: 'text', class: 'settings-input-sm',
            placeholder: 'my-voice-001', style: { width: '140px' }
        });
        let _uploadedFileId = null;

        const cloneBtn = Button.create('Clone Voice', {
            variant: 'primary', size: 'sm', disabled: true,
            onClick: async () => {
                if (!_uploadedFileId || !cloneVoiceIdInput.value.trim()) {
                    OverlordUI.setContent(cloneStatusEl, '⚠️ Upload a file and enter a Voice ID first.');
                    return;
                }
                Button.setLoading(cloneBtn, true);
                OverlordUI.setContent(cloneStatusEl, '⏳ Cloning voice…');
                this._socket.emit('voice_clone_create', {
                    fileId: _uploadedFileId,
                    voiceId: cloneVoiceIdInput.value.trim()
                });
            }
        });

        const uploadBtn = Button.create('Upload Recording', {
            variant: 'secondary', size: 'sm',
            onClick: () => cloneFileInput.click()
        });

        cloneFileInput.addEventListener('change', async () => {
            const file = cloneFileInput.files[0];
            if (!file) return;
            if (file.size > 30 * 1024 * 1024) {
                OverlordUI.setContent(cloneStatusEl, '⚠️ File too large (max ~30MB).');
                return;
            }
            OverlordUI.setContent(cloneStatusEl, '⏳ Uploading file…');
            const reader = new FileReader();
            reader.onload = () => {
                const b64 = reader.result.split(',')[1];
                this._socket.emit('voice_clone_upload', {
                    filename: file.name,
                    mimeType: file.type || 'audio/mpeg',
                    data: b64
                });
            };
            reader.readAsDataURL(file);
        });

        if (this._socket) {
            this._socket.on('voice_clone_upload_result', (res) => {
                if (res.success) {
                    _uploadedFileId = res.fileId;
                    cloneBtn.disabled = false;
                    OverlordUI.setContent(cloneStatusEl, `✅ File uploaded (id: ${res.fileId.substring(0, 12)}…)`);
                } else {
                    OverlordUI.setContent(cloneStatusEl, '❌ Upload failed: ' + (res.error || 'unknown'));
                }
            });
            this._socket.on('voice_clone_result', (res) => {
                Button.setLoading(cloneBtn, false);
                if (res.success) {
                    OverlordUI.setContent(cloneStatusEl, `✅ Voice cloned! ID: ${res.voiceId}`);
                    // Add cloned voice to the voice selector
                    const opt = h('option', { value: res.voiceId }, `${res.voiceId} (cloned)`);
                    voiceSelect.appendChild(opt);
                    voiceSelect.value = res.voiceId;
                    this._emitUpdate({ ttsVoice: res.voiceId });
                } else {
                    OverlordUI.setContent(cloneStatusEl, '❌ Clone failed: ' + (res.error || 'unknown'));
                }
            });
        }

        const cloneRow = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' } },
            uploadBtn,
            h('span', { style: { fontSize: '11px', color: 'var(--text-muted)' } }, 'Voice ID:'),
            cloneVoiceIdInput,
            cloneBtn
        );
        panel.appendChild(this._section('Voice Clone (MiniMax)',
            'Upload a voice recording (mp3/m4a/wav, 10s–5min) to create a cloned voice. The cloned voice ID is added to the voice selector above.',
            cloneFileInput,
            cloneRow,
            cloneStatusEl
        ));

        return panel;
    }

    // ── Tools / MCP Tab ──────────────────────────────────────────

    _renderToolsTab() {
        const panel = h('div', { class: 'settings-tab-panel' });

        // MCP server list
        const listHost = h('div', { 'data-ref': 'mcpList', class: 'mcp-server-list' });
        OverlordUI.setContent(listHost, h('div', {
            style: { color: 'var(--text-secondary)', fontSize: '11px' }
        }, 'Loading MCP servers...'));
        panel.appendChild(this._section('MCP Servers',
            'Model Context Protocol servers provide tools to the AI.',
            listHost
        ));

        // Add Custom Server form
        const addName    = h('input', { class: 'settings-input-full', placeholder: 'Server name (e.g. my-server)', 'data-ref': 'mcpAddName' });
        const addCmd     = h('input', { class: 'settings-input-full', placeholder: 'Command (e.g. uvx or npx)', 'data-ref': 'mcpAddCmd' });
        const addArgs    = h('input', { class: 'settings-input-full', placeholder: 'Args JSON (e.g. ["my-mcp-package"])', 'data-ref': 'mcpAddArgs' });
        const addDesc    = h('input', { class: 'settings-input-full', placeholder: 'Description (optional)', 'data-ref': 'mcpAddDesc' });
        const addBtn     = Button.create('Add Server', {
            variant: 'primary', size: 'sm',
            onClick: () => this._addCustomMcpServer(addName, addCmd, addArgs, addDesc)
        });
        const addForm = h('div', { class: 'mcp-add-form', style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
            addName, addCmd, addArgs, addDesc, addBtn
        );
        panel.appendChild(this._section('Add Custom Server', null, addForm));

        return panel;
    }

    // ── Display Tab ──────────────────────────────────────────────

    _renderDisplayTab() {
        const panel = h('div', { class: 'settings-tab-panel' });

        // Theme
        const darkBtn = Button.create('Dark', {
            icon: '\u{1F311}', variant: 'secondary', size: 'sm',
            className: 'theme-chip', dataset: { theme: 'dark' },
            onClick: () => this._setTheme('dark')
        });
        const lightBtn = Button.create('Light', {
            icon: '\u2600\uFE0F', variant: 'secondary', size: 'sm',
            className: 'theme-chip', dataset: { theme: 'light' },
            onClick: () => this._setTheme('light')
        });
        const themeGroup = h('div', { class: 'theme-chip-group', 'data-ref': 'themeGroup' },
            darkBtn, lightBtn
        );
        panel.appendChild(this._section('Appearance',
            'Color theme -- saved across sessions.',
            themeGroup
        ));

        // Notifications
        const notifToggle = this._toggle('notifEnabled', 'Enable OS notifications', (checked) => {
            this._toggleNotifications(checked);
        });
        const notifStatus = h('div', {
            class: 'notif-status-line', 'data-ref': 'notifStatus'
        }, '\u2014');
        const notifTestBtn = Button.create('Send Test Notification', {
            variant: 'ghost', size: 'sm', disabled: true,
            dataset: { ref: 'notifTest' },
            onClick: () => this._testNotification()
        });
        panel.appendChild(this._section('Notifications',
            'OS desktop alerts when the AI finishes a task or needs your approval.',
            notifToggle, notifStatus, notifTestBtn
        ));

        return panel;
    }

    // ── GitOps Tab ───────────────────────────────────────────────

    _renderGitOpsTab() {
        const panel = h('div', { class: 'settings-tab-panel' });

        // Master toggle
        const gitopsSub = h('div', { id: 'gitops-sub', style: { display: 'none' } });

        const masterWrap = this._toggleField('gitOpsEnabled', 'Enable GitOps Auto-Commit', (v) => {
            this._emitUpdate({ gitOpsEnabled: v });
            gitopsSub.style.display = v ? '' : 'none';
        });
        panel.appendChild(this._section('GitOps Auto-Commit',
            'AI generates quality commit messages and commits automatically on configurable triggers.',
            masterWrap
        ));

        // Commit Trigger radios
        const makeTriggerRadio = (value, label) => {
            const rb = h('input', { type: 'radio', name: 'gitOpsTrigger', value, 'data-field': 'gitOpsTrigger-' + value });
            rb.addEventListener('change', () => {
                if (rb.checked) {
                    this._emitUpdate({ gitOpsTrigger: value });
                    nFilesWrap.style.display = value === 'count' ? '' : 'none';
                }
            });
            return h('label', { class: 'radio-wrap' }, rb, h('span', {}, label));
        };

        const nFilesInput = h('input', {
            type: 'number', class: 'settings-input-sm',
            'data-field': 'gitOpsMinChanges',
            value: '3', min: '1', max: '50'
        });
        nFilesInput.addEventListener('change', () => {
            const n = parseInt(nFilesInput.value, 10);
            if (!isNaN(n) && n >= 1) this._emitUpdate({ gitOpsMinChanges: n });
        });

        const nFilesWrap = h('div', {
            style: { display: 'none', paddingLeft: '20px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }
        },
            h('span', { style: { fontSize: '11px' } }, 'Commit after'),
            nFilesInput,
            h('span', { style: { fontSize: '11px' } }, 'files changed')
        );

        const triggerWrap = h('div', {},
            h('div', { class: 'radio-group' },
                makeTriggerRadio('every',     'After every file change (debounced 3 s)'),
                makeTriggerRadio('task',      'After each task completes (recommended)'),
                makeTriggerRadio('milestone', 'After each milestone completes'),
                makeTriggerRadio('count',     'After N changed files accumulate'),
                makeTriggerRadio('manual',    'Manual only (use Commit & Push Now button)')
            ),
            nFilesWrap
        );
        gitopsSub.appendChild(this._section('Commit Trigger', null, triggerWrap));

        // Commit Message Style
        const styleSelect = h('select', { class: 'settings-select-full', 'data-field': 'gitOpsCommitStyle' },
            h('option', { value: 'comprehensive' }, 'Comprehensive — full impact summary, file list, trigger context'),
            h('option', { value: 'conventional' },  'Conventional Commits — type(scope): subject + file list'),
            h('option', { value: 'brief' },          'Brief — one-line type(scope): summary')
        );
        styleSelect.addEventListener('change', () => {
            this._emitUpdate({ gitOpsCommitStyle: styleSelect.value });
        });
        gitopsSub.appendChild(this._section('Commit Message Style', null, styleSelect));

        // Push Behavior radios
        const makePushRadio = (value, label) => {
            const rb = h('input', { type: 'radio', name: 'gitOpsPush', value, 'data-field': 'gitOpsPush-' + value });
            rb.addEventListener('change', () => { if (rb.checked) this._emitUpdate({ gitOpsPush: value }); });
            return h('label', { class: 'radio-wrap' }, rb, h('span', {}, label));
        };
        const pushWrap = h('div', { class: 'radio-group' },
            makePushRadio('always', 'Always push after commit'),
            makePushRadio('ask',    'Ask before each push'),
            makePushRadio('never',  'Never push (commit only)')
        );
        gitopsSub.appendChild(this._section('Push Behavior', null, pushWrap));

        // Manual commit button
        const commitNowBtn = Button.create('⚡ Commit & Push Now', {
            variant: 'electric', size: 'md',
            onClick: () => {
                if (this._socket) this._socket.emit('gitops_commit_now');
            }
        });
        gitopsSub.appendChild(this._section('Manual Trigger',
            'Immediately commit and push all staged changes with an AI-generated message.',
            commitNowBtn
        ));

        panel.appendChild(gitopsSub);
        return panel;
    }

    // ── Prompt Tab ───────────────────────────────────────────────

    _renderPromptTab() {
        const panel = h('div', { class: 'settings-tab-panel' });

        // ── System Prompt Preview ────────────────────────────────
        const promptArea = h('textarea', {
            class: 'settings-textarea settings-prompt-preview',
            readonly: '',
            rows: '18',
            placeholder: 'Click "Refresh" to load the compiled system prompt…',
            style: 'font-family: monospace; font-size: 11px; resize: vertical; white-space: pre;'
        });
        this._promptPreviewEl = promptArea;

        const refreshBtn = Button.create('Refresh', {
            variant: 'ghost', size: 'sm',
            onClick: () => this._refreshSystemPrompt()
        });

        const promptHeader = h('div', { style: 'display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;' },
            h('div', { class: 'settings-label' }, 'Compiled System Prompt'),
            refreshBtn
        );

        panel.appendChild(this._section('System Prompt Inspector',
            'Live view of the full system prompt sent to the AI on every request. Read-only — edit Custom Instructions below to add your own directives.',
            promptHeader,
            promptArea
        ));

        // ── Custom Instructions (quick-access copy from General tab) ─
        const instrArea = h('textarea', {
            class: 'settings-textarea',
            'data-field': 'customInstructions',
            maxlength: '4000',
            placeholder: 'Additional directives appended to the system prompt…',
            rows: '6'
        });
        instrArea.addEventListener('input', () => {
            this._emitUpdate({ customInstructions: instrArea.value });
        });
        this._promptInstrEl = instrArea;

        panel.appendChild(this._section('Custom Instructions',
            'These directives are appended to the system prompt as a ## CUSTOM INSTRUCTIONS section.',
            instrArea
        ));

        // Register for system_prompt_data responses
        if (this._socket) {
            this._socket.on('system_prompt_data', (data) => {
                if (this._promptPreviewEl) {
                    this._promptPreviewEl.value = data.prompt || '';
                }
            });
        }

        return panel;
    }

    _refreshSystemPrompt() {
        if (!this._socket) return;
        if (this._promptPreviewEl) {
            this._promptPreviewEl.value = '⏳ Loading…';
        }
        this._socket.emit('get_system_prompt');
    }

    // ══════════════════════════════════════════════════════════════
    //  CONFIG APPLY / SAVE
    // ══════════════════════════════════════════════════════════════

    _applyConfig(data) {
        if (!data) return;
        Object.assign(this._config, data);

        const body = Modal.getBody(MODAL_ID);
        if (!body) return;

        // Model
        const modelEl = body.querySelector('[data-field="model"]');
        if (modelEl && data.model) modelEl.value = data.model;

        // Custom Instructions (General tab + Prompt tab mirror)
        body.querySelectorAll('[data-field="customInstructions"]').forEach(instrEl => {
            if (data.customInstructions !== undefined) instrEl.value = data.customInstructions || '';
        });
        const counter = body.querySelector('[data-ref="instrCount"]');
        if (counter && data.customInstructions !== undefined) {
            OverlordUI.setContent(counter, (data.customInstructions || '').length + '/4000');
        }

        // Project Memory
        const memEl = body.querySelector('[data-field="projectMemory"]');
        if (memEl && data.projectMemory !== undefined) memEl.value = data.projectMemory || '';

        // Max AI Cycles
        const cyclesEl = body.querySelector('[data-field="maxAICycles"]');
        const unlimEl  = body.querySelector('[data-toggle="unlimitedCycles"]');
        if (cyclesEl) {
            const cycles = data.maxAICycles ?? 250;
            if (cycles === 0) {
                cyclesEl.disabled = true;
                cyclesEl.value = 9999;
                if (unlimEl) unlimEl.checked = true;
            } else {
                cyclesEl.disabled = false;
                cyclesEl.value = cycles;
                if (unlimEl) unlimEl.checked = false;
            }
        }

        // TTS Voice
        const voiceEl = body.querySelector('[data-field="ttsVoice"]');
        if (voiceEl && data.ttsVoice) voiceEl.value = data.ttsVoice;

        // Obsidian Vault Path
        const vaultEl = body.querySelector('[data-field="obsidianVaultPath"]');
        if (vaultEl && data.obsidianVaultPath !== undefined) vaultEl.value = data.obsidianVaultPath || '';

        // ── New numeric inputs ──────────────────────────────────────────────
        ['sessionNotesLines','timelineLines','rateLimitTokens','rateLimitRefillRate',
         'messageQueueSize','maxParallelAgents','thinkingBudget','ttsSpeed'].forEach(key => {
            const el = body.querySelector(`[data-field="${key}"]`);
            if (el && data[key] != null) el.value = data[key];
        });

        // ── New toggles ─────────────────────────────────────────────────────
        ['autoCreateIssues','taskEnforcement','strictCompletion','thinkingEnabled',
         'gitOpsEnabled','ttsEnabled'].forEach(key => {
            const el = body.querySelector(`[data-field="${key}"]`);
            if (el) el.checked = !!data[key];
        });

        // ── Radio groups ────────────────────────────────────────────────────
        ['queueDrainMode','planLength','gitOpsTrigger','gitOpsPush'].forEach(key => {
            const val = data[key];
            if (!val) return;
            const rb = body.querySelector(`[name="${key}"][value="${val}"]`);
            if (rb) rb.checked = true;
        });

        // gitOpsCommitStyle is a <select>
        const commitStyleEl = body.querySelector('[data-field="gitOpsCommitStyle"]');
        if (commitStyleEl && data.gitOpsCommitStyle) commitStyleEl.value = data.gitOpsCommitStyle;

        // referenceDocumentation textarea
        const refDocEl = body.querySelector('[data-field="referenceDocumentation"]');
        if (refDocEl && data.referenceDocumentation != null) refDocEl.value = data.referenceDocumentation;

        // ttsMode radio
        if (data.ttsMode) {
            const ttsRb = body.querySelector(`[name="ttsMode"][value="${data.ttsMode}"]`);
            if (ttsRb) ttsRb.checked = true;
        }

        // TTS modes sub-panel visibility
        const ttsModesEl = body.querySelector('[data-field="ttsEnabled"]');
        const ttsModesWrapEl = ttsModesEl?.closest('.settings-section')?.querySelector('div[style]');
        if (ttsModesWrapEl) ttsModesWrapEl.style.display = data.ttsEnabled ? '' : 'none';

        // GitOps sub-section visibility
        const gitopsSub = body.querySelector('#gitops-sub');
        if (gitopsSub) gitopsSub.style.display = data.gitOpsEnabled !== false ? '' : 'none';

        // gitOpsMinChanges count input visibility (when trigger='count')
        const countWrap = body.querySelector('[data-field="gitOpsMinChanges"]')?.closest('div');
        if (countWrap && data.gitOpsTrigger) {
            countWrap.style.display = data.gitOpsTrigger === 'count' ? 'flex' : 'none';
        }

        // thinkingBudget input disabled state
        const budgetEl = body.querySelector('[data-field="thinkingBudget"]');
        if (budgetEl) budgetEl.disabled = !data.thinkingEnabled;

        // Render AI-set badges
        this._renderAiSetBadges(body);
    }

    _saveConfig() {
        const body = Modal.getBody(MODAL_ID);
        if (!body || !this._socket) return;

        const g = (field) => body.querySelector(`[data-field="${field}"]`);
        const gv = (field) => g(field)?.value;
        const gc = (field) => g(field)?.checked;
        const gr = (name) => body.querySelector(`[name="${name}"]:checked`)?.value;

        const update = {};

        // Text areas
        if (g('customInstructions'))    update.customInstructions   = gv('customInstructions');
        if (g('projectMemory'))         update.projectMemory        = gv('projectMemory');
        if (g('referenceDocumentation'))update.referenceDocumentation = gv('referenceDocumentation') || '';
        if (g('obsidianVaultPath'))     update.obsidianVaultPath    = gv('obsidianVaultPath') || '';

        // Numeric inputs
        ['sessionNotesLines','timelineLines','rateLimitTokens','rateLimitRefillRate',
         'messageQueueSize','maxParallelAgents','thinkingBudget','ttsSpeed','gitOpsMinChanges'
        ].forEach(key => {
            const el = g(key);
            if (el) {
                const v = parseFloat(el.value);
                if (!isNaN(v)) update[key] = v;
            }
        });

        // Toggles
        ['autoCreateIssues','taskEnforcement','strictCompletion','thinkingEnabled',
         'gitOpsEnabled','ttsEnabled'].forEach(key => {
            const el = g(key);
            if (el) update[key] = el.checked;
        });

        // Radio groups
        ['queueDrainMode','planLength','gitOpsTrigger','gitOpsPush','ttsMode'].forEach(name => {
            const v = gr(name);
            if (v) update[name] = v;
        });

        // Selects
        if (g('ttsVoice'))        update.ttsVoice        = gv('ttsVoice');
        if (g('gitOpsCommitStyle'))update.gitOpsCommitStyle = gv('gitOpsCommitStyle');

        this._socket.emit('update_config', update);
        this.close();
    }

    _emitUpdate(patch) {
        if (this._socket) this._socket.emit('update_config', patch);
    }

    // ══════════════════════════════════════════════════════════════
    //  MCP SERVERS
    // ══════════════════════════════════════════════════════════════

    _renderMcpServers(servers) {
        const body = Modal.getBody(MODAL_ID);
        if (!body) return;
        const list = body.querySelector('[data-ref="mcpList"]');
        if (!list) return;

        list.textContent = '';

        if (!servers.length) {
            list.appendChild(h('div', {
                style: { color: 'var(--text-secondary)', fontSize: '11px' }
            }, 'No servers configured.'));
            return;
        }

        const frag = document.createDocumentFragment();
        servers.forEach(srv => {
            const toggleLabel = srv.enabled ? 'Disable' : 'Enable';
            const toolsText = srv.tools && srv.tools.length
                ? srv.tools.slice(0, 5).join(', ') + (srv.tools.length > 5 ? '...' : '')
                : 'No tools';

            const envInput = h('input', {
                class: 'settings-input-full',
                placeholder: 'ENV_VAR=value (e.g. GITHUB_TOKEN=ghp_xxx)',
                'data-srv-env': srv.name
            });
            const envBtn = Button.create('Connect', {
                variant: 'primary', size: 'sm',
                onClick: () => this._submitMcpEnv(srv.name, envInput)
            });
            const envForm = h('div', {
                class: 'mcp-env-form',
                style: { display: 'none', marginTop: '6px' }
            }, envInput, envBtn);

            const toggleBtn = Button.create(toggleLabel, {
                variant: srv.enabled ? 'danger' : 'primary', size: 'sm',
                onClick: () => this._toggleMcpServer(srv.name, srv.enabled, envForm)
            });

            const header = h('div', {
                style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }
            },
                h('span', { style: { fontWeight: '600', fontSize: '12px' } }, srv.name),
                srv.builtin ? h('span', {
                    style: { fontSize: '9px', color: 'var(--text-secondary)' }
                }, '[builtin]') : null,
                h('span', {
                    class: 'mcp-server-status ' + (srv.status || ''),
                    style: { fontSize: '10px', textTransform: 'uppercase', marginLeft: 'auto' }
                }, (srv.status || 'unknown').toUpperCase()),
                toggleBtn
            );

            const desc = srv.description
                ? h('div', { style: { fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' } }, srv.description)
                : null;

            const tools = srv.enabled && srv.toolCount
                ? h('div', { style: { fontSize: '10px', color: 'var(--text-muted)' } },
                    srv.toolCount + ' tools: ' + toolsText)
                : null;

            const item = h('div', {
                class: 'mcp-server-item',
                style: { padding: '10px 0', borderBottom: '1px solid var(--glass-border)' }
            }, header, desc, tools, envForm);

            frag.appendChild(item);
        });

        list.appendChild(frag);
    }

    _toggleMcpServer(name, currentlyEnabled, envForm) {
        if (!this._socket) return;
        if (currentlyEnabled) {
            this._socket.emit('disable_mcp_server', { name });
        } else {
            // For non-builtin servers, show env form first
            const srv = this._mcpServers.find(s => s.name === name);
            if (srv && !srv.builtin && envForm) {
                const isVisible = envForm.style.display !== 'none';
                envForm.style.display = isVisible ? 'none' : 'block';
                if (isVisible) {
                    // User toggled form closed, just enable without env
                    this._socket.emit('enable_mcp_server', { name, env: {} });
                }
            } else {
                this._socket.emit('enable_mcp_server', { name, env: {} });
            }
        }
    }

    _submitMcpEnv(name, inputEl) {
        if (!this._socket) return;
        const val = inputEl.value.trim();
        const env = {};
        if (val.includes('=')) {
            const [k, ...rest] = val.split('=');
            env[k.trim()] = rest.join('=').trim();
        }
        this._socket.emit('enable_mcp_server', { name, env });
    }

    _addCustomMcpServer(nameEl, cmdEl, argsEl, descEl) {
        if (!this._socket) return;
        const name    = nameEl.value.trim();
        const command = cmdEl.value.trim();
        const argsStr = argsEl.value.trim();
        const desc    = descEl.value.trim();

        if (!name || !command) return;

        let args = [];
        try {
            args = argsStr ? JSON.parse(argsStr) : [];
        } catch (_e) {
            args = argsStr ? argsStr.split(' ') : [];
        }

        this._socket.emit('add_mcp_server', { name, command, args, description: desc });

        // Clear form
        nameEl.value = '';
        cmdEl.value  = '';
        argsEl.value = '';
        descEl.value = '';
    }

    _onMcpResult(data) {
        if (!data) return;
        // Toast feedback is handled via the engine event bus;
        // re-request server list to keep UI in sync
        if (this._socket && Modal.isOpen(MODAL_ID)) {
            this._socket.emit('get_mcp_servers');
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  THEME
    // ══════════════════════════════════════════════════════════════

    _setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        this._updateThemeButtons();

        // Sync to pop-out windows
        OverlordUI.broadcast({ type: 'theme_changed', theme });
    }

    _updateThemeButtons() {
        const body = Modal.getBody(MODAL_ID);
        if (!body) return;
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        body.querySelectorAll('.theme-chip').forEach(btn => {
            const t = btn.dataset.theme;
            btn.classList.toggle('active', t === current);
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  NOTIFICATIONS
    // ══════════════════════════════════════════════════════════════

    _toggleNotifications(enabled) {
        localStorage.setItem('overlord_notifications', enabled ? 'on' : 'off');
        if (enabled && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
            Notification.requestPermission().then(() => this._syncNotifUI());
        } else {
            this._syncNotifUI();
        }
    }

    _syncNotifUI() {
        const body = Modal.getBody(MODAL_ID);
        if (!body) return;

        const enabled = localStorage.getItem('overlord_notifications') !== 'off';
        const perm    = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
        const status  = body.querySelector('[data-ref="notifStatus"]');
        const testBtn = body.querySelector('[data-ref="notifTest"]');

        if (status) {
            if (perm === 'granted' && enabled) {
                OverlordUI.setContent(status, 'Notifications enabled');
                status.className = 'notif-status-line ok';
            } else if (perm === 'denied') {
                OverlordUI.setContent(status, 'Blocked by browser -- update in site settings');
                status.className = 'notif-status-line err';
            } else {
                OverlordUI.setContent(status, enabled ? 'Permission not yet granted' : 'Disabled');
                status.className = 'notif-status-line warn';
            }
        }

        if (testBtn) testBtn.disabled = !(perm === 'granted' && enabled);
    }

    _testNotification() {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('OVERLORD', { body: 'Test notification -- it works!' });
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  AI-SET CONFIG BADGES
    // ══════════════════════════════════════════════════════════════

    _onAiSetConfig(data) {
        if (!data || !data.key) return;
        this._aiSetKeys.add(data.key);
        localStorage.setItem('overlord_ai_set_keys', JSON.stringify([...this._aiSetKeys]));

        const body = Modal.getBody(MODAL_ID);
        if (body) this._renderAiSetBadges(body);
    }

    _renderAiSetBadges(root) {
        this._aiSetKeys.forEach(key => {
            const field = root.querySelector('[data-field="' + key + '"]');
            const target = field ? (field.closest('.settings-section') || field.parentElement) : null;
            if (target && !target.querySelector('.ai-set-badge')) {
                target.appendChild(
                    h('span', {
                        class: 'ai-set-badge',
                        title: 'Set by AI'
                    }, '\u{1F916}')
                );
            }
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  DISPLAY PREFERENCE SYNC
    // ══════════════════════════════════════════════════════════════

    _syncDisplayPrefs() {
        const body = Modal.getBody(MODAL_ID);
        if (!body) return;

        // Theme buttons
        this._updateThemeButtons();

        // Long-running checkbox
        const lrEl = body.querySelector('[data-toggle="longRunning"]');
        if (lrEl) {
            const store = OverlordUI._store;
            lrEl.checked = store ? store.get('settings.longRunning') === 'on'
                                 : localStorage.getItem('overlord_long_running') === 'on';
        }

        // Notification state
        const notifEl = body.querySelector('[data-toggle="notifEnabled"]');
        if (notifEl) notifEl.checked = localStorage.getItem('overlord_notifications') !== 'off';
        this._syncNotifUI();
    }

    // ══════════════════════════════════════════════════════════════
    //  HELPERS
    // ══════════════════════════════════════════════════════════════

    /** Create a settings section with a title, optional description, and children. */
    _section(title, desc, ...children) {
        const sec = h('div', { class: 'settings-section' });
        sec.appendChild(h('div', { class: 'settings-section-title' }, title));
        if (desc) sec.appendChild(h('div', { class: 'settings-section-desc' }, desc));
        children.forEach(child => { if (child) sec.appendChild(child); });
        return sec;
    }

    /** Create a labelled toggle checkbox. */
    _toggle(name, label, onChange) {
        const cb = h('input', { type: 'checkbox', 'data-toggle': name });
        cb.addEventListener('change', () => onChange(cb.checked));
        return h('label', { class: 'toggle-wrap' },
            cb,
            h('span', { class: 'toggle-track' }),
            h('span', { class: 'toggle-label' }, label)
        );
    }

    /**
     * Config-bound toggle — uses data-field (persisted via update_config).
     * Unlike _toggle() which uses data-toggle (local prefs only).
     */
    _toggleField(field, label, onChange) {
        const cb = h('input', { type: 'checkbox', 'data-field': field });
        cb.addEventListener('change', () => onChange(cb.checked));
        return h('label', { class: 'toggle-wrap' },
            cb,
            h('span', { class: 'toggle-track' }),
            h('span', { class: 'toggle-label' }, label)
        );
    }
}
