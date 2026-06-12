# 2026-06-11 — WebP Texture Cache (all 7 plan tasks)

**Plan:** `docs/superpowers/plans/2026-06-11-webp-texture-cache.md` — executed end-to-end via subagent-driven development (fresh implementer per task, spec-compliance + code-quality review per task, final integration review). All server (153) and client cache (9) tests pass; `vite build` clean. **Not yet live-verified.**

## What shipped

- **Phase A (Tasks 1–4):** server transcodes J2C → WebP via the already-loaded magick-wasm (lossy q90 opaque / lossless alpha), `png`→`image` rename through `j2cPool`/`j2cWorker`/`assets.ts` (`transcodeToPng`→`transcode`, mime `image/webp`), `fast-png` dependency dropped, IDB `DB_VERSION` 4 purge of stale PNG entries. assetMemo structure + sampled `[Asset]` logging preserved.
- **Phase B (Tasks 5–6):** IDB stores binary Blobs (v5, `bytes = blob.size`), `useTextureFetch` converted end-to-end (`blobCache`/`objUrlCache`/`getBlob`/`blobInflight`), GPU build via `createImageBitmap`. Slot-open cache recheck, late-arrival persist, and the 320 MB `TEX_INTAKE_BUDGET` gate all preserved.
- **Phase C (Task 7):** cap derived from `navigator.storage.estimate()` (60%, 8 GiB fallback, pure `resolveCacheCap` unit-tested), `persist()` requested fire-and-forget, `[TexCache] cap` debug log.

## Review-driven deviations from the plan (all deliberate)

1. magick-wasm: `img.setDefine` doesn't exist; options must go through `img.settings.setDefine(MagickFormat.WebP, ...)` — `setArtifact` is silently ignored by the encoder.
2. Lossless branch adds the `exact` define — without it libwebp discards RGB under alpha=0 texels, causing dark halos at bilinear-sampled cutout edges. Test pins this with a byte-exact round-trip through a fully-transparent pixel.
3. Lossless `quality` set to 75 not 100 — in lossless mode quality is compression *effort* only (100 ≈ 3× encode time for zero fidelity gain).
4. `encodeWebp` gained a `webp_encode_size_mismatch` input guard; tests assert WebP fourcc (`VP8 ` lossy / `VP8L` lossless) to pin format routing.
5. Client decode pins old behavior with `createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none' })` + `tex.flipY = false` — WebGL ignores both texture-level flags for ImageBitmap sources.
6. `initCacheCap` runs `estimate()` before `persist()` (Firefox's persist doorhanger must not block cap derivation), persist is fire-and-forget.
7. `fake-indexeddb` added as devDependency (plan assumed it existed); `b64ToBlob` guarded against malformed payloads.

## Known minor debt (flagged, deliberately deferred)

- `objUrlCache` unbounded for preview-only UUIDs (bounded in practice by per-session floater use).
- Revoke-on-prune can blank a still-open floater thumbnail on re-render (narrow window).
- GRAYA-with-alpha textures take the lossy path (`pixelsHaveAlpha` is 4-channel-only — pre-existing semantics).
- Follow-ups from the plan remain open: disk-persistent server tier-2, q-tuning, plus `instant-load-geometry-cache` and `crc-probe-audit` (tech-debt).

## Live-verify checklist

1. Server log: `[Asset] … → NB webp W×H→W×H`, byte counts well below PNG-era.
2. Opaque surfaces clean at q90; foliage cutouts crisp, no dark halos, **nothing upside-down** (flipY seam).
3. IndexedDB `qs-tex`: Blob records, total ≈ ⅓–⅕ of before.
4. Console `[TexCache] cap` ≈ 60% of quota; Prefs cache panel shows derived cap, not 8192 MB.
5. ObjectEditFloater `<img>` previews still render.
6. Firefox: persist() doorhanger appears — accepted UX for now.
