// ==================== SCREENSHOT MODULE ====================
// Provides take_screenshot tool so the AI assistant can visually inspect
// running web apps and websites during development.
// Uses puppeteer-core with the system-installed Chrome/Chromium.

const path = require('path');
const fs   = require('fs');
const os   = require('os');

let hub    = null;

// Common Chrome executable paths on macOS, Linux, Windows
const CHROME_PATHS = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

function findChrome() {
    for (const p of CHROME_PATHS) {
        try { if (fs.existsSync(p)) return p; } catch(e) {}
    }
    return null;
}

async function takeScreenshot({ url, width = 1280, height = 800, fullPage = false, selector = null }) {
    let puppeteer;
    try {
        puppeteer = require('puppeteer-core');
    } catch(e) {
        return { error: 'puppeteer-core not installed. Run: npm install puppeteer-core' };
    }

    const executablePath = findChrome();
    if (!executablePath) {
        return { error: 'Chrome not found. Install Google Chrome or Chromium.' };
    }

    // Default to the running overlord-web server if no URL given
    if (!url) {
        const cfg = hub ? hub.getService('config') : null;
        const port = hub?.processState?.port || 3031;
        url = `http://localhost:${port}`;
    }

    // Validate URL — only allow http/https
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return { error: 'Only http/https URLs are allowed.' };
        }
    } catch(e) {
        return { error: 'Invalid URL: ' + url };
    }

    const outDir = path.join(process.cwd(), '.overlord', 'screenshots');
    fs.mkdirSync(outDir, { recursive: true });

    const filename = 'screenshot_' + Date.now() + '.png';
    const outPath  = path.join(outDir, filename);

    let browser;
    try {
        browser = await puppeteer.launch({
            executablePath,
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                `--window-size=${width},${height}`
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: parseInt(width) || 1280, height: parseInt(height) || 800 });

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        let screenshotOpts = { path: outPath, type: 'png', fullPage: !!fullPage };
        if (selector) {
            const el = await page.$(selector);
            if (el) {
                await el.screenshot({ path: outPath });
            } else {
                await page.screenshot(screenshotOpts);
            }
        } else {
            await page.screenshot(screenshotOpts);
        }

        await browser.close();

        // Return base64 so the AI can pass it to the vision API
        const imageData = fs.readFileSync(outPath);
        const base64    = imageData.toString('base64');
        const sizeKB    = Math.round(imageData.length / 1024);

        // Broadcast to frontend so the user also sees the screenshot
        if (hub) {
            hub.broadcast('screenshot_taken', {
                url,
                file: '.overlord/screenshots/' + filename,
                ts: Date.now(),
                sizeKB
            });
        }

        hub && hub.log(`📸 Screenshot taken: ${filename} (${sizeKB} KB)`, 'success');

        return {
            success: true,
            file: outPath,
            url,
            sizeKB,
            base64,
            mimeType: 'image/png',
            // Return a truncated base64 hint in text — full data is in base64 field
            summary: `Screenshot saved to ${outPath} (${sizeKB} KB). Use the base64 field to analyze the image.`
        };
    } catch(err) {
        if (browser) { try { await browser.close(); } catch(_) {} }
        hub && hub.log(`Screenshot error: ${err.message}`, 'error');
        return { error: err.message };
    }
}

async function init(h) {
    hub = h;

    const tools = hub.getService('tools');
    if (!tools || !tools.registerTool) {
        hub.log('[screenshot] tools service not available — skipping', 'warn');
        return;
    }

    tools.registerTool({
        name: 'take_screenshot',
        description: 'Take a screenshot of a running web app or website. Returns a base64-encoded PNG image that can be analyzed visually. Defaults to the current overlord-web server (localhost) if no URL is given. Use this to visually inspect UI, check layouts, verify rendered output, or see what a page looks like.',
        input_schema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'URL to screenshot. Defaults to http://localhost:3031 (the running app) if omitted.'
                },
                width: {
                    type: 'integer',
                    description: 'Viewport width in pixels (default: 1280)',
                    default: 1280
                },
                height: {
                    type: 'integer',
                    description: 'Viewport height in pixels (default: 800)',
                    default: 800
                },
                fullPage: {
                    type: 'boolean',
                    description: 'Capture the full scrollable page (default: false)',
                    default: false
                },
                selector: {
                    type: 'string',
                    description: 'CSS selector to screenshot a specific element (optional)'
                }
            },
            required: []
        }
    }, async (input) => {
        const result = await takeScreenshot(input || {});
        if (result.error) return { content: 'Screenshot failed: ' + result.error };

        // Return structured result — the base64 can be used by vision-capable models
        return {
            content: JSON.stringify({
                success: true,
                url: result.url,
                file: result.file,
                sizeKB: result.sizeKB,
                base64: result.base64,
                mimeType: result.mimeType
            })
        };
    });

    hub.log('📸 Screenshot module loaded (Chrome: ' + (findChrome() || 'NOT FOUND') + ')', 'success');
}

module.exports = { init };
