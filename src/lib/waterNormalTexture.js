// Procedurally bakes a seamless (tiling) FBM normal map for ocean ripples — no asset file.
// FS uses scrolling normal-map textures (not sine waves, which read as regular "corduroy");
// this gives FS-faithful normals we can sample in 3 scrolling layers. See
// docs water work / waterMaterial.js. The pure data generator is unit-tested; the THREE
// DataTexture wrapper is a thin adapter.

// Deterministic hash → 0..1 on a wrapped lattice (modulo `period` ⇒ the noise tiles seamlessly).
function hash2(ix, iy, period) {
	const x = ((ix % period) + period) % period
	const y = ((iy % period) + period) % period
	let n = x * 374761393 + y * 668265263
	n = (n ^ (n >> 13)) * 1274126177
	return ((n ^ (n >> 16)) >>> 0) / 4294967295
}
const smooth = (t) => t * t * (3 - 2 * t)

// Bilinear value noise that wraps every `period` cells.
function valNoiseTiling(u, v, period) {
	const x0 = Math.floor(u)
	const y0 = Math.floor(v)
	const fx = u - x0
	const fy = v - y0
	const a = hash2(x0, y0, period)
	const b = hash2(x0 + 1, y0, period)
	const c = hash2(x0, y0 + 1, period)
	const d = hash2(x0 + 1, y0 + 1, period)
	const sx = smooth(fx)
	const sy = smooth(fy)
	return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy
}

/**
 * Build a tiling normal map as packed RGBA bytes (normal.xyz → [0,255], z = up).
 * @param {number} size texture edge in texels (power of two recommended)
 * @param {number} strength bump steepness baked into the normals
 * @returns {Uint8Array} length size*size*4
 */
export function generateWaterNormalData(size = 256, strength = 2.0) {
	const periods = [4, 8, 16, 32]
	const amps = [0.5, 0.25, 0.15, 0.1]
	const h = new Float32Array(size * size)
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const u = x / size
			const v = y / size
			let s = 0
			for (let o = 0; o < periods.length; o++) {
				s += valNoiseTiling(u * periods[o], v * periods[o], periods[o]) * amps[o]
			}
			h[y * size + x] = s
		}
	}
	const data = new Uint8Array(size * size * 4)
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const xl = (x - 1 + size) % size
			const xr = (x + 1) % size
			const yt = (y - 1 + size) % size
			const yb = (y + 1) % size
			const dx = (h[y * size + xr] - h[y * size + xl]) * strength
			const dy = (h[yb * size + x] - h[yt * size + x]) * strength
			let nx = -dx
			let ny = -dy
			let nz = 1
			const len = Math.hypot(nx, ny, nz) || 1
			nx /= len
			ny /= len
			nz /= len
			const i = (y * size + x) * 4
			data[i] = Math.round((nx * 0.5 + 0.5) * 255)
			data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255)
			data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255)
			// Alpha = the wave HEIGHT (0..1) so the shader can tint crests vs troughs in lockstep
			// with the normals — this is what makes ripple motion visible (FS-style color bands).
			data[i + 3] = Math.round(Math.min(1, Math.max(0, h[y * size + x])) * 255)
		}
	}
	return data
}

/** Wrap the generated data in a repeating, mip-mapped THREE.DataTexture. */
export function createWaterNormalTexture(THREE, size = 256) {
	const data = generateWaterNormalData(size)
	const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
	tex.wrapS = THREE.RepeatWrapping
	tex.wrapT = THREE.RepeatWrapping
	tex.generateMipmaps = true
	tex.minFilter = THREE.LinearMipmapLinearFilter
	tex.magFilter = THREE.LinearFilter
	tex.needsUpdate = true
	return tex
}
