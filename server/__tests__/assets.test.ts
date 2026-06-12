import { describe, it, expect } from 'bun:test'
import { assetRequestSpec } from '../handlers/assets'

// WHY: the query-key/cap-name mapping is exactly the class of detail that has cost us hours when
// guessed wrong (wrong param name → silent 404). Pin it down with a unit test.
describe('assetRequestSpec', () => {
	it('texture → texture_id, prefers ViewerAsset then GetTexture, transcodes to WebP', () => {
		const s = assetRequestSpec('texture')!
		expect(s.queryKey).toBe('texture_id')
		expect(s.capNames).toEqual(['ViewerAsset', 'GetTexture'])
		expect(s.accept).toBe('image/x-j2c')
		expect(s.transcode).toBe(true)
		expect(s.mime).toBe('image/webp')
	})

	it('mesh → mesh_id, ViewerAsset/GetMesh2/GetMesh, no transcode', () => {
		const s = assetRequestSpec('mesh')!
		expect(s.queryKey).toBe('mesh_id')
		expect(s.capNames).toEqual(['ViewerAsset', 'GetMesh2', 'GetMesh'])
		expect(s.transcode).toBe(false)
	})

	it('sound → sound_id via ViewerAsset, no transcode', () => {
		const s = assetRequestSpec('sound')!
		expect(s.queryKey).toBe('sound_id')
		expect(s.capNames).toEqual(['ViewerAsset'])
		expect(s.transcode).toBe(false)
	})

	it('unknown asset type → null', () => {
		expect(assetRequestSpec('nonsense')).toBe(null)
	})
})
