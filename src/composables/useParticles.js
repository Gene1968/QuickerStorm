import * as THREE from 'three'
import { PSIM, maxLiveParticles, createEmitterState, stepEmitter, sampleAppearance } from '../lib/particleSim.js'
import { getTexture } from './useTextureFetch.js'
import { memUnderPressure } from '../lib/memGovernor.js'

const GLOBAL_PARTICLE_CAP = 20000
const PER_EMITTER_CAP = 512
const CULL_DIST = 96           // metres; emitters beyond this freeze (no spawn/integrate)
const CULL_DIST_SQ = CULL_DIST * CULL_DIST

let _fallbackTex = null
function fallbackTexture() {
	if (_fallbackTex) return _fallbackTex
	const s = 64, c = document.createElement('canvas'); c.width = c.height = s
	const g = c.getContext('2d')
	const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
	grad.addColorStop(0, 'rgba(255,255,255,1)')
	grad.addColorStop(0.5, 'rgba(255,255,255,0.6)')
	grad.addColorStop(1, 'rgba(255,255,255,0)')
	g.fillStyle = grad; g.fillRect(0, 0, s, s)
	_fallbackTex = new THREE.CanvasTexture(c)
	_fallbackTex.colorSpace = THREE.SRGBColorSpace
	return _fallbackTex
}

const VERT = `
	attribute vec3 pcolor; attribute float palpha; attribute float psize;
	varying vec3 vColor; varying float vAlpha;
	void main() {
		vColor = pcolor; vAlpha = palpha;
		vec4 mv = modelViewMatrix * vec4(position, 1.0);
		gl_PointSize = psize * (300.0 / -mv.z);
		gl_Position = projectionMatrix * mv;
	}`
const FRAG = `
	uniform sampler2D map; varying vec3 vColor; varying float vAlpha;
	void main() {
		vec4 t = texture2D(map, gl_PointCoord);
		float a = t.a * vAlpha;
		if (a < 0.01) discard;
		gl_FragColor = vec4(vColor * t.rgb, a);
	}`

function makeMaterial(psys) {
	const additive = (psys.partFlags & PSIM.PART_EMISSIVE) !== 0 || psys.startGlow > 0 || psys.endGlow > 0
	return new THREE.ShaderMaterial({
		uniforms: { map: { value: fallbackTexture() } },
		vertexShader: VERT, fragmentShader: FRAG,
		transparent: true, depthWrite: false,
		blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
	})
}

export function useParticles(scene) {
	const emitters = new Map()   // localId → { psys, state, points, geo, mat, getSrc, colA, alpA, sizA }
	let liveTotal = 0
	let _inRange = 0, _nearestSq = Infinity   // diagnostics: emitters within cull radius + nearest dist²

	function register(localId, psys, getSrc) {
		unregister(localId)
		if (!psys || !getSrc) return
		const cap = maxLiveParticles(psys, PER_EMITTER_CAP)
		const state = createEmitterState(psys, cap)
		const geo = new THREE.BufferGeometry()
		const posA = new Float32Array(cap * 3)
		const colA = new Float32Array(cap * 3)
		const alpA = new Float32Array(cap)
		const sizA = new Float32Array(cap)
		geo.setAttribute('position', new THREE.BufferAttribute(posA, 3))
		geo.setAttribute('pcolor', new THREE.BufferAttribute(colA, 3))
		geo.setAttribute('palpha', new THREE.BufferAttribute(alpA, 1))
		geo.setAttribute('psize', new THREE.BufferAttribute(sizA, 1))
		geo.setDrawRange(0, 0)
		const mat = makeMaterial(psys)
		const points = new THREE.Points(geo, mat)
		points.frustumCulled = false
		scene.add(points)
		emitters.set(localId, { psys, state, points, geo, mat, getSrc, colA, alpA, sizA })
		if (psys.texture) {
			getTexture(psys.texture).then(t => { if (t && emitters.get(localId)?.mat === mat) { mat.uniforms.map.value = t; mat.needsUpdate = true } }).catch(() => {})
		}
	}

	function unregister(localId) {
		const e = emitters.get(localId); if (!e) return
		scene.remove(e.points); e.geo.dispose(); e.mat.dispose()
		liveTotal -= e.state.count
		emitters.delete(localId)
	}

	function step(dt, camPos) {
		if (dt <= 0) return
		const paused = memUnderPressure?.() === true
		liveTotal = 0
		_inRange = 0; _nearestSq = Infinity
		for (const e of emitters.values()) {
			const src = e.getSrc()
			if (!src || !src.pos) { e.geo.setDrawRange(0, 0); continue }
			// cull on the source position converted SL→Three: (x,y,z)→(x,z,-y)
			const tx = src.pos[0], ty = src.pos[2], tz = -src.pos[1]
			const dx = tx - camPos.x, dy = ty - camPos.y, dz = tz - camPos.z
			const d2 = dx * dx + dy * dy + dz * dz
			if (d2 < _nearestSq) _nearestSq = d2
			const far = d2 > CULL_DIST_SQ
			if (!far) _inRange++
			// Spawn only when in range, not pressured, and under the global budget. When far we still
			// step (spawnEnabled=false) so existing particles AGE OUT and drain instead of freezing.
			const spawnOK = !far && !paused && liveTotal < GLOBAL_PARTICLE_CAP
			if (spawnOK || e.state.count > 0) {
				stepEmitter(e.state, e.psys, Math.min(dt, 0.1), src.pos, src.rot || null, Math.random, spawnOK)
			}
			const st = e.state, n = st.count
			const posA = e.geo.attributes.position.array
			for (let i = 0; i < n; i++) {
				const f = st.age[i] / st.life[i]
				const a = sampleAppearance(e.psys, f)
				// SL→Three: (px,py,pz)_SL → (px, pz, -py)_Three
				posA[i * 3] = st.px[i]; posA[i * 3 + 1] = st.pz[i]; posA[i * 3 + 2] = -st.py[i]
				e.colA[i * 3] = a.color[0]; e.colA[i * 3 + 1] = a.color[1]; e.colA[i * 3 + 2] = a.color[2]
				e.alpA[i] = a.alpha; e.sizA[i] = Math.max(0.02, a.scale)
			}
			e.geo.setDrawRange(0, n)
			e.geo.attributes.position.needsUpdate = true
			e.geo.attributes.pcolor.needsUpdate = true
			e.geo.attributes.palpha.needsUpdate = true
			e.geo.attributes.psize.needsUpdate = true
			liveTotal += n
		}
	}

	function stats() { return { emitters: emitters.size, live: liveTotal, inRange: _inRange, nearest: _nearestSq === Infinity ? -1 : Math.round(Math.sqrt(_nearestSq)) } }
	function dispose() { for (const id of [...emitters.keys()]) unregister(id) }

	return { register, unregister, step, stats, dispose }
}
