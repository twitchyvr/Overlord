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
    { value: 'female-shaonv',       label: 'Female - Young Woman' },
    { value: 'female-yujie',        label: 'Female - Elegant' },
    { value: 'female-chengshu',     label: 'Female - Mature' },
    { value: 'female-tianmei',      label: 'Female - Sweet' },
    { value: 'male-qn-qingse',     label: 'Male - Qingse' },
    { value: 'male-qn-jingying',   label: 'Male - Jingying' },
    { value: 'presenter_male',     label: 'Presenter Male' },
    { value: 'presenter_female',   label: 'Presenter Female' },
    { value: 'smart_adam',          label: 'Adam (EN)' },
    { value: 'smart_bella',        label: 'Bella (EN)' }
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
            display: this._renderDisplayTab()
        };

        Object.values(this._tabPanels).forEach(p => {
            p.style.display = 'none';
            panelHost.appendChild(p);
        });
        this._tabPanels.general.style.display = '';

        // Tabs component
        this._tabs = new Tabs(tabBar, {
            items: [
                { id: 'general', label: 'General' },
                { id: 'ai',      label: 'AI' },
                { id: 'tools',   label: 'Tools' },
                { id: 'display', label: 'Display' }
            ],
            activeId: 'general',
            style: 'underline',
            onChange: (id) => {
                Object.entries(this._tabPanels).forEach(([key, panel]) => {
                    panel.style.display = key === id ? '' : 'none';
                });
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
            localStorage.setItem('overlord_long_running', checked ? 'on' : 'off');
        });
        panel.appendChild(this._section('Session Behavior',
            'Keeps sessions alive for extended autonomous runs.',
            lrWrap
        ));

        // TTS Voice
        const voiceSelect = h('select', { class: 'settings-select-full', 'data-field': 'ttsVoice' });
        TTS_VOICES.forEach(v => {
            voiceSelect.appendChild(h('option', { value: v.value }, v.label));
        });
        const testBtn = Button.create('Test', {
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
            'Voice used for the speak tool. Audio saved to .overlord/audio/.',
            voiceRow
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

        // Custom Instructions
        const instrEl = body.querySelector('[data-field="customInstructions"]');
        if (instrEl && data.customInstructions !== undefined) {
            instrEl.value = data.customInstructions || '';
            const counter = body.querySelector('[data-ref="instrCount"]');
            if (counter) OverlordUI.setContent(counter, instrEl.value.length + '/4000');
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

        // Render AI-set badges
        this._renderAiSetBadges(body);
    }

    _saveConfig() {
        const body = Modal.getBody(MODAL_ID);
        if (!body || !this._socket) return;

        const instrEl = body.querySelector('[data-field="customInstructions"]');
        const memEl   = body.querySelector('[data-field="projectMemory"]');

        const update = {};
        if (instrEl) update.customInstructions = instrEl.value;
        if (memEl)   update.projectMemory      = memEl.value;

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
        if (lrEl) lrEl.checked = localStorage.getItem('overlord_long_running') === 'on';

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
}
