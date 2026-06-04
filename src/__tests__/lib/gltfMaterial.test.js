import { describe, it, expect } from 'bun:test'
import { gltfToDescriptor } from '@/lib/gltfMaterial.js'

const gltf = {
	materials: [{
		pbrMetallicRoughness: {
			baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.5, roughnessFactor: 0.8,
			baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 },
		},
		normalTexture: { index: 2 }, emissiveTexture: { index: 3 },
		emissiveFactor: [1, 0, 0], alphaMode: 'BLEND', doubleSided: true,
	}],
	images: [
		{ uri: 'aaaaaaaa-0000-0000-0000-000000000001' },
		{ uri: 'bbbbbbbb-0000-0000-0000-000000000002' },
		{ uri: 'cccccccc-0000-0000-0000-000000000003' },
		{ uri: 'dddddddd-0000-0000-0000-000000000004' },
	],
	textures: [{ source: 0 }, { source: 1 }, { source: 2 }, { source: 3 }],
}

describe('gltfToDescriptor', () => {
	it('maps texture indices → image UUIDs + factors', () => {
		const d = gltfToDescriptor(gltf)
		expect(d.baseColorTex).toBe('aaaaaaaa-0000-0000-0000-000000000001')
		expect(d.metallicRoughnessTex).toBe('bbbbbbbb-0000-0000-0000-000000000002')
		expect(d.normalTex).toBe('cccccccc-0000-0000-0000-000000000003')
		expect(d.emissiveTex).toBe('dddddddd-0000-0000-0000-000000000004')
		expect(d.metallic).toBe(0.5)
		expect(d.roughness).toBe(0.8)
		expect(d.alphaMode).toBe('BLEND')
		expect(d.doubleSided).toBe(true)
		expect(d.emissiveFactor).toEqual([1, 0, 0])
	})

	it('falls back to defaults for an empty/garbage material', () => {
		const d = gltfToDescriptor({})
		expect(d.baseColorTex).toBe(null)
		expect(d.metallic).toBe(1)
		expect(d.roughness).toBe(1)
		expect(d.alphaMode).toBe('OPAQUE')
	})
})
