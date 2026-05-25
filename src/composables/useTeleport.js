import { useRealtimeSocket } from '@/composables/useRealtimeSocket.js'
import { useAudio }          from '@/composables/useAudio.js'
import { C }                 from '@shared/protocol.js'

/**
 * Canonical list of teleport entry points.
 * Update status here as each source is implemented.
 */
export const TELEPORT_SOURCES = {
	LOCATION_BAR: { label: 'LocationBar',      status: 'implemented' },
	MAP_FLOATER:  { label: 'MapFloater',        status: 'stub'        },  // Phase 2
	MINIMAP:      { label: 'Minimap',           status: 'placeholder' },
	LANDMARK:     { label: 'Landmark',          status: 'placeholder' },
	DOUBLE_CLICK: { label: 'Double-click land', status: 'placeholder' },
}

export function useTeleport() {
	const { emit, connected } = useRealtimeSocket()
	const { playSound }       = useAudio()

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

	return { requestTeleport }
}
