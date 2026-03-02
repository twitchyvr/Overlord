// ==================== MINIMAX FILES MODULE ====================
// File upload/management via MiniMax Files API
// Registers minimax_upload_file, minimax_list_files, minimax_delete_file tools

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

let hub = null;

// ==================== FILES API HELPERS ====================

function makeRequest(method, urlStr, headers = {}, body = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(urlStr);
        const proto = urlObj.protocol === 'https:' ? https : http;

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname + urlObj.search,
            method,
            headers
        };

        const req = proto.request(options, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString();
                if (res.statusCode >= 400) {
                    return reject(new Error(`API error ${res.statusCode}: ${text}`));
                }
                try {
                    resolve(JSON.parse(text));
                } catch (e) {
                    resolve(text);
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

function getBaseUrl() {
    const config = hub.getService('config');
    return (config.baseUrl || 'https://api.minimax.io/anthropic').replace('/anthropic', '').replace(/\/$/, '');
}

function getApiKey() {
    return hub.getService('config').apiKey;
}

// Upload a file using multipart/form-data
async function uploadFile(filePath, purpose = 'assistants') {
    const baseUrl = getBaseUrl();
    const apiKey = getApiKey();

    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    const fileContent = fs.readFileSync(filePath);
    const filename = path.basename(filePath);
    const boundary = `----FormBoundary${Date.now()}`;

    // Build multipart/form-data body manually
    const parts = [];

    // purpose field
    parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\n${purpose}`
    );

    // file field
    const mimeType = getMimeType(filename);
    parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    );

    const preamble = Buffer.from(parts.join('\r\n') + '\r\n');
    const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([preamble, fileContent, epilogue]);

    return new Promise((resolve, reject) => {
        const urlObj = new URL(`${baseUrl}/v1/files`);
        const proto = urlObj.protocol === 'https:' ? https : http;

        const options = {
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

        const req = proto.request(options, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString();
                if (res.statusCode >= 400) {
                    return reject(new Error(`Upload error ${res.statusCode}: ${text}`));
                }
                try {
                    resolve(JSON.parse(text));
                } catch (e) {
                    resolve(text);
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function listFiles(purpose = null) {
    const baseUrl = getBaseUrl();
    const apiKey = getApiKey();
    const qs = purpose ? `?purpose=${encodeURIComponent(purpose)}` : '';

    return makeRequest('GET', `${baseUrl}/v1/files${qs}`, {
        'Authorization': `Bearer ${apiKey}`
    });
}

async function getFile(fileId) {
    const baseUrl = getBaseUrl();
    const apiKey = getApiKey();

    return makeRequest('GET', `${baseUrl}/v1/files/${fileId}`, {
        'Authorization': `Bearer ${apiKey}`
    });
}

async function deleteFile(fileId) {
    const baseUrl = getBaseUrl();
    const apiKey = getApiKey();

    return makeRequest('DELETE', `${baseUrl}/v1/files/${fileId}`, {
        'Authorization': `Bearer ${apiKey}`
    });
}

function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const types = {
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.json': 'application/json',
        '.js': 'text/javascript',
        '.ts': 'text/typescript',
        '.py': 'text/x-python',
        '.html': 'text/html',
        '.css': 'text/css',
        '.csv': 'text/csv',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4'
    };
    return types[ext] || 'application/octet-stream';
}

// ==================== TOOL HANDLERS ====================

async function handleUploadFile(input) {
    const { file_path, purpose } = input;

    try {
        hub.broadcast('agent_activity', {
            type: 'tool_start',
            tool: 'minimax_upload_file',
            ts: Date.now(),
            inputSummary: `Uploading: ${path.basename(file_path)}`
        });

        const result = await uploadFile(file_path, purpose || 'assistants');

        hub.broadcast('agent_activity', {
            type: 'tool_complete',
            tool: 'minimax_upload_file',
            ts: Date.now(),
            success: true
        });

        hub.broadcast('file_uploaded', { fileId: result.id, filename: path.basename(file_path), purpose });

        return {
            success: true,
            file_id: result.id,
            filename: result.filename || path.basename(file_path),
            size: result.bytes,
            purpose: result.purpose,
            summary: `File uploaded successfully. File ID: ${result.id}`
        };
    } catch (err) {
        hub.log(`[Files] Upload error: ${err.message}`, 'error');
        hub.broadcast('agent_activity', { type: 'tool_error', tool: 'minimax_upload_file', ts: Date.now(), error: err.message });
        return { success: false, error: err.message };
    }
}

async function handleListFiles(input) {
    const { purpose } = input || {};

    try {
        const result = await listFiles(purpose);
        const files = result.data || result.files || [];

        hub.broadcast('files_list_updated', { files });

        return {
            success: true,
            count: files.length,
            files: files.map(f => ({
                id: f.id,
                filename: f.filename,
                size: f.bytes,
                purpose: f.purpose,
                created: f.created_at
            })),
            summary: `Found ${files.length} file(s).`
        };
    } catch (err) {
        hub.log(`[Files] List error: ${err.message}`, 'error');
        return { success: false, error: err.message };
    }
}

async function handleDeleteFile(input) {
    const { file_id } = input;

    try {
        await deleteFile(file_id);

        hub.broadcast('file_deleted', { fileId: file_id });

        return {
            success: true,
            file_id,
            summary: `File ${file_id} deleted successfully.`
        };
    } catch (err) {
        hub.log(`[Files] Delete error: ${err.message}`, 'error');
        return { success: false, error: err.message };
    }
}

// ==================== TOOL DEFINITIONS ====================

const UPLOAD_TOOL_DEF = {
    name: 'minimax_upload_file',
    description: 'Upload a local file to the MiniMax Files API. The file can then be referenced in future requests by its file ID. Supports PDF, text, code files, images, and more.',
    input_schema: {
        type: 'object',
        properties: {
            file_path: {
                type: 'string',
                description: 'Absolute or relative path to the local file to upload.'
            },
            purpose: {
                type: 'string',
                description: 'Purpose of the file: "assistants" (default) for use in conversations, "fine-tune" for training data.',
                enum: ['assistants', 'fine-tune']
            }
        },
        required: ['file_path']
    }
};

const LIST_TOOL_DEF = {
    name: 'minimax_list_files',
    description: 'List all files that have been uploaded to the MiniMax Files API.',
    input_schema: {
        type: 'object',
        properties: {
            purpose: {
                type: 'string',
                description: 'Filter by purpose: "assistants" or "fine-tune". Leave empty to list all files.'
            }
        }
    }
};

const DELETE_TOOL_DEF = {
    name: 'minimax_delete_file',
    description: 'Delete a file from the MiniMax Files API by its file ID.',
    input_schema: {
        type: 'object',
        properties: {
            file_id: {
                type: 'string',
                description: 'The ID of the file to delete.'
            }
        },
        required: ['file_id']
    }
};

// ==================== INIT ====================

async function init(h) {
    hub = h;

    function registerTools() {
        const tools = hub.getService('tools');
        if (tools && tools.registerTool) {
            tools.registerTool(UPLOAD_TOOL_DEF, handleUploadFile);
            tools.registerTool(LIST_TOOL_DEF, handleListFiles);
            tools.registerTool(DELETE_TOOL_DEF, handleDeleteFile);
            hub.log('[Files] minimax_upload_file, minimax_list_files, minimax_delete_file tools registered', 'success');
        }
    }

    const tools = hub.getService('tools');
    if (tools && tools.registerTool) {
        registerTools();
    } else {
        hub.on('tools_ready', registerTools);
    }

    hub.registerService('minimaxFiles', { uploadFile, listFiles, getFile, deleteFile });
    hub.log('📁 MiniMax Files module loaded', 'success');
}

module.exports = { init };
