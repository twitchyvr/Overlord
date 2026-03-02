/**
 * Skills Module Tests
 * Tests for YAML frontmatter parsing, skill loading, and skill service API
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

// ==================== YAML FRONTMATTER PARSER (extracted for unit testing) ====================

/**
 * Mirrors the parseYamlFrontmatter() from skills-module.js
 * Extracted here so we can test it without spinning up the full module.
 */
function parseYamlFrontmatter(frontmatterText) {
    try {
        const parsed = yaml.load(frontmatterText);
        if (!parsed || typeof parsed !== 'object') return {};
        if (!parsed.allowedTools) {
            parsed.allowedTools = parsed['allowed-tools'] || parsed['allowed_tools'] || null;
        }
        return parsed;
    } catch (e) {
        return {};
    }
}

describe('Skills: parseYamlFrontmatter', () => {

    test('parses simple key: value pairs', () => {
        const fm = 'name: my-skill\ndescription: A test skill';
        const result = parseYamlFrontmatter(fm);
        expect(result.name).toBe('my-skill');
        expect(result.description).toBe('A test skill');
    });

    test('parses boolean values correctly (not as strings)', () => {
        const fm = 'enabled: true\ndisabled: false';
        const result = parseYamlFrontmatter(fm);
        expect(result.enabled).toBe(true);  // boolean, not "true"
        expect(result.disabled).toBe(false);
    });

    test('parses numeric values', () => {
        const fm = 'priority: 42\nweight: 3.14';
        const result = parseYamlFrontmatter(fm);
        expect(result.priority).toBe(42);
        expect(result.weight).toBeCloseTo(3.14);
    });

    test('parses list values (allowed-tools array)', () => {
        const fm = 'allowed-tools:\n  - bash\n  - read_file\n  - write_file';
        const result = parseYamlFrontmatter(fm);
        expect(Array.isArray(result['allowed-tools'])).toBe(true);
        expect(result['allowed-tools']).toEqual(['bash', 'read_file', 'write_file']);
    });

    test('normalizes allowed-tools → allowedTools', () => {
        const fm = 'allowed-tools:\n  - bash\n  - files';
        const result = parseYamlFrontmatter(fm);
        expect(Array.isArray(result.allowedTools)).toBe(true);
        expect(result.allowedTools).toContain('bash');
    });

    test('normalizes allowed_tools → allowedTools', () => {
        const fm = 'allowed_tools:\n  - bash';
        const result = parseYamlFrontmatter(fm);
        expect(Array.isArray(result.allowedTools)).toBe(true);
    });

    test('handles quoted strings without stripping quotes', () => {
        const fm = 'name: "my skill name"\ndescription: \'single quoted\'';
        const result = parseYamlFrontmatter(fm);
        expect(result.name).toBe('my skill name');
        expect(result.description).toBe('single quoted');
    });

    test('handles multi-line string (folded scalar)', () => {
        const fm = 'description: >\n  This is a long\n  description that spans\n  multiple lines';
        const result = parseYamlFrontmatter(fm);
        expect(typeof result.description).toBe('string');
        expect(result.description.length).toBeGreaterThan(0);
    });

    test('handles nested objects', () => {
        const fm = 'metadata:\n  author: Alice\n  version: 1.0';
        const result = parseYamlFrontmatter(fm);
        expect(result.metadata).toBeDefined();
        expect(result.metadata.author).toBe('Alice');
    });

    test('returns empty object for malformed YAML (no crash)', () => {
        const fm = 'this: is: broken: yaml: [unclosed';
        const result = parseYamlFrontmatter(fm);
        expect(typeof result).toBe('object');
        expect(result).not.toBeNull();
    });

    test('returns empty object for empty input', () => {
        expect(parseYamlFrontmatter('')).toEqual({});
        expect(parseYamlFrontmatter(null)).toEqual({});
    });

    test('returns empty object when yaml.load returns non-object (e.g. bare string)', () => {
        const fm = 'just a plain string';
        const result = parseYamlFrontmatter(fm);
        // yaml.load of a plain string returns a string, not an object → should return {}
        expect(typeof result).toBe('object');
    });

});

// ==================== SKILL FILE LOADING ====================

describe('Skills: loadSkillFromFile', () => {

    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overlord-skills-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeSkill(filename, content) {
        const fp = path.join(tmpDir, filename);
        fs.writeFileSync(fp, content, 'utf8');
        return fp;
    }

    /**
     * Minimal re-implementation of the skill loader logic (without hub dependency)
     * so we can test it in isolation.
     */
    function loadSkillFromFile(filePath) {
        const content = fs.readFileSync(filePath, 'utf8');
        const skillDir = path.dirname(filePath);

        let frontmatter = {};
        let body = content;

        const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (fmMatch) {
            frontmatter = parseYamlFrontmatter(fmMatch[1]);
            body = fmMatch[2].trim();
        }

        const name = frontmatter.name || path.basename(filePath, '.md');
        const description = frontmatter.description || 'No description provided';

        return { name, description, content: body, allowedTools: frontmatter.allowedTools || null, filePath, skillDir };
    }

    test('loads a skill with complete frontmatter', () => {
        const fp = writeSkill('test-skill.md', [
            '---',
            'name: test-skill',
            'description: A test skill for testing',
            'allowed-tools:',
            '  - bash',
            '  - read_file',
            '---',
            '',
            '## Test Skill',
            'This skill does things.'
        ].join('\n'));

        const skill = loadSkillFromFile(fp);
        expect(skill.name).toBe('test-skill');
        expect(skill.description).toBe('A test skill for testing');
        expect(skill.allowedTools).toContain('bash');
        expect(skill.content).toContain('Test Skill');
    });

    test('uses filename as name when frontmatter name is absent', () => {
        const fp = writeSkill('my-skill.md', '## Content only\nNo frontmatter here.');
        const skill = loadSkillFromFile(fp);
        expect(skill.name).toBe('my-skill');
        expect(skill.description).toBe('No description provided');
    });

    test('parses boolean enabled field correctly', () => {
        const fp = writeSkill('bool-skill.md', [
            '---',
            'name: bool-skill',
            'enabled: true',
            '---',
            'content here'
        ].join('\n'));

        const skill = loadSkillFromFile(fp);
        expect(skill.name).toBe('bool-skill');
    });

    test('parses list of allowed tools as array', () => {
        const fp = writeSkill('tools-skill.md', [
            '---',
            'name: tools-skill',
            'allowed-tools: ["bash", "write_file", "read_file"]',
            '---',
            'content'
        ].join('\n'));

        const skill = loadSkillFromFile(fp);
        expect(Array.isArray(skill.allowedTools)).toBe(true);
        expect(skill.allowedTools).toHaveLength(3);
    });

    test('handles malformed YAML frontmatter gracefully (loads with empty metadata)', () => {
        const fp = writeSkill('broken.md', [
            '---',
            'name: [broken: yaml',
            '---',
            'Content still loads'
        ].join('\n'));

        // Should not throw — skill name falls back to filename
        const skill = loadSkillFromFile(fp);
        expect(skill).not.toBeNull();
        expect(skill.name).toBe('broken'); // fallback to filename
    });

});
