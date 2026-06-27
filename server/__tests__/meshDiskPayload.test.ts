import { describe, it, expect } from 'bun:test'
import { serializeMeshPayload, deserializeMeshPayload } from '../handlers/mesh'

// The decoded-mesh disk tier stores a JSON MeshPayload through the AssetPayload {dataB64, mime} blob
// interface. These helpers are the only lossy-looking step (base64-wrap a JSON whose fields are already
// base64), so the round-trip is the thing worth pinning.
describe('mesh disk payload — serialize/deserialize round-trip', () => {
	const mk = () => ({
		submeshes: [
			{ positions: Buffer.from([1, 2, 3]).toString('base64'), normals: Buffer.from([4, 5]).toString('base64'), uvs: Buffer.from([6]).toString('base64'), indices: Buffer.from([7, 8, 9, 10]).toString('base64') },
			{ positions: Buffer.from([11]).toString('base64'), normals: '', uvs: '', indices: Buffer.from([12, 13]).toString('base64') },
		],
	})

	it('round-trips a multi-submesh payload exactly', () => {
		const p = mk()
		expect(deserializeMeshPayload(serializeMeshPayload(p))).toEqual(p)
	})

	it('tags the blob with the mesh-lod mime', () => {
		expect(serializeMeshPayload(mk()).mime).toBe('application/x-qs-mesh-lod')
	})

	it('round-trips an empty-submesh payload', () => {
		const p = { submeshes: [] }
		expect(deserializeMeshPayload(serializeMeshPayload(p))).toEqual(p)
	})
})
