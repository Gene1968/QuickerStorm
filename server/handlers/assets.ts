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
type AssetPayload = { mime: string; dataB64: string; hasAlpha?: boolean }
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
		default:
			return null
	}
}

export async function handleAssetFetch(circuitId: string, req: { assetType: string; uuid: string }): Promise<void> {
	const s = getSession(circuitId)
	if (!s) return
	const t0 = performance.now()   // DIAG(webp-trickle): handler entry → reply send, reported as tMs
	const { assetType, uuid } = req || ({} as any)
	const send = (d: Record<string, unknown>) => s.ws.send(JSON.stringify({ t: S.ASSET_DATA, d: { uuid, assetType, ...d } }))

	const spec = assetRequestSpec(assetType)
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
		const payload = await assetMemo.memo(`${assetType}:${uuid}`, async () => {
			const key = `${assetType}:${uuid}`
			// Tier-2: a previously fetched+transcoded asset answers from disk — no grid fetch, no decode.
			const cached = assetDisk.get(key)
			if (cached) { _diskHits++; return cached }
			_diskMiss++
			// A recently-confirmed 404 short-circuits without re-spending a 2–3s grid fetch + pool slot.
			if (assetDisk.isNegative(key)) throw new Error('http_404')

			const tFetch0 = performance.now()
			const res = await fetch(url, { headers: { Accept: spec.accept }, signal: AbortSignal.timeout(25_000) })
			// WHY: OpenSim returns 404 (not 416) when a speculative range overshoots; here we make no
			// range request, so a 404 is a genuine missing asset → remember it (TTL'd). Other failures
			// (timeout / 5xx) are transient and must NOT be negative-cached.
			if (!res.ok) {
				if (res.status === 404) assetDisk.putNegative(key)
				throw new Error(`http_${res.status}`)
			}
			const raw = Buffer.from(await res.arrayBuffer())
			const fetchMs = Math.round(performance.now() - tFetch0)

			let out: Buffer, hasAlpha = false, dims = '', decodeMs = 0
			if (spec.transcode) {
				const tDec0 = performance.now()
				const r = await decodeInPool(raw); out = r.image; hasAlpha = r.hasAlpha
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
				mime: spec.transcode ? spec.mime : (res.headers.get('content-type') || spec.mime),
				dataB64: out.toString('base64'),
				...(spec.transcode ? { hasAlpha } : {}),
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
		slog.warn(s.ws, `[Asset] fetch failed ${assetType} ${uuid.slice(0, 8)}…: ${(e as Error).message}`)
		send({ error: (e as Error).message })
	}
}
