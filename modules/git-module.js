// ==================== GIT MODULE ====================
// Handles automatic git commits with full documentation

const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let hub = null;
let config = null;

// Configuration
const AUTO_COMMIT_ENABLED = true;
const AUTO_PUSH_ENABLED = true;

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
        mergeBranch: mergeBranch
    });
    
    hub.log('Git module loaded - auto-commit enabled', 'success');
    
    // Auto-commit hook - listen for file changes
    hub.on('file_changed', (data) => {
        if (AUTO_COMMIT_ENABLED) {
            const { filePath, changeType, description } = data;
            autoCommit(filePath, changeType, description);
        }
    });
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

// Auto-commit function
async function autoCommit(filePath, changeType, description) {
    try {
        const cwd = getWorkingDirectory();
        
        // Check if there are changes
        const status = await execCommand('git status --porcelain', cwd);
        if (!status) {
            hub.log('No changes to commit', 'info');
            return { success: true, message: 'No changes' };
        }
        
        // Determine change type if not provided
        const changeTypeMap = {
            'A': 'Add',
            'M': 'Update',
            'D': 'Remove',
            'R': 'Rename'
        };
        
        // Get list of changed files
        const changedFiles = status.split('\n').filter(line => line.trim());
        
        // Generate commit message
        let commitMessage = '';
        if (description) {
            commitMessage = description;
        } else {
            const fileCount = changedFiles.length;
            if (fileCount === 1) {
                const file = changedFiles[0].substring(3).trim();
                const type = changeTypeMap[changedFiles[0].charAt(1)] || 'Update';
                commitMessage = `${type}: ${path.basename(file)}`;
            } else {
                commitMessage = `Update ${fileCount} files`;
            }
        }
        
        // Add detailed description
        const detailedMessage = `${commitMessage}\n\nChanged files:\n${changedFiles.map(f => `- ${f.substring(3).trim()}`).join('\n')}`;
        
        // Stage all changes
        await execCommand('git add -A', cwd);
        
        // Commit with full message
        await execCommand(`git commit -m "${detailedMessage.replace(/"/g, '\\"')}"`, cwd);
        
        hub.log(`Auto-committed: ${commitMessage}`, 'success');
        
        // Auto-push if enabled
        if (AUTO_PUSH_ENABLED) {
            await execCommand('git push', cwd);
            hub.log('Changes pushed to GitHub', 'success');
        }
        
        return { success: true, message: commitMessage };
    } catch (e) {
        hub.log(`Auto-commit error: ${e.message}`, 'error');
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

// Commit and push
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
