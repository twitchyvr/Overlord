/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Settings: General Panel
   ═══════════════════════════════════════════════════════════════════
   Working directory, timezone, auto-save settings.

   Dependencies: engine.js, button.js
   ═══════════════════════════════════════════════════════════════════ */

import { h } from '../engine.js';
import { Button } from '../components/button.js';

/**
 * Render the General settings tab
 * @param {object} config - Current config
 * @param {object} socket - Socket connection
 * @returns {HTMLElement}
 */
export function renderGeneralTab(config = {}, socket = null) {
    const panel = h('div', { class: 'settings-tab-panel' });

    // Model selector
    const modelSelect = h('select', { class: 'settings-select-full', 'data-field': 'model' });
    MODEL_OPTIONS.forEach(opt => {
        const option = h('option', { value: opt.value }, opt.label);
        if (config.model === opt.value) option.selected = true;
        modelSelect.appendChild(option);
    });
    modelSelect.addEventListener('change', () => {
        if (socket) socket.emit('update_config', { model: modelSelect.value });
    });

    panel.appendChild(buildSection('Model',
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
    if (config.customInstructions) instrArea.value = config.customInstructions;
    
    const charCount = h('span', { class: 'char-count', 'data-ref': 'instrCount' }, 
        `${(config.customInstructions || '').length}/4000`
    );
    instrArea.addEventListener('input', () => {
        charCount.textContent = `${instrArea.value.length}/4000`;
    });

    panel.appendChild(buildSection('Custom Instructions',
        'Injected with every prompt. Max 4000 chars.',
        instrArea, charCount
    ));

    // Project Memory
    const memArea = h('textarea', {
        class: 'settings-textarea',
        'data-field': 'projectMemory',
        placeholder: 'File paths, architecture notes, conventions...'
    });
    if (config.projectMemory) memArea.value = config.projectMemory;

    panel.appendChild(buildSection('Project Memory',
        'Persistent project context injected every session.',
        memArea
    ));

    // Obsidian Vault Integration
    const obsidianWrap = h('div', { class: 'obsidian-vault-section' });

    const vaultPathInput = h('input', {
        type: 'text',
        class: 'settings-input-full',
        'data-field': 'obsidianVaultPath',
        placeholder: '/path/to/your/vault',
        style: 'font-family:monospace;font-size:11px;'
    });
    if (config.obsidianVaultPath) vaultPathInput.value = config.obsidianVaultPath;

    const discoverBtn = Button.create('�� Discover Vaults', {
        variant: 'ghost', size: 'sm',
        onClick: () => {
            if (!socket) return;
            OverlordUI.setContent(discoverBtn, '⏳ Scanning…');
            socket.emit('discover_vaults', (vaults) => {});
        }
    });

    const saveVaultBtn = Button.create('�� Set Vault', {
        variant: 'primary', size: 'sm',
        onClick: () => {
            const vaultPath = vaultPathInput.value.trim();
            if (!vaultPath || !socket) return;
            socket.emit('set_vault_path', { path: vaultPath });
        }
    });

    const clearVaultBtn = Button.create('✕ Clear', {
        variant: 'ghost', size: 'sm',
        onClick: () => {
            vaultPathInput.value = '';
            if (socket) socket.emit('clear_vault_path');
        }
    });

    const vaultResultsEl = h('div', {
        'data-ref': 'vault-results',
        style: 'margin-top:8px;font-size:11px;color:var(--text-secondary);'
    });

    // Listen for vault discovery results
    if (socket) {
        socket.on('vaults_discovered', (vaults) => {
            OverlordUI.setContent(discoverBtn, '�� Discover Vaults');
            if (!vaults || vaults.length === 0) {
                OverlordUI.setContent(vaultResultsEl, 'No Obsidian vaults found.');
                return;
            }
            vaultResultsEl.textContent = '';
            vaults.forEach(v => {
                const row = h('div', {
                    style: 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.15);margin-bottom:4px;cursor:pointer;',
                },
                    h('span', { style: 'font-size:14px;' }, '��'),
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

    panel.appendChild(buildSection('Obsidian Vault',
        'Connect to an Obsidian vault. AI will use vault tools when you reference Obsidian.',
        obsidianWrap
    ));

    // Working Directory
    const workDirInput = h('input', {
        type: 'text',
        class: 'settings-input-full',
        'data-field': 'workingDirectory',
        placeholder: '/path/to/projects',
        style: 'font-family:monospace;font-size:11px;'
    });
    if (config.workingDirectory) workDirInput.value = config.workingDirectory;

    const browseBtn = Button.create('Browse', {
        variant: 'ghost', size: 'sm',
        onClick: () => {
            // Would trigger folder picker
        }
    });

    const workDirRow = h('div', { style: 'display:flex;gap:8px;' },
        workDirInput, browseBtn
    );

    panel.appendChild(buildSection('Working Directory',
        'Default directory for new projects and file operations.',
        workDirRow
    ));

    // Auto-save
    const autoSaveToggle = buildToggle('autoSave', 'Enable auto-save', (checked) => {
        if (socket) socket.emit('update_config', { autoSave: checked });
    });
    if (config.autoSave) autoSaveToggle.querySelector('input').checked = true;

    panel.appendChild(buildSection('Auto-save',
        'Automatically save changes during long-running sessions.',
        autoSaveToggle
    ));

    return panel;
}

// Model options
export const MODEL_OPTIONS = [
    { value: 'MiniMax-M2.5-highspeed', label: 'MiniMax-M2.5-highspeed — Coding (fast)' },
    { value: 'MiniMax-M2.5', label: 'MiniMax-M2.5 — Reasoning (standard)' },
    { value: 'MiniMax-Text-01', label: 'MiniMax-Text-01 — Text / PM' }
];

// Helper functions
function buildSection(title, desc, ...children) {
    const sec = h('div', { class: 'settings-section' });
    sec.appendChild(h('div', { class: 'settings-section-title' }, title));
    if (desc) sec.appendChild(h('div', { class: 'settings-section-desc' }, desc));
    children.forEach(child => { if (child) sec.appendChild(child); });
    return sec;
}

function buildToggle(name, label, onChange) {
    const cb = h('input', { type: 'checkbox', 'data-toggle': name });
    cb.addEventListener('change', () => onChange(cb.checked));
    return h('label', { class: 'toggle-wrap' },
        cb,
        h('span', { class: 'toggle-track' }),
        h('span', { class: 'toggle-label' }, label)
    );
}

// Make OverlordUI available
import { OverlordUI } from '../engine.js';
