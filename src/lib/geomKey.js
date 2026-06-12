// src/lib/geomKey.js — pure cache-key derivation for the baked-geometry cache (qs-geom).
// Key prefixes: p1=prim shape bake, m1=mesh-asset bake, s1=sculpt bake. GEOM_VERSION rides
// in every key so a bake-code change invalidates without migration.
import { fnv1aHex64 } from '@/lib/fnv1a.js'
import { GEOM_VERSION } from '@/lib/primGeometry.js'

// WHY all 18 PrimShape fields (not just the 6 buildPrimGeometry consumes today): when
// hollow/cut/shear deforms land (Phase-3 backlog), shapes differing only in those fields
// must not collide with stale entries baked before the feature existed. Field order is
// FROZEN — reordering changes every key (equivalent to a version bump, but accidental).
export const SHAPE_KEY_FIELDS = [
	'pathCurve', 'profileCurve', 'pathBegin', 'pathEnd', 'profileBegin', 'profileEnd',
	'pathScaleX', 'pathScaleY', 'pathShearX', 'pathShearY', 'pathTwist', 'pathTwistBegin',
	'pathRadiusOffset', 'pathTaperX', 'pathTaperY', 'pathRevolutions', 'pathSkew', 'profileHollow',
]

// WHY DataView (not a Float32Array view): Float32Array byte order is platform-endian; DataView
// setFloat32 is big-endian by spec, matching the setInt32 shape fields — keys are identical on
// any architecture. Rounds to single precision identically to Float32Array (canonicalization kept).
function scaleBytes(scale) {
	const buf = new ArrayBuffer(12)
	const dv = new DataView(buf)
	dv.setFloat32(0, scale?.[0] ?? 1)
	dv.setFloat32(4, scale?.[1] ?? 1)
	dv.setFloat32(8, scale?.[2] ?? 1)
	return new Uint8Array(buf)
}

// Exported for composite key builders (meshGeomKey/sculptGeomKey embed it; future asset-kind keys may too).
export function scaleHash(scale) {
	return fnv1aHex64(scaleBytes(scale))
}

export function primGeomKey(shape, scale) {
	// 18 × Int32 fields + 3 × Float32 scale = 84 bytes, hashed as one buffer.
	const buf = new ArrayBuffer(SHAPE_KEY_FIELDS.length * 4 + 12)
	const dv = new DataView(buf)
	for (let i = 0; i < SHAPE_KEY_FIELDS.length; i++) {
		dv.setInt32(i * 4, shape?.[SHAPE_KEY_FIELDS[i]] ?? 0)
	}
	new Uint8Array(buf).set(scaleBytes(scale), SHAPE_KEY_FIELDS.length * 4)
	return `p1:${GEOM_VERSION}:${fnv1aHex64(new Uint8Array(buf))}`
}

export function meshGeomKey(meshId, scale) {
	return `m1:${GEOM_VERSION}:${meshId}:${scaleHash(scale)}`
}

// sculptType is part of the key because getSculpt(sculptId, sculptType) decodes differently
// per type. (Mirror/invert are not passed to the decoder today, so they are not keyed; if
// the decoder grows those params, add them here AND bump GEOM_VERSION.)
export function sculptGeomKey(sculptId, sculptType, scale) {
	return `s1:${GEOM_VERSION}:${sculptId}:${sculptType}:${scaleHash(scale)}`
}
