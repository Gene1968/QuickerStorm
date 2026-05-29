# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

quickerSTORM — web-based 3D viewer for OpenSimulator and Second Life. Users see their avatar in a Three.js scene, move around, chat, use proximity voice, interact with objects, teleport, and cross regions — without installing a thick client.

## Commands

```sh
# Frontend dev server (port 5173)
npm run dev

# Bun WS server (port 8787) — run in a second terminal
npm run dev:server

# Lint (auto-fix)
npm run lint

# Format src/
npm run format

# Build targets
npm run build:staging    # → dist/staging/
npm run build:prod       # → dist/usaf/ + index.aspx (SharePoint host)
```

Copy `.env.development.local-example` → `.env.development.local` before first run. The file selects the WS server (`VITE_SIGNAL_URL`) — point to `ws://localhost:8787` for local or the staging Railway URL to skip running the server locally.

## Architecture

### Frontend → Bun WS → Supabase

- **Vite SPA** served standalone or from SharePoint (`mode=im|production` → `index.aspx` + `VITE_PATH` base).
- **Bun WS server** (`server/index.ts`) handles signaling, presence relay, pose sync, chat, cursors, reactions — all in real time. Modular handlers under `server/handlers/`.
- **Hash-based routing** (`createWebHashHistory`) — required for SharePoint and standalone embedding. Two routes: `/setup` and `/office`. All unknown paths → `/office`.

### Key Composables

| File | Role |
|------|------|
| `src/composables/usePresence.js` | ⚠️ Most complex module — heartbeat, upsert, session ownership, away/offline timers. **Read fully before editing.** |
| `src/composables/useRealtimeSocket.js` | Singleton WS connection; all feature composables send/receive through it |
| `src/composables/useProximityVoice.js` | WebRTC voice — peer connections, VAD, mic/speaker, signaled via WS |
| `src/composables/useMessaging.js` | DM + group messaging via Supabase Realtime |
| `src/composables/usePoseSync.js` | Per-room avatar pose relay |
| `src/composables/useWorldEngine.js` | Three.js scene, avatar meshes, door meshes, room geometry |
| `src/composables/useTheme.js` | Light/dark toggle, shared `isDark` ref |
| `src/composables/useVersionCheck.js` | Polls `version.json` every 5 min; shows reload banner |

### Pinia Stores

`src/stores/` — `avatarStore` (identity, colors, avatar config, status), `presenceStore`, `officeStore`, `userStore`, `AuthStore`, `theme`, `error`.

Naming: stores use `*Store` suffix; composables use `use*` prefix.

### Three.js / 3D Engine

`useOfficeEngine.js` owns the Three.js scene. GSAP handles tweening. Door meshes animate open/close and block navigation when locked. Avatar meshes are built from `avatarStore` config (colors, skin, hair).

## Presence System Warning

`usePresence.js` manages multi-device session arbitrage via a per-tab `sessionId` stored in `sessionStorage`. Only one tab "owns" the presence row at a time — others show `SessionDisplacedModal`. Heartbeat and hidden-tab ownership checks are tightly coupled; changing any interval affects offline/away detection across all peers. **Do not modify `usePresence.js` without reading the full file first.**

## Code Style

- **Tabs**, not spaces (enforced via `.editorconfig`).
- Vue SFCs: `<script setup>` composition API. Order: `<script setup>` → `<template>` → `<style scoped>`.
- **Styling priority**: Tailwind utility classes first → `qs-panel`/`qs-btn` layer components (`src/index.css @layer components`) → `<style scoped>` last resort.
- **Theme colors**: Use Tailwind tokens (`bg-card`, `text-t1`, `border-brd`, `text-accent`, etc.) — these reference CSS vars defined in `index.css` and switch automatically with `html.light`. **Opacity modifiers (`bg-card/50`) do not work with CSS-var colors** — use `rgba()` inline or arbitrary class.
- **Units**: `rem` for sizing/spacing/fonts. Border widths may use `px` (`border-2`, `border-[3px]`).
- Import paths use `@/` for `src/` and `@shared/` for `shared/`.
- Config always via `import { config } from '@/config/configuration.js'`.

## Agent Model Selection

When spawning subagents via the Agent tool, match model to task complexity:

| Task type | Model |
|-----------|-------|
| Explore, search, grep, read-only lookups | `haiku` |
| Focused single-file impl, simple edits | `sonnet` |
| Complex multi-file work, architecture, planning | omit (inherits) or `opus` |

Pass `"model": "haiku"` or `"model": "sonnet"` explicitly. Default inherits parent model — always specify for cost control.

## Git

- Feature branches: `ai/feature-name` for AI-assisted work.
- Conventional Commits: `feat(scope): short description`.
- AI-assisted commits include: tool, model, prompt ref, reviewer name, delta from AI output.
- `// WHY:` comments for non-obvious logic. `// TODO:` + entry in `docs/tech-debt.md` for known debt.
- No commented-out code on `main`.

## Docs

- `docs/PROJECT_BRIEF.md` — goals, constraints, success metrics.
- `docs/CONVENTIONS.md` — full style and workflow rules (authoritative).
- `docs/CONTEXT.md` — AI session context, key file map, presence system detail.
- `docs/tech-debt.md` — known shortcuts to revisit.
- After significant AI sessions → `docs/ai-sessions/YYYY-MM-DD-topic.md`.
- Architectural decisions → `docs/adr/NNNN-title.md`.
