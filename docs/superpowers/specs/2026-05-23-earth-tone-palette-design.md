# Earth-Tone Color Palette Design

**Date:** 2026-05-23  
**Branch:** ai/phase1-viewer  
**Scope:** Replace deep-navy blue color scheme with warm earth/rust palette in `index.css` and `tailwind.config.js`.

---

## Goal

Replace the existing deep-navy blue color scheme with a warm earth/rust palette built around five named colors:

| Name | Hex | Role |
|------|-----|------|
| Rufous | `#A0361B` | Primary — dark BG anchor, light-mode accent |
| Sinopia | `#C4501B` | Secondary accent |
| Carrot orange | `#E9972D` | Primary interactive accent (dark mode) |
| Hunter green | `#2B5B3F` | Success / secondary color |
| Dark/forest green | `#143829` | Deep green variant |

---

## Architecture

### Token strategy
Keep all existing **semantic token names** unchanged (`--color-bg`, `--color-card`, `--color-accent`, etc.). Only values change — zero `.vue` component rewrites required. Add named palette tokens and tint scales on top.

### Files changed
1. `src/index.css` — CSS custom properties + hardcoded rgba overrides
2. `tailwind.config.js` — named palette scales

---

## Dark Theme (`:root`)

| Token | Value | Note |
|-------|-------|------|
| `--color-bg` | `#1A0905` | Replaces `#0d1f35` |
| `--color-bg2` | `#241108` | |
| `--color-card` | `#32180D` | |
| `--color-card2` | `#3D1E11` | |
| `--color-side` | `rgba(26,9,5,0.93)` | Sidebar |
| `--color-brd` | `#5C2918` | |
| `--color-brd2` | `#7A3522` | |
| `--color-t1` | `#F5EAE0` | Warm off-white |
| `--color-t2` | `#C8A090` | Medium warm |
| `--color-tm` | `#9A7060` | Muted; ≥3.5:1 contrast on card bg |
| `--color-accent` | `#E9972D` | Carrot — primary interactive |
| `--color-accent2` | `#C4501B` | Sinopia |
| `--color-accent3` | `#F2C181` | Carrot 60% tint |
| `--color-blue` | `#2979ff` | Keep for functional use (links, info) |
| `--color-teal` | `#E9972D` | Repurposed to carrot |
| `--color-green` | `#2B5B3F` | Hunter green |
| `--color-red` | `#f44336` | Keep |
| `--color-accent-orng` | `#E9972D` | Alias for carrot |

### Named palette tokens (added to `:root`)
```css
--color-rufous:  #A0361B;
--color-sinopia: #C4501B;
--color-carrot:  #E9972D;
--color-hunter:  #2B5B3F;
--color-forest:  #143829;
```

### Floater alpha tokens (new)
```css
--color-floater:    rgba(26, 9, 5, 0.85);   /* HUD buttons */
--color-floater-sm: rgba(26, 9, 5, 0.45);   /* passive labels */
--color-floater-lg: rgba(26, 9, 5, 0.95);   /* sidebar/drawers */
```

---

## Light Theme (`html.light`)

Warm cream backgrounds, rufous as primary accent. All contrast ratios target ≥4.5:1 for body text.

| Token | Value | Note |
|-------|-------|------|
| `--color-bg` | `#FDF6EF` | Warm cream |
| `--color-bg2` | `#F5E8D8` | |
| `--color-card` | `#FDF9F5` | Near white |
| `--color-card2` | `#F3E8DC` | |
| `--color-side` | `rgba(160,54,27,0.88)` | Rufous sidebar |
| `--color-brd` | `#D4A882` | Warm tan |
| `--color-brd2` | `#BC8860` | |
| `--color-t1` | `#1A0905` | Dark rufous-black |
| `--color-t2` | `#5A2616` | Dark rufous |
| `--color-tm` | `#6B4030` | Muted warm |
| `--color-accent` | `#A0361B` | Rufous |
| `--color-accent2` | `#7A2210` | Darker rufous |
| `--color-accent3` | `#C4501B` | Sinopia |
| `--fp-svg-bg` | `#FDECD8` | |

---

## Tailwind Palette Scales

Five palettes added with tint (mixing toward white) and shade (mixing toward black) at 20% intervals:

```
rufous:  20/40/60/80/DEFAULT/s20/s40/s60/s80
sinopia: 20/40/60/80/DEFAULT/s20/s40/s60/s80
carrot:  20/40/60/80/DEFAULT/s20/s40/s60/s80
hunter:  20/40/60/80/DEFAULT/s20/s40/s60/s80
forest:  20/40/60/80/DEFAULT/s20/s40/s60/s80
```

Usage: `bg-rufous-40`, `text-carrot`, `border-hunter`, `bg-forest-s40`

Replace old `primary: '#1B4F98'` → `primary: 'var(--color-rufous)'`

### Computed tints/shades

**Rufous `#A0361B`**
- 20: `#ECD7D1` · 40: `#D9AFA4` · 60: `#C68676` · 80: `#B35E49`
- s20: `#802B16` · s40: `#602010` · s60: `#40160B` · s80: `#200B05`

**Sinopia `#C4501B`**
- 20: `#F3DCD1` · 40: `#E7B9A4` · 60: `#DC9676` · 80: `#D07349`
- s20: `#9D4016` · s40: `#763010` · s60: `#4E200B` · s80: `#271005`

**Carrot `#E9972D`**
- 20: `#FBEAD5` · 40: `#F6D5AB` · 60: `#F2C181` · 80: `#EDAC57`
- s20: `#BA7924` · s40: `#8C5B1B` · s60: `#5D3C12` · s80: `#2F1E09`

**Hunter `#2B5B3F`**
- 20: `#D5DED9` · 40: `#AABDB2` · 60: `#809D8C` · 80: `#557C65`
- s20: `#224932` · s40: `#1A3726` · s60: `#112419` · s80: `#09120D`

**Forest `#143829`**
- 20: `#D0D7D4` · 40: `#A1AFA9` · 60: `#72887F` · 80: `#436054`
- s20: `#102D21` · s40: `#0C2219` · s60: `#081610` · s80: `#040B08`

---

## index.css Changes Beyond CSS Vars

These hardcoded rgba values reference the old blue palette and must be updated:

| Location | Old | New |
|----------|-----|-----|
| Animated border (dark) gradient | `#00b4d8` / `#2979ff` | `#E9972D` / `#A0361B` |
| Animated border (light) gradient | `#0044c8` / `#7722ee` | `#A0361B` / `#2B5B3F` |

### `html.light` overrides to update
- `.voice-bar` — rufous toned

---

## What Stays Unchanged
- All `.vue` component files
- Layout, spacing, shadows, typography
- Functional red `#f44336`
- `--color-blue: #2979ff` (kept for info/link states)
- Negative margin utilities, elevation classes, transition helpers
