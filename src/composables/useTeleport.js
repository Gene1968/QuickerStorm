import { useRealtimeSocket } from '@/composables/useRealtimeSocket.js'
import { useAudio }          from '@/composables/useAudio.js'
import { useSessionStore }   from '@/stores/sessionStore.js'
import { useMapStore }       from '@/stores/mapStore.js'
import { C, S }              from '@shared/protocol.js'

/**
 * Canonical list of teleport entry points.
 * Update status here as each source is implemented.
 */
export const TELEPORT_SOURCES = {
	LOCATION_BAR: { label: 'LocationBar',      status: 'implemented' },
	MAP_FLOATER:  { label: 'MapFloater',        status: 'stub'        },  // Phase 2
	MINIMAP:      { label: 'Minimap',           status: 'placeholder' },
	LANDMARK:     { label: 'Landmark',          status: 'placeholder' },
	DOUBLE_CLICK: { label: 'Double-click land', status: 'implemented' },
}

export function useTeleport() {
	const { emit, on, off, connected } = useRealtimeSocket()
	const { playSound }                = useAudio()
	const session                      = useSessionStore()
	const map                          = useMapStore()

	/**
	 * Request a teleport to (x, y, z) in the current region.
	 * Clamps coords, plays whoosh, sends C.TELEPORT via WS.
	 * No-op when disconnected.
	 */
	function requestTeleport({ x, y, z }) {
		if (!connected.value) return

		const safeX = Math.max(1,   Math.min(255, x))
		const safeY = Math.max(1,   Math.min(255, y))
		const safeZ = Math.max(0.5, z)

		playSound('woosh.mp3')
		emit(C.TELEPORT, { x: safeX, y: safeY, z: safeZ })
	}

	/**
	 * Cross-region teleport by name. Sends MapNameRequest, waits up to TIMEOUT_MS for
	 * matching MapBlockReply, then MapTeleport. If current region matches, falls through
	 * to local requestTeleport instead.
	 * @returns {Promise<{ok:boolean, error?:string}>}
	 */
	function requestRegionTeleport({ regionName, x, y, z }) {
		return new Promise((resolve) => {
			if (!connected.value) { resolve({ ok: false, error: 'disconnected' }); return }
			const name = (regionName || '').trim()
			if (!name) { resolve({ ok: false, error: 'no region name' }); return }

			// Same region? Use local TP — cheaper, no name lookup.
			if (session.regionName && session.regionName.toLowerCase() === name.toLowerCase()) {
				requestTeleport({ x, y, z })
				resolve({ ok: true })
				return
			}

			const TIMEOUT_MS = 6000
			let done = false
			const wanted = name.toLowerCase()

			// First check map cache — may already have the block from a prior search.
			for (const b of map.regions.values()) {
				if (b.name.toLowerCase() === wanted) {
					done = true
					playSound('woosh.mp3')
					emit(C.MAP_TELEPORT, { regionX: b.regionX, regionY: b.regionY, x, y, z })
					resolve({ ok: true })
					return
				}
			}

			function handler(d) {
				if (done) return
				const blocks = d?.blocks ?? []
				const hit = blocks.find(b => b.name?.toLowerCase() === wanted)
				if (!hit) return
				done = true
				off(S.MAP_BLOCKS, handler)
				clearTimeout(timer)
				playSound('woosh.mp3')
				emit(C.MAP_TELEPORT, { regionX: hit.regionX, regionY: hit.regionY, x, y, z })
				resolve({ ok: true })
			}
			on(S.MAP_BLOCKS, handler)
			emit(C.MAP_NAME_QUERY, { name })

			const timer = setTimeout(() => {
				if (done) return
				done = true
				off(S.MAP_BLOCKS, handler)
				resolve({ ok: false, error: `region "${name}" not found` })
			}, TIMEOUT_MS)
		})
	}

	return { requestTeleport, requestRegionTeleport }
}
