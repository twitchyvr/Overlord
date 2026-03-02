# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅ Yes    |

## Reporting a Vulnerability

**Please do not report security vulnerabilities publicly via GitHub Issues.**

To report a security issue, email the maintainer directly or use GitHub's private vulnerability reporting feature (Security → Report a vulnerability).

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge your report within 48 hours and aim to release a fix within 7 days for critical issues.

## Security Considerations

OVERLORD runs a Node.js server with direct access to your filesystem and shell. By design, the AI can:
- Read and write files in the working directory
- Execute shell commands (with optional approval flow for T3/T4 tier tools)
- Make network requests

**Never expose OVERLORD directly to the public internet** without authentication. It is intended to run locally or behind a trusted network boundary.

Key settings to review:
- `APPROVAL_TIMEOUT_MS` — how long to wait for tool approval
- Tool tier settings in Settings → Capabilities
- Rate limiting: `RATE_LIMIT_TOKENS`, `RATE_LIMIT_REFILL_RATE`
