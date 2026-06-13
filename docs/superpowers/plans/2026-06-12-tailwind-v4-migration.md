# Tailwind v3 → v4 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade QuickerStorm from Tailwind CSS 3.4.18 (PostCSS) to Tailwind CSS v4 (Vite-native plugin), renaming all affected utility classes to preserve visual fidelity.

**Architecture:** Replace the `tailwindcss` + PostCSS pipeline with `@tailwindcss/vite`, keep the existing `tailwind.config.js` unchanged (referenced via `@config`), then do five regex/targeted renames across `src/` to match v4's shifted utility scales.

**Tech Stack:** Tailwind CSS v4 (`@tailwindcss/vite`), Vite 6, Vue 3 SFCs, PowerShell

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `package.json` | Modify | Remove 4 packages, add `@tailwindcss/vite` |
| `vite.config.js` | Modify | Import + wire `tailwindcss()` plugin |
| `postcss.config.js` | **Delete** | Entire file; no longer needed |
| `src/index.css` | Modify | Lines 1–3: `@tailwind` → `@import` + `@config` |
| `tailwind.config.js` | Modify | Remove `'@tailwindcss/container-queries'` from plugins |
| `src/**/*.vue`, `src/**/*.js` | Modify | 5 class rename passes (~220 instances total) |

---

## Task 1: Swap packages

**Files:** `package.json`

- [ ] **Step 1: Install @tailwindcss/vite**

```powershell
npm install @tailwindcss/vite@latest --save-dev
```

Expected: package installs without errors; `@tailwindcss/vite` appears in `package.json` devDependencies.

- [ ] **Step 2: Remove the four obsolete packages**

```powershell
npm uninstall tailwindcss autoprefixer postcss postcss-nesting
```

Expected: all four removed from `package.json` and `node_modules`.

- [ ] **Step 3: Verify package.json devDependencies**

Run:
```powershell
Get-Content package.json | Select-String 'tailwindcss|autoprefixer|postcss'
```

Expected output — exactly these lines (no `tailwindcss`, `autoprefixer`, `postcss`, `postcss-nesting`):
```
"@tailwindcss/vite": "^4.x.x",
```

---

## Task 2: Wire the Vite plugin

**Files:** `vite.config.js`

- [ ] **Step 1: Add the import**

In `vite.config.js`, add one import at the top alongside the existing imports:

```js
// add after:  import vue from "@vitejs/plugin-vue"
import tailwindcss from '@tailwindcss/vite'
```

- [ ] **Step 2: Add the plugin to the plugins array**

Find the `const plugins = [vue({` block (around line 22) and add `tailwindcss()` as the second entry:

```js
const plugins = [
    vue({
        template: {
            compilerOptions: {
                isCustomElement: (tag) => tag === 'emoji-picker',
            },
        },
    }),
    tailwindcss(),
]
```

---

## Task 3: Delete postcss.config.js

**Files:** `postcss.config.js` → deleted

- [ ] **Step 1: Delete the file**

```powershell
Remove-Item postcss.config.js
```

Expected: file is gone; `git status` shows it as deleted.

---

## Task 4: Update the CSS entry point

**Files:** `src/index.css` lines 1–3

- [ ] **Step 1: Replace the three @tailwind directives**

The current lines 1–3 of `src/index.css` are:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Replace them with:
```css
@import "tailwindcss";
@config "../tailwind.config.js";
```

Everything from line 4 onward (CSS variables, `@layer components`, etc.) stays **exactly as-is**.

> `@config` is resolved relative to the CSS file. `src/index.css` → `../tailwind.config.js` resolves to the project root config.

- [ ] **Step 2: Verify the top of the file looks correct**

```powershell
Get-Content src/index.css -TotalCount 6
```

Expected:
```
@import "tailwindcss";
@config "../tailwind.config.js";

/* ── Dark theme variables — earth / rust ─────────────────────────── */
/*
 * Palette shades used here:
```

---

## Task 5: Remove the container-queries plugin entry

**Files:** `tailwind.config.js`

- [ ] **Step 1: Remove the string plugin entry**

In `tailwind.config.js`, find the `plugins` array near the bottom. It currently reads:

```js
plugins: [
    '@tailwindcss/container-queries',
    plugin(({ addBase, theme }) => {
```

Remove the first line so it becomes:

```js
plugins: [
    plugin(({ addBase, theme }) => {
```

The `plugin(...)` function and everything inside it is unchanged.

---

## Task 6: Infrastructure smoke-test and commit

- [ ] **Step 1: Install updated lockfile**

```powershell
npm install
```

Expected: no peer-dep errors. The `node_modules` now include `@tailwindcss/vite` and no top-level `tailwindcss` or `autoprefixer`.

- [ ] **Step 2: Start the dev server**

```powershell
npm run dev
```

Expected: Vite starts on port 5174 (or next available), no PostCSS errors in the output. The app loads in the browser. Styles render — border radii and shadows may look very slightly different (class renames come in subsequent tasks), but nothing should be broken or unstyled.

- [ ] **Step 3: Confirm no PostCSS-related errors**

The output should NOT contain any of:
- `Cannot find module 'tailwindcss/nesting'`
- `Cannot find module 'autoprefixer'`
- `PostCSS plugin`

Stop the dev server (Ctrl+C).

- [ ] **Step 4: Run a production build**

```powershell
npm run build:staging
```

Expected: build completes, outputs to `dist/staging/`, no Tailwind or Vite errors.

- [ ] **Step 5: Commit the infrastructure changes**

```powershell
git add package.json package-lock.json vite.config.js src/index.css tailwind.config.js
git rm postcss.config.js
git commit -m "chore(tw): upgrade Tailwind 3→4 via @tailwindcss/vite

Replace PostCSS pipeline with Vite-native plugin. Keep tailwind.config.js
intact via @config directive. Remove @tailwindcss/container-queries (built-in).
Remove tailwindcss, autoprefixer, postcss, postcss-nesting packages."
```

---

## Task 7: Rename `rounded-sm` → `rounded-xs`  *(MUST run before Task 8)*

**Files:** `src/**/*.vue`, `src/**/*.js`

> **Why first:** Task 8 renames bare `rounded` → `rounded-sm`. If Task 8 ran first, the existing `rounded-sm` instances would then be processed by Task 8's regex and double-renamed to `rounded-sm-sm`. Always do `rounded-sm → rounded-xs` first.

- [ ] **Step 1: Run the replace**

```powershell
$files = Get-ChildItem src -Recurse -Include "*.vue","*.js"
foreach ($f in $files) {
    $text = [System.IO.File]::ReadAllText($f.FullName)
    $new  = $text -replace 'rounded-sm', 'rounded-xs'
    if ($text -ne $new) { [System.IO.File]::WriteAllText($f.FullName, $new) }
}
```

- [ ] **Step 2: Verify exactly 1 replacement**

```powershell
git diff --stat src/
```

Expected: `src/components/MapFloater.vue | 2 +-` (1 file, the one instance at line 927 plus the `-sm` in `rounded-xs` are both in that file).

```powershell
git diff src/ | Select-String 'rounded-xs|rounded-sm'
```

Expected: lines showing `-rounded-sm` → `+rounded-xs` only in `MapFloater.vue`.

- [ ] **Step 3: Verify no accidental renames in CSS property names**

```powershell
git diff src/ | Select-String 'border-radius.*rounded'
```

Expected: no output (no CSS property values should have changed).

---

## Task 8: Rename `rounded` (bare) → `rounded-sm`

**Files:** `src/**/*.vue`, `src/**/*.js`

This is the largest rename (~184 instances). The regex `rounded(?![-\w])` matches `rounded` only when NOT followed by a hyphen or word character, so `rounded-lg`, `rounded-xl`, `rounded-full` etc. are untouched.

- [ ] **Step 1: Run the replace**

```powershell
$files = Get-ChildItem src -Recurse -Include "*.vue","*.js"
foreach ($f in $files) {
    $text = [System.IO.File]::ReadAllText($f.FullName)
    $new  = $text -replace 'rounded(?![-\w])', 'rounded-sm'
    if ($text -ne $new) { [System.IO.File]::WriteAllText($f.FullName, $new) }
}
```

- [ ] **Step 2: Confirm no rounded-lg/xl/full was touched**

```powershell
git diff src/ | Select-String '\+.*rounded-(lg|xl|full|2xl|3xl|none)'
```

Expected: no output (none of these variants should appear in the `+` diff lines as new additions — they may appear as unchanged context lines, which is fine).

- [ ] **Step 3: Spot-check the diff for false positives**

```powershell
git diff src/ | Select-String '\+.*rounded-sm' | Select-Object -First 20
```

Scan through the output. Every `rounded-sm` on a `+` line should be inside a `class="…"` string or an `@apply` directive. If any appear in a comment or raw CSS property value, revert that file and fix manually:

```powershell
# To revert a single file if needed:
git checkout src/components/<filename>.vue
# Then manually edit the file to apply only the class-attribute renames
```

- [ ] **Step 4: Verify no `rounded-xs` was created by this task**

```powershell
git diff src/ | Select-String '\+.*rounded-xs'
```

Expected: no output (Task 7 already handled `rounded-sm → rounded-xs`; this task should not be creating any new `rounded-xs`).

---

## Task 9: Rename `outline-none` → `outline-hidden`

**Files:** `src/**/*.vue` (11 files, 28 instances)

> **Why:** In v4, `outline-none` = `outline: none` (bare removal). In v3 (and v4's `outline-hidden`) = `outline: 2px solid transparent; outline-offset: 2px` — visually hidden but accessibility-safe. All 28 usages are `focus:outline-none` paired with `focus:ring-*`, so this rename has no visual effect but is semantically correct.

- [ ] **Step 1: Run the replace**

```powershell
$files = Get-ChildItem src -Recurse -Include "*.vue","*.js"
foreach ($f in $files) {
    $text = [System.IO.File]::ReadAllText($f.FullName)
    $new  = $text -replace 'outline-none', 'outline-hidden'
    if ($text -ne $new) { [System.IO.File]::WriteAllText($f.FullName, $new) }
}
```

- [ ] **Step 2: Verify count**

```powershell
git diff --stat src/ | Select-String '\.vue'
```

Expected: 11 files changed (AddGridModal, AppearanceFloater, ConversationsFloater, GridSelector, InventoryFloater, LocationBar, LoginForm, MapFloater, PlacesFloater, PreferencesFloater, ProfileFloater).

```powershell
(git diff src/ | Select-String '\-.*outline-none').Count
```

Expected: 28.

- [ ] **Step 3: Confirm no outline-hidden already existed**

```powershell
git diff src/ | Select-String '\+.*outline-hidden' | Select-Object -First 5
```

All lines should show `focus:outline-hidden` (the renamed form). No raw `outline: hidden` CSS values should appear.

---

## Task 10: Rename `backdrop-blur-sm` → `backdrop-blur-xs`

**Files:** `src/components/AvatarList.vue`, `src/components/ObjectEditFloater.vue`, `src/views/WorldView.vue` (3 instances)

- [ ] **Step 1: Run the replace**

```powershell
$files = Get-ChildItem src -Recurse -Include "*.vue","*.js"
foreach ($f in $files) {
    $text = [System.IO.File]::ReadAllText($f.FullName)
    $new  = $text -replace 'backdrop-blur-sm', 'backdrop-blur-xs'
    if ($text -ne $new) { [System.IO.File]::WriteAllText($f.FullName, $new) }
}
```

- [ ] **Step 2: Verify exactly 3 instances in 3 files**

```powershell
git diff --stat src/
```

Expected: exactly `AvatarList.vue`, `ObjectEditFloater.vue`, `WorldView.vue` in the changed-file list (relative to the diff since Task 7 — you may see additional files from prior tasks; focus on `backdrop-blur` lines).

```powershell
(git diff src/ | Select-String '\-.*backdrop-blur-sm').Count
```

Expected: 3.

---

## Task 11: Rename `shadow` (bare) → `shadow-sm`

**Files:** `src/components/MapFloater.vue` (lines 758 and 818)

This rename is done manually (only 2 instances; regex risks false positives in comments and raw CSS).

- [ ] **Step 1: Confirm the exact lines to edit**

```powershell
Select-String -Path src/components/MapFloater.vue -Pattern '[" ]shadow[" ]'
```

Expected output (two lines):
```
src/components/MapFloater.vue:758:  <div class="bg-black/85 text-red-200 px-1.5 py-0.5 rounded-sm shadow"
src/components/MapFloater.vue:818:  <span class="inline-block w-3 h-3 rounded-full bg-[#7c3aed] border-2 border-white shadow"/>
```

- [ ] **Step 2: Edit MapFloater.vue line 758**

Change:
```html
<div class="bg-black/85 text-red-200 px-1.5 py-0.5 rounded-sm shadow"
```
To:
```html
<div class="bg-black/85 text-red-200 px-1.5 py-0.5 rounded-sm shadow-sm"
```

- [ ] **Step 3: Edit MapFloater.vue line 818**

Change:
```html
<span class="inline-block w-3 h-3 rounded-full bg-[#7c3aed] border-2 border-white shadow"/>
```
To:
```html
<span class="inline-block w-3 h-3 rounded-full bg-[#7c3aed] border-2 border-white shadow-sm"/>
```

- [ ] **Step 4: Verify**

```powershell
Select-String -Path src/components/MapFloater.vue -Pattern '[" ]shadow[" ]'
```

Expected: no output (no more bare `shadow` surrounded by quotes/spaces).

```powershell
git diff src/components/MapFloater.vue | Select-String 'shadow'
```

Expected: 2 `-` lines with `shadow"` and 2 `+` lines with `shadow-sm"`.

---

## Task 12: Final verification and commit

- [ ] **Step 1: Confirm no v3 class names remain**

Run each grep — all should return no output:

```powershell
# No bare rounded (only rounded-sm, rounded-lg etc. should exist)
Select-String -Path (Get-ChildItem src -Recurse -Include "*.vue","*.js") -Pattern 'class=.*\brounded\b[^-\w]'

# No outline-none in class attributes
Select-String -Path (Get-ChildItem src -Recurse -Include "*.vue") -Pattern 'class=.*outline-none'

# No backdrop-blur-sm
Select-String -Path (Get-ChildItem src -Recurse -Include "*.vue","*.js") -Pattern 'backdrop-blur-sm'

# No bare shadow in class attributes
Select-String -Path (Get-ChildItem src -Recurse -Include "*.vue","*.js") -Pattern 'class=.*[" ]shadow[" ]'
```

- [ ] **Step 2: Run the dev server and do a visual check**

```powershell
npm run dev
```

Open the app in the browser and verify:

1. **Input focus states** — click into any text input (login form, search box). You should see the accent-coloured ring with no visible outline. Identical to before.
2. **Border radii** — open PreferencesFloater, InventoryFloater, any context menu. Buttons and cards should have the same subtle rounding as before (0.25rem / 4px).
3. **Floater shadows** — open any floater. The `shadow-2xl` drop shadow should look identical.
4. **Light/dark theme** — toggle dark↔light (Ctrl+P → Appearance or bottom toolbar). All colours should switch correctly; the channel-triplet system is unchanged.
5. **Backdrop blur** — check AvatarList panel (right side of world view) — the `backdrop-blur-xs` blur should be subtle, same as before.

Stop the dev server (Ctrl+C).

- [ ] **Step 3: Run the production build**

```powershell
npm run build:staging
```

Expected: build completes cleanly, `dist/staging/` is populated, no errors.

- [ ] **Step 4: Commit the class renames**

```powershell
git add src/
git commit -m "chore(tw): rename v3 utility classes to v4 equivalents

rounded → rounded-sm (~184), rounded-sm → rounded-xs (1),
outline-none → outline-hidden (28), backdrop-blur-sm → backdrop-blur-xs (3),
shadow → shadow-sm (2). Preserves visual fidelity across the scale shift."
```

---

## Self-Review

**Spec coverage:**
- ✅ Package swap (Task 1)
- ✅ `vite.config.js` (Task 2)
- ✅ Delete `postcss.config.js` (Task 3)
- ✅ `src/index.css` entry (Task 4)
- ✅ `tailwind.config.js` plugin removal (Task 5)
- ✅ `rounded-sm → rounded-xs` (Task 7, runs first)
- ✅ `rounded → rounded-sm` (Task 8)
- ✅ `outline-none → outline-hidden` (Task 9)
- ✅ `backdrop-blur-sm → backdrop-blur-xs` (Task 10)
- ✅ `shadow → shadow-sm` (Task 11)
- ✅ Verification steps (Task 12)

**Placeholder scan:** No TBDs, no "add appropriate handling", all commands have expected output.

**Type consistency:** No function signatures across tasks; rename patterns are consistent throughout.
