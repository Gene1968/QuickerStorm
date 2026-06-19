# Hover Cursor & ClickAction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decode ClickAction U8 from ObjectUpdate/Compressed, show hand cursor + action badge icon on hover, disable Touch in the context menu for Disabled (7) objects.

**Architecture:** ClickAction is decoded server-side in lludp-codec.ts and flows through the existing WS pipeline to worldStore. A throttled pointermove handler in useWorldEngine drives a reactive `hoverAction` ref; `HoverCursorBadge.vue` renders the action icon next to the system cursor. The Object context menu reads `clickAction` from the menu payload to gate the Touch button.

**Tech Stack:** TypeScript (server codec), Vue 3 `<script setup>`, Three.js Raycaster, Tailwind CSS, inline SVG icons (Heroicons outline paths, no import dependency)

---

## File Map

| File | Change |
|------|--------|
| `server/lib/lludp-codec.ts` | Decode ClickAction U8 in `decodeObjectUpdate` and `decodeObjectUpdateCompressed`; add to `ObjectData` interface |
| `src/stores/worldStore.js` | Store `clickAction` in upsertObject, default 0 |
| `server/handlers/` | Verify WS forward carries new field (likely automatic) |
| `src/composables/useWorldEngine.js` | Add `hoverAction`/`hoverPos` refs, `onPointerMove`/`onPointerLeave`, wire listeners, add `clickAction` to openObjectMenu payload, export new refs |
| `src/stores/uiStore.js` | Update `objectMenu` type comment |
| `src/components/HoverCursorBadge.vue` | New: badge icon rendered near cursor |
| `src/views/WorldView.vue` | Import + mount HoverCursorBadge, pass hoverAction/hoverPos |
| `src/components/ObjectContextMenu.vue` | Disable Touch button when `menu.clickAction === 7` |

---

### Task 1: Decode ClickAction in lludp-codec.ts

**Files:**
- Modify: `server/lib/lludp-codec.ts`
- Test: `server/lib/lludp-codec.test.ts` (create or add to existing)

- [ ] **Step 1: Write failing test**

```typescript
// server/lib/lludp-codec.test.ts
import { describe, it, expect } from 'vitest'
import { decodeObjectUpdateCompressed } from './lludp-codec'

describe('decodeObjectUpdateCompressed ClickAction', () => {
    it('decodes clickAction Buy (2) from compressed object buffer', () => {
        // Buffer layout per lludp-codec.ts ~lines 1107-1122 then flags at ~1130:
        // fullId(16) + localId(4) + pcode(1) + material(1) + clickAction(1)
        // + scale(12) + pos(12) + rot(12) + flags(4) + state(1) = 64 bytes
        const buf = Buffer.alloc(256, 0)
        let off = 0
        // fullId UUID (16 bytes)
        Buffer.from('00000000000000000000000000000001', 'hex').copy(buf, off); off += 16
        // localId U32LE = 42
        buf.writeUInt32LE(42, off); off += 4
        // pcode U8 = 9 (prim)
        buf[off++] = 9
        // material U8 = 3 (plastic)
        buf[off++] = 3
        // clickAction U8 = 2 (Buy)  ← field under test
        buf[off++] = 2
        // scale F32LE x3 = 1.0
        buf.writeFloatLE(1.0, off); off += 4
        buf.writeFloatLE(1.0, off); off += 4
        buf.writeFloatLE(1.0, off); off += 4
        // pos F32LE x3
        buf.writeFloatLE(128.0, off); off += 4
        buf.writeFloatLE(128.0, off); off += 4
        buf.writeFloatLE(25.0, off); off += 4
        // rot F32LE x3
        buf.writeFloatLE(0.0, off); off += 4
        buf.writeFloatLE(0.0, off); off += 4
        buf.writeFloatLE(0.0, off); off += 4
        // flags U32LE = 0 (skip all conditional blocks)
        buf.writeUInt32LE(0, off); off += 4
        // state U8 = 0
        buf[off++] = 0

        const results = decodeObjectUpdateCompressed(buf)
        expect(results.length).toBeGreaterThan(0)
        expect(results[0].clickAction).toBe(2)
    })
})
```

- [ ] **Step 2: Run to confirm failure**

```
npx vitest run server/lib/lludp-codec.test.ts
```
Expected: FAIL — `results[0].clickAction` is undefined

- [ ] **Step 3: Add clickAction to the ObjectData interface**

In `server/lib/lludp-codec.ts`, find the `ObjectData` interface (~line 1041). Add:
```typescript
clickAction?: number
```

- [ ] **Step 4: Decode ClickAction in `decodeObjectUpdateCompressed`**

At lines 1112–1113 the current code is:
```typescript
off += 1   // material
off += 1   // clickAction
```
Change to:
```typescript
off += 1                        // material (not stored)
const clickAction = buf[off++]  // ClickAction U8
```

In the output push at lines ~1232–1265, add `clickAction` to the result object being assembled.

- [ ] **Step 5: Decode ClickAction in `decodeObjectUpdate`**

At line 1334 the current code is:
```typescript
off += 2   // material, clickAction
```
Change to:
```typescript
off += 1                        // material (not stored)
const clickAction = buf[off++]  // ClickAction U8
```

Find the result object assembled in `decodeObjectUpdate` and add `clickAction` there too.

- [ ] **Step 6: Run test to confirm pass**

```
npx vitest run server/lib/lludp-codec.test.ts
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/lib/lludp-codec.ts server/lib/lludp-codec.test.ts
git commit -m "feat(codec): decode ClickAction U8 from ObjectUpdate"
```

---

### Task 2: Store clickAction in worldStore

**Files:**
- Modify: `src/stores/worldStore.js`
- Test: `src/stores/worldStore.test.js` (create if absent)

- [ ] **Step 1: Write failing tests**

```js
// src/stores/worldStore.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useWorldStore } from './worldStore'

describe('worldStore clickAction', () => {
    beforeEach(() => { setActivePinia(createPinia()) })

    it('stores clickAction from upsertObject', () => {
        const store = useWorldStore()
        store.upsertObject({ localId: 1, fullId: 'aaa', clickAction: 2 })
        expect(store.objects.get(1).clickAction).toBe(2)
    })

    it('defaults clickAction to 0 when absent', () => {
        const store = useWorldStore()
        store.upsertObject({ localId: 2, fullId: 'bbb' })
        expect(store.objects.get(2).clickAction).toBe(0)
    })

    it('preserves existing clickAction when omitted in subsequent update', () => {
        const store = useWorldStore()
        store.upsertObject({ localId: 3, fullId: 'ccc', clickAction: 6 })
        store.upsertObject({ localId: 3, fullId: 'ccc', pos: [1, 2, 3] })
        expect(store.objects.get(3).clickAction).toBe(6)
    })
})
```

- [ ] **Step 2: Run to confirm failure**

```
npx vitest run src/stores/worldStore.test.js
```
Expected: FAIL — `clickAction` is undefined

- [ ] **Step 3: Update upsertObject to default clickAction**

In `src/stores/worldStore.js`, in `upsertObject` (lines 57–64), after the spread merge line, add:

```js
function upsertObject(obj) {
    const existing = objects.value.get(obj.localId) ?? {}
    const merged = { ...existing, ...obj }
    merged.name = parseNameValue(merged.nameValue) || merged.name || ''
    merged.clickAction = obj.clickAction ?? existing.clickAction ?? 0  // ADD
    objects.value.set(merged.localId, merged)
    _index(merged)
}
```

- [ ] **Step 4: Run test to confirm pass**

```
npx vitest run src/stores/worldStore.test.js
```
Expected: PASS (3 tests)

- [ ] **Step 5: Full test suite check**

```
npx vitest run
```
Expected: no regressions

- [ ] **Step 6: Commit**

```bash
git add src/stores/worldStore.js src/stores/worldStore.test.js
git commit -m "feat(store): persist clickAction on object records, default 0"
```

---

### Task 3: Verify WS forwarding carries clickAction

**Files:**
- Read: server handler(s) that forward ObjectUpdate to WS clients
- Modify if needed: whichever handler selectively picks fields

- [ ] **Step 1: Find the forwarding code**

```
grep -r "OBJ_UPDATE\|objectUpdate\|upsertObject\|decodeObjectUpdate" server/ --include="*.ts" -l
```

Open the file(s) found and locate where the decoded ObjectUpdate array is sent to clients.

- [ ] **Step 2: Check field forwarding**

If the forward uses a full spread or `JSON.stringify(obj)`:
```typescript
ws.send(JSON.stringify({ type: 'OBJ_UPDATE', ...obj }))
// or
ws.send(JSON.stringify(obj))
```
`clickAction` will flow automatically — **no change needed**, skip to Step 4.

If the handler destructures and rebuilds selectively (e.g., `const { localId, fullId, pos } = obj`), add `clickAction` to both the destructure and the outgoing payload.

- [ ] **Step 3: Confirm client receive path**

In `src/composables/useWorldEngine.js`, search for the WS message handler that calls `world.upsertObject`. Confirm the call passes the full received data object (spread or direct), so `clickAction` reaches the store automatically.

- [ ] **Step 4: Commit only if changes were needed**

```bash
git add server/handlers/<changed-file>.ts
git commit -m "feat(server): forward clickAction in OBJ_UPDATE WS message"
```

---

### Task 4: Add hoverAction refs and onPointerMove to useWorldEngine

**Files:**
- Modify: `src/composables/useWorldEngine.js`

- [ ] **Step 1: Add reactive refs**

Near the top of `useWorldEngine`, with the other reactive state declarations, add:

```js
const hoverAction = ref(null)   // null | 0-7
const hoverPos    = ref({ x: 0, y: 0 })
```

- [ ] **Step 2: Add throttle variable**

Near other module-level variables (where `_raycaster` etc. are declared), add:

```js
let _hoverThrottle = 0
```

- [ ] **Step 3: Read the primTargets construction in onContextMenu**

Open `useWorldEngine.js` and read lines 3100–3153 — specifically the block that populates `primTargets`. Note the exact traversal pattern (which scene tree, which mesh property checks like `_localId`, `_isAvatar`, visibility, distance checks if any). You will mirror this in the next step.

- [ ] **Step 4: Add onPointerMove and onPointerLeave handlers**

Add near the other canvas event handlers (near `onContextMenu`):

```js
function onPointerMove(e) {
    const now = performance.now()
    if (now - _hoverThrottle < 80) return
    _hoverThrottle = now

    hoverPos.value = { x: e.clientX, y: e.clientY }

    const canvas = canvasRef.value
    if (!canvas) return

    // Edit floater active → select mode cursor, suppress hover
    if (ui.floaterStack?.includes('object-edit')) {
        canvas.style.cursor = 'crosshair'
        hoverAction.value = null
        return
    }

    const rect = canvas.getBoundingClientRect()
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1
    _raycaster.setFromCamera({ x: nx, y: ny }, _camera)

    // Mirror the primTargets construction from onContextMenu lines 3100-3153
    const targets = []
    // <copy the primTargets population loop from onContextMenu verbatim here>

    const hits = _raycaster.intersectObjects(targets, false)
    if (!hits.length) {
        canvas.style.cursor = 'default'
        hoverAction.value = null
        return
    }

    const pickedId = hits[0].object._rootLocalId ?? hits[0].object._localId
    const obj = world.objects.get(pickedId)
    const ca = obj?.clickAction ?? 0

    canvas.style.cursor = ca === 7 ? 'default' : 'pointer'
    hoverAction.value = ca === 7 ? null : ca
}

function onPointerLeave() {
    if (canvasRef.value) canvasRef.value.style.cursor = 'default'
    hoverAction.value = null
}
```

- [ ] **Step 5: Export the new refs**

In the `return` statement at the bottom of `useWorldEngine`, add:

```js
hoverAction,
hoverPos,
```

- [ ] **Step 6: Build check**

```
npm run build:staging
```
Expected: no errors

---

### Task 5: Wire listeners and update openObjectMenu payload

**Files:**
- Modify: `src/composables/useWorldEngine.js`
- Modify: `src/stores/uiStore.js` (comment only)

- [ ] **Step 1: Add listeners in mountEngine**

At line ~4744–4745 where `contextmenu` and `dblclick` are added:

```js
canvasRef.value.addEventListener('pointermove',  onPointerMove)
canvasRef.value.addEventListener('pointerleave', onPointerLeave)
```

- [ ] **Step 2: Remove listeners in unmountEngine**

At line ~4805 where `contextmenu` is removed:

```js
canvasRef.value?.removeEventListener('pointermove',  onPointerMove)
canvasRef.value?.removeEventListener('pointerleave', onPointerLeave)
```

- [ ] **Step 3: Add clickAction to openObjectMenu payload**

In `onContextMenu` at lines 3142–3149, `openObjectMenu` is called with an object. Add `clickAction`:

```js
ui.openObjectMenu({
    localId,
    fullId: obj.fullId,
    name:   /* existing */,
    pos:    /* existing */,
    clickAction: obj.clickAction ?? 0,   // ADD
    x: e.clientX,
    y: e.clientY,
})
```

- [ ] **Step 4: Update type comment in uiStore.js**

Line 297 of `src/stores/uiStore.js`:
```js
// Before:
const objectMenu = ref(null)  // null | { localId, fullId, name, pos, x, y }

// After:
const objectMenu = ref(null)  // null | { localId, fullId, name, pos, clickAction, x, y }
```

- [ ] **Step 5: Build check**

```
npm run build:staging
```
Expected: no errors

- [ ] **Step 6: Commit tasks 4+5**

```bash
git add src/composables/useWorldEngine.js src/stores/uiStore.js
git commit -m "feat(engine): hover raycast, hoverAction ref, clickAction in menu payload"
```

---

### Task 6: Create HoverCursorBadge.vue

**Files:**
- Create: `src/components/HoverCursorBadge.vue`

- [ ] **Step 1: Create the component with inline SVG icons**

```vue
<script setup>
// ClickAction: 0=Touch, 1=Sit, 2=Buy, 3=Pay, 4=Open, 5=PlayAnim, 6=Zoom, 7=Disabled
// No badge for 0 (hand alone) or 7 (no interaction) — only 1-6 show an icon.
defineProps({
    action: { type: Number, default: null },
    x:      { type: Number, default: 0 },
    y:      { type: Number, default: 0 },
})

// Heroicons outline 24px paths
const PATHS = {
    1: 'M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z',
    2: 'M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z',
    3: 'M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z',
    4: 'M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z',
    5: 'M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z',
    6: 'm21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z',
}
</script>

<template>
    <div
        v-if="action !== null && action !== 0 && action !== 7 && PATHS[action]"
        class="fixed z-[300] pointer-events-none"
        :style="{ left: `${x + 16}px`, top: `${y + 4}px` }"
    >
        <div class="bg-panel/80 rounded-sm p-0.5">
            <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="w-[18px] h-[18px] text-t1"
            >
                <path stroke-linecap="round" stroke-linejoin="round" :d="PATHS[action]" />
            </svg>
        </div>
    </div>
</template>
```

- [ ] **Step 2: Build check**

```
npm run build:staging
```
Expected: no errors

---

### Task 7: Mount HoverCursorBadge in WorldView

**Files:**
- Modify: `src/views/WorldView.vue`

- [ ] **Step 1: Import the component**

In the `<script setup>` of `WorldView.vue`, add:
```js
import HoverCursorBadge from '@/components/HoverCursorBadge.vue'
```

- [ ] **Step 2: Destructure hoverAction and hoverPos from useWorldEngine**

Find the existing `useWorldEngine(...)` call and add the new refs to the destructure:
```js
const { /* existing exports */, hoverAction, hoverPos } = useWorldEngine(...)
```

- [ ] **Step 3: Add badge to template**

After `<LandContextMenu />` (~line 175), still inside the `v-show="ui.uiVisible"` wrapper:
```html
<HoverCursorBadge :action="hoverAction" :x="hoverPos.x" :y="hoverPos.y" />
```

- [ ] **Step 4: Build check**

```
npm run build:staging
```
Expected: no errors

- [ ] **Step 5: Commit tasks 6+7**

```bash
git add src/components/HoverCursorBadge.vue src/views/WorldView.vue
git commit -m "feat(ui): HoverCursorBadge shows action icon beside cursor"
```

---

### Task 8: Gate Touch button in ObjectContextMenu

**Files:**
- Modify: `src/components/ObjectContextMenu.vue`

- [ ] **Step 1: Disable Touch button when clickAction is 7**

Line 87 currently:
```html
<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10" @click="touch">Touch</button>
```

Change to:
```html
<button
    class="block w-full text-left px-3 py-1.5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
    :disabled="menu.clickAction === 7"
    @click="touch"
>Touch</button>
```

- [ ] **Step 2: Full build + bun test**

```
npm run build:staging && bun test
```
Expected: build clean, no new test failures

- [ ] **Step 3: Commit**

```bash
git add src/components/ObjectContextMenu.vue
git commit -m "feat(menu): disable Touch for ClickAction=Disabled (7) objects"
```

---

### Task 9: Live verify

- [ ] Start dev server and WS server: `npm run dev` + `npm run dev:server`
- [ ] Log in and enter a region with objects
- [ ] Move cursor over prims — canvas cursor changes to hand pointer
- [ ] Move cursor over terrain or sky — cursor returns to default
- [ ] Move cursor over the known teleport-script object — hand shows, no badge (ClickAction=0)
- [ ] Open Edit floater, hover objects — cursor shows crosshair instead of hand
- [ ] Right-click a normal prim — Touch button is enabled
- [ ] Right-click any Disabled object if available (ClickAction=7) — Touch button greyed out
- [ ] If a Buy object is available: hover shows shopping-bag badge
- [ ] If a Sit object is available: hover shows user/sit badge
- [ ] If a Zoom object is available (picture frames often use this): hover shows magnifying-glass badge
