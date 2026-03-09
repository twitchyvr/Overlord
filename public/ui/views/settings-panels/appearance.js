/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Settings: Appearance Panel
   ═══════════════════════════════════════════════════════════════════
   Theme, font size, panel sizes settings.

   Dependencies: engine.js, button.js
   ═══════════════════════════════════════════════════════════════════ */

import { h } from '../../engine.js';
import { Button } from '../../components/button.js';
import { OverlordUI } from '../../engine.js';

/**
 * Render the Appearance/Display settings tab
 * @param {object} config - Current config
 * @returns {HTMLElement}
 */
export function renderDisplayTab(config = {}) {
    const panel = h('div', { class: 'settings-tab-panel' });

    // Theme
    const darkBtn = Button.create('Dark', {
        icon: '\u{1F311}', variant: 'secondary', size: 'sm',
        className: 'theme-chip', dataset: { theme: 'dark' },
        onClick: () => setTheme('dark')
    });
    const lightBtn = Button.create('Light', {
        icon: '\u2600\uFE0F', variant: 'secondary', size: 'sm',
        className: 'theme-chip', dataset: { theme: 'light' },
        onClick: () => setTheme('light')
    });
    
    // Update active state based on current theme
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    darkBtn.classList.toggle('active', currentTheme === 'dark');
    lightBtn.classList.toggle('active', currentTheme === 'light');

    const themeGroup = h('div', { class: 'theme-chip-group', 'data-ref': 'themeGroup' },
        darkBtn, lightBtn
    );
    panel.appendChild(buildSection('Appearance',
        'Color theme — saved across sessions.',
        themeGroup
    ));

    // Font Size
    const fontSizeSelect = h('select', { class: 'settings-select-full', 'data-field': 'fontSize' });
    const fontSizes = [
        { value: 'small', label: 'Small (12px)' },
        { value: 'medium', label: 'Medium (14px)' },
        { value: 'large', label: 'Large (16px)' },
        { value: 'xlarge', label: 'Extra Large (18px)' }
    ];
    fontSizes.forEach(opt => {
        const option = h('option', { value: opt.value }, opt.label);
        if (config.fontSize === opt.value) option.selected = true;
        fontSizeSelect.appendChild(option);
    });
    fontSizeSelect.addEventListener('change', () => {
        document.documentElement.style.setProperty('--font-size-base', fontSizeSelect.value);
    });

    panel.appendChild(buildSection('Font Size',
        'Base font size for the UI.',
        fontSizeSelect
    ));

    // Panel Sizes
    const panelSizeGrid = h('div', { class: 'settings-num-grid' });

    const sidebarWidthInput = h('input', {
        type: 'number', class: 'settings-input-sm',
        'data-field': 'sidebarWidth',
        value: String(config.sidebarWidth || 280), min: '200', max: '500'
    });
    sidebarWidthInput.addEventListener('change', () => {
        const v = parseInt(sidebarWidthInput.value);
        if (!isNaN(v) && v >= 200 && v <= 500) {
            document.documentElement.style.setProperty('--sidebar-width', v + 'px');
        }
    });

    const panelSizeCell = h('div', { class: 'settings-num-cell' },
        h('label', { class: 'settings-num-label' }, 'Sidebar Width'),
        sidebarWidthInput,
        h('span', { class: 'settings-num-hint' }, 'px')
    );
    panelSizeGrid.appendChild(panelSizeCell);

    const editorWidthInput = h('input', {
        type: 'number', class: 'settings-input-sm',
        'data-field': 'editorWidth',
        value: String(config.editorWidth || 400), min: '300', max: '800'
    });
    editorWidthInput.addEventListener('change', () => {
        const v = parseInt(editorWidthInput.value);
        if (!isNaN(v) && v >= 300 && v <= 800) {
            document.documentElement.style.setProperty('--editor-width', v + 'px');
        }
    });

    const editorSizeCell = h('div', { class: 'settings-num-cell' },
        h('label', { class: 'settings-num-label' }, 'Editor Width'),
        editorWidthInput,
        h('span', { class: 'settings-num-hint' }, 'px')
    );
    panelSizeGrid.appendChild(editorSizeCell);

    panel.appendChild(buildSection('Panel Sizes',
        'Customize the width of sidebar and editor panels.',
        panelSizeGrid
    ));

    // Compact Mode
    const compactToggle = buildToggle('compactMode', 'Compact mode', (checked) => {
        document.documentElement.classList.toggle('compact-mode', checked);
        localStorage.setItem('overlord_compact_mode', checked ? 'on' : 'off');
    });
    if (config.compactMode) compactToggle.querySelector('input').checked = true;

    panel.appendChild(buildSection('Layout',
        'Reduce spacing for more content on screen.',
        compactToggle
    ));

    // Notifications
    const notifToggle = buildToggle('notifEnabled', 'Enable OS notifications', (checked) => {
        toggleNotifications(checked);
    });
    if (localStorage.getItem('overlord_notifications') !== 'off') {
        notifToggle.querySelector('input').checked = true;
    }

    const notifStatus = h('div', {
        class: 'notif-status-line', 'data-ref': 'notifStatus'
    }, '\u2014');
    
    const notifTestBtn = Button.create('Send Test Notification', {
        variant: 'ghost', size: 'sm',
        dataset: { ref: 'notifTest' },
        onClick: () => testNotification()
    });
    notifTestBtn.disabled = !isNotificationEnabled();

    panel.appendChild(buildSection('Notifications',
        'OS desktop alerts when the AI finishes a task or needs your approval.',
        notifToggle, notifStatus, notifTestBtn
    ));

    return panel;
}

/**
 * Alias for backward compatibility
 */
export function renderAppearancePanel(config) {
    return renderDisplayTab(config);
}

/**
 * Set the theme
 */
function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    OverlordUI.broadcast({ type: 'theme_changed', theme });
}

/**
 * Toggle notifications
 */
function toggleNotifications(enabled) {
    localStorage.setItem('overlord_notifications', enabled ? 'on' : 'off');
    if (enabled && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
        Notification.requestPermission();
    }
}

/**
 * Test notification
 */
function testNotification() {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('OVERLORD', { body: 'Test notification — it works!' });
    }
}

/**
 * Check if notifications are enabled
 */
function isNotificationEnabled() {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted' 
        && localStorage.getItem('overlord_notifications') !== 'off';
}

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
