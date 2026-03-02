// ==================== MINIMAX IMAGE GENERATION MODULE ====================
// Handles image generation via MiniMax image_generation API
// Registers the 'generate_image' tool

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

let hub = null;

// ==================== IMAGE GENERATION ====================

async function generateImage(prompt, options = {}) {
    const config = hub.getService('config');
    const baseUrl = (config.baseUrl || 'https://api.minimax.io/anthropic').replace('/anthropic', '').replace(/\/$/, '');
    const apiKey = config.apiKey;

    const model = options.model || 'image-01';
    const aspectRatio = options.aspect_ratio || '1:1';
    const n = Math.min(options.n || 1, 4);
    const promptOptimize = options.prompt_optimize !== false;
    const style = options.style || null; // e.g. 'anime', 'realistic', 'sketch'

    const body = {
        model,
        prompt,
        aspect_ratio: aspectRatio,
        n,
        prompt_optimizer: promptOptimize
    };
    if (style) body.style_preset = style;

    hub.log(`[ImageGen] Generating ${n} image(s) with model ${model}...`, 'info');

    return new Promise((resolve, reject) => {
        const urlObj = new URL(`${baseUrl}/v1/image_generation`);
        const payload = JSON.stringify(body);

        const options = {
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
        const req = proto.request(options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    hub.log(`[ImageGen] API error ${res.statusCode}: ${data}`, 'error');
                    return reject(new Error(`Image generation API error ${res.statusCode}: ${data}`));
                }
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (e) {
                    reject(new Error(`Failed to parse image API response: ${e.message}`));
                }
            });
        });

        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

// Download an image URL and save to .overlord/generated/
async function downloadAndSaveImage(imageUrl, filename) {
    const conv = hub.getService('conversation');
    const baseDir = conv?.getWorkingDirectory?.() || process.cwd();
    const genDir = path.join(baseDir, '.overlord', 'generated');

    if (!fs.existsSync(genDir)) {
        fs.mkdirSync(genDir, { recursive: true });
    }

    const filePath = path.join(genDir, filename);

    return new Promise((resolve, reject) => {
        const urlObj = new URL(imageUrl);
        const proto = urlObj.protocol === 'https:' ? https : http;

        const file = fs.createWriteStream(filePath);
        proto.get(imageUrl, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                // Follow redirect
                file.close();
                downloadAndSaveImage(res.headers.location, filename).then(resolve).catch(reject);
                return;
            }
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve(filePath);
            });
        }).on('error', (err) => {
            fs.unlink(filePath, () => {});
            reject(err);
        });
    });
}

// ==================== TOOL HANDLER ====================

async function handleGenerateImage(input) {
    const { prompt, aspect_ratio, n, style, prompt_optimize } = input;

    if (!prompt || !prompt.trim()) {
        return { success: false, error: 'A prompt is required for image generation.' };
    }

    try {
        hub.broadcast('agent_activity', {
            type: 'tool_start',
            tool: 'generate_image',
            ts: Date.now(),
            inputSummary: `Generating image: "${prompt.substring(0, 80)}..."`
        });

        const result = await generateImage(prompt, { aspect_ratio, n, style, prompt_optimize });

        if (!result.data || !result.data.length) {
            return { success: false, error: 'No images returned from API.', raw: result };
        }

        const savedImages = [];
        for (let i = 0; i < result.data.length; i++) {
            const img = result.data[i];
            const url = img.url || img.b64_json ? null : null;

            if (img.url) {
                const ts = Date.now();
                const filename = `image-${ts}-${i + 1}.png`;
                try {
                    const localPath = await downloadAndSaveImage(img.url, filename);
                    savedImages.push({ url: img.url, localPath, filename });
                } catch (e) {
                    savedImages.push({ url: img.url, localPath: null, filename: null, error: e.message });
                }
            } else if (img.b64_json) {
                const ts = Date.now();
                const filename = `image-${ts}-${i + 1}.png`;
                const conv = hub.getService('conversation');
                const baseDir = conv?.getWorkingDirectory?.() || process.cwd();
                const genDir = path.join(baseDir, '.overlord', 'generated');
                if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
                const localPath = path.join(genDir, filename);
                fs.writeFileSync(localPath, Buffer.from(img.b64_json, 'base64'));
                savedImages.push({ url: null, localPath, filename });
            }
        }

        hub.broadcast('agent_activity', {
            type: 'tool_complete',
            tool: 'generate_image',
            ts: Date.now(),
            success: true
        });

        // Broadcast to UI so images can be shown inline
        hub.broadcast('images_generated', {
            prompt,
            images: savedImages.map(img => ({
                url: img.url,
                localPath: img.localPath,
                filename: img.filename,
                servePath: img.filename ? `/generated/${img.filename}` : null
            }))
        });

        const descriptions = savedImages.map((img, i) => {
            const ref = img.servePath ? `Available at: ${img.servePath}` : img.url ? `URL: ${img.url}` : 'Saved locally';
            return `Image ${i + 1}: ${ref}`;
        }).join('\n');

        return {
            success: true,
            count: savedImages.length,
            images: savedImages,
            summary: `Generated ${savedImages.length} image(s).\n${descriptions}`
        };

    } catch (err) {
        hub.log(`[ImageGen] Error: ${err.message}`, 'error');
        hub.broadcast('agent_activity', {
            type: 'tool_error',
            tool: 'generate_image',
            ts: Date.now(),
            error: err.message
        });
        return { success: false, error: err.message };
    }
}

// ==================== TOOL DEFINITION ====================

const IMAGE_TOOL_DEF = {
    name: 'generate_image',
    description: 'Generate images using the MiniMax image generation API. Returns image URLs and saves them locally. Use this when the user asks to create, draw, or generate an image.',
    input_schema: {
        type: 'object',
        properties: {
            prompt: {
                type: 'string',
                description: 'A detailed description of the image to generate. Be specific about style, composition, colors, and content.'
            },
            aspect_ratio: {
                type: 'string',
                description: 'Image aspect ratio. Options: "1:1" (square), "16:9" (landscape), "9:16" (portrait), "4:3", "3:4". Default: "1:1"',
                enum: ['1:1', '16:9', '9:16', '4:3', '3:4']
            },
            n: {
                type: 'number',
                description: 'Number of images to generate (1-4). Default: 1'
            },
            style: {
                type: 'string',
                description: 'Optional style preset (e.g. "anime", "realistic", "sketch", "oil_painting"). Leave empty for default.'
            },
            prompt_optimize: {
                type: 'boolean',
                description: 'Whether to let the model optimize the prompt. Default: true'
            }
        },
        required: ['prompt']
    }
};

// ==================== INIT ====================

async function init(h) {
    hub = h;

    // Register the tool handler
    const tools = hub.getService('tools');
    if (tools && tools.registerTool) {
        tools.registerTool(IMAGE_TOOL_DEF, handleGenerateImage);
        hub.log('[ImageGen] generate_image tool registered', 'success');
    } else {
        hub.log('[ImageGen] Tools service not available, will retry on tools_ready', 'warn');
        hub.on('tools_ready', () => {
            const t = hub.getService('tools');
            if (t && t.registerTool) {
                t.registerTool(IMAGE_TOOL_DEF, handleGenerateImage);
                hub.log('[ImageGen] generate_image tool registered (delayed)', 'success');
            }
        });
    }

    hub.registerService('imageGen', { generateImage, handleGenerateImage });
    hub.log('🎨 MiniMax Image Generation module loaded', 'success');
}

module.exports = { init };
