// ==================== TOOL PARSER MODULE ====================
// Tool definition extraction and tool call parsing

let hub = null;
let config = null;

// Extract tool definitions in a format suitable for the system prompt
function extractToolDefinitions(toolDefs) {
    if (!toolDefs || !Array.isArray(toolDefs)) {
        return '';
    }
    
    let result = '\n## AVAILABLE TOOLS\n\n';
    
    toolDefs.forEach(tool => {
        result += `### ${tool.name} (${tool.category || 'general'})\n`;
        result += `${tool.description}\n`;
        
        if (tool.input_schema && tool.input_schema.properties) {
            result += '\nParameters:\n';
            Object.entries(tool.input_schema.properties).forEach(([key, prop]) => {
                const required = tool.input_schema.required?.includes(key) ? ' (required)' : '';
                const enumValues = prop.enum ? ` (${prop.enum.join(', ')})` : '';
                result += `- \`${key}\`${required}: ${prop.description || ''}${enumValues}\n`;
            });
        }
        
        result += '\n';
    });
    
    return result;
}

// Parse tool calls from AI response
function parseToolCalls(response) {
    if (!response) {
        return [];
    }
    
    // Handle array of tool calls
    if (Array.isArray(response.tool_calls)) {
        return response.tool_calls.map(tc => normalizeToolCall(tc));
    }
    
    // Handle object with tool_calls
    if (response.tool_calls) {
        return response.tool_calls.map(tc => normalizeToolCall(tc));
    }
    
    // Handle content as text that might contain tool calls
    if (typeof response.content === 'string') {
        return parseToolCallsFromText(response.content);
    }
    
    return [];
}

// Normalize tool call format
function normalizeToolCall(tc) {
    // Already in correct format
    if (tc.function) {
        return {
            id: tc.id || 'tool_' + Date.now(),
            type: 'function',
            function: {
                name: tc.function.name,
                arguments: typeof tc.function.arguments === 'string' 
                    ? tc.function.arguments 
                    : JSON.stringify(tc.function.arguments)
            }
        };
    }
    
    // tool_use format
    if (tc.name && tc.input) {
        return {
            id: tc.id || 'tool_' + Date.now(),
            type: 'function',
            function: {
                name: tc.name,
                arguments: typeof tc.input === 'string'
                    ? tc.input
                    : JSON.stringify(tc.input)
            }
        };
    }
    
    return tc;
}

// Parse tool calls from text content
function parseToolCallsFromText(text) {
    const toolCalls = [];
    
    // Try to find JSON blocks
    const jsonMatches = text.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
    
    if (jsonMatches) {
        for (const match of jsonMatches) {
            try {
                const parsed = JSON.parse(match);
                if (parsed.tool_calls) {
                    toolCalls.push(...parsed.tool_calls);
                } else if (parsed.name && parsed.input) {
                    toolCalls.push({
                        id: 'tool_' + Date.now(),
                        type: 'function',
                        function: {
                            name: parsed.name,
                            arguments: JSON.stringify(parsed.input)
                        }
                    });
                }
            } catch (e) {
                // Not valid JSON, skip
            }
        }
    }
    
    return toolCalls;
}

// Map tool results to message format
function mapToolResults(toolResults, messages) {
    if (!toolResults || !Array.isArray(toolResults)) {
        return messages;
    }
    
    const lastMessage = messages[messages.length - 1];
    
    // Add tool results as content blocks
    const toolResultBlocks = toolResults.map(result => {
        return {
            type: 'tool_result',
            tool_use_id: result.tool_call_id || result.id,
            content: typeof result.content === 'string' 
                ? result.content 
                : JSON.stringify(result.content)
        };
    });
    
    if (lastMessage && lastMessage.role === 'user') {
        // Append to existing user message
        if (Array.isArray(lastMessage.content)) {
            lastMessage.content.push(...toolResultBlocks);
        } else {
            lastMessage.content = [
                { type: 'text', text: lastMessage.content },
                ...toolResultBlocks
            ];
        }
    } else {
        // Add new user message with tool results
        messages.push({
            role: 'user',
            content: toolResultBlocks
        });
    }
    
    return messages;
}

// Extract tool calls from streaming response
function extractToolCallsFromStream(events) {
    const toolCalls = [];
    let currentTool = null;
    
    for (const event of events) {
        if (event.type === 'content_block_start') {
            const block = event.content_block;
            if (block && block.type === 'tool_use') {
                currentTool = {
                    id: block.id,
                    type: 'function',
                    function: {
                        name: block.name,
                        arguments: ''
                    }
                };
            }
        } else if (event.type === 'content_block_delta') {
            const delta = event.delta;
            if (delta && currentTool) {
                if (delta.type === 'input_json_delta') {
                    currentTool.function.arguments += delta.partial_json || '';
                }
            }
        } else if (event.type === 'content_block_stop') {
            if (currentTool) {
                // Parse arguments as JSON
                try {
                    currentTool.function.arguments = JSON.parse(currentTool.function.arguments);
                } catch (e) {
                    // Keep as string if parsing fails
                }
                toolCalls.push(currentTool);
                currentTool = null;
            }
        }
    }
    
    return toolCalls;
}

// Format tool result for display
function formatToolResult(result) {
    if (typeof result === 'string') {
        return result;
    }
    
    if (result.error) {
        return `Error: ${result.error}`;
    }
    
    if (result.content) {
        return result.content;
    }
    
    return JSON.stringify(result, null, 2);
}

// Initialize module
function init(h, cfg) {
    hub = h;
    config = cfg;
}

module.exports = {
    init,
    extractToolDefinitions,
    parseToolCalls,
    normalizeToolCall,
    parseToolCallsFromText,
    mapToolResults,
    extractToolCallsFromStream,
    formatToolResult
};
