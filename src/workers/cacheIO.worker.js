// src/workers/cacheIO.worker.js — owns qs-geom IDB + the large geom mem-tier off the main thread.
import * as geom from '../lib/geomCacheCore.js'

// Build a transfer list from an arrays object (position/normal/uv/index buffers).
function arraysTransfer(a) {
	const t = []
	if (a?.position) t.push(a.position.buffer)
	if (a?.normal)   t.push(a.normal.buffer)
	if (a?.uv)       t.push(a.uv.buffer)
	if (a?.index)    t.push(a.index.buffer)
	return t
}

self.onmessage = async (e) => {
	const { id, op } = e.data
	try {
		switch (op) {
			case 'geomGetMany': {
				const map = await geom.geomCacheGetMany(e.data.keys)
				const hits = {}; const transfer = []
				for (const [k, arrays] of map) { hits[k] = arrays; transfer.push(...arraysTransfer(arrays)) }
				self.postMessage({ id, hits }, transfer)
				break
			}
			case 'geomStore': { geom.geomCacheStore(e.data.key, e.data.arrays); self.postMessage({ id, ok: true }); break }
			case 'geomManifestRecord': { await geom.geomManifestRecord(e.data.regionKey, e.data.keys); self.postMessage({ id, ok: true }); break }
			case 'geomManifestPrefetch': { const warmed = await geom.geomManifestPrefetch(e.data.regionKey); self.postMessage({ id, warmed }); break }
			case 'geomEvict': { await geom.geomCacheEvict(e.data.key); self.postMessage({ id, ok: true }); break }
			case 'setLoading': { geom.setGeomCacheLoading(e.data.v); self.postMessage({ id, ok: true }); break }
			case 'setMemBudget': { geom.setGeomMemBudget(e.data.bytes); self.postMessage({ id, ok: true }); break }
			case 'setMemPressureCap': { geom.setGeomMemPressureCap(e.data.bytes); self.postMessage({ id, ok: true }); break }
			case 'geomStats': { const s = await geom.getGeomCacheStats(); self.postMessage({ id, stats: s }); break }
			case 'clearGeom': { await geom.clearGeomCache(); self.postMessage({ id, ok: true }); break }
			case 'flushGeom': { await geom.__flushGeomWritesNow(); self.postMessage({ id, ok: true }); break }
			default: self.postMessage({ id, error: 'unknown op ' + op })
		}
	} catch (err) { self.postMessage({ id, error: String(err?.message || err) }) }
}
