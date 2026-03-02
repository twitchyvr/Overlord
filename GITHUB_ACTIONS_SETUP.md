# GitHub Actions Setup Guide

This guide walks you through setting up OVERLORD on GitHub with CI/CD.

## Step 1: Create the GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Repository name: `overlord-web`
3. Visibility: **Public** (or Private)
4. **Do NOT** initialize with README — we have one
5. Click **Create repository**

## Step 2: Push the Local Repository

```bash
cd /Users/mattrogers/Documents/overlord-web
git remote add origin https://github.com/YOUR_USERNAME/overlord-web.git
git branch -M main
git push -u origin main
```

## Step 3: Configure Repository Secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Value | Required |
|-------------|-------|----------|
| `MINIMAX_API_KEY` | Your MiniMax API key | For integration tests |

> **Note:** The CI workflow uses `test_key_for_ci` as a dummy key. Only add the real key if you want integration tests to make real API calls.

## Step 4: Branch Protection

Go to **Settings → Branches → Add rule**:
- Branch name pattern: `main`
- ✅ Require a pull request before merging
- ✅ Require status checks to pass before merging
- ✅ Require branches to be up to date before merging
- Status checks to require: `Test (Node.js 20.x)`

## Step 5: How the CI Workflow Works

The CI workflow (`.github/workflows/ci.yml`) runs on every push to `main` or `develop` and on every PR:

1. Checks out the code
2. Installs Node.js (18.x, 20.x, 22.x in parallel)
3. Runs `npm ci` to install dependencies
4. Runs `npm test` — all 93+ tests must pass

**Failing CI blocks merges to main when branch protection is enabled.**

## Step 6: How the Release Workflow Works

The release workflow (`.github/workflows/release.yml`) triggers on version tags:

```bash
# To create a release:
git tag v1.1.0
git push origin v1.1.0
```

This will:
1. Run all tests
2. Create a GitHub Release with auto-generated release notes
3. The release notes pull from commit messages since the last tag

## Step 7: GitHub Pages for Docs (Optional)

1. Go to **Settings → Pages**
2. Source: Deploy from a branch
3. Branch: `main`, folder: `/docs`
4. Your documentation will be available at `https://YOUR_USERNAME.github.io/overlord-web/`

## Step 8: Dependabot (Optional)

Create `.github/dependabot.yml` to automatically get PRs for dependency updates:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
```

## Common Issues

**Tests fail with "API key" error:**
The tests mock the API — if you see actual API errors, check that `NODE_ENV=test` is set in the workflow.

**Push fails with "remote: Repository not found":**
Make sure you've created the repo on GitHub first and have the correct remote URL.

**CI badge not showing:**
After the first CI run completes, add this to your README:
```markdown
[![CI](https://github.com/YOUR_USERNAME/overlord-web/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/overlord-web/actions/workflows/ci.yml)
```
