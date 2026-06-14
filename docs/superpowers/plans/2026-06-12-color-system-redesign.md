# Color System Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the opaque `t1/t2/tm/brd/card` token set with semantic `fg/edge/panel` tokens derived from an abstract `--primary-*` palette block that can be swapped in one edit.

**Architecture:** Three layers in `src/index.css` — palette block (swap to change theme), semantic layer (maps palette steps to roles), light-mode override (reassigns semantic refs to opposite steps). `tailwind.config.js` maps the semantic vars to Tailwind utility names. Component files do a mechanical find-replace of old token names.

**Tech Stack:** Tailwind CSS v4, CSS custom properties, PowerShell for bulk renames.

---

## Files Changed

| File | Change |
|------|--------|
| `src/index.css` | Replace `:root` + `html.light` color blocks; update all raw `var(--color-*)` refs |
| `tailwind.config.js` | Replace `extend.colors` semantic entries |
| `src/**/*.vue`, `src/**/*.js` | Token renames (~600 instances, 36 files) |

---

### Task 1: Replace `:root` color block in `src/index.css`

**Files:**
- Modify: `src/index.css:7-63`

- [ ] **Step 1: Replace the entire dark-theme `:root` block**

Replace lines 7–63 of `src/index.css` (from the comment `/* ── Dark theme variables` through the closing `}`) with:

```css
/* ── PALETTE (swap this block to change theme) ──────────────────── */
/*
 * Replace --primary-1..9 and their -ch triplets to change the entire colour scheme.
 * Semantic tokens below reference these — nothing else needs editing.
 * Scale: 1 = darkest, 9 = lightest.
 */
:root {
	color-scheme: dark;

	/* primary scale */
	--primary-1: #200B05;   --primary-1-ch: 32 11 5;
	--primary-2: #40160B;   --primary-2-ch: 64 22 11;
	--primary-3: #602010;   --primary-3-ch: 96 32 16;
	--primary-4: #802B16;   --primary-4-ch: 128 43 22;
	--primary-5: #A0361B;   --primary-5-ch: 160 54 27;
	--primary-6: #B35E49;   --primary-6-ch: 179 94 73;
	--primary-7: #C68676;   --primary-7-ch: 198 134 118;
	--primary-8: #D9AFA4;   --primary-8-ch: 217 175 164;
	--primary-9: #ECD7D1;   --primary-9-ch: 236 215 209;

	/* accent: interactive / highlight */
	--accent:       #E9972D;   --accent-ch:       233 151 45;
	--accent-dark:  #C4501B;   --accent-dark-ch:  196 80 27;
	--accent-light: #F2C181;   --accent-light-ch: 242 193 129;

	/* green: alt surface family (sidebar, panel-alt) */
	--green-deep:   #081610;   --green-deep-ch:   8 22 16;
	--green-dark:   #1A3726;   --green-dark-ch:   26 55 38;
	--green-mid:    #2B5B3F;   --green-mid-ch:    43 91 63;
	--green-light:  #D5DED9;   --green-light-ch:  213 222 217;

	/* functional (not palette-derived) */
	--color-blue: #2979ff;
	--color-red:  #f44336;

	/* ── SEMANTIC TOKENS (don't edit — edit the palette above) ──────── */
	--surface:      var(--primary-1);   --surface-ch:      var(--primary-1-ch);
	--panel:        var(--primary-3);   --panel-ch:        var(--primary-3-ch);
	--panel-alt:    var(--green-dark);  --panel-alt-ch:    var(--green-dark-ch);
	--sidebar:      rgb(var(--green-deep-ch) / 0.93);
	--sidebar-ch:   var(--green-deep-ch);
	--edge:         var(--primary-4);   --edge-ch:         var(--primary-4-ch);
	--edge-strong:  var(--primary-5);   --edge-strong-ch:  var(--primary-5-ch);
	--fg:           var(--primary-9);   --fg-ch:           var(--primary-9-ch);
	--fg-subtle:    var(--primary-7);   --fg-subtle-ch:    var(--primary-7-ch);
	--fg-muted:     var(--primary-6);   --fg-muted-ch:     var(--primary-6-ch);

	/* floater alpha surfaces — auto-follow panel when palette changes */
	--floater:      rgb(var(--panel-ch) / 0.85);
	--floater-sm:   rgb(var(--panel-ch) / 0.45);
	--floater-lg:   rgb(var(--panel-ch) / 0.95);

	/* layout — unchanged */
	--sidebar-w:            clamp(9rem, 15vw, 19rem);
	--sidebar-collapsed-w:  3.25rem;
	--canvas-left:          var(--sidebar-w);
}
```

- [ ] **Step 2: Verify the file looks right**

```powershell
Select-String -Path src/index.css -Pattern '--primary-1' | Select-Object -First 3
```
Expected: lines showing `--primary-1: #200B05` and `--primary-1-ch: 32 11 5`

---

### Task 2: Replace `html.light` block in `src/index.css`

**Files:**
- Modify: `src/index.css:65-96`

- [ ] **Step 1: Replace the entire `html.light` block**

Replace lines 65–96 (from `/* ── Light theme` through the closing `}`) with:

```css
/* ── LIGHT MODE — reassigns semantic tokens to opposite palette ends ── */
html.light {
	color-scheme: light;
	--surface:      var(--primary-9);   --surface-ch:      var(--primary-9-ch);
	--panel:        var(--primary-8);   --panel-ch:        var(--primary-8-ch);
	--panel-alt:    var(--green-light); --panel-alt-ch:    var(--green-light-ch);
	--sidebar:      rgb(var(--accent-ch) / 0.88);
	--sidebar-ch:   var(--accent-ch);
	--edge:         var(--primary-6);   --edge-ch:         var(--primary-6-ch);
	--edge-strong:  var(--primary-5);   --edge-strong-ch:  var(--primary-5-ch);
	--fg:           var(--primary-1);   --fg-ch:           var(--primary-1-ch);
	--fg-subtle:    var(--primary-3);   --fg-subtle-ch:    var(--primary-3-ch);
	--fg-muted:     var(--primary-4);   --fg-muted-ch:     var(--primary-4-ch);
	--accent:       var(--primary-5);   --accent-ch:       var(--primary-5-ch);
	--accent-dark:  var(--primary-4);   --accent-dark-ch:  var(--primary-4-ch);
	--accent-light: var(--primary-6);   --accent-light-ch: var(--primary-6-ch);
	--fp-svg-bg:    #FDECD8;
}
```

---

### Task 3: Update raw `var(--color-*)` refs throughout `src/index.css`

**Files:**
- Modify: `src/index.css` (the `@layer components` block and rules below it)

The `@layer components` block and the global rules below it still reference the old `--color-*` vars. Update them all.

- [ ] **Step 1: Update `.reset-input` (lines ~126-135)**

```css
.reset-input {
	-webkit-appearance: none;
	appearance: none;
	background-color: var(--panel-alt);
	border: 1px solid var(--edge);
	color: var(--fg);
}
.reset-input::placeholder {
	color: var(--fg-subtle);
}
```

- [ ] **Step 2: Update `.qs-btn-mini` (line ~139)**

```css
.qs-btn-mini {
	@apply px-2 py-0.5 text-2xs rounded border border-edge text-fg hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed;
}
```

- [ ] **Step 3: Update `.ui-select option` and `.ui-btn` / `.floater button` rules (lines ~152-180)**

```css
.ui-select option {
	background-color: var(--surface);
	padding: 0.35rem;
	color: var(--fg);
	transition: color 0.15s, border-color 0.15s, background 0.15s;
}
:where(.floater button:not(.custom)),
.ui-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	background-color: var(--surface);
	padding: 0.35rem;
	color: var(--fg-subtle);
	transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.floater button:hover {
	background: rgba(255, 255, 255, 0.05);
	border-color: var(--accent);
	color: var(--fg);
}
.floater button svg:not(.custom) {
	width: 1rem;
	height: 1rem;
}
.floater button.arrowctrl {
	background-color: var(--panel);
	padding: 0.35rem 0.125rem;
}
```

- [ ] **Step 4: Update `.floater .tabs` and `.floater .vtabs` rules (lines ~182-221)**

```css
.floater .tabs {
	@apply inline-flex shrink-0 border-b border-edge
}
.floater .tabs button:not(.sq) {
	flex: 1;
	background: none;
	border: none;
	border-bottom: 2px solid transparent;
	border-radius: 0;
	padding: 0.375rem 0.75rem;
	font-size: 0.6875rem;
	color: var(--fg-subtle);
	cursor: pointer;
	transition: color 0.12s, border-color 0.12s, background 0.12s;
}
.floater .tabs button:hover {
	background: rgba(255, 255, 255, 0.04);
	color: var(--fg);
}
.floater .tabs button.active {
	@apply text-accent border-accent
}

.floater .vtabs {
	@apply flex flex-col shrink-0 border-r border-edge overflow-y-auto;
}
.floater .vtabs > div {
	@apply flex items-center justify-between;
}
.floater .vtabs button:not(.block) {
	background: none;
	@apply flex items-center gap-1 py-4 px-1 text-xs transition-colors border-l-2 border-transparent w-full;
}
.floater .vtabs button:not(.block):hover {
	background: rgba(255, 255, 255, 0.06);
	color: var(--fg);
}
.floater .vtabs button:not(.block).active {
	@apply bg-white/10 text-accent border-accent-light
}
```

- [ ] **Step 5: Update autofill rules (lines ~226-235)**

```css
input.reset-input:-webkit-autofill,
input.reset-input:-webkit-autofill:hover,
input.reset-input:-webkit-autofill:focus,
input.bg-panel-alt:-webkit-autofill,
input.bg-panel-alt:-webkit-autofill:hover,
input.bg-panel-alt:-webkit-autofill:focus {
	-webkit-box-shadow: 0 0 0 1000px var(--panel-alt) inset !important;
	-webkit-text-fill-color: var(--fg) !important;
	caret-color: var(--fg);
}

/* Same appearance reset when using bg-panel-alt utility directly on inputs */
input.bg-panel-alt,
textarea.bg-panel-alt {
	-webkit-appearance: none;
	appearance: none;
}
```

- [ ] **Step 6: Update `@layer base` and global rules (lines ~248-278)**

In `@layer base`:
```css
html {
	font-family: 'RobotoFlex', system-ui, sans-serif;
	background: var(--surface);
	color: var(--fg);
	min-height: 100vh;
	overflow: hidden;
	-webkit-font-smoothing: antialiased;
}
```

Scrollbar thumb (line ~269):
```css
::-webkit-scrollbar-thumb { background: var(--edge-strong); border-radius: 3px; }
```

`#app` background (line ~277):
```css
#app {
	display: flex;
	height: 100vh;
	overflow: hidden;
	background: var(--surface);
}
```

- [ ] **Step 7: Check for any remaining `--color-` refs in index.css**

```powershell
Select-String -Path src/index.css -Pattern 'var\(--color-(?!blue|red)'
```
Expected: no matches (only `--color-blue` and `--color-red` are kept).

---

### Task 4: Update `tailwind.config.js` extend.colors

**Files:**
- Modify: `tailwind.config.js:64-220`

- [ ] **Step 1: Replace the `colors:` block inside `extend`**

The existing `colors:` object starts at line 64 (after `extend: {`). Replace the entire block from `colors: {` through its closing `},` with:

```js
colors: {
	/*
	 * ── Semantic tokens — contrast-aware, auto-flip with html.light ──────
	 * These reference CSS vars defined in index.css.
	 * Opacity modifiers work (bg-panel/50) via the -ch channel-triplet vars.
	 * Do NOT put hardcoded hex here — use the palette vars in index.css.
	 */
	surface:        'rgb(var(--surface-ch) / <alpha-value>)',
	panel:          'rgb(var(--panel-ch) / <alpha-value>)',
	'panel-alt':    'rgb(var(--panel-alt-ch) / <alpha-value>)',
	sidebar:        'rgb(var(--sidebar-ch) / <alpha-value>)',
	edge:           'rgb(var(--edge-ch) / <alpha-value>)',
	'edge-strong':  'rgb(var(--edge-strong-ch) / <alpha-value>)',
	fg:             'rgb(var(--fg-ch) / <alpha-value>)',
	'fg-subtle':    'rgb(var(--fg-subtle-ch) / <alpha-value>)',
	'fg-muted':     'rgb(var(--fg-muted-ch) / <alpha-value>)',
	accent:         'rgb(var(--accent-ch) / <alpha-value>)',
	'accent-dark':  'rgb(var(--accent-dark-ch) / <alpha-value>)',
	'accent-light': 'rgb(var(--accent-light-ch) / <alpha-value>)',

	/* non-semantic — kept for direct usage */
	lighten: '#ffffff51',
	darken:  '#00000051',
	nav:     '#2E2B3B',
},
```

- [ ] **Step 2: Verify build passes**

```powershell
npm run build:staging 2>&1 | Select-Object -Last 5
```
Expected: `✓ built in Xs` — no errors. Utilities will be missing from components (visual breakage) but the build itself passes.

---

### Task 5: Rename surface/bg tokens in `src/`

Order matters: rename more-specific patterns before less-specific to avoid double-replacement.

**Files:** All `src/**/*.vue` and `src/**/*.js`

- [ ] **Step 1: `bg-card2` → `bg-panel-alt`**

```powershell
cd "C:\Users\gene1\Downloads\Pages\git\QuickerStorm"
$files = Get-ChildItem -Path src -Recurse -Include "*.vue","*.js"
$total = 0
foreach ($f in $files) {
    $c = Get-Content $f.FullName -Raw
    $n = $c -replace 'bg-card2', 'bg-panel-alt'
    if ($c -ne $n) { Set-Content $f.FullName $n -NoNewline -Encoding UTF8; $total++ }
}
Write-Host "Files changed: $total"
```
Expected: ~5 files changed.

- [ ] **Step 2: `bg-card` → `bg-panel`**

```powershell
$files = Get-ChildItem -Path src -Recurse -Include "*.vue","*.js"
$total = 0
foreach ($f in $files) {
    $c = Get-Content $f.FullName -Raw
    $n = $c -replace 'bg-card(?!2)', 'bg-panel'
    if ($c -ne $n) { Set-Content $f.FullName $n -NoNewline -Encoding UTF8; $total++ }
}
Write-Host "Files changed: $total"
```
Expected: ~15 files changed.

- [ ] **Step 3: `bg-bg` → `bg-surface` (excluding `bg-bg2`)**

```powershell
$files = Get-ChildItem -Path src -Recurse -Include "*.vue","*.js"
$total = 0
foreach ($f in $files) {
    $c = Get-Content $f.FullName -Raw
    $n = $c -replace 'bg-bg(?!2)', 'bg-surface'
    if ($c -ne $n) { Set-Content $f.FullName $n -NoNewline -Encoding UTF8; $total++ }
}
Write-Host "Files changed: $total"
```

- [ ] **Step 4: `bg-bg2` → `bg-panel`**

```powershell
$files = Get-ChildItem -Path src -Recurse -Include "*.vue","*.js"
$total = 0
foreach ($f in $files) {
    $c = Get-Content $f.FullName -Raw
    $n = $c -replace 'bg-bg2', 'bg-panel'
    if ($c -ne $n) { Set-Content $f.FullName $n -NoNewline -Encoding UTF8; $total++ }
}
Write-Host "Files changed: $total"
```

- [ ] **Step 5: `bg-side` → `bg-sidebar`**

```powershell
$files = Get-ChildItem -Path src -Recurse -Include "*.vue","*.js")
$total = 0
foreach ($f in $files) {
    $c = Get-Content $f.FullName -Raw
    $n = $c -replace 'bg-side(?!bar)', 'bg-sidebar'
    if ($c -ne $n) { Set-Content $f.FullName $n -NoNewline -Encoding UTF8; $total++ }
}
Write-Host "Files changed: $total"
```

- [ ] **Step 6: Also rename `text-card`, `text-card2`, `text-bg` if any exist**

```powershell
Select-String -Path src/**/*.vue,src/**/*.js -Pattern 'text-card|text-bg(?!2)|text-bg2|text-side(?!bar)' | Select-Object -First 20
```
Replace any found with their semantic equivalents (`text-panel`, `text-surface`, etc.).

---

### Task 6: Rename border/ring tokens in `src/`

- [ ] **Step 1: `border-brd2` → `border-edge-strong` (before `border-brd`)**

```powershell
cd "C:\Users\gene1\Downloads\Pages\git\QuickerStorm"
$files = Get-ChildItem -Path src -Recurse -Include "*.vue","*.js"
$total = 0
foreach ($f in $files) {
    $c = Get-Content $f.FullName -Raw
    $n = $c -replace 'border-brd2', 'border-edge-strong'
    if ($c -ne $n) { Set-Content $f.FullName $n -NoNewline -Encoding UTF8; $total++ }
}
Write-Host "Files changed: $total"
```

- [ ] **Step 2: `border-brd` → `border-edge`**

```powershell
$files = Get-ChildItem -Path src -Recurse -Include "*.vue","*.js"
$total = 0
foreach ($f in $files) {
    $c = Get-Content $f.FullName -Raw
    $n = $c -replace 'border-brd(?!2)', 'border-edge'
    if ($c -ne $n) { Set-Content $f.FullName $n -NoNewline -Encoding UTF8; $total++ }
}
Write-Host "Files changed: $total"
```
Expected: ~25 files changed (195 instances).

- [ ] **Step 3: `ring-brd` variants if any**

```powershell
Select-String -Path src/**/*.vue,src/**/*.js -Pattern 'ring-brd' | Select-Object -First 10
```
Replace any found: `ring-brd2` → `ring-edge-strong`, `ring-brd` → `ring-edge`.

---

### Task 7: Rename text/fg tokens in `src/`

- [ ] **Step 1: `text-t1` → `text-fg`**

```powershell
cd "C:\Users\gene1\Downloads\Pages\git\QuickerStorm"
$files = Get-ChildItem -Path src -Recurse -Include "*.vue","*.js"
$total = 0
foreach ($f in $files) {
    $c = Get-Content $f.FullName -Raw
    $n = $c -replace 'text-t1(?!\d)', 'text-fg'
    if ($c -ne $n) { Set-Content $f.FullName $n -NoNewline -Encoding UTF8; $total++ }
}
Write-Host "Files changed: $total"
```
Expected: ~25 files changed (173 instances).

- [ ] **Step 2: `text-tm` → `text-fg-muted`**

```powershell
$files = Get-ChildItem -Path src -Recurse -Include "*.vue","*.js"
$total = 0
foreach ($f in $files) {
    $c = Get-Content $f.FullName -Raw
    $n = $c -replace 'text-tm(?![-\w])', 'text-fg-muted'
    if ($c -ne $n) { Set-Content $f.FullName $n -NoNewline -Encoding UTF8; $total++ }
}
Write-Host "Files changed: $total"
```
Expected: ~15 files changed (63 instances).

- [ ] **Step 3: `text-t2` → `text-fg-subtle`**

```powershell
$files = Get-ChildItem -Path src -Recurse -Include "*.vue","*.js"
$total = 0
foreach ($f in $files) {
    $c = Get-Content $f.FullName -Raw
    $n = $c -replace 'text-t2(?!\d)', 'text-fg-subtle'
    if ($c -ne $n) { Set-Content $f.FullName $n -NoNewline -Encoding UTF8; $total++ }
}
Write-Host "Files changed: $total"
```
Expected: ~8 files changed (14 instances).

---

### Task 8: Rename accent variant tokens in `src/`

- [ ] **Step 1: Rename `accent2` → `accent-dark` everywhere**

This covers `text-accent2`, `bg-accent2`, `border-accent2`, `ring-accent2`.

```powershell
cd "C:\Users\gene1\Downloads\Pages\git\QuickerStorm"
$files = Get-ChildItem -Path src -Recurse -Include "*.vue","*.js"
$total = 0
foreach ($f in $files) {
    $c = Get-Content $f.FullName -Raw
    $n = $c -replace 'accent2', 'accent-dark'
    if ($c -ne $n) { Set-Content $f.FullName $n -NoNewline -Encoding UTF8; $total++ }
}
Write-Host "Files changed: $total"
```

- [ ] **Step 2: Rename `accent3` → `accent-light` everywhere**

```powershell
$files = Get-ChildItem -Path src -Recurse -Include "*.vue","*.js"
$total = 0
foreach ($f in $files) {
    $c = Get-Content $f.FullName -Raw
    $n = $c -replace 'accent3', 'accent-light'
    if ($c -ne $n) { Set-Content $f.FullName $n -NoNewline -Encoding UTF8; $total++ }
}
Write-Host "Files changed: $total"
```

---

### Task 9: Migrate `text-white` → `text-fg` (selective)

218 uses of `text-white`. Not all should change — only those on themed surfaces.

**Rules:**
- `text-white` on dark surface elements (labels, body text, icon labels) → `text-fg`
- `text-white` **inside** elements that have `bg-accent`, `bg-accent-dark`, `bg-red`, `bg-green`, `bg-blue` → **keep** (intentional white-on-color)
- `bg-white/5`, `bg-white/10` hover overlays → **keep** (additive lightening)

- [ ] **Step 1: Mechanical bulk swap**

```powershell
cd "C:\Users\gene1\Downloads\Pages\git\QuickerStorm"
$files = Get-ChildItem -Path src -Recurse -Include "*.vue","*.js"
$total = 0
foreach ($f in $files) {
    $c = Get-Content $f.FullName -Raw
    $n = $c -replace 'text-white(?!/)', 'text-fg'
    if ($c -ne $n) { Set-Content $f.FullName $n -NoNewline -Encoding UTF8; $total++ }
}
Write-Host "Files changed: $total"
```

Note: `(?!/)` preserves `text-white/50` patterns — those get a separate pass below.

- [ ] **Step 2: Replace `text-white/N` → `text-fg/N` (opacity variants)**

```powershell
$files = Get-ChildItem -Path src -Recurse -Include "*.vue","*.js"
$total = 0
foreach ($f in $files) {
    $c = Get-Content $f.FullName -Raw
    $n = $c -replace 'text-white/', 'text-fg/'
    if ($c -ne $n) { Set-Content $f.FullName $n -NoNewline -Encoding UTF8; $total++ }
}
Write-Host "Files changed: $total"
```

- [ ] **Step 3: Restore intentional white-on-color instances**

Find elements where a colored bg warrants `text-white`:

```powershell
Select-String -Path src/**/*.vue -Pattern 'bg-accent[^-].*text-fg|text-fg.*bg-accent[^-]' -Context 0,0 | Select-Object -First 20
```

Also check:
```powershell
Select-String -Path src/**/*.vue -Pattern 'bg-(red|green|blue|rufous|sinopia|carrot)\S*\s.*text-fg' | Select-Object -First 10
```

For each match where the background is a fixed non-themed color (accent button, status badge), revert `text-fg` back to `text-white` manually.

- [ ] **Step 4: Also update raw `var(--color-*)` refs in Vue `<style>` blocks**

```powershell
Select-String -Path src/**/*.vue -Pattern 'var\(--color-(?!blue|red)' | Select-Object Filename, LineNumber, Line | Format-Table -AutoSize
```

For any matches found, manually update to the new var name using this mapping:
```
var(--color-bg)       → var(--surface)
var(--color-card)     → var(--panel)
var(--color-card2)    → var(--panel-alt)
var(--color-brd)      → var(--edge)
var(--color-brd2)     → var(--edge-strong)
var(--color-t1)       → var(--fg)
var(--color-t2)       → var(--fg-subtle)
var(--color-tm)       → var(--fg-muted)
var(--color-accent)   → var(--accent)
var(--color-accent2)  → var(--accent-dark)
var(--color-accent3)  → var(--accent-light)
var(--color-floater)  → var(--floater)
var(--color-floater-sm) → var(--floater-sm)
var(--color-floater-lg) → var(--floater-lg)
```

---

### Task 10: Final build + visual check

- [ ] **Step 1: Run build**

```powershell
npm run build:staging 2>&1 | Select-Object -Last 8
```
Expected: `✓ built in Xs` — no errors.

- [ ] **Step 2: Start dev server and visually check**

```powershell
npm run dev
```

Open the app and verify:
- Login screen: text and panels have warm tint, not plain white-on-black
- Switch to light mode: surfaces flip to light cream, text to near-black
- Floater open (e.g. Preferences): panel background correct, borders visible
- Focus rings on inputs: still visible in both modes
- No `text-fg` on accent-colored buttons showing wrong contrast

- [ ] **Step 3: Check for any remaining old token names**

```powershell
Select-String -Path src/**/*.vue,src/**/*.js -Pattern 'text-t1|text-t2|text-tm|bg-card(?!2)|-brd(?!2)|bg-bg(?!2)|bg-side(?!bar)' | Select-Object Filename, LineNumber | Format-Table -AutoSize
```
Expected: no matches.
