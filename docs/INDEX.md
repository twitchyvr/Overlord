# Overlord Documentation Index

Welcome to the Overlord documentation. This index provides an organized entry point to all documentation files, with cross-references to help you navigate the project effectively.

## Table of Contents

1. Getting Started
2. Architecture Overview
3. Backend Documentation
4. Frontend Documentation
5. Middleware Documentation
6. API Reference
7. Recent Updates

## Getting Started

### Quick Start for New Developers

If you are new to Overlord, follow this path:

| Step | Document | Purpose |
|------|----------|---------|
| 1 | Architecture Overview (./architecture.md) | Understand the high-level system design |
| 2 | Backend README (./App/Backend/README.md) | Learn about the Node.js backend architecture |
| 3 | Frontend README (./App/Frontend/README.md) | Understand the modular UI system |
| 4 | Middleware README (./App/Middleware/README.md) | Grasp the Socket.IO communication layer |

### Prerequisites

- Node.js 18+
- npm or yarn
- SQLite (via better-sqlite3)
- MiniMax API key (for AI capabilities)

### Running the Application

Run these commands:
npm install
npm start
Then open http://localhost:3031

## Architecture Overview

| Document | Description |
|----------|-------------|
| architecture.md | High-level architecture diagram, hub pattern, orchestration flow, Socket.IO rooms, agent session engine |

## Backend Documentation

The backend is a Node.js application built on Express and Socket.IO with a modular plugin architecture.

| Document | Description | Related Documents |
|----------|-------------|-------------------|
| Backend README (./App/Backend/README.md) | Entry point for backend docs: module initialization order, data flow, service registry | modules.md, services.md |
| modules.md (./App/Backend/modules.md) | Complete reference for all 30+ backend modules organized by layer | services.md, data-persistence.md |
| services.md (./App/Backend/services.md) | Every registered service API with method signatures | modules.md |
| data-persistence.md (./App/Backend/data-persistence.md) | All files under .overlord/ and their lifecycle | modules.md |

### Key Backend Modules

| Module | Purpose |
|--------|---------|
| orchestration-module.js | AI loop coordination, tool dispatch, approval system |
| ai-module.js | MiniMax API client with streaming and thinking budget |
| agent-system-module.js | Agent execution with 4-tier approval |
| tools-v5.js | 42+ native tools with dynamic registration |
| conversation-module.js | History, tasks, roadmap, working directory |

## Frontend Documentation

The frontend is a vanilla ES-module UI with no framework dependency, communicating via Socket.IO.

| Document | Description | Related Documents |
|----------|-------------|-------------------|
| Frontend README (./App/Frontend/README.md) | Entry point: directory layout, component hierarchy, data flow | store-keys.md, components.md |
| store-keys.md (./App/Frontend/store-keys.md) | Every reactive store key with defaults, persistence, readers/writers | data-flow.md |
| components.md (./App/Frontend/components.md) | Complete reference for all UI modules (engine, components, panels, views) | css-architecture.md |
| css-architecture.md (./App/Frontend/css-architecture.md) | Design tokens, theming, responsive breakpoints, visual effects | components.md |
| data-flow.md (./App/Frontend/data-flow.md) | End-to-end data flow diagrams and patterns | store-keys.md, event-catalog.md |
| event-catalog.md (./App/Frontend/event-catalog.md) | Complete catalog of all frontend events organized by category | socket-handlers.md |

### Key Frontend Concepts

| Concept | Description |
|---------|-------------|
| OverlordUI | Central singleton managing component lifecycle, event dispatch, DOM helpers |
| Store | Reactive state with dot-notation keys, subscriptions, localStorage persistence |
| SocketBridge | Maps 83 Socket.IO events to store updates and engine dispatches |
| Router | Mobile/tablet/desktop layout switching |

## Middleware Documentation

The middleware layer connects backend modules to the frontend through Socket.IO and a Node.js EventEmitter hub.

| Document | Description | Related Documents |
|----------|-------------|-------------------|
| Middleware README (./App/Middleware/README.md) | Entry point: hub pattern, socket bridge, room architecture, rate limiting | socket-handlers.md, event-catalog.md |
| socket-handlers.md (./App/Middleware/socket-handlers.md) | Complete reference for all 134 socket.on() handlers in hub.js | event-catalog.md |

### Key Middleware Concepts

| Concept | Description |
|---------|-------------|
| hub.js | Central EventEmitter: service registry, Socket.IO bridge, broadcast router |
| Socket.IO Rooms | conv:{conversationId} scoping for multi-user support |
| Rate Limiting | Token bucket algorithm (20 tokens, 4/sec) |
| Message Queue | Buffers user messages when AI is busy (consolidated or sequential drain) |

## API Reference

| Document | Description |
|----------|-------------|
| minimax_doc_index.txt (./minimax_doc_index.txt) | Index of MiniMax API documentation (text, image, video, audio, files) |

## Recent Updates

The documentation reflects recent refactoring and improvements:

### Tool Execution and API
- Message History Sanitization - Proper sanitization before sending to API
- Duplicate Tool Call IDs - Fixed duplicate IDs in API requests
- Tool Name Deduplication - Removed duplicate tool names

### Orchestration
- Tool Denial Handling - Fixed bare assistant messages breaking API alternation
- Message Content Preservation - Assistant messages now retain content blocks and tool_calls in loop
- Tool Loop Fixes - Resolved multiple root causes of tool loop stopping after one call

### UI Improvements
- Thought Bubble Formatting - Proper paragraphs instead of raw pre tags
- Prompt History - Ctrl+Up/Down recalls text and image attachments

### Approval System
- Tier Registry Coverage - Complete tier registry for all tools
- MCP Tool Fallback - MCP tools now properly fall back through priority chain

### Infrastructure
- Tools Service Registration - Root cause fix for zero tools appearing in API
- MCP Binaries - Uses globally-installed binaries instead of npx

## Cross-Reference Guide

### Finding Information

| What You Need | Start Here |
|---------------|------------|
| How to add a new backend module | Backend README |
| How to add a new UI component | Frontend README |
| Understanding data flow | data-flow.md |
| Socket.IO event reference | socket-handlers.md |
| Service API details | services.md |
| Store key reference | store-keys.md |

### Related Document Groups

| Topic | Documents |
|--------|-----------|
| Backend Architecture | architecture.md, Backend/README.md, modules.md, services.md |
| Frontend Architecture | architecture.md, Frontend/README.md, store-keys.md, components.md |
| Communication Layer | architecture.md, Middleware/README.md, socket-handlers.md |
| API Integration | architecture.md, minimax_doc_index.txt |

## Contributing to Documentation

When updating documentation:
1. Update the relevant section file (Backend/Frontend/Middleware)
2. Cross-reference related documents
3. Update this INDEX.md if adding new documents
4. Follow the existing format and style

Last updated: 2026-03-10