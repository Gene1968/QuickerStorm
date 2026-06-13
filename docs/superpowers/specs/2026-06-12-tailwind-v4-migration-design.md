# Tailwind CSS v3 → v4 Migration Design

**Date:** 2026-06-12
**Approach:** Manual Vite-plugin migration (no codemod, JS config retained via `@config`)

---

## Background

QuickerStorm runs Tailwind 3.4.18 via PostCSS. The project uses a bespoke
channel-triplet color system (`rgb(var(--color-X-ch) / <alpha-value>)`) wired
through `tailwind.config.js` and toggled via `html.light`. This system must be
preserved intact — a CSS-first `@theme` rewrite would break the light/dark
switching mechanism, so the JS config is kept and referenced via v4's `@config`
directive.

---

## Infrastructure Changes (5 files)

### 1. Packages

```
npm install @tailwindcss/vite@latest -D
npm uninstall tailwindcss autoprefixer postcss postcss-nesting
```

| Package removed | Reason |
|-----------------|--------|
| `tailwindcss` | Engine is bundled in `@tailwindcss/vite` |
| `autoprefixer` | v4 uses Lightning CSS for vendor prefixing internally |
| `postcss` | Not needed for Vite-native Tailwind |
| `postcss-nesting` | CSS nesting is built-in in v4 |

### 2. `vite.config.js`

Add the Tailwind Vite plugin alongside the existing Vue plugin:

```js
import tailwindcss from '@tailwindcss/vite'

// in plugins array:
plugins: [
  vue({ … }),
  tailwindcss(),
  …
]
```

### 3. `postcss.config.js`

Delete the file entirely. All four of its plugins (`postcss-import`,
`tailwindcss/nesting`, `tailwindcss`, `autoprefixer`) are now unnecessary with
the Vite-native integration.

### 4. `src/index.css` — CSS entry

Replace the three `@tailwind` directives at the top of the file:

```css
/* Remove: */
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Replace with: */
@import "tailwindcss";
@config "../tailwind.config.js";
```

`@config` is resolved relative to the CSS file. From `src/index.css` the
config lives at `../tailwind.config.js`. This single directive loads the full
existing JS config — colors, fonts, fluid type scale, plugins — unchanged.

### 5. `tailwind.config.js` — remove built-in plugin

Remove the `'@tailwindcss/container-queries'` string from the `plugins` array.
Container queries are built-in in v4 and the package was never in
`package.json`. The `plugin(({ addBase, theme }) => { … })` function stays
untouched.

```js
// Remove this line from plugins array:
'@tailwindcss/container-queries',
```

---

## Class Renames

Tailwind v4 shifted the bottom of several scales (shadow, border-radius, blur)
and changed the semantics of `outline-none`. All renames are safe regex
replacements applied to `src/**/*.vue` and `src/**/*.js`.

### Rename table

| v3 class | v4 class | Count | Reason |
|----------|----------|-------|--------|
| `rounded` (bare) | `rounded-sm` | ~184 | Scale shift: bare `rounded` in v4 is ~6px; `rounded-sm` preserves the old 4px (0.25rem) value |
| `outline-none` | `outline-hidden` | 28 | v4 `outline-none` = bare `outline:none`; `outline-hidden` = 2px transparent + offset (old v3 behaviour, accessibility-safe) |
| `rounded-sm` | `rounded-xs` | 1 | Same scale shift as above |
| `backdrop-blur-sm` | `backdrop-blur-xs` | 3 | Blur scale shifted; `backdrop-blur-xs` preserves the old small-blur value |
| `shadow` (bare) | `shadow-sm` | ~3 | Shadow scale shifted; `shadow-sm` preserves the old default box-shadow |

### Regex patterns (safe, no false positives)

```
rounded(?![-\w])     →  rounded-sm
rounded-sm           →  rounded-xs      (apply BEFORE the above)
outline-none         →  outline-hidden
backdrop-blur-sm     →  backdrop-blur-xs
shadow(?![-\w])      →  shadow-sm       (applied only in class="…" context)
```

> **Order matters:** rename `rounded-sm → rounded-xs` before
> `rounded → rounded-sm`, otherwise `rounded-sm` instances get double-renamed.

### Classes confirmed NOT renamed in v4

The following are still valid in v4 with the same names and no action is needed:

- `leading-snug`, `leading-tight`, `leading-relaxed`, `leading-loose`, `leading-normal`
- `shadow-lg`, `shadow-xl`, `shadow-2xl`, `shadow-md`
- `ring-1`, `ring-2`, `ring-4` (explicit sizes; only bare `ring` changed default width 3px→1px, not present in codebase)
- `backdrop-blur-lg`, `backdrop-blur-md`, `backdrop-blur-xl` (larger blur steps are unaffected by the scale shift)

---

## Verification Steps

After applying all changes:

1. `npm install` — confirm no peer-dep warnings from old packages
2. `npm run dev` — Vite should start cleanly with no PostCSS errors
3. **Visual check:** open the app, inspect:
   - Input focus states — ring + hidden outline should look identical to before
   - Cards, buttons, and modals — border radii should be unchanged (4px)
   - Floater shadows (`shadow-2xl`, `shadow-lg`) — unchanged
4. `npm run build:staging` — confirm production build completes

---

## Out of Scope

- CSS-first `@theme` migration — the channel-triplet color system is incompatible
  with v4's `color-mix()` opacity mechanism; JS config via `@config` is the
  correct long-term home for this design system
- `tailwind.config.js` content of the `addBase` plugin — no changes needed; the
  `theme()` helper is compatible with `@config` in v4
- `sass-embedded` devDependency — unused (SCSS config is commented out in
  `vite.config.js`); leave as-is
