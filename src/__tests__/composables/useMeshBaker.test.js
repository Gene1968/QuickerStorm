import { describe, it, expect, beforeEach } from 'vitest'
import { useMeshBaker } from '@/composables/useMeshBaker.js'

// jsdom: constructing a module Worker from a file URL throws → exercises the sync fallback.
describe('useMeshBaker (fallback)', () => {
	let baker
	beforeEach(() => { baker = useMeshBaker() })

	it('bakes a prim synchronously when the worker is unavailable', async () => {
		const out = await baker.bake({ kind: 'prim', shape: { pathCurve: 16, profileCurve: 1 }, scale: [1,1,1] })
		expect(out.bad).toBeUndefined()
		expect(out.position).toBeInstanceOf(Float32Array)
		expect(out.position.length).toBeGreaterThan(0)
		baker.dispose()
	})

	it('flags non-finite submesh as bad', async () => {
		const subs = [{ positions:[NaN,0,0,1,0,0,0,1,0], normals:[0,0,1,0,0,1,0,0,1], uvs:[0,0,1,0,0,1], indices:[0,1,2] }]
		const out = await baker.bake({ kind: 'submesh', subs, scale: [1,1,1] })
		expect(out).toEqual({ bad: true })
		baker.dispose()
	})

	it('batches multiple bakes in one flush and resolves each', async () => {
		const results = await Promise.all([
			baker.bake({ kind: 'prim', shape: { pathCurve: 16, profileCurve: 5 }, scale: [1,1,1] }),
			baker.bake({ kind: 'prim', shape: { pathCurve: 32, profileCurve: 5 }, scale: [1,1,1] }),
		])
		expect(results).toHaveLength(2)
		results.forEach(r => expect(r.position).toBeInstanceOf(Float32Array))
		baker.dispose()
	})

	it('settles pending promises when dispose() is called mid-flight', async () => {
		const p = baker.bake({ kind: 'prim', shape: { pathCurve: 16, profileCurve: 1 }, scale: [1,1,1] })
		baker.dispose()
		const out = await p   // must resolve (via sync fallback), not hang
		expect(out.position).toBeInstanceOf(Float32Array)
	})
})
