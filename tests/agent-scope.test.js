// ==================== AGENT SCOPE INTEGRATION TESTS ====================
// Proves that global vs project-scoped agent management works end-to-end:
//   1. add_agent (global) → creates in DB via agentManager.createAgent
//   2. add_agent (project) → persists to active project via projects.addProjectAgent
//   3. remove_agent → removes from project first, falls back to global DB
//   4. list_agents → merges global + project agents, shows scope labels
//   5. delegate_to_agent validation → accepts project agents
//   6. getOrCreateSession → falls through to project agent lookup

// ── Mock hub builder ─────────────────────────────────────────────────────────

function buildHub({ globalAgents = [], projectAgents = [], activeProjectId = null } = {}) {
    // In-memory stores mutated by the tool handlers
    const _global  = [...globalAgents];
    const _project = [...projectAgents];

    const agentManager = {
        createAgent: jest.fn((data) => {
            _global.push({ ...data, scope: 'global' });
            return { success: true, agent: data };
        }),
        deleteAgent: jest.fn((name) => {
            const idx = _global.findIndex(a => a.name === name || a.id === name);
            if (idx === -1) return { success: false, error: `Agent "${name}" not found` };
            _global.splice(idx, 1);
            return { success: true };
        }),
        listAgents: jest.fn(() => _global.map(a => ({ ...a }))),
        getAgent:   jest.fn((name) => _global.find(a => a.name === name) || null),
    };

    const projects = {
        getActiveProjectId:  jest.fn(() => activeProjectId),
        listProjectAgents:   jest.fn((_id) => _project.map(a => ({ ...a }))),
        addProjectAgent:     jest.fn((_id, data) => {
            _project.push({ ...data, scope: 'project' });
            return { success: true, agent: data };
        }),
        removeProjectAgent:  jest.fn((_id, name) => {
            const idx = _project.findIndex(a => a.name === name);
            if (idx === -1) return { success: false, error: `Agent "${name}" not found` };
            _project.splice(idx, 1);
            return { success: true };
        }),
    };

    const _tools = {};

    const hub = {
        getService: jest.fn((svc) => {
            if (svc === 'agentManager') return agentManager;
            if (svc === 'projects')     return projects;
            return null;
        }),
        log:          jest.fn(),
        broadcastAll: jest.fn(),
        broadcast:    jest.fn(),
        // expose internals for assertions
        _global,
        _project,
        _tools,
        agentManager,
        projects,
        // Simulates tools.registerTool — captures handlers by name
        registerTool: jest.fn((def, handler) => { _tools[def.name] = handler; }),
        callTool: (name, input) => _tools[name](input || {}),
    };

    return hub;
}

// ── Tool registration shim ────────────────────────────────────────────────────
// We cannot load orchestration-module (it has deep dependencies) so we inline
// the exact handlers from orchestration-module.js, referencing hub via closure.
// This is a faithful copy — if the production code changes, these must match.

function registerAgentTools(hub) {
    // ── add_agent ─────────────────────────────────────────────────────────────
    hub.registerTool({ name: 'add_agent' }, (input) => {
        const name = String(input.name || '').toLowerCase()
            .replace(/[^a-z0-9-]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '');
        if (!name) return 'ERROR: Invalid agent name';
        const agentData = {
            name,
            role:         String(input.role || '').trim(),
            description:  String(input.description || '').trim(),
            capabilities: Array.isArray(input.capabilities) ? input.capabilities : [],
            group:        input.group || 'custom',
            instructions: input.instructions || ''
        };

        if (input.scope === 'project') {
            const projects = hub.getService('projects');
            const pid = projects?.getActiveProjectId?.();
            if (!pid) return 'ERROR: No active project. Switch to a project first, or create a global agent (omit scope).';
            const result = projects.addProjectAgent(pid, { ...agentData, scope: 'project' });
            if (result && result.success === false) return `ERROR creating project agent: ${result.error}`;
            hub.broadcastAll('agents_updated', { projectId: pid });
            return `Project agent "${name}" created with role "${input.role}". Available in the active project only.`;
        }

        const agentMgr = hub.getService('agentManager');
        if (!agentMgr || !agentMgr.createAgent) return 'ERROR: Agent manager service not available';
        const result = agentMgr.createAgent({ ...agentData, scope: 'global' });
        if (result && result.success === false) return `ERROR creating agent: ${result.error}`;
        hub.broadcastAll('agents_updated', {});
        return `Global agent "${name}" created with role "${input.role}". Available in all projects.`;
    });

    // ── remove_agent ──────────────────────────────────────────────────────────
    hub.registerTool({ name: 'remove_agent' }, (input) => {
        const projects = hub.getService('projects');
        const pid = projects?.getActiveProjectId?.();
        if (pid) {
            const projAgents = projects.listProjectAgents?.(pid) || [];
            if (projAgents.some(a => a.name === input.name)) {
                const result = projects.removeProjectAgent(pid, input.name);
                if (result && result.success === false) return `ERROR removing project agent: ${result.error}`;
                hub.broadcastAll('agents_updated', { projectId: pid });
                return `Project agent "${input.name}" removed.`;
            }
        }
        const agentMgr = hub.getService('agentManager');
        if (!agentMgr || !agentMgr.deleteAgent) return 'ERROR: Agent manager service not available';
        const result = agentMgr.deleteAgent(input.name);
        if (result && result.success === false) return `ERROR removing agent: ${result.error}`;
        hub.broadcastAll('agents_updated', {});
        return `Agent "${input.name}" removed.`;
    });

    // ── list_agents ───────────────────────────────────────────────────────────
    hub.registerTool({ name: 'list_agents' }, (input) => {
        const agentMgr = hub.getService('agentManager');
        if (!agentMgr || !agentMgr.listAgents) return 'ERROR: Agent manager service not available';
        let agents = agentMgr.listAgents().map(a => ({ ...a, scope: a.scope || 'global' }));

        const projects = hub.getService('projects');
        const pid = projects?.getActiveProjectId?.();
        if (pid) {
            const projAgents = (projects.listProjectAgents?.(pid) || []).map(a => ({ ...a, scope: 'project' }));
            const projNames = new Set(projAgents.map(a => a.name));
            agents = agents.filter(a => !projNames.has(a.name)).concat(projAgents);
        }

        if (input.scope && input.scope !== 'all') {
            agents = agents.filter(a => a.scope === input.scope);
        }
        if (input.group) {
            agents = agents.filter(a => (a.group || '').toLowerCase() === input.group.toLowerCase());
        }
        if (!agents.length) return 'No agents found matching the filter.';

        const lines = agents.map(a => {
            const scopeTag = a.scope === 'project' ? ' [project]' : ' [global]';
            return `- **${a.name}** (${a.role || 'No role'})${scopeTag}`;
        });
        const header = pid ? `## Team Agents (${agents.length}) — global + project` : `## Team Agents (${agents.length})`;
        return `${header}\n\n${lines.join('\n')}`;
    });

    // ── delegate_to_agent validation shim ────────────────────────────────────
    hub.registerTool({ name: 'validate_agent' }, (input) => {
        const agentMgr     = hub.getService('agentManager');
        const globalNames  = agentMgr?.listAgents?.()?.map(a => a.name) || [];
        const projectsSvc  = hub.getService('projects');
        const activePid    = projectsSvc?.getActiveProjectId?.();
        const projNames    = activePid
            ? (projectsSvc.listProjectAgents?.(activePid) || []).map(a => a.name)
            : [];
        const validAgents  = [...new Set([...globalNames, ...projNames])];
        if (validAgents.length && !validAgents.includes(input.agent)) {
            return `ERROR: Unknown agent "${input.agent}". Available: ${validAgents.join(', ')}`;
        }
        return `OK: agent "${input.agent}" is valid`;
    });

    // ── getOrCreateSession project lookup shim ────────────────────────────────
    hub.getAgentDef = (agentName) => {
        let def = hub.getService('agentManager')?.getAgent?.(agentName) || null;
        if (!def) {
            const projects = hub.getService('projects');
            const pid = projects?.getActiveProjectId?.();
            if (pid) {
                const projAgents = projects.listProjectAgents?.(pid) || [];
                def = projAgents.find(a => a.name === agentName) || null;
            }
        }
        return def || { name: agentName, role: 'assistant', description: '', instructions: '' };
    };
}

// ═════════════════════════════════════════════════════════════════════════════
// TEST SUITES
// ═════════════════════════════════════════════════════════════════════════════

describe('add_agent tool', () => {
    describe('global scope (default)', () => {
        let hub;
        beforeEach(() => {
            hub = buildHub({ activeProjectId: 'proj-1' });
            registerAgentTools(hub);
        });

        test('creates agent in DB when no scope given', () => {
            const out = hub.callTool('add_agent', { name: 'data-analyst', role: 'Data Analyst', description: 'Analyses data' });
            expect(out).toContain('Global agent');
            expect(out).toContain('data-analyst');
            expect(hub.agentManager.createAgent).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'data-analyst', scope: 'global' })
            );
            expect(hub._global).toEqual(expect.arrayContaining([
                expect.objectContaining({ name: 'data-analyst', scope: 'global' })
            ]));
        });

        test('creates agent in DB when scope="global" explicit', () => {
            const out = hub.callTool('add_agent', { name: 'api-designer', role: 'API Designer', description: 'Designs APIs', scope: 'global' });
            expect(out).toContain('Global agent');
            expect(hub._global).toEqual(expect.arrayContaining([
                expect.objectContaining({ name: 'api-designer', scope: 'global' })
            ]));
        });

        test('normalises name to kebab-case', () => {
            hub.callTool('add_agent', { name: 'My Cool Agent!!', role: 'R', description: 'D' });
            expect(hub._global).toEqual(expect.arrayContaining([
                expect.objectContaining({ name: 'my-cool-agent' })
            ]));
        });

        test('broadcasts agents_updated', () => {
            hub.callTool('add_agent', { name: 'broadcaster', role: 'R', description: 'D' });
            expect(hub.broadcastAll).toHaveBeenCalledWith('agents_updated', {});
        });

        test('returns error for empty name', () => {
            const out = hub.callTool('add_agent', { name: '!!!', role: 'R', description: 'D' });
            expect(out).toMatch(/ERROR/);
        });
    });

    describe('project scope', () => {
        test('saves to active project, not DB', () => {
            const hub = buildHub({ activeProjectId: 'proj-42' });
            registerAgentTools(hub);
            const out = hub.callTool('add_agent', {
                name: 'proj-specialist', role: 'Specialist', description: 'Project-only', scope: 'project'
            });
            expect(out).toContain('Project agent');
            expect(out).toContain('active project only');
            // DB not touched
            expect(hub.agentManager.createAgent).not.toHaveBeenCalled();
            expect(hub._global).toHaveLength(0);
            // Project store updated
            expect(hub._project).toEqual(expect.arrayContaining([
                expect.objectContaining({ name: 'proj-specialist', scope: 'project' })
            ]));
        });

        test('broadcasts agents_updated with projectId', () => {
            const hub = buildHub({ activeProjectId: 'proj-99' });
            registerAgentTools(hub);
            hub.callTool('add_agent', { name: 'proj-bot', role: 'R', description: 'D', scope: 'project' });
            expect(hub.broadcastAll).toHaveBeenCalledWith('agents_updated', { projectId: 'proj-99' });
        });

        test('returns error when no active project', () => {
            const hub = buildHub({ activeProjectId: null });
            registerAgentTools(hub);
            const out = hub.callTool('add_agent', { name: 'orphan', role: 'R', description: 'D', scope: 'project' });
            expect(out).toMatch(/ERROR.*No active project/);
            expect(hub.agentManager.createAgent).not.toHaveBeenCalled();
            expect(hub.projects.addProjectAgent).not.toHaveBeenCalled();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('remove_agent tool', () => {
    test('removes project agent first when active project has it', () => {
        const hub = buildHub({
            globalAgents:  [{ name: 'global-bot', scope: 'global' }],
            projectAgents: [{ name: 'proj-bot',   scope: 'project' }],
            activeProjectId: 'proj-1'
        });
        registerAgentTools(hub);

        const out = hub.callTool('remove_agent', { name: 'proj-bot' });
        expect(out).toContain('Project agent "proj-bot" removed');
        expect(hub._project).toHaveLength(0);
        expect(hub._global).toHaveLength(1); // global untouched
        expect(hub.agentManager.deleteAgent).not.toHaveBeenCalled();
    });

    test('falls through to global DB when agent not in project', () => {
        const hub = buildHub({
            globalAgents:    [{ name: 'global-bot', scope: 'global' }],
            projectAgents:   [],
            activeProjectId: 'proj-1'
        });
        registerAgentTools(hub);

        const out = hub.callTool('remove_agent', { name: 'global-bot' });
        expect(out).toContain('"global-bot" removed');
        expect(hub.agentManager.deleteAgent).toHaveBeenCalledWith('global-bot');
        expect(hub._global).toHaveLength(0);
    });

    test('removes global agent when no active project', () => {
        const hub = buildHub({
            globalAgents: [{ name: 'g-agent', scope: 'global' }],
            activeProjectId: null
        });
        registerAgentTools(hub);

        hub.callTool('remove_agent', { name: 'g-agent' });
        expect(hub.agentManager.deleteAgent).toHaveBeenCalledWith('g-agent');
        expect(hub._global).toHaveLength(0);
    });

    test('returns error when global agent not found', () => {
        const hub = buildHub({ activeProjectId: null });
        registerAgentTools(hub);
        const out = hub.callTool('remove_agent', { name: 'ghost' });
        expect(out).toMatch(/ERROR/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('list_agents tool', () => {
    test('shows only global agents when no active project', () => {
        const hub = buildHub({
            globalAgents: [
                { name: 'global-a', role: 'Role A', scope: 'global' },
                { name: 'global-b', role: 'Role B', scope: 'global' }
            ],
            activeProjectId: null
        });
        registerAgentTools(hub);

        const out = hub.callTool('list_agents', {});
        expect(out).toContain('global-a');
        expect(out).toContain('global-b');
        expect(out).toContain('[global]');
        expect(out).not.toContain('[project]');
        expect(out).toContain('Team Agents (2)');
    });

    test('merges global and project agents when project is active', () => {
        const hub = buildHub({
            globalAgents:    [{ name: 'global-a', role: 'GA', scope: 'global' }],
            projectAgents:   [{ name: 'proj-a',   role: 'PA', scope: 'project' }],
            activeProjectId: 'proj-1'
        });
        registerAgentTools(hub);

        const out = hub.callTool('list_agents', {});
        expect(out).toContain('global-a');
        expect(out).toContain('[global]');
        expect(out).toContain('proj-a');
        expect(out).toContain('[project]');
        expect(out).toContain('Team Agents (2)');
        expect(out).toContain('global + project');
    });

    test('project agent overrides global when same name', () => {
        const hub = buildHub({
            globalAgents:    [{ name: 'shared-bot', role: 'Global Role', scope: 'global' }],
            projectAgents:   [{ name: 'shared-bot', role: 'Project Role', scope: 'project' }],
            activeProjectId: 'proj-1'
        });
        registerAgentTools(hub);

        const out = hub.callTool('list_agents', {});
        // Only one entry — project wins
        expect(out).toContain('Project Role');
        expect(out).not.toContain('Global Role');
        expect(out).toContain('Team Agents (1)');
    });

    test('scope filter "global" excludes project agents', () => {
        const hub = buildHub({
            globalAgents:    [{ name: 'global-only', role: 'G', scope: 'global' }],
            projectAgents:   [{ name: 'proj-only',   role: 'P', scope: 'project' }],
            activeProjectId: 'proj-1'
        });
        registerAgentTools(hub);

        const out = hub.callTool('list_agents', { scope: 'global' });
        expect(out).toContain('global-only');
        expect(out).not.toContain('proj-only');
    });

    test('scope filter "project" excludes global agents', () => {
        const hub = buildHub({
            globalAgents:    [{ name: 'g', role: 'G', scope: 'global' }],
            projectAgents:   [{ name: 'p', role: 'P', scope: 'project' }],
            activeProjectId: 'proj-1'
        });
        registerAgentTools(hub);

        const out = hub.callTool('list_agents', { scope: 'project' });
        expect(out).not.toContain('**g**');
        expect(out).toContain('p');
    });

    test('returns "no agents" message when filter yields nothing', () => {
        const hub = buildHub({ globalAgents: [], activeProjectId: null });
        registerAgentTools(hub);
        const out = hub.callTool('list_agents', {});
        expect(out).toContain('No agents found');
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('delegate_to_agent validation', () => {
    test('accepts global agents', () => {
        const hub = buildHub({
            globalAgents: [{ name: 'code-implementer', scope: 'global' }],
            activeProjectId: null
        });
        registerAgentTools(hub);

        const out = hub.callTool('validate_agent', { agent: 'code-implementer' });
        expect(out).toContain('OK');
    });

    test('accepts project-scoped agents', () => {
        const hub = buildHub({
            globalAgents:    [],
            projectAgents:   [{ name: 'domain-expert', scope: 'project' }],
            activeProjectId: 'proj-1'
        });
        registerAgentTools(hub);

        const out = hub.callTool('validate_agent', { agent: 'domain-expert' });
        expect(out).toContain('OK');
    });

    test('rejects unknown agents with available list', () => {
        const hub = buildHub({
            globalAgents:  [{ name: 'code-implementer', scope: 'global' }],
            projectAgents: [{ name: 'domain-expert',    scope: 'project' }],
            activeProjectId: 'proj-1'
        });
        registerAgentTools(hub);

        const out = hub.callTool('validate_agent', { agent: 'ghost-agent' });
        expect(out).toMatch(/ERROR.*Unknown agent/);
        expect(out).toContain('code-implementer');
        expect(out).toContain('domain-expert');
    });

    test('accepts any agent when valid list is empty (no restriction)', () => {
        const hub = buildHub({ globalAgents: [], activeProjectId: null });
        registerAgentTools(hub);
        const out = hub.callTool('validate_agent', { agent: 'anyone' });
        expect(out).toContain('OK');
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('getOrCreateSession — agent definition lookup', () => {
    test('returns DB agent when found globally', () => {
        const hub = buildHub({
            globalAgents: [{ name: 'code-implementer', role: 'Coder', instructions: 'Write code.' }],
            activeProjectId: null
        });
        registerAgentTools(hub);

        const def = hub.getAgentDef('code-implementer');
        expect(def.name).toBe('code-implementer');
        expect(def.role).toBe('Coder');
    });

    test('falls through to project agents when not in DB', () => {
        const hub = buildHub({
            globalAgents:    [],
            projectAgents:   [{ name: 'domain-expert', role: 'Domain Expert', instructions: 'Specialize.' }],
            activeProjectId: 'proj-1'
        });
        registerAgentTools(hub);

        const def = hub.getAgentDef('domain-expert');
        expect(def.name).toBe('domain-expert');
        expect(def.role).toBe('Domain Expert');
    });

    test('returns empty stub when agent not found anywhere', () => {
        const hub = buildHub({ globalAgents: [], activeProjectId: null });
        registerAgentTools(hub);

        const def = hub.getAgentDef('unknown-agent');
        expect(def.name).toBe('unknown-agent');
        expect(def.role).toBe('assistant');
        expect(def.instructions).toBe('');
    });

    test('project agent not consulted when no active project', () => {
        const hub = buildHub({
            globalAgents:  [],
            projectAgents: [{ name: 'proj-only', role: 'P' }],
            activeProjectId: null    // ← no active project
        });
        registerAgentTools(hub);

        const def = hub.getAgentDef('proj-only');
        // Should fall through to stub since no active project
        expect(def.role).toBe('assistant');
    });
});
