# Contributing to OVERLORD

Thank you for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/YOUR_USERNAME/overlord-web.git
cd overlord-web
npm install
cp .env.example .env
# Fill in your MINIMAX_API_KEY
node server.js
```

## Branching Strategy

- `main` — stable, production-ready code
- `develop` — integration branch for features
- `feature/your-feature` — new features
- `fix/your-bugfix` — bug fixes
- `docs/your-docs` — documentation updates

## Making a Pull Request

1. Fork the repository and create your branch from `develop`
2. Make your changes with clear, atomic commits
3. Add or update tests if applicable
4. Run `npm test` to ensure all tests pass
5. Open a PR against `develop` with a clear description

## Commit Style

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): add new feature
fix(scope): fix a bug
docs(scope): update documentation
refactor(scope): code change that neither fixes a bug nor adds a feature
test(scope): add or fix tests
chore(scope): build process or auxiliary tool changes
```

## Code Style

- Use `const`/`let`, never `var`
- Async/await over raw callbacks where possible
- Error messages should be human-readable
- No `console.log` in production paths — use `hub.log()` instead

## Testing

```bash
npm test           # run all tests
npm run test:watch # watch mode
```

## Reporting Issues

Please use GitHub Issues with the provided templates. Include:
- OVERLORD version (check `package.json`)
- Node.js version (`node --version`)
- Steps to reproduce
- Expected vs actual behavior

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md).
