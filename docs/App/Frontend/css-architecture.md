# Overlord UI -- CSS Architecture

Design tokens, file organization, theming, responsive breakpoints, and visual effect patterns.

---

## File Organization

CSS files are loaded in this order in `index.html`:

| Order | File | Purpose |
|-------|------|---------|
| 1 | `ui/css/tokens.css` | Design tokens (CSS custom properties) |
| 2 | `ui/css/base.css` | Reset, typography, layout grid, focus ring, scrollbars |
| 3 | `ui/css/components.css` | All component-level styles (panels, modals, cards, buttons, etc.) |
| 4 | `ui/css/chat.css` | Chat-specific styles (messages, input, streaming) |
| 5 | `ui/css/effects.css` | Animations, keyframes, aurora, plasma, glassmorphism |
| 6 | `ui/css/responsive.css` | Breakpoints and mobile/tablet/landscape overrides |

---

## Design Tokens (tokens.css)

All design values are defined as CSS custom properties on `:root` (dark theme) with overrides on `html[data-theme="light"]`.

### Color Tokens

| Token | Dark Value | Light Value | Usage |
|-------|-----------|-------------|-------|
| `--bg-dark` | `#080b10` | `#f1f5f9` | App background |
| `--bg-panel` | `#0d1117` | `#ffffff` | Panel backgrounds |
| `--bg-input` | `#0a0d13` | `#f8fafc` | Input field backgrounds |
| `--bg-hover` | `#161c26` | `#e2e8f0` | Hover state backgrounds |
| `--bg-primary` | `#0d1117` | `#ffffff` | Primary surface |
| `--bg-secondary` | `#0a0d13` | `#f8fafc` | Secondary surface |
| `--bg-tertiary` | `#111827` | `#f1f5f9` | Tertiary surface |
| `--text-primary` | `#f0f4f8` | `#0f172a` | Primary text |
| `--text-secondary` | `#94a3b8` | `#475569` | Secondary text |
| `--text-muted` | `#4a5568` | `#94a3b8` | Muted text |

### Border Tokens

| Token | Dark Value | Light Value |
|-------|-----------|-------------|
| `--border-subtle` | `#161c26` | `#e2e8f0` |
| `--border` | `#1e2530` | `#cbd5e1` |
| `--border-color` | `#1e2530` | `#cbd5e1` |
| `--border-strong` | `#2d3748` | `#94a3b8` |

### Accent Palette

| Token | Dark Value | Light Value | Usage |
|-------|-----------|-------------|-------|
| `--accent-cyan` | `#38bdf8` | `#0284c7` | Primary accent, links |
| `--accent-green` | `#4ade80` | `#16a34a` | Success states |
| `--accent-yellow` | `#fbbf24` | `#d97706` | Warnings |
| `--accent-red` | `#f87171` | `#dc2626` | Errors, danger |
| `--accent-magenta` | `#c084fc` | `#9333ea` | Secondary accent |
| `--accent-primary` | `#38bdf8` | `#0284c7` | Alias for accent-cyan |
| `--accent-blue` | `#38bdf8` | `#0284c7` | Alias for accent-cyan |

### Electric Neon Identity Tokens

| Token | Dark Value | Light Value | Usage |
|-------|-----------|-------------|-------|
| `--electric` | `#00d4ff` | `#0284c7` | Primary brand color, glows |
| `--plasma` | `#a855f7` | `#9333ea` | Secondary brand color |
| `--neon-green` | `#00ff88` | `#16a34a` | Tertiary brand color |
| `--deep-space` | `#040608` | `#f8fafc` | Deepest background |
| `--charged` | `rgba(0,212,255,0.07)` | `rgba(2,132,199,0.07)` | Subtle cyan tint |
| `--charged-purple` | `rgba(168,85,247,0.07)` | `rgba(147,51,234,0.07)` | Subtle purple tint |

### Spacing Scale

| Token | Value |
|-------|-------|
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-5` | `24px` |
| `--space-6` | `32px` |
| `--space-7` | `40px` |
| `--space-8` | `48px` |
| `--space-9` | `64px` |

### Type Scale

| Token | Value |
|-------|-------|
| `--font-size-1` | `12px` |
| `--font-size-2` | `14px` |
| `--font-size-3` | `16px` |
| `--font-size-4` | `18px` |
| `--font-size-5` | `20px` |
| `--font-size-6` | `24px` |

### Border Radii

| Token | Value |
|-------|-------|
| `--radius-1` | `3px` |
| `--radius-2` | `6px` |
| `--radius-3` | `8px` |
| `--radius-4` | `12px` |
| `--radius-full` | `9999px` |

### Glass Effect Tokens

| Token | Dark Value | Description |
|-------|-----------|-------------|
| `--glass-bg` | `rgba(8,12,18,0.72)` | Glass background |
| `--glass-bg-raised` | `rgba(12,18,28,0.82)` | Raised glass surface |
| `--glass-border` | `rgba(255,255,255,0.08)` | Subtle glass border |
| `--glass-border-bright` | `rgba(0,212,255,0.4)` | Bright glass border (electric) |
| `--glass-inner-glow` | Linear gradient (white top) | Inner highlight |
| `--glass-shadow` | Multi-layer box-shadow | Large glass shadow with inner glow |
| `--glass-shadow-sm` | Multi-layer box-shadow | Small glass shadow |
| `--blur-md` | `blur(24px) saturate(160%)` | Medium backdrop blur |
| `--blur-sm` | `blur(14px) saturate(140%)` | Small backdrop blur |

### Glow Tokens

| Token | Description |
|-------|-------------|
| `--glow-cyan` | Cyan glow (8px + 22px layers) |
| `--glow-cyan-sm` | Small cyan glow (5px + 12px layers) |
| `--glow-green` | Green glow (8px + 20px layers) |
| `--glow-purple` | Purple glow (8px + 20px layers) |

### Miscellaneous Tokens

| Token | Value | Description |
|-------|-------|-------------|
| `--focus-ring` | box-shadow (bg-dark + electric ring) | Focus ring for accessibility |
| `--toggle-w` | `32px` | Toggle switch width |
| `--toggle-h` | `18px` | Toggle switch height |
| `--toggle-knob` | `14px` | Toggle knob diameter |
| `--scanline` | repeating-linear-gradient | CRT scanline overlay (dark only) |
| `--code-bg` | `#0d1117` / `#f1f5f9` | Code block background |

---

## Theming

### Theme Switching

Theme is controlled by the `data-theme` attribute on `<html>`:

```html
<html data-theme="dark">   <!-- default -->
<html data-theme="light">
```

The theme value is stored in the reactive store (`ui.theme`) and persisted to `localStorage` under the key `theme`.

### How It Works

1. `tokens.css` defines all tokens on `:root` and `html[data-theme="dark"]` (identical -- dark is default).
2. `html[data-theme="light"]` overrides every token with light-mode values.
3. Components reference tokens via `var(--token-name)` and automatically adapt.
4. `BroadcastChannel` syncs theme changes to pop-out windows via `theme_changed` message.

### Light Theme Element Overrides

Several elements have additional light-mode rules beyond token swaps:

| Selector | Override |
|----------|----------|
| `.panel-header::after` | Reduced opacity (0.12) |
| `.chat-msg-ai` | Light blue background, softer border |
| `#user-input` | Transparent background, inherit text color |
| `.input-wrapper` | White background, softer border |
| `.modal-overlay` | Darker overlay opacity |
| `.kanban-card` | White background |
| `.ms-card` | Near-white background |
| Agent Manager inputs | Explicit white bg + dark text |
| `--scanline` | Set to `none` (no CRT effect in light mode) |

---

## Responsive Breakpoints

Defined in `responsive.css` and `router.js`.

| Breakpoint | CSS Media Query | JS Constant | Layout |
|------------|----------------|-------------|--------|
| Desktop | `@media (min-width: 769px)` | `BP_DESKTOP = 1100` | Side-by-side chat + right panel |
| Tablet | `@media (min-width: 769px) and (max-width: 1100px)` | -- | Chat + narrow right panel (200-240px) |
| Mobile Portrait | `@media (max-width: 768px)` | `BP_MOBILE = 768` | Full-screen views, bottom tab bar |
| Mobile Landscape | `@media (max-width: 768px) and (orientation: landscape)` | -- | Side-by-side dual-pane (56%/44%) |
| Extra Small | `@media (max-width: 390px)` | -- | Ultra-compact text and controls |
| Short Viewport | `@media (max-height: 450px)` | -- | Compact status bar, input, messages |
| Portrait Safe Area | `@media (max-width: 768px) and (orientation: portrait)` | -- | Bottom nav safe area padding |

### Mobile Architecture

On mobile (portrait):
- `.chat-panel` and `.right-panel` are `position: absolute; inset: 0`.
- Only one is visible at a time, controlled by `.mobile-hidden` / `.mobile-visible` classes.
- Within the right panel, only one `.panel` has `.mobile-panel-active` and is displayed.
- The bottom tab bar (`#mobile-nav`) provides navigation between views.
- Panel dividers are hidden.
- Desktop-only elements (`.toolbar-panel-toggles`, `.panel-btn-popout`, `#panel-configurator`) are hidden.

On mobile (landscape):
- Chat and right panel display side-by-side (`flex-direction: row`).
- Panels collapse to header-only (28px); the active one expands.
- Mobile nav is hidden; panel headers act as view selectors.
- Ultra-compact status bar (32px).

### CSS Classes Set by Router

| Class | Applied To | When |
|-------|-----------|------|
| `mode-desktop` | `#app` | width > 1100px |
| `mode-tablet` | `#app` | 769px -- 1100px |
| `mode-mobile` | `#app` | <= 768px |
| `mobile-hidden` | `.chat-panel` | Non-chat mobile view active |
| `mobile-visible` | `#right-panel` | Non-chat mobile view active |
| `mobile-panel-active` | `.panel` | The one active panel on mobile |

---

## Key CSS Patterns

### Glass Effect

The signature glass effect uses semi-transparent backgrounds with backdrop blur:

```css
.element {
    background: var(--glass-bg);
    backdrop-filter: var(--blur-md);
    -webkit-backdrop-filter: var(--blur-md);
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
}
```

Used on: panels, modals, cards (glass variant), status bar.

### Aurora Effect

A breathing border animation that cycles between electric cyan and plasma purple:

```css
@keyframes auroraBreath {
    0%, 100% { border-color: rgba(0,212,255,0.55); }
    40%      { border-color: rgba(168,85,247,0.60); }
    70%      { border-color: rgba(0,212,255,0.42); }
}
```

Used on: input wrapper during processing, agent toasts.

### Plasma Breathe

A pulsing box-shadow glow:

```css
@keyframes plasma-breathe {
    0%, 100% { box-shadow: 0 0 6px rgba(0,212,255,0.28); }
    50%      { box-shadow: 0 0 12px rgba(0,212,255,0.6), 0 0 48px rgba(0,212,255,0.07); }
}
```

Used on: status indicators, active agent cards.

### Neon Flicker

A subtle opacity flicker imitating neon signage:

```css
@keyframes neon-flicker {
    0%, 89%, 91%, 93%, 100% { opacity: 1; }
    90%, 92% { opacity: 0.78; }
}
```

Used on: status dot when active.

### Materialize

Entry animation for new elements (messages, cards):

```css
@keyframes materialize {
    from { opacity: 0; filter: blur(3px); transform: translateY(5px) scale(0.99); }
    to   { opacity: 1; filter: blur(0);   transform: translateY(0) scale(1); }
}
```

### Plasma Sweep

A highlight bar that sweeps across an element:

```css
@keyframes plasmaSweep {
    0%   { transform: translateX(-120%) skewX(-8deg); opacity: 0; }
    100% { transform: translateX(220%) skewX(-8deg);  opacity: 0; }
}
```

### Scanline Overlay

A CRT-style scanline effect (dark theme only, disabled in light):

```css
--scanline: repeating-linear-gradient(
    0deg,
    transparent 0px, transparent 3px,
    rgba(0,0,0,0.018) 3px, rgba(0,0,0,0.018) 4px
);
```

### Electric Arc

An animated CSS `@property` for rotating gradients:

```css
@property --arc {
    syntax: '<angle>';
    inherits: false;
    initial-value: 0deg;
}

@keyframes electric-arc { to { --arc: 360deg; } }
```

---

## Additional Keyframes

| Keyframe | Purpose |
|----------|---------|
| `spin` | 360-degree rotation (loading spinners) |
| `fadeIn` | Opacity 0->1 with slight upward translate |
| `aurora-border` | Border color cycling (purple -> cyan -> purple) |
| `toast-out` | Toast exit animation (not defined in effects.css, used inline) |

---

## Focus Management

Follows Radix-style focus-visible pattern:

```css
:focus { outline: none; }
:focus-visible {
    box-shadow: 0 0 0 2px var(--bg-dark),
                0 0 0 3px var(--electric),
                var(--glow-cyan-sm);
}
```

Input elements receive a neon focus ring (defined in `base.css`).

---

## Base Typography

| Property | Value |
|----------|-------|
| Font family | `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` |
| Base font size | `var(--font-size-2)` (14px) |
| Line height | `1.5` |
| Body background | `linear-gradient(160deg, #080e18 0%, #0d1117 40%, #070b0f 100%)` (dark) |

---

## Scrollbar Styling

Custom scrollbars are defined in `base.css`:
- Width: 6px (desktop), 3px (mobile).
- Track: transparent.
- Thumb: `var(--border)` with hover brightening.
