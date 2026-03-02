// ==================== SKILLS MODULE ====================
// Claude Skills Integration - Provides specialized skills for different tasks
// Based on MiniAgent cookbook skill system
//
// Features:
// - Load skills from .overlord/skills/ directory
// - Each skill is a .md file with YAML frontmatter (name, description)
// - Skills can be activated to provide expert guidance
// - Progressive disclosure: list available skills, load full content on demand

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

let HUB = null;
let CONFIG = null;

// Default skills directory
const DEFAULT_SKILLS_DIR = '.overlord/skills';

// Loaded skills cache
let skillsCache = new Map();
let skillsLoaded = false;

// ==================== INITIALIZATION ====================

function init(hub) {
    HUB = hub;
    
    // Wait for config
    let attempts = 0;
    while (!HUB.getService('config') && attempts < 10) {
        new Promise(r => setTimeout(r, 100));
        attempts++;
    }
    
    CONFIG = HUB.getService('config') || {};
    
    // Register the skills service
    const service = {
        loadSkills: loadSkills,
        getSkill: getSkill,
        listSkills: listSkills,
        getSkillsPrompt: getSkillsPrompt,
        getSkillsMetadataPrompt: getSkillsMetadataPrompt,
        activateSkill: activateSkill,
        deactivateSkill: deactivateSkill,
        getActiveSkills: getActiveSkills,
        reloadSkills: reloadSkills
    };
    
    HUB.registerService('skills', service);
    
    // Auto-load skills on init
    loadSkills();
    
    HUB.log(`🎯 Skills module loaded (${skillsCache.size} skills)`, 'success');
}

// ==================== PATH HELPERS ====================

function getSkillsDir() {
    const baseDir = CONFIG?.baseDir || process.cwd();
    return path.join(baseDir, DEFAULT_SKILLS_DIR);
}

// ==================== SKILL LOADING ====================

/**
 * Load all skills from the skills directory
 */
function loadSkills() {
    const skillsDir = getSkillsDir();
    
    if (!fs.existsSync(skillsDir)) {
        // Create default skills directory with some example skills
        createDefaultSkills(skillsDir);
    }
    
    // Discover and load all .md files
    const skillFiles = discoverSkillFiles(skillsDir);
    
    skillsCache.clear();
    
    for (const file of skillFiles) {
        const skill = loadSkillFromFile(file);
        if (skill) {
            skillsCache.set(skill.name, skill);
        }
    }
    
    skillsLoaded = true;
    HUB?.log(`📂 Loaded ${skillsCache.size} skills from ${skillsDir}`, 'info');
    
    return skillsCache;
}

/**
 * Discover all skill files (SKILL.md or *.md) in directory
 */
function discoverSkillFiles(dir, files = []) {
    if (!fs.existsSync(dir)) return files;
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
            discoverSkillFiles(fullPath, files);
        } else if (entry.isFile() && (entry.name === 'SKILL.md' || entry.name.endsWith('.md'))) {
            files.push(fullPath);
        }
    }
    
    return files;
}

/**
 * Load a single skill from a markdown file
 * Supports YAML frontmatter for metadata
 */
function loadSkillFromFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const skillDir = path.dirname(filePath);
        
        // Parse YAML frontmatter if present
        let frontmatter = {};
        let body = content;
        
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        
        if (fmMatch) {
            try {
                frontmatter = parseYamlFrontmatter(fmMatch[1]);
                body = fmMatch[2].trim();
            } catch (e) {
                HUB?.log(`⚠️ Failed to parse frontmatter in ${filePath}: ${e.message}`, 'warn');
            }
        }
        
        // Required fields
        const name = frontmatter.name || path.basename(filePath, '.md');
        const description = frontmatter.description || 'No description provided';
        
        // Process body to handle relative paths
        const processedBody = processSkillPaths(body, skillDir);
        
        return {
            name: name,
            description: description,
            content: processedBody,
            license: frontmatter.license || null,
            allowedTools: frontmatter.allowedTools || frontmatter['allowed-tools'] || null,
            metadata: frontmatter.metadata || null,
            filePath: filePath,
            skillDir: skillDir
        };
        
    } catch (e) {
        HUB?.log(`❌ Failed to load skill from ${filePath}: ${e.message}`, 'error');
        return null;
    }
}

/**
 * YAML frontmatter parser — uses js-yaml for correct, standards-compliant parsing.
 * Handles: quoted strings, booleans, numbers, nested objects, lists, multi-line values.
 */
function parseYamlFrontmatter(frontmatterText) {
    try {
        const parsed = yaml.load(frontmatterText);
        if (!parsed || typeof parsed !== 'object') return {};
        // Normalize allowed-tools / allowed_tools → allowedTools
        if (!parsed.allowedTools) {
            parsed.allowedTools = parsed['allowed-tools'] || parsed['allowed_tools'] || null;
        }
        return parsed;
    } catch (e) {
        HUB?.log(`⚠️ YAML parse error in skill frontmatter: ${e.message}`, 'warn');
        return {};
    }
}

/**
 * Process skill content to replace relative paths with absolute paths
 * This ensures scripts and resources can be found from any working directory
 */
function processSkillPaths(content, skillDir) {
    let processed = content;
    
    // Pattern 1: Directory-based paths (scripts/, references/, assets/)
    processed = processed.replace(
        /(python\s+|`)((?:scripts|references|assets)\/[^\s`\)]+)/g,
        (match, prefix, relPath) => {
            const absPath = path.join(skillDir, relPath);
            return fs.existsSync(absPath) ? `${prefix}${absPath}` : match;
        }
    );
    
    // Pattern 2: Markdown links - convert to absolute paths
    processed = processed.replace(
        /\[([^\]]+)\]\(([^)]+\.(?:md|txt|json|yaml|js|py|html))\)/g,
        (match, linkText, relPath) => {
            // Remove leading ./
            const cleanPath = relPath.startsWith('./') ? relPath.slice(2) : relPath;
            const absPath = path.join(skillDir, cleanPath);
            
            if (fs.existsSync(absPath)) {
                return `[${linkText}](\`${absPath}\`)`;
            }
            return match;
        }
    );
    
    return processed;
}

/**
 * Create default skills directory with example skills
 */
function createDefaultSkills(skillsDir) {
    try {
        fs.mkdirSync(skillsDir, { recursive: true });
        
        // Create example skill
        const exampleSkill = `---
name: example-skill
description: Example skill demonstrating the skill format
---

# Example Skill

This is an example skill that demonstrates how to create skills for Overlord.

## Usage

Use the \`skill-\${name}\` tool to activate this skill and get specialized guidance.

## Example Commands

- Read files in the skill directory
- Execute scripts with python
`;
        
        fs.writeFileSync(path.join(skillsDir, 'example.md'), exampleSkill);
        
        HUB?.log(`📁 Created default skills directory: ${skillsDir}`, 'info');
    } catch (e) {
        HUB?.log(`⚠️ Could not create skills directory: ${e.message}`, 'warn');
    }
}

// ==================== PUBLIC API ====================

/**
 * Get a specific skill by name
 */
function getSkill(name) {
    if (!skillsLoaded) loadSkills();
    return skillsCache.get(name) || null;
}

/**
 * List all available skill names
 */
function listSkills() {
    if (!skillsLoaded) loadSkills();
    return Array.from(skillsCache.keys());
}

/**
 * Get full prompt for all skills (includes full content)
 * Warning: This can be large - use sparingly
 */
function getSkillsPrompt() {
    if (!skillsLoaded) loadSkills();
    
    if (skillsCache.size === 0) {
        return '';
    }
    
    const parts = ['## 🎯 Available Skills\n'];
    parts.push('You have access to specialized skills. Each skill provides expert guidance for specific tasks.\n');
    
    for (const skill of skillsCache.values()) {
        parts.push(`\n### Skill: ${skill.name}\n`);
        parts.push(`*${skill.description}*\n`);
        parts.push(`\n${skill.content}\n`);
    }
    
    return parts.join('\n');
}

/**
 * Get metadata-only prompt (name + description only)
 * This implements Progressive Disclosure - Level 1
 */
function getSkillsMetadataPrompt() {
    if (!skillsLoaded) loadSkills();
    
    if (skillsCache.size === 0) {
        return '';
    }
    
    const parts = ['## 🎯 Available Skills\n'];
    parts.push('You have access to specialized skills. Each skill provides expert guidance for specific tasks.\n');
    parts.push('Load a skill\'s full content using the skill activation tool when needed.\n');
    
    for (const skill of skillsCache.values()) {
        parts.push(`- \`${skill.name}\`: ${skill.description}`);
    }
    
    return parts.join('\n');
}

// Active skills set (skill names currently activated)
const activeSkills = new Set();

/**
 * Activate a skill (add to current context)
 */
function activateSkill(name) {
    const skill = getSkill(name);
    if (!skill) {
        return { 
            success: false, 
            content: `Skill "${name}" not found. Available: ${listSkills().join(', ')}` 
        };
    }
    
    activeSkills.add(name);
    HUB?.log(`🎯 Activated skill: ${name}`, 'info');
    
    return {
        success: true,
        content: `Skill "${name}" activated.\n\n${skill.content}`
    };
}

/**
 * Deactivate a skill
 */
function deactivateSkill(name) {
    if (!activeSkills.has(name)) {
        return { 
            success: false, 
            content: `Skill "${name}" is not currently active` 
        };
    }
    
    activeSkills.delete(name);
    HUB?.log(`🎯 Deactivated skill: ${name}`, 'info');
    
    return {
        success: true,
        content: `Skill "${name}" deactivated`
    };
}

/**
 * Get list of currently active skills
 */
function getActiveSkills() {
    return Array.from(activeSkills);
}

/**
 * Reload all skills from disk
 */
function reloadSkills() {
    skillsLoaded = false;
    activeSkills.clear();
    return loadSkills();
}

// ==================== TOOL REGISTRATION ====================

function getToolDefinitions() {
    return [
        {
            name: 'list_skills',
            description: 'List all available skills. Use this to see what specialized skills are available.',
            input_schema: {
                type: 'object',
                properties: {},
                required: []
            }
        },
        {
            name: 'get_skill',
            description: 'Get detailed information about a specific skill including its full content and capabilities.',
            input_schema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Name of the skill to retrieve'
                    }
                },
                required: ['name']
            }
        },
        {
            name: 'activate_skill',
            description: 'Activate a skill to add its specialized guidance to the current context. Use list_skills first to see available skills.',
            input_schema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Name of the skill to activate'
                    }
                },
                required: ['name']
            }
        },
        {
            name: 'deactivate_skill',
            description: 'Deactivate a previously activated skill.',
            input_schema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Name of the skill to deactivate'
                    }
                },
                required: ['name']
            }
        }
    ];
}

function executeSkillTool(toolName, input) {
    switch (toolName) {
        case 'list_skills':
            return { 
                success: true, 
                content: 'Available skills:\n' + listSkills().map(s => `- ${s}`).join('\n') 
            };
        case 'get_skill': {
            const skill = getSkill(input.name);
            if (!skill) {
                return { 
                    success: false, 
                    content: `Skill "${input.name}" not found. Use list_skills to see available skills.` 
                };
            }
            return {
                success: true,
                content: `# Skill: ${skill.name}\n\n${skill.description}\n\n---\n\n${skill.content}`
            };
        }
        case 'activate_skill':
            return activateSkill(input.name);
        case 'deactivate_skill':
            return deactivateSkill(input.name);
        default:
            return { success: false, content: 'Unknown skill tool: ' + toolName };
    }
}

// Export
module.exports = { 
    init, 
    getToolDefinitions, 
    executeSkillTool,
    loadSkills,
    getSkill,
    listSkills,
    getSkillsPrompt,
    getSkillsMetadataPrompt,
    activateSkill,
    deactivateSkill,
    getActiveSkills,
    reloadSkills
};
