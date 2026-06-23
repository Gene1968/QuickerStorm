// server/__tests__/resync.test.ts
// Approach: the resume bug — avatar falls through terrain to z≈1 on a NORMAL reload (not hard reload).
// Root cause: the resume's replayCachedWorld TERRAIN_PATCH burst fires BEFORE the client engine mounts
// its handlers, so the frames are dropped and worldStore.terrainHeights stays zeroed; sampleTerrainHeight
// then returns ~0 and client gravity floors the avatar. The post-mount OBJ_PROBE_RESYNC re-sent only the
// own avatar — not terrain. Fix = a shared replayTerrain() helper re-sent on probe-resync (auto-heal).
import { describe, it, expect } from 'bun:test'
import { replayTerrain } from '../lib/resync'
import { S } from '../../shared/protocol.js'
import type { CircuitState } from '../state/sessions'

function makeSession(patches: Array<{ x: number; y: number; patchSize: number; heights: number[] }>) {
	const sent: Array<{ t: number; d: { patchSize: number; patches: Array<{ x: number; y: number; heights: number[] }> } }> = []
	const ws = { send: (s: string) => sent.push(JSON.parse(s)) }
	const terrainCache = new Map<string, unknown>()
	for (const p of patches) terrainCache.set(`${p.x},${p.y}`, p)
	return { session: { ws, terrainCache } as unknown as CircuitState, sent }
}

describe('replayTerrain', () => {
	it('sends TERRAIN_PATCH frame(s) for cached patches and returns the count', () => {
		const { session, sent } = makeSession([
			{ x: 9, y: 9, patchSize: 16, heights: new Array(256).fill(22) },
			{ x: 9, y: 10, patchSize: 16, heights: new Array(256).fill(23) },
		])
		const n = replayTerrain(session)
		expect(n).toBe(2)
		const frames = sent.filter(m => m.t === S.TERRAIN_PATCH)
		expect(frames.length).toBe(1)                 // both fit in one PATCHES_PER_FRAME chunk
		expect(frames[0].d.patches.length).toBe(2)
		expect(frames[0].d.patches[0].x).toBe(9)
		expect(frames[0].d.patches[0].heights[0]).toBe(22)
	})

	it('sends nothing and returns 0 when no terrain is cached', () => {
		const { session, sent } = makeSession([])
		const n = replayTerrain(session)
		expect(n).toBe(0)
		expect(sent.length).toBe(0)
	})
})
