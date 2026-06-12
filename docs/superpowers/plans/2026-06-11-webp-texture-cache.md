# WebP Texture Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink the texture cache (server RAM memo + browser IndexedDB) by transcoding J2C → WebP instead of PNG, storing the browser copy as a binary Blob, and sizing the IDB cap to the browser's real quota.

**Architecture:** The server already decodes J2C with magick-wasm and re-encodes PNG via `fast-png`, then a per-circuit-shared RAM LRU (`assetMemo`, 384 MB) caches the base64 payload. We swap the encode to WebP (lossy q90 for opaque, lossless for alpha) using the magick-wasm encoder that is *already loaded* — no new dependency, no native build. The browser stores the result as a `Blob` (not a base64 data-URL string, which is +33%) in IndexedDB, and the IDB size cap is derived from `navigator.storage.estimate()` with `navigator.storage.persist()` requested so the cache survives storage pressure.

**Tech Stack:** Bun + `@imagemagick/magick-wasm` (server transcode, worker pool), Vue 3 SPA, IndexedDB (`src/lib/textureCache.js`), Three.js (`src/composables/useTextureFetch.js`). Server tests: `bun:test`. Client tests: `vitest`.

---

## Design Decisions (from brainstorming)

- **Format:** lossy WebP **q90** for opaque textures (`hasAlpha === false`); **lossless** WebP for alpha textures (`hasAlpha === true`) — lossless avoids RGB edge-bleed on cutout foliage and is still ~25% smaller than PNG. WebP beats PNG in *both* modes, so no PNG path is kept.
- **Encoder:** reuse magick-wasm (already initialized for the J2C decode). No `sharp` (native build), no second WASM module.
- **Browser storage:** store a `Blob`, not a `data:` URL string. Build the GPU texture via `createImageBitmap(blob)` (faster than `Image().src = dataURL`).
- **IDB cap:** derive from real quota via `storage.estimate()` (default 60%), and call `storage.persist()` so Chrome does not silently evict the cache under disk pressure. The hardcoded 8 GB becomes a fallback only.
- **Server tier-2 already exists** as a 384 MB **RAM** LRU (`server/lib/assetMemo.ts`); WebP shrinks each entry so more assets fit for free. A *disk-persistent* server tier is explicitly out of scope here — see Follow-ups.

## Phases (each ships independently)

- **Phase A — Server WebP cutover (Tasks 1–4).** Biggest win (3–5× smaller payloads), lowest risk. Client code is untouched except an IDB version bump that purges stale PNGs. **You can stop here and still get most of the benefit.**
- **Phase B — Browser Blob storage (Tasks 5–6).** Further ~1.33× + faster texture build. Touches the recently-rewritten `useTextureFetch.js` hot path — isolated and individually revertible.
- **Phase C — Quota-derived cap + persistence (Task 7).** Independent; turns the IDB cache from session-scoped into a durable multi-region cache.

## File Map

| File | Phase | Responsibility / change |
|------|-------|-------------------------|
| `server/lib/j2c.ts` | A | Add `rawFormatFor` + `encodeWebp`; rename `j2cToPng*` → `j2cToImage*` emitting WebP; drop `fast-png` |
| `server/lib/j2cPool.ts` | A | `DecodeResult.png` → `image`; message field rename |
| `server/lib/j2cWorker.ts` | A | post `image` instead of `png` |
| `server/handlers/assets.ts` | A | texture `mime: 'image/webp'`; `transcodeToPng` → `transcode`; `r.png` → `r.image`; log "webp" |
| `server/__tests__/j2c.test.ts` | A | WebP signature + lossless round-trip + alpha-branch tests |
| `server/__tests__/assets.test.ts` | A | expect `image/webp` + `transcode` |
| `src/lib/textureCache.js` | A,B,C | A: `DB_VERSION` 3→4 purge. B: store Blob (4→5). C: `resolveCacheCap` + `initCacheCap` |
| `src/composables/useTextureFetch.js` | B | Blob cache layers, `createImageBitmap` build, object-URL previews |
| `src/__tests__/lib/textureCache.test.js` | A,B,C | record-shape + `resolveCacheCap` tests |

---

## PHASE A — Server WebP cutover

### Task 1: WebP encoder helpers in `j2c.ts`

**Files:**
- Modify: `server/lib/j2c.ts`
- Test: `server/__tests__/j2c.test.ts`

- [ ] **Step 1: Add the WebP encoder + format mapper.** In `server/lib/j2c.ts`, extend the magick-wasm import and add the two helpers below. Place the import change at line 9 and the helpers just above `j2cToPngWithAlpha` (the existing line 153).

Change the import (currently `import { initializeImageMagick, ImageMagick } from '@imagemagick/magick-wasm'`) to:

```ts
import { initializeImageMagick, ImageMagick, MagickFormat, MagickReadSettings } from '@imagemagick/magick-wasm'
```

Add:

```ts
// Lossy WebP quality for OPAQUE textures. 90 ≈ visually lossless on SL surfaces while staying
// 3-5× smaller than PNG. Alpha textures are encoded LOSSLESS instead (lossy RGB bleed fuzzes
// cutout edges); see j2cToImageWithAlpha. Override with QS_WEBP_QUALITY.
const WEBP_QUALITY = Number(process.env.QS_WEBP_QUALITY) || 90

// Map a raw interleaved channel count to the MagickFormat that describes those samples, so magick
// can import our already-decoded pixel buffer without a container header. WHY exported: pure, unit-
// tested without a WASM round-trip. Throws outside 1-4 (matches magickDecode's channel guard).
export function rawFormatFor(channels: number): MagickFormat {
	switch (channels) {
		case 1: return MagickFormat.Gray
		case 2: return MagickFormat.Graya
		case 3: return MagickFormat.Rgb
		case 4: return MagickFormat.Rgba
		default: throw new Error(`webp_unsupported_channels: ${channels}`)
	}
}

// Encode raw interleaved 8-bit pixels → WebP. Lossy (WEBP_QUALITY) by default; lossless when
// `lossless` is set (alpha cutouts). WHY magick: the J2C decode already runs through magick-wasm in
// this module, so the encoder is loaded — no second WASM, no native build on the prod host.
export function encodeWebp(
	pixels: Uint8Array, width: number, height: number, channels: number, lossless: boolean,
): Buffer {
	const settings = new MagickReadSettings()
	settings.format = rawFormatFor(channels)
	settings.width = width
	settings.height = height
	settings.depth = 8
	let out: Buffer | null = null
	ImageMagick.read(pixels, settings, img => {
		img.quality = lossless ? 100 : WEBP_QUALITY
		if (lossless) img.setDefine(MagickFormat.WebP, 'lossless', true)
		img.write(MagickFormat.WebP, data => { out = Buffer.from(data) })
	})
	if (!out) throw new Error('webp_encode_empty')
	return out
}
```

- [ ] **Step 2: Write failing tests.** Append to `server/__tests__/j2c.test.ts` (and extend its import on line 4 to include the new symbols — see Step 4). Add:

```ts
import { ImageMagick } from '@imagemagick/magick-wasm'

const isWebp = (b: Buffer) =>
	b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'

describe('encodeWebp', () => {
	it('maps channel counts to magick raw formats and rejects out-of-range', () => {
		expect(rawFormatFor(1)).toBe('GRAY')
		expect(rawFormatFor(2)).toBe('GRAYA')
		expect(rawFormatFor(3)).toBe('RGB')
		expect(rawFormatFor(4)).toBe('RGBA')
		expect(() => rawFormatFor(5)).toThrow('webp_unsupported_channels')
	})

	it('lossless-encodes RGBA pixels to a WebP that round-trips exactly', async () => {
		await decodeJ2C(fixture)   // ensure magick is initialized
		const px = new Uint8Array([10, 20, 30, 128, 40, 50, 60, 255, 70, 80, 90, 0, 100, 110, 120, 200]) // 2×2 RGBA
		const webp = encodeWebp(px, 2, 2, 4, true)
		expect(isWebp(webp)).toBe(true)
		let back: Uint8Array | null = null
		ImageMagick.read(webp, img => { img.getPixels(p => { back = new Uint8Array(p.getArea(0, 0, 2, 2)) }) })
		expect(Array.from(back!)).toEqual(Array.from(px))   // lossless → byte-exact
	})
})
```

- [ ] **Step 3: Run the tests, expect FAIL.**

Run: `bun test server/__tests__/j2c.test.ts`
Expected: FAIL — `encodeWebp`/`rawFormatFor` not exported yet (import error) until Step 1 lands; if Step 1 already saved, FAIL only if the API call is wrong.

- [ ] **Step 4: Make them pass.** Ensure Step 1's code is saved. Update the test import on line 4 to add the new symbols (final form lands in Task 2; for now):

```ts
import { decodeJ2C, j2cToPng, j2cToPngWithAlpha, pixelsHaveAlpha, downscalePixels, encodeWebp, rawFormatFor } from '../lib/j2c'
```

Run: `bun test server/__tests__/j2c.test.ts`
Expected: PASS (all `j2c`, `encodeWebp`, `downscalePixels`, `pixelsHaveAlpha` suites green).

- [ ] **Step 5: Commit.**

```bash
git add server/lib/j2c.ts server/__tests__/j2c.test.ts
git commit -m "feat(render): WebP encoder helpers (magick), lossless+lossy"
```

---

### Task 2: Emit WebP from the transcode + rename through the pool

**Files:**
- Modify: `server/lib/j2c.ts:152-166`
- Modify: `server/lib/j2cPool.ts:10-17,56-72,100-122`
- Modify: `server/lib/j2cWorker.ts:14-29`
- Modify: `server/handlers/assets.ts:19-42,44-97`
- Test: `server/__tests__/j2c.test.ts`, `server/__tests__/assets.test.ts`

- [ ] **Step 1: Switch the transcode to WebP and rename.** In `server/lib/j2c.ts`, replace `j2cToPngWithAlpha` and `j2cToPng` (lines 152–166) with:

```ts
/** Decode a J2C codestream → WebP buffer plus whether it carries real transparency. Opaque textures
 *  use lossy q90; alpha textures use lossless (no cutout edge-bleed). */
export async function j2cToImageWithAlpha(
	bytes: Buffer | Uint8Array,
): Promise<{ image: Buffer; hasAlpha: boolean; width: number; height: number; srcWidth: number; srcHeight: number }> {
	const dec = await decodeJ2C(bytes)
	const { channels } = dec
	const { pixels, width, height } = downscalePixels(dec.pixels, dec.width, dec.height, channels, MAX_TEX_DIM)
	const hasAlpha = pixelsHaveAlpha(pixels, channels)
	const image = encodeWebp(pixels, width, height, channels, hasAlpha)
	return { image, hasAlpha, width, height, srcWidth: dec.width, srcHeight: dec.height }
}

/** Decode a J2C codestream and re-encode it as a WebP buffer. */
export async function j2cToImage(bytes: Buffer | Uint8Array): Promise<Buffer> {
	return (await j2cToImageWithAlpha(bytes)).image
}
```

Then remove the now-unused PNG import (line 10): delete `import { encode as encodePng } from 'fast-png'`.

- [ ] **Step 2: Rename in the worker pool.** In `server/lib/j2cPool.ts`:
  - Line 8: `import { j2cToPngWithAlpha } from './j2c'` → `import { j2cToImageWithAlpha } from './j2c'`
  - `DecodeResult` (lines 10–17): rename `png: Buffer` → `image: Buffer`.
  - `worker.onmessage` (lines 56–72): rename the wire field `png` → `image` and resolve `image: Buffer.from(d.image)`:

```ts
				const d = e.data as { id: number; ok: boolean; error?: string; image?: ArrayBuffer; hasAlpha?: boolean; width?: number; height?: number; srcWidth?: number; srcHeight?: number }
				const job = pw.inflight.get(d.id)
				if (!job) return
				pw.inflight.delete(d.id)
				if (d.ok && d.image) {
					job.resolve({
						image: Buffer.from(d.image),
						hasAlpha: !!d.hasAlpha,
						width: d.width || 0,
						height: d.height || 0,
						srcWidth: d.srcWidth || 0,
						srcHeight: d.srcHeight || 0,
					})
				} else {
					job.reject(new Error(d.error || 'j2c_worker_failed'))
				}
```

  - Inline fallback (line 103): `return j2cToPngWithAlpha(bytes)` → `return j2cToImageWithAlpha(bytes)`.

- [ ] **Step 3: Rename in the worker body.** Replace `server/lib/j2cWorker.ts` lines 8 and 14–29 with:

```ts
import { j2cToImageWithAlpha } from './j2c'

// Each job: { id, buf }. buf is the J2C codestream as an ArrayBuffer (structured-cloned in — fine).
// Reply on success: { id, ok:true, image:<ArrayBuffer, transferred>, hasAlpha, width, height, srcWidth, srcHeight }.
// Reply on failure: { id, ok:false, error }. The pool rejects the matching job so the caller's catch
// (handlers/assets.ts) sends {error} to the client.
self.onmessage = async (e: MessageEvent) => {
	const { id, buf } = e.data as { id: number; buf: ArrayBuffer }
	try {
		const r = await j2cToImageWithAlpha(Buffer.from(buf))
		const image = r.image
		// WHY .slice(byteOffset, …): the Buffer may be a view onto a larger pooled ArrayBuffer. slice
		// gives a standalone ArrayBuffer covering exactly these bytes, safe to transfer zero-copy.
		const imgBuf = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength)
		self.postMessage(
			{ id, ok: true, image: imgBuf, hasAlpha: r.hasAlpha, width: r.width, height: r.height, srcWidth: r.srcWidth, srcHeight: r.srcHeight },
			[imgBuf],
		)
	} catch (err) {
		self.postMessage({ id, ok: false, error: String((err as Error)?.message || err) })
	}
}
```

- [ ] **Step 4: Update the asset handler.** In `server/handlers/assets.ts`:
  - The header comment (line 4) "transcode to PNG server-side" → "transcode to WebP server-side".
  - `AssetRequestSpec` (lines 19–25): rename `transcodeToPng: boolean` → `transcode: boolean`.
  - Texture spec (line 32): `transcodeToPng: true, mime: 'image/png'` → `transcode: true, mime: 'image/webp'`. Mesh/sound/animation: rename `transcodeToPng:` → `transcode:` (values unchanged, all `false`).
  - In `handleAssetFetch` (lines 73–84): rename `spec.transcodeToPng` → `spec.transcode`, `out = r.png` → `out = r.image`, and the log substring `png${dims}` → `webp${dims}`:

```ts
				let out: Buffer, hasAlpha = false, dims = ''
				if (spec.transcode) {
					const r = await decodeInPool(raw); out = r.image; hasAlpha = r.hasAlpha
					dims = ` ${r.srcWidth}×${r.srcHeight}→${r.width}×${r.height}`
				}
				else out = raw
				slog.info(s.ws, `[Asset] ${assetType} ${uuid.slice(0, 8)}… via ${capName} (${raw.length}B${spec.transcode ? ` → ${out.length}B webp${dims}` : ''})`)
				return {
					mime: spec.transcode ? spec.mime : (res.headers.get('content-type') || spec.mime),
					dataB64: out.toString('base64'),
					...(spec.transcode ? { hasAlpha } : {}),
				}
```

- [ ] **Step 5: Update the j2c test imports + the PNG-specific test.** In `server/__tests__/j2c.test.ts`:
  - Line 4 import → `import { decodeJ2C, j2cToImage, j2cToImageWithAlpha, pixelsHaveAlpha, downscalePixels, encodeWebp, rawFormatFor } from '../lib/j2c'`
  - Delete line 5 `import { decode as decodePng } from 'fast-png'`.
  - Replace the "transcodes J2C to a valid PNG" test (lines 23–30) with:

```ts
	it('transcodes an opaque J2C to a valid lossy WebP of the right dimensions', async () => {
		const webp = await j2cToImage(fixture)
		expect(isWebp(webp)).toBe(true)
		let w = 0, h = 0
		ImageMagick.read(webp, img => { w = img.width; h = img.height })
		expect(w).toBe(128); expect(h).toBe(128)
	})
```

  - Replace the "reports the opaque RGB terrain texture as having no alpha" test (lines 39–42) so it targets the renamed function and add an alpha-fixture test:

```ts
	it('reports the opaque RGB terrain texture as having no alpha', async () => {
		const { hasAlpha } = await j2cToImageWithAlpha(fixture)
		expect(hasAlpha).toBe(false)
	})

	it('reports the RGBA foliage texture as having alpha and emits a valid WebP', async () => {
		const { image, hasAlpha } = await j2cToImageWithAlpha(img('palm-frond-rgba.j2c'))
		expect(hasAlpha).toBe(true)
		expect(isWebp(image)).toBe(true)
	})
```

- [ ] **Step 6: Update `assets.test.ts`.** In `server/__tests__/assets.test.ts`, change the texture expectations (lines 11–12) and the mesh/sound expectations from `transcodeToPng` → `transcode`:

```ts
		expect(s.accept).toBe('image/x-j2c')
		expect(s.transcode).toBe(true)
		expect(s.mime).toBe('image/webp')
```
(and `expect(s.transcode).toBe(false)` for mesh line 19 and sound line 26).

- [ ] **Step 7: Run the server suites, expect PASS.**

Run: `bun test server/__tests__/j2c.test.ts server/__tests__/assets.test.ts server/__tests__/j2cPool.test.ts`
Expected: PASS. If `j2cPool.test.ts` references `.png`, rename to `.image` there too.

- [ ] **Step 8: Commit.**

```bash
git add server/lib/j2c.ts server/lib/j2cPool.ts server/lib/j2cWorker.ts server/handlers/assets.ts server/__tests__/j2c.test.ts server/__tests__/assets.test.ts server/__tests__/j2cPool.test.ts
git commit -m "feat(render): server transcodes J2C->WebP (lossy q90 / lossless alpha)"
```

---

### Task 3: Drop the unused `fast-png` dependency

**Files:**
- Modify: `package.json:26`

- [ ] **Step 1: Confirm no remaining importers.**

Run: `grep -rn "fast-png" server/ src/ shared/`
Expected: no matches (Task 2 removed the import in `j2c.ts` and the test). If any remain, fix them before continuing.

- [ ] **Step 2: Remove the dependency.** Delete line 26 `"fast-png": "^8.0.0",` from `package.json`, then:

Run: `npm install`
Expected: lockfile updates, no errors.

- [ ] **Step 3: Re-run the server suites.**

Run: `bun test server/`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add package.json package-lock.json
git commit -m "chore: drop fast-png (WebP transcode uses magick)"
```

---

### Task 4: Purge stale PNG entries from IndexedDB

**Files:**
- Modify: `src/lib/textureCache.js:8-13,38-44`

- [ ] **Step 1: Bump the DB version + purge.** In `src/lib/textureCache.js`, change `DB_VERSION` (line 8) from `3` to `4`, update its comment to note the v4 purge (PNG → WebP cutover), and widen the one-time purge guard so v<4 drops every store. Replace lines 40–44:

```js
			// One-time purge: drop every store so nothing from a superseded transcode pipeline survives.
			// v3 = post-cornerstone→magick J2C swap; v4 = PNG→WebP cutover (old PNG data-URLs are dead).
			if (e.oldVersion > 0 && e.oldVersion < 4) {
				for (const name of [STORE, META, FAILED]) {
					if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name)
				}
			}
```

- [ ] **Step 2: Verify the client build + existing cache tests still pass.**

Run: `npx vitest run src/__tests__/lib/textureCache.test.js && npx vite build`
Expected: PASS / build succeeds.

- [ ] **Step 3: Live-verify Phase A.** Start the server (`npm run dev:server`) and Vite (`npm run dev`), log into the Neverworld var-region, and confirm in the server log that `[Asset] … → NB webp` lines appear and that the per-texture byte count is markedly lower than the old PNG sizes. In DevTools → Application → IndexedDB → `qs-tex`, confirm records repopulate and total stays well under prior levels. Spot-check that alpha foliage still renders cutouts correctly (lossless branch) and opaque surfaces look clean (q90).

- [ ] **Step 4: Commit.**

```bash
git add src/lib/textureCache.js
git commit -m "feat(render): purge IDB v4 for PNG->WebP texture cutover"
```

> **Phase A complete.** Server now serves WebP; IDB holds WebP data-URLs. This delivers the 3–5× size reduction. Stop here if Phase B/C aren't needed yet.

---

## PHASE B — Browser Blob storage

Stores the WebP as a binary `Blob` (saves the +33% base64 inflation) and builds the GPU texture via `createImageBitmap`.

### Task 5: Store Blobs in IndexedDB

**Files:**
- Modify: `src/lib/textureCache.js` (DB version, record shape, get/put)
- Test: `src/__tests__/lib/textureCache.test.js`

- [ ] **Step 1: Write failing tests for the Blob record shape.** In `src/__tests__/lib/textureCache.test.js`, add a test that a put-then-get returns a Blob and that `bytes` reflects `blob.size`. (`fake-indexeddb` is already used by the existing suite — mirror its setup; if the suite uses a helper to open the DB, reuse it.)

```js
import { texCachePut, texCacheGet } from '@/lib/textureCache.js'

it('stores and returns a Blob, sizing bytes by blob.size', async () => {
	const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/webp' })
	await texCachePut('11111111-1111-1111-1111-111111111111', blob, true)
	const got = await texCacheGet('11111111-1111-1111-1111-111111111111')
	expect(got.blob).toBeInstanceOf(Blob)
	expect(got.blob.size).toBe(5)
	expect(got.hasAlpha).toBe(true)
})
```

- [ ] **Step 2: Run it, expect FAIL.**

Run: `npx vitest run src/__tests__/lib/textureCache.test.js`
Expected: FAIL — `texCacheGet` returns `{ url, hasAlpha }`, no `blob`.

- [ ] **Step 3: Switch the record to a Blob.** In `src/lib/textureCache.js`:
  - `DB_VERSION` 4 → 5; extend the purge guard to `< 5` and note "v5 = data-URL string → Blob".
  - Line 14 comment: `// { uuid, blob, bytes, hasAlpha, lastUsed }`.
  - `texCacheGet` (lines 78–99): resolve `rec ? { blob: rec.blob, hasAlpha: !!rec.hasAlpha } : null`.
  - `texCachePut` signature + body (lines 130–138): take a `blob` and size by `blob.size`:

```js
export async function texCachePut(uuid, blob, hasAlpha = false, now = Date.now()) {
	try {
		const db = await openDb()
		const bytes = blob.size
		await new Promise((resolve, reject) => {
			const tx = db.transaction([STORE, META], 'readwrite')
			const st = tx.objectStore(STORE)
			const mt = tx.objectStore(META)
			st.put({ uuid, blob, bytes, hasAlpha, lastUsed: now })
			// …(eviction body below unchanged)…
```

(The eviction/stats body from line 139 onward is unchanged — it operates on `bytes`, not the payload.)

- [ ] **Step 4: Run it, expect PASS.**

Run: `npx vitest run src/__tests__/lib/textureCache.test.js`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/textureCache.js src/__tests__/lib/textureCache.test.js
git commit -m "feat(render): store textures as Blob in IDB (v5), bytes=blob.size"
```

---

### Task 6: Blob-based fetch + `createImageBitmap` build

**Files:**
- Modify: `src/composables/useTextureFetch.js`

- [ ] **Step 1: Add a base64→Blob helper.** Near the top of `src/composables/useTextureFetch.js` (after the imports), add:

```js
// Decode a base64 payload (as delivered over WS) into a typed Blob for IDB storage + createImageBitmap.
// WHY: storing the Blob (not a data-URL string) drops the +33% base64 inflation and lets the GPU
// texture build via createImageBitmap (no data-URL parse).
function b64ToBlob(b64, mime) {
	const bin = atob(b64)
	const bytes = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
	return new Blob([bytes], { type: mime })
}
```

- [ ] **Step 2: Rename the in-memory mirror to a Blob cache + add an object-URL cache.** Replace the `urlCache` declaration (line 29) and add an object-URL map:

```js
const blobCache   = new Map()  // uuid → Blob (sync mirror; preview <img> + fast re-reads)
const objUrlCache = new Map()  // uuid → object URL (lazily created for <img> previews; revoked on prune/clear)
```

Replace every other `urlCache` reference in the file (lines 118, 169, 176, 178, 217, 239, 304, 321) per the steps below.

- [ ] **Step 3: Build a Blob in `_onAssetData`.** Replace lines 91–103 (the data-URL construction + late-arrival persist) with:

```ts
		alphaCache.set(d.uuid, !!d.hasAlpha)
		const blob = b64ToBlob(d.dataB64, d.mime || 'image/webp')
		if (p) { p.resolve(blob); return }
		// Late arrival — request already timed out and freed its slot, but the transcode is paid for.
		// Persist to IDB and clear the timeout strikes so the next soft-retry hits cache instantly.
		stats.late++
		softAttempts.delete(d.uuid)
		texCachePut(d.uuid, blob, !!d.hasAlpha)
```

- [ ] **Step 4: Make the resolver Blob-typed.** In `_wsFetch` (lines 118–120) the cache recheck becomes Blob-based:

```js
				const cachedBlob = blobCache.get(uuid)
					?? await texCacheGet(uuid).then(c => { if (c) alphaCache.set(uuid, c.hasAlpha); return c?.blob ?? null }).catch(() => null)
				if (cachedBlob) { active--; _pump(); resolve(cachedBlob); return }
```

Rename `getDataUrl` → `getBlob` (line 167) and update its body (lines 169–186):

```js
function getBlob(uuid) {
	if (!uuid || uuid === ZERO_UUID) return Promise.resolve(null)
	if (blobCache.has(uuid)) return Promise.resolve(blobCache.get(uuid))
	if (failedHard.has(uuid)) return Promise.resolve(null)
	if ((softAttempts.get(uuid) || 0) >= MAX_SOFT_RETRY) return Promise.resolve(null)
	if (urlInflight.has(uuid)) return urlInflight.get(uuid)

	const p = (async () => {
		const cached = await texCacheGet(uuid)
		if (cached) { blobCache.set(uuid, cached.blob); alphaCache.set(uuid, cached.hasAlpha); return cached.blob }
		const net = await _wsFetch(uuid)
		if (net) { blobCache.set(uuid, net); texCachePut(uuid, net, alphaCache.get(uuid) ?? false); return net }
		return null
	})().then(blob => { urlInflight.delete(uuid); return blob })

	urlInflight.set(uuid, p)
	return p
}
```

- [ ] **Step 5: Build the texture from a Blob via `createImageBitmap`.** Replace `buildTexture` (lines 196–220):

```js
// Build a THREE.Texture from a WebP Blob, downscaling the resident image to MAX_TEX_DIM.
async function buildTexture(blob) {
	let bitmap
	try { bitmap = await createImageBitmap(blob) } catch { return null }
	let source = bitmap
	const longest = Math.max(bitmap.width, bitmap.height)
	if (longest > MAX_TEX_DIM) {
		const s = MAX_TEX_DIM / longest
		const cw = Math.max(1, Math.round(bitmap.width * s))
		const ch = Math.max(1, Math.round(bitmap.height * s))
		const canvas = document.createElement('canvas')
		canvas.width = cw; canvas.height = ch
		const ctx = canvas.getContext('2d')
		if (ctx) { ctx.drawImage(bitmap, 0, 0, cw, ch); source = canvas; bitmap.close?.() }
	}
	const tex = new THREE.Texture(source)
	tex.colorSpace = THREE.SRGBColorSpace
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping
	tex.needsUpdate = true
	return tex
}
```

- [ ] **Step 6: Point `getBaseTexture` at the Blob path.** In `getBaseTexture` (line 228) change `getDataUrl(uuid)` → `getBlob(uuid)` and `url ? buildTexture(url) : null` → `blob ? buildTexture(blob) : null`. Update the `urlCache.delete(uuid)` on line 239 → `blobCache.delete(uuid)` (the comment "Free the in-memory PNG data URL" → "Free the in-memory Blob mirror").

- [ ] **Step 7: Object-URL previews.** Replace `getTextureUrl` (lines 280–282):

```js
/** Resolve a texture UUID to an object URL for an <img> preview. Null on missing/failed.
 *  Cached + reused per uuid; revoked by pruneTexturesLRU / clearTextureCache. */
export function getTextureUrl(uuid) {
	const existing = objUrlCache.get(uuid)
	if (existing) return Promise.resolve(existing)
	return getBlob(uuid).then(blob => {
		if (!blob) return null
		const u = URL.createObjectURL(blob)
		objUrlCache.set(uuid, u)
		return u
	})
}
```

- [ ] **Step 8: Revoke object URLs + drop blobs on prune/clear.** In `pruneTexturesLRU` (line 304) replace `urlCache.delete(uuid)` with:

```js
		blobCache.delete(uuid)
		const ou = objUrlCache.get(uuid); if (ou) { URL.revokeObjectURL(ou); objUrlCache.delete(uuid) }
```

In `clearTextureCache` (line 321) replace `urlCache.clear()` with:

```js
	for (const u of objUrlCache.values()) URL.revokeObjectURL(u)
	objUrlCache.clear()
	blobCache.clear()
```

Also update the module header comment (lines 2–5) and the `getBaseTexture`/`_onAssetData` doc lines that say "data URL" → "Blob".

- [ ] **Step 9: Verify build + run.**

Run: `npx vitest run && npx vite build`
Expected: PASS / build succeeds.

Then live-verify: log into the region, confirm textures render (opaque + alpha), confirm `<img>` previews in the object-edit / inventory floaters still show thumbnails, and confirm IndexedDB `qs-tex` total is ~⅔ of the Phase-A figure for the same region.

- [ ] **Step 10: Commit.**

```bash
git add src/composables/useTextureFetch.js
git commit -m "feat(render): Blob texture cache + createImageBitmap build"
```

---

## PHASE C — Quota-derived cap + persistence

### Task 7: Size the IDB cap to real quota and request persistence

**Files:**
- Modify: `src/lib/textureCache.js`
- Test: `src/__tests__/lib/textureCache.test.js`

- [ ] **Step 1: Write a failing test for the pure cap resolver.** Add to `src/__tests__/lib/textureCache.test.js`:

```js
import { resolveCacheCap } from '@/lib/textureCache.js'

describe('resolveCacheCap', () => {
	const FALLBACK = 8 * 1024 * 1024 * 1024
	it('takes a fraction of the reported quota', () => {
		expect(resolveCacheCap({ quota: 100 * 1024 * 1024 * 1024 }, 0.6, FALLBACK)).toBe(60 * 1024 * 1024 * 1024)
	})
	it('falls back when quota is missing or zero', () => {
		expect(resolveCacheCap({}, 0.6, FALLBACK)).toBe(FALLBACK)
		expect(resolveCacheCap({ quota: 0 }, 0.6, FALLBACK)).toBe(FALLBACK)
		expect(resolveCacheCap(undefined, 0.6, FALLBACK)).toBe(FALLBACK)
	})
})
```

- [ ] **Step 2: Run it, expect FAIL.**

Run: `npx vitest run src/__tests__/lib/textureCache.test.js`
Expected: FAIL — `resolveCacheCap` not exported.

- [ ] **Step 3: Implement the resolver + dynamic cap.** In `src/lib/textureCache.js`, replace the `TEX_CACHE_CAP_BYTES` const (line 23) with a fallback + a mutable cap + an init, and add the pure resolver:

```js
// Fallback cap when the browser won't report a quota. Real cap is derived from navigator.storage
// .estimate() at init (see initCacheCap) so the cache scales to the machine instead of guessing.
export const TEX_CACHE_FALLBACK_BYTES = 8 * 1024 * 1024 * 1024
const CAP_FRACTION = 0.6   // fraction of the origin's quota we're willing to hold
let _capBytes = TEX_CACHE_FALLBACK_BYTES

// Pure: choose a cap from a StorageEstimate-like object. Exported for unit tests (no navigator dep).
export function resolveCacheCap(estimate, fraction = CAP_FRACTION, fallback = TEX_CACHE_FALLBACK_BYTES) {
	const quota = estimate && typeof estimate.quota === 'number' ? estimate.quota : 0
	return quota > 0 ? Math.floor(quota * fraction) : fallback
}

// Request persistent storage (exempts the cache from automatic eviction under disk pressure) and
// derive the cap from the real quota. Best-effort: any failure leaves the fallback cap in place.
// Safe to call repeatedly; the first call does the work.
let _capInit = null
export function initCacheCap() {
	if (_capInit) return _capInit
	_capInit = (async () => {
		try {
			if (navigator.storage?.persist) await navigator.storage.persist()
			if (navigator.storage?.estimate) _capBytes = resolveCacheCap(await navigator.storage.estimate())
		} catch { /* keep fallback */ }
		return _capBytes
	})()
	return _capInit
}
```

Replace the two `TEX_CACHE_CAP_BYTES` usages in `texCachePut` (lines 152, 161) with `_capBytes`, and in `getTextureCacheStats` (lines 177, 188, 191) return `capBytes: _capBytes`.

- [ ] **Step 4: Kick off cap init once the DB opens.** In `openDb`'s `onsuccess` (line 52), after `_db = e.target.result`, add `initCacheCap()` (fire-and-forget) so persistence is requested and the cap is sized on first cache use:

```js
			req.onsuccess = (e) => { _db = e.target.result; initCacheCap(); resolve(_db) }
```

- [ ] **Step 5: Run it, expect PASS.**

Run: `npx vitest run src/__tests__/lib/textureCache.test.js`
Expected: PASS.

- [ ] **Step 6: Verify build + live.**

Run: `npx vite build`
Then live: in DevTools console, `await navigator.storage.estimate()` shows the quota, `await navigator.storage.persisted()` returns `true` (granted), and the Cache/Prefs stats panel shows the new cap (≈60% of quota) rather than a flat 8 GB.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/textureCache.js src/__tests__/lib/textureCache.test.js
git commit -m "feat(render): quota-derived IDB cap + persistent storage request"
```

---

## Follow-ups (out of scope)

- **Disk-persistent server tier-2.** `assetMemo.ts` is RAM-only (384 MB, lost on restart). A disk/SQLite-backed tier keyed by `assetType:uuid` would let cold client misses hit already-transcoded WebP on the VPS/NAS instead of re-fetching J2C from the grid + re-decoding — the real "cache for many many regions" durability play. Separate spec.
- **Full-size export path.** Render cache is lossy/downscaled. For texture/mesh export, re-fetch the original J2C from the grid by UUID at export time (UUIDs are immutable) rather than storing originals.
- **Tune `WEBP_QUALITY`.** q90 chosen for safety; measure size vs. visual delta at q80 on a dense region if footprint is still a concern.

## Self-Review Notes

- **Spec coverage:** WebP format (Task 1–2), lossless-for-alpha (Task 2 `lossless = hasAlpha`), q90 (Task 1 `WEBP_QUALITY`), Blob storage (Task 5–6), quota cap + persist (Task 7), DB purges (Task 4 v4, Task 5 v5). Server RAM tier already exists — noted, benefits for free.
- **Type consistency:** `j2cToImageWithAlpha`/`j2cToImage` return `{ image }`; `DecodeResult.image`; worker/pool wire field `image`; handler `r.image`; spec field `transcode`. `texCachePut(uuid, blob, hasAlpha)` / `texCacheGet → { blob, hasAlpha }`; resolver `getBlob`. No stale `png`/`url`/`transcodeToPng` references should remain after Phase A/B (Task 3 Step 1 greps for `fast-png`; a similar grep for `transcodeToPng` and `urlCache` is advised before each phase's final commit).
- **No placeholders:** every code step shows the code; every run step has an expected result.
