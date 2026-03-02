# Changelog

All notable changes to OVERLORD are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), versioning follows [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-03-02

### Added
- Multi-agent system with SQLite persistence, roles, capabilities, tool permissions
- Global vs project-scoped agents with scope badges (G/P) on agent cards
- Real-time agent activity sparklines (60-second rolling window)
- Agent-to-agent messaging via `message_agent` tool with 2-level chain depth guard
- Task delegation via `delegate_to_agent` tool with scope injection and CRITICAL CONSTRAINTS block
- Per-agent extended thinking mode with configurable token budget
- Socket.IO rooms architecture — conversation-scoped broadcasting
- Message queue with consolidated drain mode (joins all queued messages into one prompt)
- Force-send individual or all queued messages immediately
- Plan Mode — AI generates multi-variant plans (Short/Regular/Long/Unlimited)
- Plan approval bar with Short/Regular/Long variant tabs + one-click switching
- Project dashboard: kanban board, milestone tracker, KPI charts, PM chat
- AI-powered task/milestone fill with missing-agent detection and quick-create flow
- Agent quick-create mini-form with AI fill and global/project scope toggle
- Message copy button with Markdown/Plain Text options and green ✓ acknowledgement
- MCP server manager with multi-server support and built-in presets
- Approval flow for T3/T4 tools — any connected device can approve
- AutoQA: lint, type-check, test runs after file writes
- AI-powered context compaction (summarization module)
- Session notes and TIMELINE.md context injection
- Custom Instructions, Project Memory, Reference Documentation fields
- Thinking mode settings (global toggle + budget) in Settings panel
- Queue Drain Mode setting: consolidated (default) vs sequential
- Plan Length setting: short/regular/long/unlimited
- Full MiniMax M2.5 API support (Anthropic-compatible endpoint)
- Image understanding, TTS, and file upload modules
