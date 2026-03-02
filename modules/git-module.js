// ==================== GIT MODULE ====================
// Handles automatic git commits with full documentation

const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let hub = null;
let config = null;

// ── Change accumulator for 'count' trigger mode ────────────────────────────
let _pendingChanges = [];   // { filePath, changeType, description, ts }
let _commitTimer    = null; // debounce handle

async function init(h) {
    hub = h;
    config = hub.getService('config');

    hub.registerService('git', {
        commit: commitChanges,
        commitAndPush: commitAndPush,
        getStatus: getStatus,
        createIssue: createIssue,
        createPR: createPR,
        getIssues: getIssues,
        getPullRequests: getPullRequests,
        linkIssueToCommit: linkIssueToCommit,
        checkoutBranch: checkoutBranch,
        mergeBranch: mergeBranch,
        triggerAutoCommit: () => autoCommit(null, null, null, 'manual')
    });

    // ── Event listeners ─────────────────────────────────────────────────────

    // file_changed → used by 'every' and 'count' triggers
    hub.on('file_changed', (data) => {
        if (!cfg('gitOpsEnabled')) return;
        const trigger = cfg('gitOpsTrigger');
        const { filePath, changeType, description } = data;

        if (trigger === 'every') {
            // Debounce: wait 3 s for burst writes to settle, then commit once
            _pendingChanges.push({ filePath, changeType, description, ts: Date.now() });
            clearTimeout(_commitTimer);
            _commitTimer = setTimeout(() => {
                autoCommit(null, null, null, 'file_changed');
                _pendingChanges = [];
            }, 3000);

        } else if (trigger === 'count') {
            _pendingChanges.push({ filePath, changeType, description, ts: Date.now() });
            if (_pendingChanges.length >= cfg('gitOpsMinChanges')) {
                autoCommit(null, null, null, 'count');
                _pendingChanges = [];
            }
        }
        // 'task' / 'milestone' / 'manual' do not trigger on file_changed
    });

    // task_complete → commit after each task (most common trigger)
    hub.on('task_complete', (data) => {
        if (!cfg('gitOpsEnabled')) return;
        if (cfg('gitOpsTrigger') !== 'task') return;
        autoCommit(null, null, data.taskTitle || data.title || 'task complete', 'task_complete');
    });

    // milestone_completed → commit after milestone
    hub.on('milestone_completed', (data) => {
        if (!cfg('gitOpsEnabled')) return;
        if (!['task', 'milestone'].includes(cfg('gitOpsTrigger'))) return;
        autoCommit(null, null, data.milestoneName || data.title || 'milestone complete', 'milestone_completed');
    });

    // Manual "Commit & Push Now" from settings UI
    hub.on('gitops_commit_now', () => {
        autoCommit(null, null, null, 'manual');
    });

    hub.log('Git module loaded', 'success');
}

// Safe config accessor — always reads live value so runtime setting changes apply immediately
function cfg(key) {
    const c = hub ? hub.getService('config') : config;
    return c ? c[key] : undefined;
}

function getBaseDir() {
    return config ? config.baseDir : path.join(__dirname, '..');
}

function getWorkingDirectory() {
    // Get the working directory from conversation service
    const conv = hub.getService('conversation');
    if (conv && conv.getWorkingDirectory) {
        return conv.getWorkingDirectory();
    }
    return getBaseDir();
}

// Execute shell command
function execCommand(command, cwd) {
    return new Promise((resolve, reject) => {
        const isWindows = process.platform === 'win32';
        const shell = isWindows ? 'cmd.exe' : '/bin/bash';
        const shellArgs = isWindows ? ['/c', command] : ['-c', command];
        
        exec(command, { cwd }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr || error.message));
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

// Get git status
async function getStatus() {
    try {
        const cwd = getWorkingDirectory();
        const status = await execCommand('git status --porcelain', cwd);
        return status || 'No changes';
    } catch (e) {
        return `Error: ${e.message}`;
    }
}

// ── Commit-type detector ────────────────────────────────────────────────────
// Maps file paths to a Conventional Commits type + scope
function detectType(files) {
    const paths = files.map(f => f.toLowerCase());
    if (paths.some(p => /test|spec/.test(p)))            return 'test';
    if (paths.some(p => /readme|changelog|docs?\//i.test(p))) return 'docs';
    if (paths.some(p => /\.css$|styles?\./.test(p)))     return 'style';
    if (paths.some(p => /config|settings|\.env/.test(p))) return 'chore';
    if (paths.some(p => /package\.json|package-lock|yarn\.lock/.test(p))) return 'chore';
    if (paths.some(p => /\.github\/|ci\.yml|\.yaml$/.test(p))) return 'ci';
    if (paths.some(p => /\.(js|ts|jsx|tsx|py|go|rs|java|cs)$/.test(p))) return 'feat';
    return 'chore';
}

function detectScope(files) {
    // Most-common parent directory becomes the scope
    const dirs = files.map(f => {
        const parts = f.replace(/^[AMD?! ]+/, '').trim().split('/');
        return parts.length > 1 ? parts[0] : '';
    }).filter(Boolean);
    if (!dirs.length) return null;
    const freq = {};
    dirs.forEach(d => { freq[d] = (freq[d] || 0) + 1; });
    return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
}

// ── Commit message generators ───────────────────────────────────────────────

function buildBriefMessage(files, label) {
    if (label) return label;
    const type  = detectType(files.map(f => f.replace(/^[AMD?! ]+/, '').trim()));
    const count = files.length;
    const scope = detectScope(files);
    const s = scope ? `(${scope})` : '';
    return `${type}${s}: update ${count} file${count === 1 ? '' : 's'}`;
}

function buildConventionalMessage(files, label) {
    const cleanFiles = files.map(f => f.replace(/^[AMD?! ]+/, '').trim());
    const type  = detectType(cleanFiles);
    const scope = detectScope(files);
    const s = scope ? `(${scope})` : '';

    let subject = label || `update ${cleanFiles.length} file${cleanFiles.length === 1 ? '' : 's'}`;
    if (!label && cleanFiles.length === 1) {
        subject = `update ${path.basename(cleanFiles[0])}`;
    }

    const body = [
        'Changed files:',
        ...files.map(f => {
            const code = f.charAt(0) === ' ' ? f.charAt(1) : f.charAt(0);
            const fp   = f.replace(/^[AMD?! ]+/, '').trim();
            const op   = code === 'A' ? 'add' : code === 'D' ? 'remove' : code === 'R' ? 'rename' : 'modify';
            return `  ${op}: ${fp}`;
        })
    ].join('\n');

    return `${type}${s}: ${subject}\n\n${body}\n\nCo-Authored-By: OVERLORD GitOps <gitops@overlord.ai>`;
}

function buildComprehensiveMessage(files, label, trigger) {
    const cleanFiles = files.map(f => f.replace(/^[AMD?! ]+/, '').trim());
    const added    = files.filter(f => f.charAt(0) === 'A' || f.charAt(1) === 'A');
    const modified = files.filter(f => f.charAt(0) === 'M' || f.charAt(1) === 'M');
    const deleted  = files.filter(f => f.charAt(0) === 'D' || f.charAt(1) === 'D');
    const renamed  = files.filter(f => f.charAt(0) === 'R' || f.charAt(1) === 'R');
    const type     = detectType(cleanFiles);
    const scope    = detectScope(files);
    const s        = scope ? `(${scope})` : '';

    // Subject line
    let subject = label || '';
    if (!subject) {
        if (cleanFiles.length === 1) subject = `update ${path.basename(cleanFiles[0])}`;
        else subject = `update ${cleanFiles.length} files across ${scope || 'project'}`;
    }

    // Impact summary
    const impacts = [];
    if (added.length)    impacts.push(`${added.length} added`);
    if (modified.length) impacts.push(`${modified.length} modified`);
    if (deleted.length)  impacts.push(`${deleted.length} deleted`);
    if (renamed.length)  impacts.push(`${renamed.length} renamed`);
    const impactLine = impacts.length ? `\nImpact: ${impacts.join(', ')}` : '';

    // Trigger context
    const triggerMap = {
        task_complete:      'Committed after task completion',
        milestone_completed:'Committed after milestone reached',
        file_changed:       'Committed after file change batch settled',
        count:              'Committed after change count threshold reached',
        manual:             'Manual GitOps commit'
    };
    const triggerLine = `\nTrigger: ${triggerMap[trigger] || trigger || 'auto'}`;

    // File list grouped by operation
    const fileLines = [];
    if (added.length)    fileLines.push('  Added:', ...added.map(f    => `    + ${f.replace(/^[AMD?! ]+/, '').trim()}`));
    if (modified.length) fileLines.push('  Modified:', ...modified.map(f => `    ~ ${f.replace(/^[AMD?! ]+/, '').trim()}`));
    if (deleted.length)  fileLines.push('  Deleted:', ...deleted.map(f  => `    - ${f.replace(/^[AMD?! ]+/, '').trim()}`));
    if (renamed.length)  fileLines.push('  Renamed:', ...renamed.map(f  => `    → ${f.replace(/^[AMD?! ]+/, '').trim()}`));
    // Any untracked
    const untracked = files.filter(f => f.startsWith('??'));
    if (untracked.length) fileLines.push('  New (untracked):', ...untracked.map(f => `    + ${f.replace(/^\?\? /, '')}`));

    const body = [
        impactLine.trim(),
        triggerLine.trim(),
        '',
        'Files:',
        ...fileLines
    ].filter(l => l !== undefined).join('\n');

    return `${type}${s}: ${subject}\n\n${body}\n\nCo-Authored-By: OVERLORD GitOps <gitops@overlord.ai>`;
}

// ── Auto-commit orchestrator ────────────────────────────────────────────────
async function autoCommit(filePath, changeType, description, trigger) {
    try {
        const cwd = getWorkingDirectory();

        // Check for actual changes
        const status = await execCommand('git status --porcelain', cwd);
        if (!status) {
            hub.log('[GitOps] No changes to commit', 'info');
            return { success: true, message: 'No changes' };
        }

        const files = status.split('\n').filter(l => l.trim());

        // Build commit message based on configured style
        const style   = cfg('gitOpsCommitStyle') || 'comprehensive';
        let commitMsg;
        if (style === 'brief') {
            commitMsg = buildBriefMessage(files, description);
        } else if (style === 'conventional') {
            commitMsg = buildConventionalMessage(files, description);
        } else {
            // comprehensive (default)
            commitMsg = buildComprehensiveMessage(files, description, trigger);
        }

        // Stage and commit
        await execCommand('git add -A', cwd);
        // Escape the message for the shell
        const escapedMsg = commitMsg.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`');
        await execCommand(`git commit -m "${escapedMsg}"`, cwd);

        hub.log(`[GitOps] Committed (${style}): ${commitMsg.split('\n')[0]}`, 'success');
        hub.broadcast('gitops_commit', { message: commitMsg.split('\n')[0], trigger, style, fileCount: files.length });

        // Push based on configured push mode
        const pushMode = cfg('gitOpsPush') || 'always';
        if (pushMode === 'always') {
            await execCommand('git push', cwd);
            hub.log('[GitOps] Pushed to GitHub', 'success');
            hub.broadcast('gitops_push', { success: true });
        } else if (pushMode === 'ask') {
            hub.broadcast('gitops_push_request', { message: commitMsg.split('\n')[0] });
        }
        // 'never' → skip push

        return { success: true, message: commitMsg.split('\n')[0] };
    } catch (e) {
        hub.log(`[GitOps] Auto-commit error: ${e.message}`, 'error');
        return { success: false, error: e.message };
    }
}

// Manual commit function
async function commitChanges(message, files = null) {
    try {
        const cwd = getWorkingDirectory();
        
        // Stage specific files or all
        if (files) {
            for (const file of files) {
                await execCommand(`git add "${file}"`, cwd);
            }
        } else {
            await execCommand('git add -A', cwd);
        }
        
        // Commit
        await execCommand(`git commit -m "${message.replace(/"/g, '\\"')}"`, cwd);
        
        hub.log(`Committed: ${message}`, 'success');
        
        return { success: true, message };
    } catch (e) {
        hub.log(`Commit error: ${e.message}`, 'error');
        return { success: false, error: e.message };
    }
}

// Commit and push (manual — always pushes regardless of gitOpsPush setting)
async function commitAndPush(message, files = null) {
    const result = await commitChanges(message, files);
    if (!result.success) return result;

    try {
        const cwd = getWorkingDirectory();
        await execCommand('git push', cwd);
        hub.log('Pushed to GitHub', 'success');
        return { success: true, message: result.message, pushed: true };
    } catch (e) {
        hub.log(`Push error: ${e.message}`, 'error');
        return { success: false, error: e.message };
    }
}

// GitHub Issues (requires GitHub CLI or API)
async function createIssue(title, body) {
    try {
        // Try using gh CLI
        const cwd = getWorkingDirectory();
        const issueBody = body.replace(/"/g, '\\"');
        const result = await execCommand(`gh issue create -t "${title}" -b "${issueBody}"`, cwd);
        hub.log(`Created issue: ${title}`, 'success');
        return { success: true, url: result };
    } catch (e) {
        // Fallback: create local issue file
        const issuesDir = path.join(getBaseDir(), '.overlord', 'issues');
        if (!fs.existsSync(issuesDir)) {
            fs.mkdirSync(issuesDir, { recursive: true });
        }
        
        const issueId = `issue_${Date.now()}`;
        const issueFile = path.join(issuesDir, `${issueId}.json`);
        
        const issue = {
            id: issueId,
            title,
            body,
            status: 'open',
            createdAt: new Date().toISOString()
        };
        
        fs.writeFileSync(issueFile, JSON.stringify(issue, null, 2));
        hub.log(`Created local issue: ${title}`, 'success');
        
        return { success: true, id: issueId, local: true };
    }
}

async function getIssues() {
    try {
        const cwd = getWorkingDirectory();
        const result = await execCommand('gh issue list --json number,title,state', cwd);
        return JSON.parse(result);
    } catch (e) {
        // Return local issues
        const issuesDir = path.join(getBaseDir(), '.overlord', 'issues');
        if (!fs.existsSync(issuesDir)) return [];
        
        const files = fs.readdirSync(issuesDir).filter(f => f.endsWith('.json'));
        return files.map(f => {
            const issue = JSON.parse(fs.readFileSync(path.join(issuesDir, f), 'utf8'));
            return { number: f.replace('issue_', '').replace('.json', ''), title: issue.title, state: issue.status };
        });
    }
}

async function createPR(title, body, branch = 'master') {
    try {
        const cwd = getWorkingDirectory();
        const prBody = body.replace(/"/g, '\\"');
        const result = await execCommand(`gh pr create -t "${title}" -b "${prBody}" -B ${branch}`, cwd);
        hub.log(`Created PR: ${title}`, 'success');
        return { success: true, url: result };
    } catch (e) {
        hub.log(`PR creation error: ${e.message}`, 'error');
        return { success: false, error: e.message };
    }
}

async function getPullRequests() {
    try {
        const cwd = getWorkingDirectory();
        const result = await execCommand('gh pr list --json number,title,state', cwd);
        return JSON.parse(result);
    } catch (e) {
        return [];
    }
}

function linkIssueToCommit(issueNumber) {
    // GitHub automatically links commits with issues if using "Fixes #123" or "Closes #123" in commit message
    return `Closes #${issueNumber}`;
}

// ── Milestone branch helpers ────────────────────────────────────────────────

async function checkoutBranch(branch) {
    // Milestone branches live in overlord-web's own repo, not the user's project dir
    const cwd = getBaseDir();
    try {
        // Try creating a new branch first
        await execCommand(`git checkout -b "${branch}"`, cwd);
        hub.log('[Git] Created and checked out branch: ' + branch, 'success');
    } catch (e) {
        // Branch already exists — just switch to it
        try {
            await execCommand(`git checkout "${branch}"`, cwd);
            hub.log('[Git] Checked out existing branch: ' + branch, 'success');
        } catch (e2) {
            hub.log('[Git] checkoutBranch failed: ' + e2.message, 'error');
            throw e2;
        }
    }
}

async function mergeBranch(branch, target = null) {
    // Milestone branches live in overlord-web's own repo, not the user's project dir
    const cwd = getBaseDir();
    try {
        const safeMsg = `chore: merge milestone branch ${branch}`.replace(/"/g, '\\"');
        await execCommand(`git merge --no-ff "${branch}" -m "${safeMsg}"`, cwd);
        hub.log('[Git] Merged ' + branch + ' into current branch', 'success');
        return { success: true, branch };
    } catch (e) {
        hub.log('[Git] mergeBranch failed: ' + e.message, 'error');
        throw e;
    }
}

module.exports = { init };
