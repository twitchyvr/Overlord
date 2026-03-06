# Overlord — Claude Code Project Instructions

These rules are **mandatory and non-negotiable**. They apply to every session,
every change, every prompt. Claude must follow them without being reminded.

---

## 1. Working File

- The active UI entry point is **`public/index.html`** (the modular ES-module build).
- `public/index-ori.html` is the legacy monolith — do NOT modify it.
- All new UI code lives under `public/ui/` (engine, components, panels, views, css).

---

## 2. Git Workflow — MANDATORY on every change

### Before coding
1. **Create or switch to a feature branch** — never commit directly to `main`.
   ```
   git checkout -b fix/short-description
   git checkout -b feat/short-description
   git checkout -b docs/short-description
   ```
2. **Create a GitHub Issue** for the work being done:
   ```
   gh issue create --title "…" --body "…"
   ```
   Link the branch to the issue number.

### After coding
3. **Commit every meaningful change** atomically using Conventional Commits:
   `type(scope): subject` — types: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`
   Always include: `Co-Authored-By: Claude <noreply@anthropic.com>`

4. **Open a Pull Request** when the branch is ready:
   ```
   gh pr create --title "…" --body "…"
   ```
   - PR body must include: Summary, Test Plan, link to the Issue (`Closes #N`)

5. **Never push directly to `main`** — all changes go through PRs.

### Stable milestones
- Stable branches: `stable/description-vN` (e.g. `stable/modular-ui-v1`)
- Annotated tags:  `vMAJOR.MINOR.PATCH-description`
- To restore a known-good state: `git checkout stable/modular-ui-v1`

---

## 3. Issue Labels (use these consistently)

| Label | When |
|-------|------|
| `bug` | Something broken |
| `enhancement` | New feature or improvement |
| `ui` | Frontend / visual change |
| `backend` | Server / socket / module change |
| `refactor` | Code restructure, no behavior change |
| `blocked` | Waiting on something |

---

## 4. Current Architecture (quick reference)

```
public/
  index.html              ← active entry point (modular ES modules)
  index-ori.html          ← legacy monolith (do not touch)
  ui/
    engine.js             ← OverlordUI core: Component, h(), event bus
    state.js              ← reactive Store with localStorage persistence
    socket-bridge.js      ← maps 83 socket.io events → store + dispatch
    router.js             ← layout router (mobile/desktop)
    components/
      modal.js            ← unified overlay (center/bottom-sheet/drawer/fullscreen)
      panel.js            ← collapsible/resizable/popout panels with persistence
      toast.js, tabs.js, button.js, …
    panels/               ← right-sidebar panel classes
      log.js, orchestration.js, team.js, tasks.js, activity.js, project.js, tools.js
    views/                ← full-page/modal views
      chat.js             ← main chat (streaming, plans, thoughts, images)
      settings.js         ← settings modal (General/AI/Tools/Display)
      agent-manager.js    ← agents + groups modal
      kanban.js           ← kanban board modal
    css/
      tokens.css          ← design tokens (colors, spacing, etc.)
      components.css      ← all component CSS including modals
      chat.css, effects.css, base.css, responsive.css
```

### Key patterns
- **Component lifecycle**: `new MyComponent(el, opts)` → `component.mount()`
- **Event delegation**: `this.on('click', '#selector', handler)` — scoped to component root
- **Store reactivity**: `store.subscribe('key', fn)` — fires on every future change
- **Modal**: `Modal.open(id, { title, content, size, position })` / `Modal.close(id)`
- **Panel visibility**: `togglePanelVisibility(panelId)` — persists to localStorage automatically

### Default panel state (first load)
Only **LOG** and **ORCHESTRATION** are visible. Others are off but togglable via:
- Toolbar icon buttons (quick toggle)
- ⚙ gear menu in the PANELS header (full configurator)
- Command menu (⚙ bottom-right) → Milestones/Projects/etc routes to relevant panel

---

## 5. What NOT to do

- Do NOT modify `index-ori.html`
- Do NOT commit directly to `main`
- Do NOT skip creating an Issue before starting significant work
- Do NOT claim something works without verifying it (use `preview_*` tools)
- Do NOT use DOM-overwriting APIs — always use `createElement` / `appendChild`
- Do NOT add inline styles when a CSS class already covers it
