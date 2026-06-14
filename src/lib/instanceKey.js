// src/lib/instanceKey.js
// Stable pooling key for a Material. Two objects with the same geometry part AND the
// same materialKey can share one InstancedMesh. Color is DELIBERATELY excluded — it
// rides InstancedMesh.instanceColor so tinted copies still pool together.
// See spec draw-call-instancing.
export function materialKey(p) {
	return [
		p.texId || 'none',
		p.uvKey || '',
		p.blend ? 'B' : '',
		p.alpha ? 'A' : '',
		p.fullbright ? 'F' : '',
		p.lit ? 'L' : '',
		p.pbr ? 'P' : '',
	].join('|')
}

// Encode a TE UV transform into a key fragment (identity → '').
export function uvKey(xform) {
	if (!xform) return ''
	const r = xform.rep || [1, 1], o = xform.ofs || [0, 0], rot = xform.rot || 0
	return `${r[0]},${r[1]},${o[0]},${o[1]},${rot}`
}
