// ==================== GITHUB TOOLS MODULE ====================
// GitHub operations via gh CLI + local git via spawn (no shell injection)

const { spawn } = require('child_process');

let HUB = null;
let CONFIG = null;

// Run gh CLI with safe args array (no shell interpolation)
function runGh(args, cwd) {
    return new Promise((resolve, reject) => {
        const proc = spawn('gh', args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false,
            cwd: cwd || process.cwd()
        });

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => { stdout += d.toString(); });
        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.on('close', code => resolve({ success: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), code }));
        proc.on('error', reject);
    });
}

// Run local git with safe args array
function runGit(args, cwd) {
    return new Promise((resolve, reject) => {
        const proc = spawn('git', args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false,
            cwd: cwd || process.cwd()
        });

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => { stdout += d.toString(); });
        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.on('close', code => resolve({ success: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), code }));
        proc.on('error', reject);
    });
}

function getWorkingDir() {
    const conv = HUB?.getService('conversation');
    return conv?.getWorkingDirectory?.() || process.cwd();
}

// Handle GitHub + git operations
async function handleGithub(input) {
    const { action, body, repo, state, title, branch, base, number, labels, assignees, milestone } = input;

    const validActions = [
        'get_repo', 'get_status',
        'list_issues', 'create_issue', 'close_issue',
        'list_prs', 'create_pr', 'merge_pr',
        'list_branches', 'create_branch', 'checkout_branch', 'delete_branch',
        'push', 'pull'
    ];

    if (!action) return { success: false, error: 'action is required' };
    if (!validActions.includes(action)) {
        return { success: false, error: `Invalid action. Valid: ${validActions.join(', ')}` };
    }

    const cwd = getWorkingDir();

    try {
        switch (action) {

            // ── Repo info ──────────────────────────────────────────────────
            case 'get_repo': {
                const args = ['repo', 'view', '--json',
                    'name,description,url,visibility,defaultBranch,language,stargazerCount,forkCount'];
                if (repo) args.splice(2, 0, repo);
                const result = await runGh(args, cwd);
                if (result.success) return { success: true, data: JSON.parse(result.stdout) };
                return { success: false, error: result.stderr };
            }

            // ── Local git status ───────────────────────────────────────────
            case 'get_status': {
                const [statusRes, branchRes, logRes] = await Promise.all([
                    runGit(['status', '--short'], cwd),
                    runGit(['branch', '--show-current'], cwd),
                    runGit(['log', '--oneline', '-5'], cwd)
                ]);
                return {
                    success: true,
                    branch: branchRes.stdout,
                    changes: statusRes.stdout || '(clean)',
                    recentCommits: logRes.stdout
                };
            }

            // ── Issues ─────────────────────────────────────────────────────
            case 'list_issues': {
                const args = ['issue', 'list', '--json',
                    'number,title,state,labels,assignees,url,createdAt'];
                if (repo) args.push('--repo', repo);
                args.push('--state', state || 'open');
                const result = await runGh(args, cwd);
                if (result.success) return { success: true, issues: JSON.parse(result.stdout) };
                return { success: false, error: result.stderr };
            }

            case 'create_issue': {
                if (!title) return { success: false, error: 'title is required' };
                const args = ['issue', 'create', '--title', title];
                if (repo) args.push('--repo', repo);
                if (body) args.push('--body', body);
                if (labels) args.push('--label', String(labels));
                if (assignees) args.push('--assignee', String(assignees));
                if (milestone) args.push('--milestone', String(milestone));
                const result = await runGh(args, cwd);
                if (result.success) {
                    HUB?.log(`[GitHub] Created issue: ${title}`, 'success');
                    return { success: true, url: result.stdout };
                }
                return { success: false, error: result.stderr };
            }

            case 'close_issue': {
                if (!number) return { success: false, error: 'number is required' };
                const args = ['issue', 'close', String(number)];
                if (repo) args.push('--repo', repo);
                const result = await runGh(args, cwd);
                if (result.success) return { success: true, message: `Issue #${number} closed` };
                return { success: false, error: result.stderr };
            }

            // ── Pull Requests ──────────────────────────────────────────────
            case 'list_prs': {
                const args = ['pr', 'list', '--json',
                    'number,title,state,headRefName,baseRefName,url,createdAt'];
                if (repo) args.push('--repo', repo);
                args.push('--state', state || 'open');
                const result = await runGh(args, cwd);
                if (result.success) return { success: true, prs: JSON.parse(result.stdout) };
                return { success: false, error: result.stderr };
            }

            case 'create_pr': {
                if (!title) return { success: false, error: 'title is required' };
                const args = ['pr', 'create', '--title', title];
                if (repo) args.push('--repo', repo);
                if (body) args.push('--body', body || '');
                if (base) args.push('--base', base);
                if (branch) args.push('--head', branch);
                if (labels) args.push('--label', String(labels));
                if (assignees) args.push('--assignee', String(assignees));
                const result = await runGh(args, cwd);
                if (result.success) {
                    HUB?.log(`[GitHub] Created PR: ${title}`, 'success');
                    return { success: true, url: result.stdout };
                }
                return { success: false, error: result.stderr };
            }

            case 'merge_pr': {
                if (!number) return { success: false, error: 'number is required' };
                const args = ['pr', 'merge', String(number), '--merge'];
                if (repo) args.push('--repo', repo);
                const result = await runGh(args, cwd);
                if (result.success) return { success: true, message: `PR #${number} merged` };
                return { success: false, error: result.stderr };
            }

            // ── Branches ───────────────────────────────────────────────────
            case 'list_branches': {
                const result = await runGit(['branch', '-a', '--format=%(refname:short)'], cwd);
                return { success: true, branches: result.stdout.split('\n').filter(Boolean) };
            }

            case 'create_branch': {
                if (!branch) return { success: false, error: 'branch is required' };
                // Create from base if specified, else current HEAD
                const args = base
                    ? ['checkout', '-b', branch, base]
                    : ['checkout', '-b', branch];
                const result = await runGit(args, cwd);
                if (result.success || result.stderr.includes('Switched to a new branch')) {
                    HUB?.log(`[Git] Created branch: ${branch}`, 'success');
                    return { success: true, branch };
                }
                return { success: false, error: result.stderr };
            }

            case 'checkout_branch': {
                if (!branch) return { success: false, error: 'branch is required' };
                const result = await runGit(['checkout', branch], cwd);
                if (result.success) return { success: true, branch };
                return { success: false, error: result.stderr };
            }

            case 'delete_branch': {
                if (!branch) return { success: false, error: 'branch is required' };
                const result = await runGit(['branch', '-d', branch], cwd);
                if (result.success) return { success: true, message: `Branch ${branch} deleted` };
                return { success: false, error: result.stderr };
            }

            // ── Push / Pull ────────────────────────────────────────────────
            case 'push': {
                const args = ['push'];
                if (branch) args.push('origin', branch);
                else args.push('--set-upstream', 'origin', 'HEAD');
                const result = await runGit(args, cwd);
                if (result.success) return { success: true, output: result.stdout || result.stderr };
                return { success: false, error: result.stderr };
            }

            case 'pull': {
                const result = await runGit(['pull'], cwd);
                if (result.success) return { success: true, output: result.stdout };
                return { success: false, error: result.stderr };
            }

            default:
                return { success: false, error: `Unknown action: ${action}` };
        }
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Initialize module
function init(hub) {
    HUB = hub;
    CONFIG = hub.getService('config');
}

module.exports = { init, handleGithub, runGh, runGit };
