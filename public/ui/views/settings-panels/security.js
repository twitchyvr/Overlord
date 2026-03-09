/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Settings: Security Panel
   ═══════════════════════════════════════════════════════════════════
   Approval tiers, guardrails, auto-QA settings.

   Dependencies: engine.js, button.js
   ═══════════════════════════════════════════════════════════════════ */

import { h } from '../../engine.js';
import { Button } from '../../components/button.js';
import { OverlordUI } from '../../engine.js';

/**
 * Render the Security settings tab
 * @param {object} config - Current config
 * @param {object} socket - Socket connection
 * @returns {HTMLElement}
 */
export function renderSecurityTab(config = {}, socket = null) {
    const panel = h('div', { class: 'settings-tab-panel' });

    // Approval Tiers
    panel.appendChild(buildSection('Approval Tiers',
        'Configure when AI needs human approval before executing actions.',
        renderApprovalTiers(config, socket)
    ));

    // Guardrails
    panel.appendChild(buildSection('Guardrails',
        'Safety checks and restrictions on AI actions.',
        renderGuardrails(config, socket)
    ));

    // Auto-QA Settings
    panel.appendChild(buildSection('Auto-QA',
        'Automatic quality assurance for AI outputs.',
        renderAutoQA(config, socket)
    ));

    // Session Security
    panel.appendChild(buildSection('Session Security',
        'Session timeout and authentication settings.',
        renderSessionSecurity(config, socket)
    ));

    return panel;
}

/**
 * Render approval tiers configuration
 */
function renderApprovalTiers(config, socket) {
    const container = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });

    // Tier 1: Low Risk (auto-approve)
    const tier1Desc = 'File reads, glob, grep, web fetch, code analysis';
    const tier1Toggle = buildConfigToggle('approvalTier1Auto', 'Low Risk — Auto-approve', (v) => {
        if (socket) socket.emit('update_config', { approvalTier1Auto: v });
    });
    if (config.approvalTier1Auto !== false) tier1Toggle.querySelector('input').checked = true;
    container.appendChild(tier1Toggle);

    // Tier 2: Medium Risk (prompt)
    const tier2Toggle = buildConfigToggle('approvalTier2Prompt', 'Medium Risk — Prompt for approval', (v) => {
        if (socket) socket.emit('update_config', { approvalTier2Prompt: v });
    });
    if (config.approvalTier2Prompt !== false) tier2Toggle.querySelector('input').checked = true;
    container.appendChild(tier2Toggle);

    // Tier 3: High Risk (block)
    const tier3Toggle = buildConfigToggle('approvalTier3Block', 'High Risk — Always block', (v) => {
        if (socket) socket.emit('update_config', { approvalTier3Block: v });
    });
    if (config.approvalTier3Block !== false) tier3Toggle.querySelector('input').checked = true;
    container.appendChild(tier3Toggle);

    // Shell command approval
    const shellToggle = buildConfigToggle('shellApprovalRequired', 'Shell commands require approval', (v) => {
        if (socket) socket.emit('update_config', { shellApprovalRequired: v });
    });
    if (config.shellApprovalRequired) shellToggle.querySelector('input').checked = true;
    container.appendChild(shellToggle);

    // Git push approval
    const gitPushToggle = buildConfigToggle('gitPushApprovalRequired', 'Git push requires approval', (v) => {
        if (socket) socket.emit('update_config', { gitPushApprovalRequired: v });
    });
    if (config.gitPushApprovalRequired) gitPushToggle.querySelector('input').checked = true;
    container.appendChild(gitPushToggle);

    return container;
}

/**
 * Render guardrails configuration
 */
function renderGuardrails(config, socket) {
    const container = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });

    // Rate limiting
    const rateLimitToggle = buildConfigToggle('rateLimitingEnabled', 'Enable rate limiting', (v) => {
        if (socket) socket.emit('update_config', { rateLimitingEnabled: v });
    });
    if (config.rateLimitingEnabled !== false) rateLimitToggle.querySelector('input').checked = true;
    container.appendChild(rateLimitToggle);

    // Content filtering
    const contentFilterToggle = buildConfigToggle('contentFilteringEnabled', 'Enable content filtering', (v) => {
        if (socket) socket.emit('update_config', { contentFilteringEnabled: v });
    });
    if (config.contentFilteringEnabled !== false) contentFilterToggle.querySelector('input').checked = true;
    container.appendChild(contentFilterToggle);

    // Code execution limits
    const codeExecGrid = h('div', { class: 'settings-num-grid' });

    const timeoutInput = h('input', {
        type: 'number', class: 'settings-input-sm',
        'data-field': 'codeExecTimeout',
        value: String(config.codeExecTimeout || 30), min: '5', max: '300'
    });
    timeoutInput.addEventListener('change', () => {
        const v = parseInt(timeoutInput.value);
        if (!isNaN(v) && v >= 5 && socket) socket.emit('update_config', { codeExecTimeout: v });
    });

    const timeoutCell = h('div', { class: 'settings-num-cell' },
        h('label', { class: 'settings-num-label' }, 'Command Timeout'),
        timeoutInput,
        h('span', { class: 'settings-num-hint' }, 'seconds')
    );
    codeExecGrid.appendChild(timeoutCell);

    const maxOutputInput = h('input', {
        type: 'number', class: 'settings-input-sm',
        'data-field': 'maxOutputSize',
        value: String(config.maxOutputSize || 100000), min: '1000', max: '1000000'
    });
    maxOutputInput.addEventListener('change', () => {
        const v = parseInt(maxOutputInput.value);
        if (!isNaN(v) && v >= 1000 && socket) socket.emit('update_config', { maxOutputSize: v });
    });

    const maxOutputCell = h('div', { class: 'settings-num-cell' },
        h('label', { class: 'settings-num-label' }, 'Max Output'),
        maxOutputInput,
        h('span', { class: 'settings-num-hint' }, 'bytes')
    );
    codeExecGrid.appendChild(maxOutputCell);

    container.appendChild(codeExecGrid);

    // Dangerous commands blocklist
    const blocklistArea = h('textarea', {
        class: 'settings-textarea',
        'data-field': 'blockedCommands',
        placeholder: 'Commands to block (one per line)',
        rows: '4'
    });
    if (config.blockedCommands) blocklistArea.value = config.blockedCommands;
    blocklistArea.addEventListener('change', () => {
        if (socket) socket.emit('update_config', { blockedCommands: blocklistArea.value });
    });

    container.appendChild(buildSection('Blocked Commands',
        'List of shell commands that are never executed.',
        blocklistArea
    ));

    return container;
}

/**
 * Render Auto-QA configuration
 */
function renderAutoQA(config, socket) {
    const container = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });

    // Auto-QA toggle
    const autoQAToggle = buildConfigToggle('autoQAEnabled', 'Enable automatic QA', (v) => {
        if (socket) socket.emit('update_config', { autoQAEnabled: v });
        autoQASettings.style.display = v ? '' : 'none';
    });
    if (config.autoQAEnabled) autoQAToggle.querySelector('input').checked = true;

    const autoQASettings = h('div', { style: { display: config.autoQAEnabled ? 'flex' : 'none', flexDirection: 'column', gap: '8px', marginTop: '8px' } });

    // Lint after code changes
    const lintToggle = buildConfigToggle('autoQALint', 'Run linter after code changes', (v) => {
        if (socket) socket.emit('update_config', { autoQALint: v });
    });
    if (config.autoQALint !== false) lintToggle.querySelector('input').checked = true;
    autoQASettings.appendChild(lintToggle);

    // Type check
    const typeCheckToggle = buildConfigToggle('autoQATypeCheck', 'Run type checker after code changes', (v) => {
        if (socket) socket.emit('update_config', { autoQATypeCheck: v });
    });
    if (config.autoQATypeCheck !== false) typeCheckToggle.querySelector('input').checked = true;
    autoQASettings.appendChild(typeCheckToggle);

    // Run tests
    const testToggle = buildConfigToggle('autoQATests', 'Run tests after code changes', (v) => {
        if (socket) socket.emit('update_config', { autoQATests: v });
    });
    if (config.autoQATests !== false) testToggle.querySelector('input').checked = true;
    autoQASettings.appendChild(testToggle);

    // QA strictness
    const strictnessSelect = h('select', { class: 'settings-select-full', 'data-field': 'autoQAStrictness' });
    const strictnessLevels = [
        { value: 'warning', label: 'Warning only — continue even if QA fails' },
        { value: 'error', label: 'Error — stop if QA fails' },
        { value: 'strict', label: 'Strict — fail on any warning' }
    ];
    strictnessLevels.forEach(opt => {
        const option = h('option', { value: opt.value }, opt.label);
        if (config.autoQAStrictness === opt.value) option.selected = true;
        strictnessSelect.appendChild(option);
    });
    strictnessSelect.addEventListener('change', () => {
        if (socket) socket.emit('update_config', { autoQAStrictness: strictnessSelect.value });
    });

    autoQASettings.appendChild(buildSection('QA Strictness',
        'How to handle QA failures.',
        strictnessSelect
    ));

    container.appendChild(autoQAToggle);
    container.appendChild(autoQASettings);

    return container;
}

/**
 * Render session security settings
 */
function renderSessionSecurity(config, socket) {
    const container = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });

    // Session timeout
    const timeoutInput = h('input', {
        type: 'number', class: 'settings-input-sm',
        'data-field': 'sessionTimeout',
        value: String(config.sessionTimeout || 60), min: '5', max: '480'
    });
    timeoutInput.addEventListener('change', () => {
        const v = parseInt(timeoutInput.value);
        if (!isNaN(v) && v >= 5 && socket) socket.emit('update_config', { sessionTimeout: v });
    });

    const timeoutRow = h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        h('label', { style: { fontSize: '12px' } }, 'Session timeout:'),
        timeoutInput,
        h('span', { style: { fontSize: '11px', color: 'var(--text-muted)' } }, 'minutes')
    );

    container.appendChild(timeoutRow);

    // Require re-auth for sensitive actions
    const reauthToggle = buildConfigToggle('requireReauthForSensitive', 'Require re-authentication for sensitive actions', (v) => {
        if (socket) socket.emit('update_config', { requireReauthForSensitive: v });
    });
    if (config.requireReauthForSensitive) reauthToggle.querySelector('input').checked = true;
    container.appendChild(reauthToggle);

    // API key visibility
    const apiKeyToggle = buildConfigToggle('hideAPIKeys', 'Hide API keys in UI', (v) => {
        if (socket) socket.emit('update_config', { hideAPIKeys: v });
    });
    if (config.hideAPIKeys !== false) apiKeyToggle.querySelector('input').checked = true;
    container.appendChild(apiKeyToggle);

    return container;
}

// Helper functions
function buildSection(title, desc, ...children) {
    const sec = h('div', { class: 'settings-section' });
    sec.appendChild(h('div', { class: 'settings-section-title' }, title));
    if (desc) sec.appendChild(h('div', { class: 'settings-section-desc' }, desc));
    children.forEach(child => { if (child) sec.appendChild(child); });
    return sec;
}

function buildConfigToggle(field, label, onChange) {
    const cb = h('input', { type: 'checkbox', 'data-field': field });
    cb.addEventListener('change', () => onChange(cb.checked));
    return h('label', { class: 'toggle-wrap' },
        cb,
        h('span', { class: 'toggle-track' }),
        h('span', { class: 'toggle-label' }, label)
    );
}
