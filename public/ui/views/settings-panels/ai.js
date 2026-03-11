/* ═══════════════════════════════════════════════════════════════════
   OVERLORD UI — Settings: AI Panel
   ═══════════════════════════════════════════════════════════════════
   Model selection, API key, max tokens, temperature settings.

   Dependencies: engine.js, button.js
   ═══════════════════════════════════════════════════════════════════ */

import { h } from '../../engine.js';
import { Button } from '../../components/button.js';
import { MODEL_OPTIONS } from './general.js';

// TTS Voice options
export const TTS_VOICES = [
    // Official MiniMax English System Voices
    { value: 'English_expressive_narrator', label: 'Expressive Narrator' },
    { value: 'English_radiant_girl', label: 'Radiant Girl' },
    { value: 'English_magnetic_voiced_man', label: 'Magnetic-voiced Man' },
    { value: 'English_Upbeat_Woman', label: 'Upbeat Woman' },
    { value: 'English_Trustworth_Man', label: 'Trustworthy Man' },
    { value: 'English_CalmWoman', label: 'Calm Woman' },
    { value: 'English_Gentle-voiced_man', label: 'Gentle-voiced Man' },
    { value: 'English_Diligent_Man', label: 'Diligent Man' },
    { value: 'English_Graceful_Lady', label: 'Graceful Lady' },
    { value: 'English_PlayfulGirl', label: 'Playful Girl' },
    { value: 'English_ManWithDeepVoice', label: 'Man With Deep Voice' },
    { value: 'English_FriendlyPerson', label: 'Friendly Guy' },
    { value: 'English_CaptivatingStoryteller', label: 'Captivating Storyteller' },
    { value: 'English_WiseScholar', label: 'Wise Scholar' },
    { value: 'English_ConfidentWoman', label: 'Confident Woman' },
    { value: 'English_PatientMan', label: 'Patient Man' },
    { value: 'English_Comedian', label: 'Comedian' },
    // Legacy voices
    { value: 'smart_adam', label: 'Adam (legacy)' },
    { value: 'smart_bella', label: 'Bella (legacy)' }
];

/**
 * Render the AI settings tab
 * @param {object} config - Current config
 * @param {object} socket - Socket connection
 * @returns {HTMLElement}
 */
export function renderAITab(config = {}, socket = null) {
    const panel = h('div', { class: 'settings-tab-panel' });

    // Max AI Cycles
    const cyclesInput = h('input', {
        type: 'number', class: 'settings-input-full',
        'data-field': 'maxAICycles',
        value: String(config.maxAICycles || 250), min: '1', max: '9999'
    });
    const unlimitedWrap = buildToggle('unlimitedCycles', 'Unlimited', (checked) => {
        cyclesInput.disabled = checked;
        if (socket) {
            socket.emit('update_config', { maxAICycles: checked ? 0 : parseInt(cyclesInput.value) || 250 });
        }
    });
    cyclesInput.addEventListener('change', () => {
        const v = parseInt(cyclesInput.value);
        if (!isNaN(v) && v > 0 && socket) {
            socket.emit('update_config', { maxAICycles: v });
        }
    });

    panel.appendChild(buildSection('Max AI Cycles',
        'Maximum autonomous cycles before pausing. Set to 0 for unlimited.',
        cyclesInput, unlimitedWrap
    ));

    // Long-Running Mode
    const lrWrap = buildToggle('longRunning', 'Long-running mode', (checked) => {
        const store = OverlordUI._store;
        if (store) store.set('settings.longRunning', checked ? 'on' : 'off');
        else localStorage.setItem('overlord_long_running', checked ? 'on' : 'off');
    });
    if (config.longRunning) lrWrap.querySelector('input').checked = true;

    panel.appendChild(buildSection('Session Behavior',
        'Keeps sessions alive for extended autonomous runs.',
        lrWrap
    ));

    // Advanced Numeric Inputs (2-column grid)
    const makeNumField = (key, def, min, max, step) => {
        const inp = h('input', {
            type: 'number', class: 'settings-input-sm',
            'data-field': key, value: String(config[key] ?? def), min: String(min), max: String(max)
        });
        if (step) inp.step = String(step);
        inp.addEventListener('change', () => {
            const v = parseFloat(inp.value);
            if (!isNaN(v) && socket) socket.emit('update_config', { [key]: v });
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

    panel.appendChild(buildSection('Processing Limits',
        'Fine-tune context injection, rate limiting, and parallelism.',
        numGrid
    ));

    // AI Self-Correction
    const selfCorrWrap = buildConfigToggle('autoCreateIssues', 'Enable AI self-correction (auto-create GitHub issues on errors)', (v) => {
        if (socket) socket.emit('update_config', { autoCreateIssues: v });
    });
    if (config.autoCreateIssues) selfCorrWrap.querySelector('input').checked = true;

    panel.appendChild(buildSection('AI Self-Correction',
        'AI creates GitHub issues for its own errors and retries until resolved.',
        selfCorrWrap
    ));

    // Task Enforcement
    const taskEnfWrap = buildConfigToggle('taskEnforcement', 'Enforce task creation (AI must use task tools)', (v) => {
        if (socket) socket.emit('update_config', { taskEnforcement: v });
    });
    if (config.taskEnforcement) taskEnfWrap.querySelector('input').checked = true;

    panel.appendChild(buildSection('Task Enforcement',
        'Require AI to create and complete tasks before reporting done.',
        taskEnfWrap
    ));

    // Strict Completion Mode
    const strictWrap = buildConfigToggle('strictCompletion', 'Strict completion mode — AI cannot skip or simplify work', (v) => {
        if (socket) socket.emit('update_config', { strictCompletion: v });
    });
    if (config.strictCompletion) strictWrap.querySelector('input').checked = true;

    panel.appendChild(buildSection('Strict Completion Mode',
        'Prevents the AI from removing tests, truncating output, or marking tasks done prematurely.',
        strictWrap
    ));

    // Queue Drain Mode
    const makeQueueRadio = (value, label) => {
        const rb = h('input', { type: 'radio', name: 'queueDrainMode', value, 'data-field': 'queueDrainMode-' + value });
        if (config.queueDrainMode === value) rb.checked = true;
        rb.addEventListener('change', () => { if (rb.checked && socket) socket.emit('update_config', { queueDrainMode: value }); });
        return h('label', { class: 'radio-wrap' }, rb, h('span', {}, label));
    };

    const queueDrainWrap = h('div', { class: 'radio-group' },
        makeQueueRadio('consolidated', 'Consolidated — merge queued messages into one request'),
        makeQueueRadio('sequential', 'Sequential — process each queued message in turn')
    );

    panel.appendChild(buildSection('Queue Drain Mode',
        'How buffered messages are processed when the AI finishes a request.',
        queueDrainWrap
    ));

    // Extended Thinking Mode — High / Med / Low / Off selector
    const THINKING_LEVELS = [
        { value: 'off',  label: 'Off',    budget: 0,     enabled: false },
        { value: 'low',  label: 'Low',    budget: 2048,  enabled: true },
        { value: 'med',  label: 'Medium', budget: 8192,  enabled: true },
        { value: 'high', label: 'High',   budget: 32768, enabled: true }
    ];

    // Determine current level from config
    const currentLevel = !config.thinkingEnabled ? 'off'
        : (config.thinkingBudget || 0) <= 2048 ? 'low'
        : (config.thinkingBudget || 0) <= 8192 ? 'med'
        : 'high';

    const makeThinkingRadio = (level) => {
        const rb = h('input', { type: 'radio', name: 'thinkingLevel', value: level.value });
        if (currentLevel === level.value) rb.checked = true;
        rb.addEventListener('change', () => {
            if (rb.checked && socket) {
                socket.emit('update_config', {
                    thinkingEnabled: level.enabled,
                    thinkingBudget: level.budget,
                    thinkingLevel: level.value
                });
            }
        });
        const hint = level.enabled ? ` (${level.budget.toLocaleString()} tokens)` : '';
        return h('label', { class: 'radio-wrap' }, rb, h('span', {}, level.label + hint));
    };

    const thinkingWrap = h('div', { class: 'radio-group' },
        ...THINKING_LEVELS.map(makeThinkingRadio)
    );

    panel.appendChild(buildSection('Extended Thinking (Interleaved Reasoning)',
        'MiniMax M2.5 supports native interleaved thinking. Higher levels give deeper reasoning but use more tokens.',
        thinkingWrap
    ));

    // Plan Mode Length
    const makePlanRadio = (value, label) => {
        const rb = h('input', { type: 'radio', name: 'planLength', value, 'data-field': 'planLength-' + value });
        if (config.planLength === value) rb.checked = true;
        rb.addEventListener('change', () => { if (rb.checked && socket) socket.emit('update_config', { planLength: value }); });
        return h('label', { class: 'radio-wrap' }, rb, h('span', {}, label));
    };

    const planLengthWrap = h('div', { class: 'radio-group' },
        makePlanRadio('short', 'Short — concise action list (faster, fewer tokens)'),
        makePlanRadio('regular', 'Regular — balanced detail (recommended)'),
        makePlanRadio('long', 'Long — full rationale and implementation notes'),
        makePlanRadio('unlimited', 'Unlimited — no length constraints')
    );

    panel.appendChild(buildSection('Plan Mode Length',
        'Controls the verbosity of PLAN mode outputs.',
        planLengthWrap
    ));

    // Reference Documentation
    const refDocArea = h('textarea', {
        class: 'settings-textarea settings-textarea-mono',
        'data-field': 'referenceDocumentation',
        placeholder: 'Paste API docs, architecture notes, or any reference material here...',
        rows: '8'
    });
    if (config.referenceDocumentation) refDocArea.value = config.referenceDocumentation;
    refDocArea.addEventListener('change', () => {
        if (socket) socket.emit('update_config', { referenceDocumentation: refDocArea.value });
    });

    panel.appendChild(buildSection('Reference Documentation',
        'Injected into every AI request as additional context.',
        refDocArea
    ));

    // TTS Voice
    const voiceSelect = h('select', { class: 'settings-select-full', 'data-field': 'ttsVoice' });
    TTS_VOICES.forEach(v => {
        const option = h('option', { value: v.value }, v.label);
        if (config.ttsVoice === v.value) option.selected = true;
        voiceSelect.appendChild(option);
    });
    voiceSelect.addEventListener('change', () => {
        if (socket) socket.emit('update_config', { ttsVoice: voiceSelect.value });
    });

    const testBtn = Button.create('Test Voice', {
        variant: 'ghost', size: 'sm',
        onClick: () => {
            if (socket) {
                socket.emit('user_input', 'speak Hello! I am your AI assistant using the ' + voiceSelect.value + ' voice.');
            }
        }
    });

    const voiceRow = h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        voiceSelect, testBtn
    );

    panel.appendChild(buildSection('TTS Voice',
        'Voice used for the speak tool and auto-narration.',
        voiceRow
    ));

    // Voice Narration Mode
    const ttsEnabledWrap = buildConfigToggle('ttsEnabled', 'Enable auto voice narration', (v) => {
        if (socket) socket.emit('update_config', { ttsEnabled: v });
        ttsModesWrap.style.display = v ? '' : 'none';
    });
    if (config.ttsEnabled) ttsEnabledWrap.querySelector('input').checked = true;

    const makeTtsRadio = (value, labelText) => {
        const rb = h('input', { type: 'radio', name: 'ttsMode', value, 'data-field': 'ttsMode-' + value });
        if (config.ttsMode === value) rb.checked = true;
        rb.addEventListener('change', () => { if (rb.checked && socket) socket.emit('update_config', { ttsMode: value }); });
        return h('label', { class: 'radio-wrap' }, rb, h('span', {}, labelText));
    };

    const ttsSpeedInput = h('input', {
        type: 'number', class: 'settings-input-sm',
        'data-field': 'ttsSpeed',
        value: String(config.ttsSpeed || 1.0), min: '0.5', max: '2.0', step: '0.1'
    });
    ttsSpeedInput.addEventListener('change', () => {
        const s = parseFloat(ttsSpeedInput.value);
        if (!isNaN(s) && s >= 0.5 && s <= 2.0 && socket) socket.emit('update_config', { ttsSpeed: s });
    });

    const ttsModesWrap = h('div', { style: { display: config.ttsEnabled ? '' : 'none', marginTop: '8px' } },
        h('div', { class: 'radio-group' },
            makeTtsRadio('read-aloud', 'Read Aloud — speaks AI responses verbatim'),
            makeTtsRadio('quick-updates', 'Quick Updates — brief 2–3 sentence summary'),
            makeTtsRadio('thinking-aloud', 'Thinking Aloud — AI reflects on what it noticed')
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' } },
            h('label', { class: 'settings-num-label', style: { minWidth: '50px' } }, 'Speed'),
            ttsSpeedInput,
            h('span', { class: 'settings-num-hint' }, '× normal speed (0.5–2.0)')
        )
    );

    panel.appendChild(buildSection('Voice Narration Mode',
        'AI automatically speaks after each response completes.',
        ttsEnabledWrap, ttsModesWrap
    ));

    // Voice Clone
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
            socket.emit('voice_clone_create', {
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
            socket.emit('voice_clone_upload', {
                filename: file.name,
                mimeType: file.type || 'audio/mpeg',
                data: b64
            });
        };
        reader.readAsDataURL(file);
    });

    if (socket) {
        socket.on('voice_clone_upload_result', (res) => {
            if (res.success) {
                _uploadedFileId = res.fileId;
                cloneBtn.disabled = false;
                OverlordUI.setContent(cloneStatusEl, `✅ File uploaded (id: ${res.fileId.substring(0, 12)}…)`);
            } else {
                OverlordUI.setContent(cloneStatusEl, '❌ Upload failed: ' + (res.error || 'unknown'));
            }
        });
        socket.on('voice_clone_result', (res) => {
            Button.setLoading(cloneBtn, false);
            if (res.success) {
                OverlordUI.setContent(cloneStatusEl, `✅ Voice cloned! ID: ${res.voiceId}`);
                const opt = h('option', { value: res.voiceId }, `${res.voiceId} (cloned)`);
                voiceSelect.appendChild(opt);
                voiceSelect.value = res.voiceId;
                socket.emit('update_config', { ttsVoice: res.voiceId });
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

    panel.appendChild(buildSection('Voice Clone (MiniMax)',
        'Upload a voice recording (mp3/m4a/wav, 10s–5min) to create a cloned voice.',
        cloneFileInput,
        cloneRow,
        cloneStatusEl
    ));

    return panel;
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

function buildConfigToggle(field, label, onChange) {
    const cb = h('input', { type: 'checkbox', 'data-field': field });
    cb.addEventListener('change', () => onChange(cb.checked));
    return h('label', { class: 'toggle-wrap' },
        cb,
        h('span', { class: 'toggle-track' }),
        h('span', { class: 'toggle-label' }, label)
    );
}

import { OverlordUI } from '../../engine.js';
