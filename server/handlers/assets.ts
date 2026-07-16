// server/handlers/assets.ts — asset fetch over the HTTP cap layer (ViewerAsset / GetTexture / GetMesh).
// WHY: SL/OpenSim serve textures, mesh, sounds, etc. as binary assets by UUID. ViewerAsset is the
// unified cap; type-specific caps are fallbacks. Textures come back as J2C (image/x-j2c) which the
// browser can't decode, so we transcode to WebP server-side (see lib/j2c.ts). Cap URLs + tokens stay
// on the server; the browser gets clean base64. Shapes from caps-feature-map cluster A.
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { getSession } from '../state/sessions'
import { slog } from '../lib/serverLog'
import { decodeInPool, getPoolStats } from '../lib/j2cPool'
import { createAssetMemo } from '../lib/assetMemo'
import { openAssetDiskCacheSafe, createDisabledAssetDiskCache, type AssetDiskCache } from '../lib/assetDiskCache'
import { S } from '../../shared/protocol.js'

// Tier-2 asset cache + request coalescing. Assets are global by UUID (caps are per-session but the
// bytes they serve are not), so one memo serves every circuit. dataB64 length ≈ payload bytes.
// srcWidth/srcHeight are the TRUE J2C-header dimensions (present on transcoded textures); the client
// texture-preview floater shows these as the real asset size regardless of the world downscale cap.
type AssetPayload = { mime: string; dataB64: string; hasAlpha?: boolean; srcWidth?: number; srcHeight?: number }
const ASSET_MEMO_BUDGET = 384 * 1048576
const assetMemo = createAssetMemo<AssetPayload>({ budgetBytes: ASSET_MEMO_BUDGET, sizeOf: v => v.dataB64.length })
let _memoStatTick = 0
let _assetLogN = 0

// Tier-2 DISK cache (survives restart; shared across clients). Env-tunable; disabled → no-op.
// Defaults: .cache/assets.sqlite, 8 GB cap, 6 h negative-TTL. The grid fetch + WebP transcode then
// happens once EVER for an immutable-by-UUID asset, instead of every cold load / restart.
const ASSET_DISK_CACHE_ON    = process.env.ASSET_DISK_CACHE !== '0'
const ASSET_DISK_CACHE_PATH  = process.env.ASSET_DISK_CACHE_PATH  || '.cache/assets.sqlite'
const ASSET_DISK_CACHE_BYTES = Number(process.env.ASSET_DISK_CACHE_BYTES) || 8 * 1024 * 1024 * 1024
const ASSET_DISK_NEG_TTL_MS  = Number(process.env.ASSET_DISK_NEG_TTL_MS) || 6 * 3600 * 1000
try { mkdirSync(dirname(ASSET_DISK_CACHE_PATH), { recursive: true }) } catch { /* ignore */ }
const assetDisk: AssetDiskCache = ASSET_DISK_CACHE_ON
	? openAssetDiskCacheSafe({ path: ASSET_DISK_CACHE_PATH, capBytes: ASSET_DISK_CACHE_BYTES, negTtlMs: ASSET_DISK_NEG_TTL_MS })
	: createDisabledAssetDiskCache()
let _diskHits = 0, _diskMiss = 0   // handler-level counters for the [AssetMemo] log line

// WHY: this grid serves 100+ permanently-missing assets (blob 404s). A 404 is DEFINITIVELY DEAD —
// retrying never resurrects it — so it is negative-cached and short-circuited (see DEAD_ASSET below).
// To stop the log flood we dedupe the one-line dead-asset notice per key; an already-negative-cached
// asset re-asked within TTL is fully silent (no fetch, no log).
const DEAD_ASSET = 'asset_missing'                 // sentinel thrown for a known-dead (404'd) asset
const _deadLogged = new Set<string>()              // keys whose "dead" notice has been logged once

// Transient-failure retry policy. ONLY network errors / timeouts / 5xx are retried — never a 404
// (a missing asset will not appear by retrying). Coalescing (assetMemo) means one in-flight retry
// chain serves every concurrent waiter for the same uuid.
const ASSET_RETRY_BACKOFF_MS = [250, 750]          // attempt N waits this long before retrying
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// WHY pure + exported: the "what is worth retrying" decision is the load-bearing detail of R2 and
// must be pinned by a test independent of a live fetch. Returns the next action for a fetch outcome.
//   'retry' → transient (network err / 5xx) with retry budget left; backoff then re-fetch
//   'dead'  → 404: definitively missing → negative-cache, never retry
//   'fail'  → non-transient (other 4xx) or out of retry budget → give up
export type AssetFetchOutcome =
	| { kind: 'network' }              // fetch() threw (DNS/conn/timeout)
	| { kind: 'status'; status: number }
export function assetRetryDecision(outcome: AssetFetchOutcome, attempt: number): 'retry' | 'dead' | 'fail' {
	const hasBudget = attempt < ASSET_RETRY_BACKOFF_MS.length
	if (outcome.kind === 'network') return hasBudget ? 'retry' : 'fail'
	if (outcome.status === 404) return 'dead'
	if (outcome.status >= 500) return hasBudget ? 'retry' : 'fail'
	return 'fail'                       // non-transient 4xx (401/403/410/…)
}

export interface AssetRequestSpec {
	capNames: string[]      // cap names to try, in preference order
	queryKey: string        // the `?<key>=<uuid>` query parameter
	accept: string          // Accept header
	transcode: boolean      // true → decode J2C and re-encode WebP before sending
	mime: string            // Content-Type sent to the browser (post-transcode for textures)
}

// WHY pure + exported: the query-key/cap-name mapping is the detail that silently 404s when wrong.
// Unit-tested in __tests__/assets.test.ts.
export function assetRequestSpec(assetType: string): AssetRequestSpec | null {
	switch (assetType) {
		case 'texture':
			return { capNames: ['ViewerAsset', 'GetTexture'], queryKey: 'texture_id', accept: 'image/x-j2c', transcode: true, mime: 'image/webp' }
		case 'mesh':
			return { capNames: ['ViewerAsset', 'GetMesh2', 'GetMesh'], queryKey: 'mesh_id', accept: 'application/vnd.ll.mesh', transcode: false, mime: 'application/vnd.ll.mesh' }
		case 'sound':
			return { capNames: ['ViewerAsset'], queryKey: 'sound_id', accept: 'audio/ogg', transcode: false, mime: 'audio/ogg' }
		case 'animation':
			return { capNames: ['ViewerAsset'], queryKey: 'animatn_id', accept: 'application/vnd.ll.animation', transcode: false, mime: 'application/vnd.ll.animation' }
		case 'notecard':
			// Notecard asset = the "Linden text version 2" envelope (client strips it via assetSerialize).
			return { capNames: ['ViewerAsset'], queryKey: 'notecard_id', accept: 'application/octet-stream', transcode: false, mime: 'text/plain' }
		case 'lsltext':
			// LSL script source = raw UTF-8 text. GetAssetsHandler.cs:61 maps lsltext_id → AssetType.LSLText.
			return { capNames: ['ViewerAsset'], queryKey: 'lsltext_id', accept: 'application/octet-stream', transcode: false, mime: 'text/plain' }
		default:
			return null
	}
}

export async function handleAssetFetch(circuitId: string, req: { assetType: string; uuid: string; full?: boolean }): Promise<void> {
	const s = getSession(circuitId)
	if (!s) return
	const t0 = performance.now()   // DIAG(webp-trickle): handler entry → reply send, reported as tMs
	const { assetType, uuid } = req || ({} as any)
	const spec = assetRequestSpec(assetType)
	// WHY full-res path: the world load transcodes textures at MAX_TEX_DIM (512) to bound GPU/heap. The
	// texture-preview floater wants the TRUE asset pixels (FS llpreviewtexture BOOST_PREVIEW), so it asks
	// for full=true → we decode with no downscale cap and cache it under a distinct key so the full-res
	// bytes never evict/pollute the world 512 texture cache. Only textures honor `full` (transcode path).
	const full = !!req?.full && !!spec?.transcode
	const send = (d: Record<string, unknown>) => s.ws.send(JSON.stringify({ t: S.ASSET_DATA, d: { uuid, assetType, ...(full ? { full: true } : {}), ...d } }))

	if (!spec || !uuid) { send({ error: 'bad_request' }); return }

	const capName = spec.capNames.find(n => s.caps.get(n))
	const capBase = capName ? s.caps.get(capName) : undefined
	if (!capBase) {
		slog.warn(s.ws, `[Asset] cap_unavailable for ${assetType} — have: ${[...s.caps.keys()].join(', ') || '(none)'}`)
		send({ error: 'cap_unavailable' })
		return
	}

	const url = `${capBase}/?${spec.queryKey}=${uuid}`
	try {
		// Memoized: a cached asset answers instantly; a concurrent/retried request for the same uuid
		// shares the in-flight grid fetch + decode instead of re-queuing both. Errors throw and are
		// never cached (the rejection reaches every coalesced waiter; a later retry re-attempts).
		// Distinct cache key for the full-res variant so it never evicts/serves the world 512 payload.
		const memoKey = full ? `${assetType}:full:${uuid}` : `${assetType}:${uuid}`
		const payload = await assetMemo.memo(memoKey, async () => {
			const key = memoKey
			// Tier-2: a previously fetched+transcoded asset answers from disk — no grid fetch, no decode.
			const cached = assetDisk.get(key)
			if (cached) { _diskHits++; return cached }
			_diskMiss++
			// A recently-confirmed 404 short-circuits without re-spending a 2–3s grid fetch + pool slot.
			// Serve the negative verdict to every coalesced waiter so a known-dead asset is never
			// re-fetched within the TTL. Thrown as DEAD_ASSET (not http_404) so the catch stays silent.
			if (assetDisk.isNegative(key)) throw new Error(DEAD_ASSET)

			// Bounded retry: ONLY transient failures (network/timeout/5xx) are retried. A 404 breaks
			// out immediately and is negative-cached — retrying a missing asset is pointless work.
			// WHY: OpenSim returns 404 (not 416) when a speculative range overshoots; here we make no
			// range request, so a 404 is a genuine missing asset. assetRetryDecision encodes the policy.
			const tFetch0 = performance.now()
			let res: Response | undefined
			for (let attempt = 0; ; attempt++) {
				let outcome: AssetFetchOutcome
				try {
					res = await fetch(url, { headers: { Accept: spec.accept }, signal: AbortSignal.timeout(25_000) })
					if (res.ok) break
					outcome = { kind: 'status', status: res.status }
				} catch {
					outcome = { kind: 'network' }
				}
				const action = assetRetryDecision(outcome, attempt)
				if (action === 'retry') { await sleep(ASSET_RETRY_BACKOFF_MS[attempt]); continue }
				if (action === 'dead') {
					assetDisk.putNegative(key)
					if (!_deadLogged.has(key)) { _deadLogged.add(key); slog.info(s.ws, `[Asset] missing ${assetType} ${uuid} (404 — negative-cached)`) }
					throw new Error(DEAD_ASSET)
				}
				// 'fail' → non-transient 4xx, or transient out of retry budget.
				throw new Error(outcome.kind === 'network' ? 'network_error' : `http_${outcome.status}`)
			}
			const raw = Buffer.from(await res!.arrayBuffer())
			const fetchMs = Math.round(performance.now() - tFetch0)

			let out: Buffer, hasAlpha = false, dims = '', decodeMs = 0
			let srcWidth = 0, srcHeight = 0
			if (spec.transcode) {
				const tDec0 = performance.now()
				// full → Infinity = no downscale cap (true asset resolution for the preview floater).
				const r = await decodeInPool(raw, full ? Infinity : undefined); out = r.image; hasAlpha = r.hasAlpha
				srcWidth = r.srcWidth; srcHeight = r.srcHeight
				decodeMs = Math.round(performance.now() - tDec0)
				dims = ` ${r.srcWidth}×${r.srcHeight}→${r.width}×${r.height}`
			}
			else out = raw
			// Sampled: first 10 then every 25th (real work only — cache hits are silent; [AssetMemo]
			// stats carry the totals). Per-asset lines were the dominant server-log flood.
			if (++_assetLogN <= 10 || _assetLogN % 25 === 0) {
				const ps = getPoolStats()
				slog.info(s.ws, `[Asset] #${_assetLogN} ${assetType} ${uuid.slice(0, 8)}… via ${capName} (${raw.length}B${spec.transcode ? ` → ${out.length}B webp${dims}` : ''}) fetch=${fetchMs}ms decode=${decodeMs}ms | pool w=${ps.workers} degraded=${ps.degraded} inflight=${ps.inflight}`)
			}
			const result = {
				mime: spec.transcode ? spec.mime : (res!.headers.get('content-type') || spec.mime),
				dataB64: out.toString('base64'),
				...(spec.transcode ? { hasAlpha, srcWidth, srcHeight } : {}),
			}
			assetDisk.put(key, result)   // persist for every later client / visit / restart
			return result
		})
		if (!payload) { send({ error: 'unavailable' }); return }
		// DIAG(webp-trickle): tMs added per-request (NOT memoized — memo hits report their own, near-0 time)
		send({ ...payload, tMs: Math.round(performance.now() - t0) })
		if ((++_memoStatTick % 200) === 0) {
			const m = assetMemo.stats(), d = assetDisk.stats()
			slog.info(s.ws, `[AssetMemo] size=${m.size} MB=${(m.bytes / 1048576).toFixed(0)} hits=${m.hits} misses=${m.misses} evict=${m.evictions} inflight=${m.inflight} | disk hits=${_diskHits} miss=${_diskMiss} MB=${(d.bytes / 1048576).toFixed(0)} size=${d.size} evict=${d.evictions} neg=${d.negSize}`)
		}
	} catch (e) {
		const msg = (e as Error).message
		// A known-dead asset is silent here — it was negative-cached and logged once at the 404 source;
		// every later coalesced waiter and re-ask within TTL lands here and must NOT re-flood the log.
		// Genuine transient failures (out of retries) still warn so a real outage stays visible.
		if (msg !== DEAD_ASSET) slog.warn(s.ws, `[Asset] fetch failed ${assetType} ${uuid.slice(0, 8)}…: ${msg}`)
		send({ error: msg })
	}
}
