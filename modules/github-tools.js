// ==================== GITHUB TOOLS MODULE ====================
// GitHub operations via gh CLI

const { spawn } = require('child_process');

let HUB = null;
let CONFIG = null;

// Execute gh command
function runGh(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn('gh', args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            resolve({
                success: code === 0,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                code
            });
        });

        proc.on('error', (err) => {
            reject(err);
        });
    });
}

// Handle GitHub operations
async function handleGithub(input) {
    const { action, body, repo, state, title } = input;
    const validActions = ['get_repo', 'list_issues', 'create_issue', 'close_issue', 'list_prs', 'create_pr'];
    
    if (!action) {
        return { success: false, error: 'action is required' };
    }
    
    if (!validActions.includes(action)) {
        return { success: false, error: `Invalid action. Valid: ${validActions.join(', ')}` };
    }
    
    // Check if gh is available
    try {
        const check = await runGh(['--version']);
        if (!check.success) {
            return { success: false, error: 'gh CLI not installed or not authenticated' };
        }
    } catch (e) {
        return { success: false, error: 'gh CLI not found. Install from https://cli.github.com/' };
    }
    
    try {
        switch (action) {
            case 'get_repo': {
                if (!repo) {
                    return { success: false, error: 'repo is required for get_repo' };
                }
                const result = await runGh(['repo', 'view', repo, '--json', 'name,description,url,visibility,defaultBranch,language']);
                if (result.success) {
                    return { success: true, data: JSON.parse(result.stdout) };
                }
                return { success: false, error: result.stderr || 'Failed to get repo' };
            }
            
            case 'list_issues': {
                const args = ['issue', 'list'];
                if (repo) args.push('--repo', repo);
                if (state) args.push('--state', state);
                else args.push('--state', 'open');
                
                const result = await runGh(args);
                if (result.success) {
                    const issues = result.stdout.split('\n').filter(Boolean).map(line => {
                        const parts = line.split('\t');
                        return {
                            number: parts[0],
                            title: parts[1],
                            state: parts[2]
                        };
                    });
                    return { success: true, issues };
                }
                return { success: false, error: result.stderr || 'Failed to list issues' };
            }
            
            case 'create_issue': {
                if (!repo || !title) {
                    return { success: false, error: 'repo and title are required for create_issue' };
                }
                const args = ['issue', 'create', '--repo', repo, '--title', title];
                if (body) args.push('--body', body);
                
                const result = await runGh(args);
                if (result.success) {
                    return { success: true, url: result.stdout.trim() };
                }
                return { success: false, error: result.stderr || 'Failed to create issue' };
            }
            
            case 'close_issue': {
                if (!repo || !title) {
                    return { success: false, error: 'repo and title are required for close_issue' };
                }
                // First find the issue number
                const listResult = await runGh(['issue', 'list', '--repo', repo, '--state', 'all', '--limit', '100']);
                if (!listResult.success) {
                    return { success: false, error: 'Failed to find issue' };
                }
                
                const issueLine = listResult.stdout.split('\n').find(line => line.includes(title));
                if (!issueLine) {
                    return { success: false, error: 'Issue not found' };
                }
                
                const issueNum = issueLine.split('\t')[0];
                const closeResult = await runGh(['issue', 'close', '--repo', repo, issueNum]);
                
                if (closeResult.success) {
                    return { success: true, message: `Issue #${issueNum} closed` };
                }
                return { success: false, error: closeResult.stderr || 'Failed to close issue' };
            }
            
            case 'list_prs': {
                const args = ['pr', 'list'];
                if (repo) args.push('--repo', repo);
                if (state) args.push('--state', state);
                else args.push('--state', 'open');
                
                const result = await runGh(args);
                if (result.success) {
                    const prs = result.stdout.split('\n').filter(Boolean).map(line => {
                        const parts = line.split('\t');
                        return {
                            number: parts[0],
                            title: parts[1],
                            state: parts[2]
                        };
                    });
                    return { success: true, prs };
                }
                return { success: false, error: result.stderr || 'Failed to list PRs' };
            }
            
            case 'create_pr': {
                // This would typically require a branch and base
                return { success: false, error: 'create_pr requires --base and --head flags. Use gh pr create directly.' };
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

module.exports = {
    init,
    handleGithub,
    runGh
};
