// src/lib/gltfMaterial.js — map an SL/OpenSim GLTF 2.0 material JSON to a flat descriptor of
// texture UUIDs + PBR factors for Three.js MeshStandardMaterial. A texture "index" resolves through
// textures[index].source → images[source].uri, which (in SL assets) is the asset UUID string.
// TextureInfo slots: 0 baseColor, 1 normal, 2 metallicRoughness (ORM-packed; == occlusion), 3 emissive.
export function gltfToDescriptor(gltf) {
	const m = gltf?.materials?.[0] ?? {}
	const pbr = m.pbrMetallicRoughness ?? {}
	const texUuid = (info) => {
		if (!info || info.index == null) return null
		const src = gltf?.textures?.[info.index]?.source
		return gltf?.images?.[src]?.uri ?? null
	}
	return {
		baseColorTex:         texUuid(pbr.baseColorTexture),
		metallicRoughnessTex: texUuid(pbr.metallicRoughnessTexture),
		normalTex:            texUuid(m.normalTexture),
		emissiveTex:          texUuid(m.emissiveTexture),
		baseColorFactor:      pbr.baseColorFactor ?? [1, 1, 1, 1],
		metallic:             pbr.metallicFactor  ?? 1,
		roughness:            pbr.roughnessFactor ?? 1,
		emissiveFactor:       m.emissiveFactor ?? [0, 0, 0],
		alphaMode:            m.alphaMode ?? 'OPAQUE',
		alphaCutoff:          m.alphaCutoff ?? 0.5,
		doubleSided:          !!m.doubleSided,
	}
}
