# Color System Redesign

**Date:** 2026-06-12
**Approach:** Semantic step tokens with explicit palette block; approach A from brainstorm.

---

## Goals

1. **Contrast-aware** — `text-white/50` (218 uses, invisible in light mode) is replaced by semantic tokens that flip automatically.
2. **Semantic names** — `t1 / t2 / tm / brd / brd2 / card / card2` replaced with readable names.
3. **Palette-driven** — one `--primary-*` block at the top of `index.css` is the only thing that changes to swap the entire theme.
4. **Easy theming** — rufous/earth tones are the current values; replacing 9 hex values + their channel triplets gives a new look with zero other changes.

---

## Architecture

### Three layers in `index.css`

```
Layer 1 — PALETTE BLOCK (:root top section)
  --primary-1..9 + -ch triplets  ← change these to swap theme
  --accent, --accent-dark, --accent-light + -ch
  --green-deep, --green-dark, --green-mid, --green-light + -ch
  --color-blue, --color-red  ← functional, untouched

Layer 2 — SEMANTIC TOKENS (:root below palette)
  --surface, --panel, --panel-alt, --sidebar
  --edge, --edge-strong
  --fg, --fg-subtle, --fg-muted
  --accent (re-exported), --accent-dark, --accent-light
  --floater, --floater-sm, --floater-lg  ← derived from panel
  Each semantic var has a matching -ch counterpart.

Layer 3 — LIGHT MODE OVERRIDE (html.light)
  Reassigns semantic tokens to opposite palette steps only.
  The palette block is NEVER touched by light mode.
```

---

## Palette Block (current rufous values — user will replace)

```css
:root {
  /* ── PRIMARY SCALE (1 = darkest, 9 = lightest) ───────────── */
  --primary-1: #200B05;   --primary-1-ch: 32 11 5;
  --primary-2: #40160B;   --primary-2-ch: 64 22 11;
  --primary-3: #602010;   --primary-3-ch: 96 32 16;
  --primary-4: #802B16;   --primary-4-ch: 128 43 22;
  --primary-5: #A0361B;   --primary-5-ch: 160 54 27;
  --primary-6: #B35E49;   --primary-6-ch: 179 94 73;
  --primary-7: #C68676;   --primary-7-ch: 198 134 118;
  --primary-8: #D9AFA4;   --primary-8-ch: 217 175 164;
  --primary-9: #ECD7D1;   --primary-9-ch: 236 215 209;

  /* ── ACCENT (interactive / highlight) ──────────────────────── */
  --accent:        #E9972D;   --accent-ch:        233 151 45;
  --accent-dark:   #C4501B;   --accent-dark-ch:   196 80 27;
  --accent-light:  #F2C181;   --accent-light-ch:  242 193 129;

  /* ── GREEN (alt surface family) ─────────────────────────────── */
  --green-deep:    #081610;   --green-deep-ch:    8 22 16;
  --green-dark:    #1A3726;   --green-dark-ch:    26 55 38;
  --green-mid:     #2B5B3F;   --green-mid-ch:     43 91 63;
  --green-light:   #D5DED9;   --green-light-ch:   213 222 217;

  /* ── FUNCTIONAL (not palette-derived, never change) ─────────── */
  --color-blue: #2979ff;
  --color-red:  #f44336;
}
```

---

## Semantic Tokens (dark mode defaults)

```css
:root {
  color-scheme: dark;

  /* surfaces */
  --surface:      var(--primary-1);   --surface-ch:      var(--primary-1-ch);
  --panel:        var(--primary-3);   --panel-ch:        var(--primary-3-ch);
  --panel-alt:    var(--green-dark);  --panel-alt-ch:    var(--green-dark-ch);
  --sidebar:      rgb(var(--green-deep-ch) / 0.93);
  --sidebar-ch:   var(--green-deep-ch);

  /* borders */
  --edge:         var(--primary-4);   --edge-ch:         var(--primary-4-ch);
  --edge-strong:  var(--primary-5);   --edge-strong-ch:  var(--primary-5-ch);

  /* text / foreground */
  --fg:           var(--primary-9);   --fg-ch:           var(--primary-9-ch);
  --fg-subtle:    var(--primary-7);   --fg-subtle-ch:    var(--primary-7-ch);
  --fg-muted:     var(--primary-6);   --fg-muted-ch:     var(--primary-6-ch);

  /* floater alpha surfaces (derived — auto-follow panel) */
  --floater:      rgb(var(--panel-ch) / 0.85);
  --floater-sm:   rgb(var(--panel-ch) / 0.45);
  --floater-lg:   rgb(var(--panel-ch) / 0.95);

  /* layout vars — unchanged */
  --sidebar-w:             clamp(9rem, 15vw, 19rem);
  --sidebar-collapsed-w:   3.25rem;
  --canvas-left:           var(--sidebar-w);
}
```

---

## Light Mode Override

```css
html.light {
  color-scheme: light;

  /* surfaces — flip to opposite palette ends */
  --surface:      var(--primary-9);   --surface-ch:      var(--primary-9-ch);
  --panel:        var(--primary-8);   --panel-ch:        var(--primary-8-ch);
  --panel-alt:    var(--green-light); --panel-alt-ch:    var(--green-light-ch);
  --sidebar:      rgb(var(--accent-ch) / 0.88);
  --sidebar-ch:   var(--accent-ch);

  /* borders */
  --edge:         var(--primary-6);   --edge-ch:         var(--primary-6-ch);
  --edge-strong:  var(--primary-5);   --edge-strong-ch:  var(--primary-5-ch);

  /* text — flip to dark ends */
  --fg:           var(--primary-1);   --fg-ch:           var(--primary-1-ch);
  --fg-subtle:    var(--primary-3);   --fg-subtle-ch:    var(--primary-3-ch);
  --fg-muted:     var(--primary-4);   --fg-muted-ch:     var(--primary-4-ch);

  /* accent shifts to primary hue in light (current behaviour preserved) */
  --accent:       var(--primary-5);   --accent-ch:       var(--primary-5-ch);
  --accent-dark:  var(--primary-4);   --accent-dark-ch:  var(--primary-4-ch);
  --accent-light: var(--primary-6);   --accent-light-ch: var(--primary-6-ch);
}
```

---

## Token Rename Table

| Old token | New token | Tailwind utility (before → after) |
|-----------|-----------|-----------------------------------|
| `bg` | `surface` | `bg-bg` → `bg-surface` |
| `bg2` | *(dropped)* | `bg-bg2` → `bg-surface/80` or `bg-panel` |
| `card` | `panel` | `bg-card` → `bg-panel` |
| `card2` | `panel-alt` | `bg-card2` → `bg-panel-alt` |
| `side` | `sidebar` | `bg-side` → `bg-sidebar` |
| `brd` | `edge` | `border-brd` → `border-edge` |
| `brd2` | `edge-strong` | `border-brd2` → `border-edge-strong` |
| `t1` | `fg` | `text-t1` → `text-fg` |
| `t2` | `fg-subtle` | `text-t2` → `text-fg-subtle` |
| `tm` | `fg-muted` | `text-tm` → `text-fg-muted` |
| `accent` | `accent` | unchanged |
| `accent2` | `accent-dark` | `text-accent2` → `text-accent-dark` |
| `accent3` | `accent-light` | `text-accent3` → `text-accent-light` |

---

## `text-white` Migration Strategy

218 uses of `text-white` / `text-white/N`. Not a blind replace — three distinct patterns:

| Pattern | Action |
|---------|--------|
| `text-white` / `text-white/N` on dark surface bg (icons, labels, body text) | → `text-fg` / `text-fg/N` |
| `text-white` inside accent-colored buttons/badges (intentional white-on-color) | → keep `text-white` |
| `bg-white/5` or `bg-white/10` hover overlays (additive lightening) | → keep `bg-white/5` (overlay, not theme color) |

Implementation does the mechanical swap and flags remaining `text-white` instances for a per-component review pass.

---

## `tailwind.config.js` Changes

Replace the `colors` section in `extend`:

```js
colors: {
  // semantic layer — contrast-aware, auto-flip with html.light
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

  // non-themed (kept as-is)
  nav:    '#2E2B3B',
  lighten:'#ffffff51',
  darken: '#00000051',
  // earth palette names (rufous, sinopia, carrot, hunter, forest) REMOVED
  // primary/secondary/tertiary/neutral kept for any direct hex usage in components
}
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/index.css` | Replace `:root` and `html.light` color blocks entirely |
| `tailwind.config.js` | Replace `extend.colors` semantic tokens |
| `src/**/*.vue` `src/**/*.js` | Find-replace token renames (~600 instances across 36 files) |
| `src/index.css` `@layer components` | Update `@apply` directives using old tokens |

---

## Out of Scope

- Replacing the rufous palette with the user's new palette — that's a one-block swap after this ships.
- `--color-floater` raw var usage in component CSS (stays as `var(--floater)` after rename).
- `primary`, `secondary`, `tertiary`, `neutral` named palettes in `tailwind.config.js` — kept for direct hex usage in components; not semantic tokens.
- `var(--color-rufous)` etc. raw CSS var usage — replace with `var(--accent)` or `var(--primary-5)` as appropriate.
