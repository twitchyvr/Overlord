// ==================== MINIMAX TTS MODULE ====================
// Text-to-speech synthesis via MiniMax T2A v2 API
// Registers the 'speak' tool

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

let hub = null;

// Default voice list (MiniMax T2A v2 supported voices)
const VOICES = {
    'male-qn-qingse': 'Male - Qingse (Clear)',
    'male-qn-jingying': 'Male - Jingying (Calm)',
    'male-qn-badao': 'Male - Badao (Bold)',
    'male-qn-daxuesheng': 'Male - Student',
    'female-shaonv': 'Female - Young Woman',
    'female-yujie': 'Female - Elegant',
    'female-chengshu': 'Female - Mature',
    'female-tianmei': 'Female - Sweet',
    'presenter_male': 'Presenter Male',
    'presenter_female': 'Presenter Female',
    'audiobook_male_1': 'Audiobook Male 1',
    'audiobook_male_2': 'Audiobook Male 2',
    'audiobook_female_1': 'Audiobook Female 1',
    'audiobook_female_2': 'Audiobook Female 2',
    'smart_adam': 'Adam (EN)',
    'smart_bella': 'Bella (EN)',
    'smart_clyde': 'Clyde (EN)',
    'smart_dorothy': 'Dorothy (EN)'
};

// ==================== TTS SYNTHESIS ====================

async function synthesize(text, options = {}) {
    const config = hub.getService('config');
    const baseUrl = (config.baseUrl || 'https://api.minimax.io/anthropic').replace('/anthropic', '').replace(/\/$/, '');
    const apiKey = config.apiKey;

    const voiceId = options.voice_id || 'female-shaonv';
    const speed = options.speed || 1.0;
    const vol = options.vol || 1.0;
    const pitch = options.pitch || 0;
    const model = options.model || 'speech-01-turbo';
    const outputFormat = 'mp3';

    const body = {
        model,
        text,
        stream: false,
        voice_setting: {
            voice_id: voiceId,
            speed,
            vol,
            pitch
        },
        audio_setting: {
            audio_sample_rate: 32000,
            bitrate: 128000,
            format: outputFormat
        }
    };

    hub.log(`[TTS] Synthesizing text with voice "${voiceId}"...`, 'info');

    return new Promise((resolve, reject) => {
        const urlObj = new URL(`${baseUrl}/v1/t2a_v2`);
        const payload = JSON.stringify(body);

        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const proto = urlObj.protocol === 'https:' ? https : http;
        const req = proto.request(reqOptions, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const data = Buffer.concat(chunks);
                if (res.statusCode !== 200) {
                    hub.log(`[TTS] API error ${res.statusCode}: ${data.toString()}`, 'error');
                    return reject(new Error(`TTS API error ${res.statusCode}: ${data.toString()}`));
                }

                // Check Content-Type: JSON means error or hex-encoded audio
                const ct = res.headers['content-type'] || '';
                if (ct.includes('application/json')) {
                    try {
                        const json = JSON.parse(data.toString());
                        if (json.data && json.data.audio) {
                            // Hex-encoded audio
                            const audioBuffer = Buffer.from(json.data.audio, 'hex');
                            resolve({ buffer: audioBuffer, format: outputFormat });
                        } else {
                            reject(new Error(`TTS API returned JSON without audio: ${JSON.stringify(json)}`));
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse TTS JSON response: ${e.message}`));
                    }
                } else {
                    // Raw audio bytes
                    resolve({ buffer: data, format: outputFormat });
                }
            });
        });

        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

// Save audio buffer to .overlord/audio/ and return serve path
function saveAudio(buffer, format) {
    const conv = hub.getService('conversation');
    const baseDir = conv?.getWorkingDirectory?.() || process.cwd();
    const audioDir = path.join(baseDir, '.overlord', 'audio');

    if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
    }

    const filename = `tts-${Date.now()}.${format}`;
    const filePath = path.join(audioDir, filename);
    fs.writeFileSync(filePath, buffer);

    return { filePath, filename, servePath: `/audio/${filename}` };
}

// ==================== TOOL HANDLER ====================

async function handleSpeak(input) {
    const { text, voice_id, speed, vol, pitch } = input;

    if (!text || !text.trim()) {
        return { success: false, error: 'Text is required for speech synthesis.' };
    }

    const truncated = text.length > 5000 ? text.substring(0, 5000) + '...' : text;

    try {
        hub.broadcast('agent_activity', {
            type: 'tool_start',
            tool: 'speak',
            ts: Date.now(),
            inputSummary: `Synthesizing: "${truncated.substring(0, 80)}..."`
        });

        const result = await synthesize(truncated, { voice_id, speed, vol, pitch });
        const saved = saveAudio(result.buffer, result.format);

        hub.broadcast('agent_activity', {
            type: 'tool_complete',
            tool: 'speak',
            ts: Date.now(),
            success: true
        });

        // Broadcast to UI for autoplay
        hub.broadcast('audio_ready', {
            servePath: saved.servePath,
            filename: saved.filename,
            text: truncated.substring(0, 100)
        });

        return {
            success: true,
            servePath: saved.servePath,
            filename: saved.filename,
            summary: `Audio synthesized and saved to ${saved.servePath}`
        };

    } catch (err) {
        hub.log(`[TTS] Error: ${err.message}`, 'error');
        hub.broadcast('agent_activity', {
            type: 'tool_error',
            tool: 'speak',
            ts: Date.now(),
            error: err.message
        });
        return { success: false, error: err.message };
    }
}

// ==================== TOOL DEFINITION ====================

const TTS_TOOL_DEF = {
    name: 'speak',
    description: 'Convert text to speech using the MiniMax T2A v2 API. The audio is saved and can be played back in the UI. Use this when the user asks to read text aloud, narrate something, or generate audio.',
    input_schema: {
        type: 'object',
        properties: {
            text: {
                type: 'string',
                description: 'The text to convert to speech. Maximum ~5000 characters.'
            },
            voice_id: {
                type: 'string',
                description: 'Voice ID to use. Options include: female-shaonv, female-yujie, male-qn-qingse, male-qn-jingying, presenter_male, presenter_female, smart_adam, smart_bella. Default: female-shaonv'
            },
            speed: {
                type: 'number',
                description: 'Speaking speed multiplier (0.5 to 2.0). Default: 1.0'
            },
            vol: {
                type: 'number',
                description: 'Volume level (0.1 to 10.0). Default: 1.0'
            },
            pitch: {
                type: 'number',
                description: 'Pitch adjustment (-12 to 12). Default: 0'
            }
        },
        required: ['text']
    }
};

// ==================== INIT ====================

async function init(h) {
    hub = h;

    const tools = hub.getService('tools');
    if (tools && tools.registerTool) {
        tools.registerTool(TTS_TOOL_DEF, handleSpeak);
        hub.log('[TTS] speak tool registered', 'success');
    } else {
        hub.on('tools_ready', () => {
            const t = hub.getService('tools');
            if (t && t.registerTool) {
                t.registerTool(TTS_TOOL_DEF, handleSpeak);
                hub.log('[TTS] speak tool registered (delayed)', 'success');
            }
        });
    }

    hub.registerService('tts', { synthesize, handleSpeak, getVoices: () => VOICES });

    // ── TTS Voice Mode hook ────────────────────────────────────────────────
    // Fires after every AI processing cycle completes; reads active mode from config
    // and speaks verbatim, a summary, or a reflective commentary.
    hub.on('ai_response_complete', async ({ text }) => {
        const config = hub.getService('config');
        if (!config?.ttsEnabled || !config?.ttsMode || config.ttsMode === 'off') return;
        if (!text || !text.trim()) return;

        const ai = hub.getService('ai');
        let speakText = text;

        try {
            if (config.ttsMode === 'quick-updates' && ai?.quickComplete) {
                speakText = await ai.quickComplete(
                    `Summarize this AI response in 2–3 spoken sentences, present-tense, first-person, conversational:\n\n${text.substring(0, 3000)}`,
                    { maxTokens: 150, temperature: 0.3 }
                ).catch(() => text.substring(0, 500));
            } else if (config.ttsMode === 'thinking-aloud' && ai?.quickComplete) {
                speakText = await ai.quickComplete(
                    `You are an AI assistant narrating your own thought process. Based on what you just did, speak 2–4 sentences reflecting on what you noticed, what decisions you made, or what you're still uncertain about. Be conversational and direct:\n\n${text.substring(0, 3000)}`,
                    { maxTokens: 200, temperature: 0.5 }
                ).catch(() => text.substring(0, 500));
            }
        } catch (_e) {
            speakText = text.substring(0, 500);
        }

        // Strip markdown syntax before speaking
        speakText = speakText
            .replace(/```[\s\S]*?```/g, ' [code block] ')
            .replace(/`[^`]+`/g, (m) => m.slice(1, -1))
            .replace(/[*_#>]/g, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/\s+/g, ' ')
            .trim();

        if (speakText.length > 10) {
            hub.log(`[TTS] Auto-narrating (mode: ${config.ttsMode}, chars: ${speakText.length})`, 'info');
            await handleSpeak({
                text: speakText,
                voice_id: config.ttsVoice || 'English_expressive_narrator',
                speed: config.ttsSpeed || 1.0
            }).catch(e => hub.log(`[TTS] Auto-narration error: ${e.message}`, 'warn'));
        }
    });

    // ── Voice Clone API handlers ───────────────────────────────────────────
    hub.on('voice_clone_create', async ({ fileId, voiceId, promptText } = {}, socket) => {
        const config = hub.getService('config');
        const apiKey = config?.apiKey;
        const baseUrl = ((config?.baseUrl) || 'https://api.minimax.io/anthropic')
            .replace('/anthropic', '').replace(/\/$/, '');

        if (!apiKey) {
            if (socket) socket.emit('voice_clone_result', { success: false, error: 'API key not configured' });
            return;
        }
        if (!fileId || !voiceId) {
            if (socket) socket.emit('voice_clone_result', { success: false, error: 'fileId and voiceId are required' });
            return;
        }

        const body = { file_id: fileId, voice_id: voiceId };
        if (promptText) body.clone_prompt = promptText;

        try {
            const result = await new Promise((resolve, reject) => {
                const payload = JSON.stringify(body);
                const urlObj = new URL(`${baseUrl}/v1/voice_clone`);
                const reqOpts = {
                    hostname: urlObj.hostname,
                    port: urlObj.port || 443,
                    path: urlObj.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Length': Buffer.byteLength(payload)
                    }
                };
                const proto = urlObj.protocol === 'https:' ? https : http;
                const req = proto.request(reqOpts, (res) => {
                    const chunks = [];
                    res.on('data', c => chunks.push(c));
                    res.on('end', () => {
                        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
                        catch (e) { reject(e); }
                    });
                });
                req.on('error', reject);
                req.write(payload);
                req.end();
            });

            hub.log(`[TTS] Voice clone created: ${voiceId}`, 'success');
            if (socket) socket.emit('voice_clone_result', { success: true, voiceId, result });
        } catch (e) {
            hub.log(`[TTS] Voice clone error: ${e.message}`, 'error');
            if (socket) socket.emit('voice_clone_result', { success: false, error: e.message });
        }
    });

    // Voice file upload for cloning
    hub.on('voice_clone_upload', async ({ filename, mimeType, data: fileDataB64 } = {}, socket) => {
        const config = hub.getService('config');
        const apiKey = config?.apiKey;
        const baseUrl = ((config?.baseUrl) || 'https://api.minimax.io/anthropic')
            .replace('/anthropic', '').replace(/\/$/, '');

        if (!apiKey || !fileDataB64) {
            if (socket) socket.emit('voice_clone_upload_result', { success: false, error: 'Missing API key or file data' });
            return;
        }

        try {
            const fileBuffer = Buffer.from(fileDataB64, 'base64');
            const boundary = `----FormBoundary${Date.now()}`;
            const mime = mimeType || 'audio/mpeg';
            const fname = filename || `voice-clone-${Date.now()}.mp3`;

            const formParts = [
                `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nvoice_clone`,
                `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fname}"\r\nContent-Type: ${mime}\r\n\r\n`
            ];

            const header = Buffer.from(formParts.join('\r\n'));
            const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
            const body = Buffer.concat([header, fileBuffer, footer]);

            const result = await new Promise((resolve, reject) => {
                const urlObj = new URL(`${baseUrl}/v1/files/upload`);
                const reqOpts = {
                    hostname: urlObj.hostname,
                    port: urlObj.port || 443,
                    path: urlObj.pathname,
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': `multipart/form-data; boundary=${boundary}`,
                        'Content-Length': body.length
                    }
                };
                const proto = urlObj.protocol === 'https:' ? https : http;
                const req = proto.request(reqOpts, (res) => {
                    const chunks = [];
                    res.on('data', c => chunks.push(c));
                    res.on('end', () => {
                        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
                        catch (e) { reject(e); }
                    });
                });
                req.on('error', reject);
                req.write(body);
                req.end();
            });

            const fileId = result?.file?.file_id || result?.file_id;
            if (fileId) {
                hub.log(`[TTS] Voice file uploaded: ${fileId}`, 'success');
                if (socket) socket.emit('voice_clone_upload_result', { success: true, fileId });
            } else {
                if (socket) socket.emit('voice_clone_upload_result', { success: false, error: JSON.stringify(result) });
            }
        } catch (e) {
            hub.log(`[TTS] Voice upload error: ${e.message}`, 'error');
            if (socket) socket.emit('voice_clone_upload_result', { success: false, error: e.message });
        }
    });

    hub.log('🔊 MiniMax TTS module loaded', 'success');
}

module.exports = { init };
