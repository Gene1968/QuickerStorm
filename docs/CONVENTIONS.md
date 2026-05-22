# Conventions — quickerSTORM

> Include this file (with `PROJECT_BRIEF.md`) in AI prompt context for consistent output. This file is the single place for style rules in this repo (aligned with the company **AI-Assisted Development** guide: `../ai-assisted-workflow/docs/main-guide.md`).

## File & Folder Naming

- **Vue SFCs:** PascalCase for components: `ListView.vue`, `HomeView.vue`.
- **Stores / composables / utils:** camelCase files where the repo already uses them: `requestsStore.js`, `useAllTasks.js`.
- **Config:** `src/config/*.json`, `configuration.js`, `appListSchemas.js`.

## Code Style

- **Imports:** Use `@/` alias as established in the project (`jsconfig.json` paths).
- **Config:** Always load app config via `import { config } from '@/config/configuration.js'`.

### Indentation

- **Always use tabs**, never spaces.

### CSS units and Tailwind

- **Prefer `rem` over `px`** for sizing, spacing, font sizes, and layout values.  VW/clamp() used for full-responsiveness when possible.
- Exception: **borders of 1–5px** may stay in `px` (e.g. `border-1`, `border-2`, `border-[3px]`).
- Exception: very small pixel-precise values where `rem` would be awkward (e.g. `1px` box shadows, `2px` outlines).
- Use Tailwind utility classes as the primary styling approach.
- For arbitrary values, prefer `rem`-based where Tailwind's scale doesn't cover it (e.g. `w-[14rem]` not `w-[224px]`).
- Border widths in `px` are fine (`border`, `border-2`, `border-[3px]`).

### Styling layer rule — where CSS lives

Use this priority order; only go further down the list when the one above can't do it:

1. **Tailwind utility classes in the template** — layout, spacing, flex/grid, positioning, border-radius, text size/weight, transitions, `z-index`. Use `bg-card`, `text-t1`, `border-brd2`, etc. — defined in `tailwind.config.js` as CSS-var references so they follow the light/dark theme.
2. **Bootstrap utility / component classes** when they already help (grid helpers, visibility, etc.) — do not fight the theme; prefer TW theme tokens when both could work.
3. **`ava-panel` / `ava-btn`** (and other classes in `src/index.css` `@layer components`) — repeated themed card/button patterns instead of duplicating the same TW cluster everywhere.
4. **`<style scoped>`** — keep this **small**: one-off numbers, pseudo-elements, keyframes, gradients, Vue `<Transition>` classes, or `@apply` to bundle TW when the template would otherwise be noisy. **Do not** put ordinary layout, spacing, flexbox, or standard theme colors only in `<style>` — those belong in the template as TW (or Bootstrap) classes.

### Theme-aware colors

The quickerSTORM palette in `tailwind.config.js` (`bg`, `card`, `t1`, `accent`, etc.) uses `var(--color-*)` so `bg-card`, `text-t1`, `border-brd` etc. correctly switch between dark (`:root`) and light (`html.light`) themes.

⚠️ Opacity modifiers (`bg-card/50`) do **not** work with CSS-var colors. Use `rgba()` inline style or a `bg-[rgba(...)]` arbitrary class when you need translucency.

### Vue SFCs

- **Composition API** with `<script setup>`.
- Keep `<script setup>` before `<template>` before `<style>`.

## Naming Conventions

| Thing | Convention | Example |
| --- | --- | --- |
| Pinia stores | `*Store` suffix | `requestsStore`, `userStore` |
| Composables | `use*` prefix | `useAllTasks` |
| Supabase columns | PascalCase column names in Supabase match legacy app-level field shapes | `RoomId`, `LastSeen`, `AvatarState` |
| Route params | Existing router patterns | See `src/router/index.js` |

## Git & AI-Assisted Work

- **Feature branches for AI work:** `ai/feature-name` until reviewed and merged (company standard).
- **Conventional Commits** style: `feat(scope): short description`.
- **AI-assisted commits** — include traceability (adapt to your tooling), for example:

```text
feat(module): short description

- Generated with AI assistance (tool: [name], model: [version])
- Prompt ref: `docs/prompts/your-prompt.md`
- Human reviewed: [name]
- Changes from AI output: [brief summary]
```

## Error Handling

- Do not swallow API/Supabase errors silently; surface or log in line with existing patterns in stores and views.
- User-facing messages should stay readable; raw errors for debugging only where appropriate.

## Comments

- `// WHY:` for non-obvious logic.
- `// TODO:` for known shortcuts — also add an entry in `tech-debt.md` when it is a real debt item.
- No commented-out code on main.

## AI Session Hygiene

- After significant sessions, add a log under `docs/ai-sessions/YYYY-MM-DD-topic.md`.
- Architectural choices → `docs/adr/NNNN-title.md`.
- Phase milestones → `docs/progress/reports/` when using phased plans under `docs/planning/docs/`.
