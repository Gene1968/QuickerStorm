import { vi, describe, it, expect, beforeEach } from 'vitest'

// Must mock BEFORE importing the module under test
const mockEmit      = vi.fn()
const mockPlaySound = vi.fn()
const mockConnected = { value: true }

vi.mock('@/composables/useRealtimeSocket.js', () => ({
	useRealtimeSocket: () => ({ emit: mockEmit, connected: mockConnected }),
}))

vi.mock('@/composables/useAudio.js', () => ({
	useAudio: () => ({ playSound: mockPlaySound }),
}))

// Dynamic import after mocks are set
const { useTeleport, TELEPORT_SOURCES } = await import('@/composables/useTeleport.js')

const C_TELEPORT = 'teleport'   // C.TELEPORT value from shared/protocol.js

beforeEach(() => {
	vi.clearAllMocks()
	mockConnected.value = true
})

describe('useTeleport', () => {
	describe('requestTeleport', () => {
		it('emits C.TELEPORT with clamped coords and plays woosh', () => {
			const { requestTeleport } = useTeleport()
			requestTeleport({ x: 128, y: 64, z: 30 })

			expect(mockEmit).toHaveBeenCalledOnce()
			expect(mockEmit).toHaveBeenCalledWith(C_TELEPORT, { x: 128, y: 64, z: 30 })
			expect(mockPlaySound).toHaveBeenCalledWith('woosh.mp3')
		})

		it('clamps x and y to [1, 255]', () => {
			const { requestTeleport } = useTeleport()
			requestTeleport({ x: 0, y: 300, z: 20 })

			expect(mockEmit).toHaveBeenCalledWith(C_TELEPORT, { x: 1, y: 255, z: 20 })
		})

		it('clamps z to minimum 0.5', () => {
			const { requestTeleport } = useTeleport()
			requestTeleport({ x: 128, y: 128, z: -5 })

			expect(mockEmit).toHaveBeenCalledWith(C_TELEPORT, { x: 128, y: 128, z: 0.5 })
		})

		it('does nothing when not connected', () => {
			mockConnected.value = false
			const { requestTeleport } = useTeleport()
			requestTeleport({ x: 128, y: 128, z: 20 })

			expect(mockEmit).not.toHaveBeenCalled()
			expect(mockPlaySound).not.toHaveBeenCalled()
		})
	})

	describe('TELEPORT_SOURCES', () => {
		it('exports LOCATION_BAR as implemented', () => {
			expect(TELEPORT_SOURCES.LOCATION_BAR.status).toBe('implemented')
		})

		it('exports MAP_FLOATER, MINIMAP, LANDMARK, DOUBLE_CLICK as non-implemented', () => {
			expect(TELEPORT_SOURCES.MAP_FLOATER.status).not.toBe('implemented')
			expect(TELEPORT_SOURCES.MINIMAP.status).not.toBe('implemented')
			expect(TELEPORT_SOURCES.LANDMARK.status).not.toBe('implemented')
			expect(TELEPORT_SOURCES.DOUBLE_CLICK.status).not.toBe('implemented')
		})
	})
})
