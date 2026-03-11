// ==================== WEB FETCH MODULE ====================
// Web search, page fetching, and image analysis

const https = require('https');
const zlib = require('zlib');

let HUB = null;
let CONFIG = null;

// Read response body with size limit
async function readResponseBody(response, maxBytes = 500000) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let bytesRead = 0;

        response.on('data', (chunk) => {
            chunks.push(chunk);
            bytesRead += chunk.length;
            if (bytesRead > maxBytes) {
                response.destroy();
                resolve(Buffer.concat(chunks).toString('utf-8').substring(0, maxBytes) + '\n[Truncated]');
            }
        });

        response.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf-8'));
        });

        response.on('error', reject);
    });
}

// Fetch webpage content
async function fetchWebpage(url) {
    // Validate HTTPS
    if (!url.startsWith('https://')) {
        return { success: false, error: 'Only HTTPS URLs are supported' };
    }

    return new Promise((resolve) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate'
            }
        }, async (response) => {
            // Handle redirects
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                const redirectUrl = response.headers.location;
                HUB?.log(`[Web] Redirecting to: ${redirectUrl}`, 'info');
                resolve(await fetchWebpage(redirectUrl));
                return;
            }

            if (response.statusCode !== 200) {
                resolve({ success: false, error: `HTTP ${response.statusCode}` });
                return;
            }

            // Handle encoding
            const encoding = response.headers['content-encoding'];
            let body;

            try {
                if (encoding === 'gzip') {
                    const gunzip = zlib.createGunzip();
                    const chunks = [];
                    response.pipe(gunzip);
                    gunzip.on('data', chunk => chunks.push(chunk));
                    gunzip.on('end', () => {
                        body = Buffer.concat(chunks).toString('utf-8');
                    });
                    await new Promise(r => gunzip.on('end', r));
                } else if (encoding === 'deflate') {
                    const inflate = zlib.createInflate();
                    const chunks = [];
                    response.pipe(inflate);
                    inflate.on('data', chunk => chunks.push(chunk));
                    inflate.on('end', () => {
                        body = Buffer.concat(chunks).toString('utf-8');
                    });
                    await new Promise(r => inflate.on('end', r));
                } else {
                    body = await readResponseBody(response);
                }
            } catch (err) {
                resolve({ success: false, error: `Decompression error: ${err.message}` });
                return;
            }

            // Extract text from HTML
            const text = extractTextFromHtml(body, url);
            
            resolve({
                success: true,
                content: text,
                url,
                length: text.length
            });
        });

        req.on('error', (err) => {
            resolve({ success: false, error: err.message });
        });

        req.setTimeout(30000, () => {
            req.destroy();
            resolve({ success: false, error: 'Request timeout' });
        });
    });
}

// Fetch via Jina Reader (for JavaScript-rendered pages)
async function fetchViaJina(url) {
    const jinaUrl = `https://r.jina.ai/${url}`;

    return new Promise((resolve) => {
        const req = https.get(jinaUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'text/plain'
            }
        }, async (response) => {
            if (response.statusCode !== 200) {
                resolve({ success: false, error: `Jina fetch failed: HTTP ${response.statusCode}` });
                return;
            }

            const body = await readResponseBody(response);
            
            resolve({
                success: true,
                content: body,
                url,
                via: 'jina'
            });
        });

        req.on('error', (err) => {
            resolve({ success: false, error: err.message });
        });
    });
}

// Save webpage to Obsidian vault
async function saveWebpageToVault(input) {
    const { url, filename, folder } = input;
    
    if (!url) {
        return { success: false, error: 'URL is required' };
    }

    // First try regular fetch
    let result = await fetchWebpage(url);
    
    // If minimal content, try Jina
    if (result.success && result.content.length < 500) {
        const jinaResult = await fetchViaJina(url);
        if (jinaResult.success) {
            result = jinaResult;
        }
    }

    if (!result.success) {
        return { success: false, error: result.error };
    }

    // Import the vault module
    let vaultModule;
    try {
        vaultModule = require('./obsidian-vault-module');
    } catch (e) {
        return { success: false, error: 'Obsidian vault module not available' };
    }

    // Generate filename if not provided
    const safeFilename = filename || url.split('/').pop() || 'webpage';
    const finalFilename = safeFilename.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 100);

    // Add YAML frontmatter
    const content = `---
source_url: ${url}
fetched_at: ${new Date().toISOString()}
---

${result.content}`;

    try {
        const vaultResult = await vaultModule.saveNote(content, finalFilename, folder);
        
        if (vaultResult.success) {
            return {
                success: true,
                message: `Saved to vault: ${vaultResult.path}`,
                path: vaultResult.path
            };
        } else {
            return vaultResult;
        }
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Strip HTML tags
function stripTags(html) {
    return html.replace(/<[^>]*>/g, '');
}

// Decode HTML entities
function decodeEntities(text) {
    const entities = {
        '&nbsp;': ' ',
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&apos;': "'",
        '&mdash;': '—',
        '&ndash;': '–',
        '&copy;': '©',
        '&reg;': '®',
        '&trade;': '™',
        '&hellip;': '...'
    };
    
    let result = text;
    for (const [entity, char] of Object.entries(entities)) {
        result = result.replace(new RegExp(entity, 'g'), char);
    }
    
    // Handle numeric entities
    result = result.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
    result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    
    return result;
}

// Convert inline HTML to Markdown
function inlineToMarkdown(html) {
    let text = html;
    
    // Headers
    text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n');
    text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n');
    text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n');
    text = text.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n');
    text = text.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '\n##### $1\n');
    text = text.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '\n###### $1\n');
    
    // Links
    text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
    
    // Bold and italic
    text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
    text = text.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
    text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
    text = text.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
    
    // Code
    text = text.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
    text = text.replace(/<pre[^>]*>(.*?)<\/pre>/gi, '\n```\n$1\n```\n');
    
    // Lists
    text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
    text = text.replace(/<ul[^>]*>|<\/ul>/gi, '');
    text = text.replace(/<ol[^>]*>|<\/ol>/gi, '');
    
    // Paragraphs and breaks
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n');
    
    return text;
}

// Extract text from HTML
function extractTextFromHtml(html, url) {
    // Remove script and style tags
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    
    // Remove HTML comments
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    
    // Convert to markdown
    text = inlineToMarkdown(text);
    
    // Strip remaining tags
    text = stripTags(text);
    
    // Decode entities
    text = decodeEntities(text);
    
    // Clean up whitespace
    text = text.replace(/[ \t]{2,}/g, ' ');
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.trim();
    
    // Extract title if available
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : null;
    
    return `# ${title || url}\nSource: ${url}\n\n${text}`;
}

// Web search using MCP service or fallback
async function webSearch(query) {
    // Try MCP service first
    const mcp = HUB?.getService('mcp');
    
    if (mcp && mcp.webSearch) {
        try {
            const result = await mcp.webSearch(query);
            return result;
        } catch (e) {
            HUB?.log(`[Web] MCP search failed: ${e.message}`, 'warn');
        }
    }
    
    // Fallback: use fetch via Jina for simple search results
    // This is a simplified fallback - proper web search would need an API key
    const searchUrl = `https://r.jina.ai/https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    try {
        const result = await fetchWebpage(searchUrl);
        
        if (result.success) {
            // Extract just the search result snippets
            const lines = result.content.split('\n').filter(line => 
                line.includes('result__') || line.includes('Result')
            ).slice(0, 10);
            
            return {
                success: true,
                results: lines.join('\n').substring(0, 2000),
                query
            };
        }
        
        return { success: false, error: 'Search failed' };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Understand/analyze image
async function understandImage(imagePath, prompt) {
    // Import minimax image module
    let imageModule;
    try {
        imageModule = require('./minimax-image-module');
    } catch (e) {
        return { success: false, error: 'Image analysis not available' };
    }
    
    try {
        const result = await imageModule.analyzeImage(imagePath, prompt || 'Describe this image in detail');
        
        if (result.success) {
            return {
                success: true,
                description: result.description
            };
        }
        
        return result;
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Initialize module
function init(hub) {
    HUB = hub;
    CONFIG = hub.getService('config');
}

module.exports = {
    init,
    fetchWebpage,
    fetchViaJina,
    saveWebpageToVault,
    webSearch,
    understandImage,
    stripTags,
    decodeEntities,
    inlineToMarkdown,
    extractTextFromHtml
};
