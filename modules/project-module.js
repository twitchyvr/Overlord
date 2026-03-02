// ==================== PROJECT MODULE ====================
// Manages multiple projects, each with their own context, tasks, roadmap,
// working directory, documentation, agents, and settings.

const fs = require('fs');
const path = require('path');

let hub = null;
let config = null;

const PROJECTS_DIR = '.overlord/projects';
const INDEX_FILE = '.overlord/projects/index.json';

// In-memory state
let projectIndex = { activeProjectId: null, projects: [] };

async function init(h) {
    hub = h;
    config = hub.getService('config');

    // Ensure projects directory exists
    const baseDir = getBaseDir();
    const projectsDir = path.join(baseDir, PROJECTS_DIR);
    if (!fs.existsSync(projectsDir)) {
        fs.mkdirSync(projectsDir, { recursive: true });
    }

    // Load project index
    const indexPath = path.join(baseDir, INDEX_FILE);
    if (fs.existsSync(indexPath)) {
        try {
            projectIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
            if (!Array.isArray(projectIndex.projects)) projectIndex.projects = [];
        } catch (e) {
            hub.log('[Projects] Error loading index: ' + e.message, 'error');
            projectIndex = { activeProjectId: null, projects: [] };
        }
    }

    hub.registerService('projects', {
        listProjects,
        getProject,
        createProject,
        updateProject,
        deleteProject,
        switchProject,
        getActiveProject,
        getActiveProjectId,
        linkProjects,
        unlinkProjects,
        getProjectData,
        saveProjectData,
        saveCurrentProjectState,
        listProjectAgents,
        addProjectAgent,
        removeProjectAgent
    });

    hub.log('[Projects] Module loaded — ' + projectIndex.projects.length + ' project(s)', 'success');

    // If there's an active project, restore its data once conversation module is ready
    if (projectIndex.activeProjectId) {
        // Defer until after conversation module initializes
        setImmediate(() => {
            try {
                _applyActiveProjectToConversation();
            } catch (e) {
                hub.log('[Projects] Could not restore active project: ' + e.message, 'warn');
            }
        });
    }
}

function getBaseDir() {
    return config?.baseDir || process.cwd();
}

function saveIndex() {
    try {
        const indexPath = path.join(getBaseDir(), INDEX_FILE);
        fs.writeFileSync(indexPath, JSON.stringify(projectIndex, null, 2));
    } catch (e) {
        hub.log('[Projects] Error saving index: ' + e.message, 'error');
    }
}

function getProjectDir(id) {
    return path.join(getBaseDir(), PROJECTS_DIR, id);
}

function getProjectDataPath(id) {
    return path.join(getProjectDir(id), 'data.json');
}

// ── CRUD ────────────────────────────────────────────────────────────────────

function listProjects() {
    return projectIndex.projects.map(p => ({
        ...p,
        isActive: p.id === projectIndex.activeProjectId
    }));
}

function getProject(id) {
    return projectIndex.projects.find(p => p.id === id) || null;
}

function getActiveProject() {
    if (!projectIndex.activeProjectId) return null;
    return getProject(projectIndex.activeProjectId);
}

function getActiveProjectId() {
    return projectIndex.activeProjectId;
}

function createProject({ name, description = '', color = '#58a6ff', icon = '📁', workingDir = '' }) {
    const id = 'proj_' + Date.now();
    const now = new Date().toISOString();
    const proj = {
        id,
        name: name || 'New Project',
        description,
        color,
        icon,
        createdAt: now,
        updatedAt: now,
        linkedProjects: []
    };

    // Create project directory + data file
    const projDir = getProjectDir(id);
    fs.mkdirSync(projDir, { recursive: true });

    const data = {
        workingDir: workingDir || '',
        customInstructions: '',
        projectMemory: '',
        referenceDocumentation: '',
        requirements: '',
        agents: [],
        tasks: [],
        roadmap: []
    };
    fs.writeFileSync(getProjectDataPath(id), JSON.stringify(data, null, 2));

    projectIndex.projects.push(proj);
    saveIndex();
    hub.log('[Projects] Created: ' + proj.name, 'success');
    return { project: proj, data };
}

function updateProject(id, fields) {
    const proj = projectIndex.projects.find(p => p.id === id);
    if (!proj) return null;

    // Top-level metadata fields
    const metaAllowed = ['name', 'description', 'color', 'icon', 'linkedProjects'];
    metaAllowed.forEach(k => { if (fields[k] !== undefined) proj[k] = fields[k]; });
    proj.updatedAt = new Date().toISOString();

    // Data-level fields go to data.json
    const dataAllowed = ['workingDir', 'customInstructions', 'projectMemory',
        'referenceDocumentation', 'requirements', 'agents', 'tasks', 'roadmap'];
    const hasData = dataAllowed.some(k => fields[k] !== undefined);
    if (hasData) {
        const data = getProjectData(id) || {};
        dataAllowed.forEach(k => { if (fields[k] !== undefined) data[k] = fields[k]; });
        saveProjectData(id, data);
    }

    saveIndex();
    return proj;
}

function deleteProject(id) {
    const idx = projectIndex.projects.findIndex(p => p.id === id);
    if (idx === -1) return false;

    projectIndex.projects.splice(idx, 1);
    if (projectIndex.activeProjectId === id) {
        projectIndex.activeProjectId = null;
        _clearProjectOverlay();
    }
    saveIndex();

    // Remove project directory
    try {
        const projDir = getProjectDir(id);
        if (fs.existsSync(projDir)) fs.rmSync(projDir, { recursive: true, force: true });
    } catch (e) {
        hub.log('[Projects] Could not remove dir for ' + id + ': ' + e.message, 'warn');
    }

    hub.log('[Projects] Deleted: ' + id, 'info');
    return true;
}

function getProjectData(id) {
    const dataPath = getProjectDataPath(id);
    if (!fs.existsSync(dataPath)) {
        return {
            workingDir: '', customInstructions: '', projectMemory: '',
            referenceDocumentation: '', requirements: '', agents: [], tasks: [], roadmap: []
        };
    }
    try {
        return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    } catch (e) {
        hub.log('[Projects] Error reading data for ' + id + ': ' + e.message, 'error');
        return null;
    }
}

function saveProjectData(id, data) {
    const projDir = getProjectDir(id);
    if (!fs.existsSync(projDir)) fs.mkdirSync(projDir, { recursive: true });
    try {
        fs.writeFileSync(getProjectDataPath(id), JSON.stringify(data, null, 2));
    } catch (e) {
        hub.log('[Projects] Error saving data for ' + id + ': ' + e.message, 'error');
    }
}

// ── Project switching ────────────────────────────────────────────────────────

function saveCurrentProjectState() {
    const currentId = projectIndex.activeProjectId;
    if (!currentId) return;
    const conv = hub.getService('conversation');
    if (!conv) return;
    const data = getProjectData(currentId);
    if (!data) return;
    data.tasks = conv.getTasks ? conv.getTasks() : [];
    data.roadmap = conv.getRoadmap ? conv.getRoadmap() : [];
    if (conv.getWorkingDirectory) data.workingDir = conv.getWorkingDirectory();
    saveProjectData(currentId, data);
}

function switchProject(id) {
    // Save current project state first
    saveCurrentProjectState();

    const proj = getProject(id);
    if (!proj) return null;

    projectIndex.activeProjectId = id;
    saveIndex();

    const data = getProjectData(id) || {};
    _applyProjectData(proj, data);

    hub.log('[Projects] Switched to: ' + proj.name, 'success');
    return { project: { ...proj, isActive: true }, data };
}

function _applyActiveProjectToConversation() {
    const id = projectIndex.activeProjectId;
    if (!id) return;
    const proj = getProject(id);
    const data = getProjectData(id);
    if (proj && data) _applyProjectData(proj, data);
}

function _applyProjectData(proj, data) {
    const conv = hub.getService('conversation');
    const cfg = hub.getService('config');

    if (conv && conv.loadProjectData) {
        conv.loadProjectData({
            tasks: data.tasks || [],
            roadmap: data.roadmap || [],
            workingDir: data.workingDir || ''
        });
    }

    if (cfg) {
        cfg._projectCustomInstructions = data.customInstructions || '';
        cfg._projectMemory = data.projectMemory || '';
        cfg._projectReferenceDocumentation = data.referenceDocumentation || '';
        cfg._projectRequirements = data.requirements || '';
        cfg._activeProjectId = proj.id;
        cfg._activeProjectName = proj.name;
    }

    // Emit project agents so hub can merge them with global agents in team broadcasts
    const projectAgents = Array.isArray(data.agents) ? data.agents : [];
    hub.broadcast('project_agents_loaded', { projectId: proj.id, agents: projectAgents });

    hub.broadcast('project_switched', {
        project: { ...proj, isActive: true },
        data
    });
}

function _clearProjectOverlay() {
    const cfg = hub.getService('config');
    if (cfg) {
        cfg._projectCustomInstructions = '';
        cfg._projectMemory = '';
        cfg._projectReferenceDocumentation = '';
        cfg._projectRequirements = '';
        cfg._activeProjectId = null;
        cfg._activeProjectName = null;
    }
}

// ── Project Agents ───────────────────────────────────────────────────────────

function listProjectAgents(id) {
    const data = getProjectData(id);
    return (data && Array.isArray(data.agents)) ? data.agents : [];
}

function addProjectAgent(id, agentData) {
    const data = getProjectData(id);
    if (!data) return { success: false, error: 'Project not found' };
    if (!Array.isArray(data.agents)) data.agents = [];

    // Deduplicate by name
    data.agents = data.agents.filter(a => a.name !== agentData.name);
    data.agents.push({ ...agentData, scope: 'project' });
    saveProjectData(id, data);
    hub.log(`[Projects] Added project agent: ${agentData.name} to ${id}`, 'info');
    return { success: true, agent: agentData };
}

function removeProjectAgent(id, agentName) {
    const data = getProjectData(id);
    if (!data) return { success: false, error: 'Project not found' };
    if (!Array.isArray(data.agents)) return { success: false, error: 'No project agents' };
    data.agents = data.agents.filter(a => a.name !== agentName);
    saveProjectData(id, data);
    return { success: true };
}

// ── Linking ──────────────────────────────────────────────────────────────────

function linkProjects(id1, id2, relationship, note) {
    const proj1 = projectIndex.projects.find(p => p.id === id1);
    const proj2 = projectIndex.projects.find(p => p.id === id2);
    if (!proj1 || !proj2) return false;
    if (!proj1.linkedProjects) proj1.linkedProjects = [];
    // Remove old link if it exists
    proj1.linkedProjects = proj1.linkedProjects.filter(l => l.id !== id2);
    proj1.linkedProjects.push({ id: id2, name: proj2.name, relationship, note: note || '' });
    proj1.updatedAt = new Date().toISOString();
    saveIndex();
    return true;
}

function unlinkProjects(id1, id2) {
    const proj1 = projectIndex.projects.find(p => p.id === id1);
    if (!proj1) return false;
    proj1.linkedProjects = (proj1.linkedProjects || []).filter(l => l.id !== id2);
    proj1.updatedAt = new Date().toISOString();
    saveIndex();
    return true;
}

module.exports = { init };
