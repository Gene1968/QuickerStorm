import * as THREE from 'three'

// WHY unlit: matches the existing MeshBasicMaterial-for-terrain decision — a lit
// terrain material reintroduces the ACES/tone-map dark-face artifacts documented in
// the threejs-rendering-decisions memo. The blend mirrors src/lib/terrainTextures.js
// layerWeights() so the JS twins in that file's tests cover the math.

const VERT = /* glsl */`
	varying vec3 vWorld;
	void main() {
		vec4 wp = modelMatrix * vec4(position, 1.0);
		vWorld = wp.xyz;
		gl_Position = projectionMatrix * viewMatrix * wp;
	}
`

const FRAG = /* glsl */`
	precision highp float;
	uniform sampler2D uTex0;
	uniform sampler2D uTex1;
	uniform sampler2D uTex2;
	uniform sampler2D uTex3;
	uniform vec4 uStartHeight;   // [00,01,10,11] = [x][y]
	uniform vec4 uHeightRange;
	uniform vec2 uRegionSize;    // metres (regionSizeX, regionSizeY)
	uniform float uTexScale;     // texture repeats per metre
	uniform float uNoiseScale;
	uniform float uNoiseAmp;
	varying vec3 vWorld;

	float bilerp(vec4 c, float u, float v) {
		float x0 = mix(c.x, c.y, v); // 00→01
		float x1 = mix(c.z, c.w, v); // 10→11
		return mix(x0, x1, u);
	}
	float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
	float vnoise(vec2 p){
		vec2 i = floor(p), f = fract(p);
		vec2 u = f*f*(3.0-2.0*f);
		return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
		           mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
	}
	float fbm(vec2 p){ return 0.5*vnoise(p) + 0.25*vnoise(p*2.0) + 0.125*vnoise(p*4.0); }

	void main() {
		// WHY v = -vWorld.z/ry: Three Z = -slY (slToThree), so south (slY=0) is at Z=0 and
		// north (slY=ry) at Z=-ry. The corner arrays are [x][y] with y=0 south, y=1 north,
		// so v must be 0 at south and 1 at north — i.e. -vWorld.z/ry. Using (z+ry)/ry here
		// silently mirrors the terrain N-S (the iy=ry-slY trap from threejs-rendering-decisions).
		float u = clamp(vWorld.x / uRegionSize.x, 0.0, 1.0);
		float v = clamp(-vWorld.z / uRegionSize.y, 0.0, 1.0);

		float start = bilerp(uStartHeight, u, v);
		float range = bilerp(uHeightRange, u, v);
		range = (abs(range) < 1e-6) ? 1e-6 : range;   // mirror layerWeights() zero-guard

		float noise = (fbm(vWorld.xz * uNoiseScale) - 0.5) * uNoiseAmp;
		float e = clamp((vWorld.y - start) / range + noise, 0.0, 1.0);
		float p = e * 3.0;
		float lo = min(floor(p), 3.0);
		float f = p - lo;

		float w0 = (lo == 0.0 ? 1.0 - f : 0.0);
		float w1 = (lo == 0.0 ? f : 0.0) + (lo == 1.0 ? 1.0 - f : 0.0);
		float w2 = (lo == 1.0 ? f : 0.0) + (lo == 2.0 ? 1.0 - f : 0.0);
		float w3 = (lo == 2.0 ? f : 0.0) + (lo == 3.0 ? 1.0 : 0.0);

		vec2 st = vWorld.xz * uTexScale;
		vec3 col = texture2D(uTex0, st).rgb * w0
		         + texture2D(uTex1, st).rgb * w1
		         + texture2D(uTex2, st).rgb * w2
		         + texture2D(uTex3, st).rgb * w3;
		gl_FragColor = vec4(col, 1.0);
	}
`

// 1×1 placeholder so samplers are never null before textures bind. Shared singleton —
// bound into every terrain material, never disposed (Material.dispose() doesn't free uniform
// textures anyway, and a per-material 1×1 would orphan on each rebuild). 4 bytes, app-lifetime.
let _placeholderTex = null
function placeholderTex() {
	if (_placeholderTex) return _placeholderTex
	_placeholderTex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat)
	_placeholderTex.needsUpdate = true
	return _placeholderTex
}

/**
 * Build the terrain shader material.
 * @param {{startHeight:number[], heightRange:number[], regionSizeX:number, regionSizeY:number}} opts
 */
export function buildTerrainMaterial(opts) {
	const ph = placeholderTex()
	return new THREE.ShaderMaterial({
		uniforms: {
			uTex0: { value: ph }, uTex1: { value: ph }, uTex2: { value: ph }, uTex3: { value: ph },
			uStartHeight: { value: new THREE.Vector4(...opts.startHeight) },
			uHeightRange: { value: new THREE.Vector4(...opts.heightRange) },
			uRegionSize:  { value: new THREE.Vector2(opts.regionSizeX, opts.regionSizeY) },
			uTexScale:    { value: 1 / 8 },
			uNoiseScale:  { value: 0.05 },
			uNoiseAmp:    { value: 0.35 },
		},
		vertexShader: VERT,
		fragmentShader: FRAG,
		side: THREE.FrontSide,
	})
}

/** Bind one detail texture into slot 0..3 (sets RepeatWrapping + sRGB + anisotropy).
 *  Idempotent: only flips needsUpdate when a sampler param actually changes, so rebinding a
 *  shared (memoized/cache-owned) texture across regions doesn't force a redundant GPU re-upload.
 *  WHY anisotropy: terrain rakes to the horizon at grazing angles — the textbook case where
 *  isotropic mip filtering aliases into shimmery "grain". Max-aniso matches Firestorm's look. */
export function setTerrainSlot(material, slot, texture, anisotropy = 1) {
	if (!material || !texture) return
	if (
		texture.wrapS !== THREE.RepeatWrapping ||
		texture.wrapT !== THREE.RepeatWrapping ||
		texture.colorSpace !== THREE.SRGBColorSpace ||
		texture.anisotropy !== anisotropy
	) {
		texture.wrapS = texture.wrapT = THREE.RepeatWrapping
		texture.colorSpace = THREE.SRGBColorSpace
		texture.anisotropy = anisotropy
		texture.needsUpdate = true
	}
	material.uniforms['uTex' + slot].value = texture
	material.uniformsNeedUpdate = true
}
