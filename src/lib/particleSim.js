// Pure, Three.js-free particle simulation over structure-of-arrays buffers.
// Mirrors SL semantics (llpartdata / llviewerpartsource) for the v1 common-case subset.

export const PSIM = {
	PATTERN_DROP: 0x01, PATTERN_EXPLODE: 0x02, PATTERN_ANGLE: 0x04,
	PATTERN_ANGLE_CONE: 0x08, PATTERN_ANGLE_CONE_EMPTY: 0x10,
	PART_INTERP_COLOR: 0x01, PART_INTERP_SCALE: 0x02,
	PART_FOLLOW_SRC: 0x10, PART_FOLLOW_VELOCITY: 0x20,
	PART_EMISSIVE: 0x100, PART_DATA_GLOW: 0x10000, PART_DATA_BLEND: 0x20000,
	SRC_USE_NEW_ANGLE: 0x02,   // LLPartSysData.mFlags (srcFlags): particle uses 'correct' angle params
}

// Upper bound on simultaneously-live particles for this source, clamped to `cap`.
export function maxLiveParticles(psys, cap) {
	const rate = Math.max(0.01, psys.burstRate)
	const life = Math.max(0.01, psys.partMaxAge)
	const count = Math.max(1, psys.burstPartCount | 0)
	return Math.min(cap, Math.ceil(life / rate) * count + count)
}

export function createEmitterState(psys, capacity) {
	return {
		capacity, count: 0, emitAccum: 0, sourceAge: 0,
		px: new Float32Array(capacity), py: new Float32Array(capacity), pz: new Float32Array(capacity),
		vx: new Float32Array(capacity), vy: new Float32Array(capacity), vz: new Float32Array(capacity),
		age: new Float32Array(capacity), life: new Float32Array(capacity),
	}
}

// Emission UNIT direction in SL axes (Z-up), replicating Firestorm
// llviewerpartsource.cpp LLViewerPartSourceScript::update spawn block. Returns null for
// DROP (particle stays at the source with zero velocity). srcRot (SL quaternion [x,y,z,w])
// is applied to the direction afterwards in spawn().
function emitDirection(psys, rng) {
	switch (psys.pattern) {
		case PSIM.PATTERN_DROP:
			return null
		case PSIM.PATTERN_EXPLODE: {
			// FS: uniform-on-sphere via rejection sampling of the unit cube. Guarded against a
			// degenerate run (e.g. a constant rng) so it can't loop forever.
			for (let g = 0; g < 16; g++) {
				const x = rng() * 2 - 1, y = rng() * 2 - 1, z = rng() * 2 - 1
				const m = x * x + y * y + z * z
				if (m <= 1 && m >= 0.01) { const inv = 1 / Math.sqrt(m); return [x * inv, y * inv, z * inv] }
			}
			return [0, 0, 1]
		}
		case PSIM.PATTERN_ANGLE:
		case PSIM.PATTERN_ANGLE_CONE: {
			let d = [0, 0, 1]
			let angle = psys.innerAngle + (psys.outerAngle - psys.innerAngle) * rng()
			if (rng() < 0.5) angle = -angle
			d = rotAxis(d, [1, 0, 0], angle)                                  // rotate around X
			if (psys.pattern & PSIM.PATTERN_ANGLE_CONE) d = rotAxis(d, [0, 0, 1], rng() * 4 * Math.PI)
			if (!(psys.srcFlags & PSIM.SRC_USE_NEW_ANGLE)) d = rotAxis(d, [1, 0, 0], psys.outerAngle) // legacy
			return d
		}
		// DROP, ANGLE_CONE_EMPTY (0x10) and unknown patterns → stationary. Matches FS: its spawn
		// block only handles DROP/EXPLODE/ANGLE/ANGLE_CONE, and `pattern & (ANGLE|ANGLE_CONE)`
		// excludes 0x10, so FS falls to its zero-velocity default for ANGLE_CONE_EMPTY.
		default:
			return null
	}
}

// Rotate vector v around unit axis a by angle (radians) — Rodrigues' formula.
function rotAxis(v, a, ang) {
	const c = Math.cos(ang), s = Math.sin(ang), k = 1 - c
	const dot = v[0] * a[0] + v[1] * a[1] + v[2] * a[2]
	const cx = a[1] * v[2] - a[2] * v[1], cy = a[2] * v[0] - a[0] * v[2], cz = a[0] * v[1] - a[1] * v[0]
	return [v[0] * c + cx * s + a[0] * dot * k, v[1] * c + cy * s + a[1] * dot * k, v[2] * c + cz * s + a[2] * dot * k]
}

// Rotate vector v by quaternion q=[x,y,z,w].
function rotQuat(v, q) {
	const x = q[0], y = q[1], z = q[2], w = q[3]
	const ix = w * v[0] + y * v[2] - z * v[1]
	const iy = w * v[1] + z * v[0] - x * v[2]
	const iz = w * v[2] + x * v[1] - y * v[0]
	const iw = -x * v[0] - y * v[1] - z * v[2]
	return [
		ix * w + iw * -x + iy * -z - iz * -y,
		iy * w + iw * -y + iz * -x - ix * -z,
		iz * w + iw * -z + ix * -y - iy * -x,
	]
}

// Spawn one particle. All vectors in SL axes (Z-up). srcRot optional ([x,y,z,w] or null).
// FS places the burst-radius offset ALONG the emission direction (not a random sphere).
function spawn(st, psys, srcPos, srcRot, rng) {
	if (st.count >= st.capacity) return
	const i = st.count++
	const dir = emitDirection(psys, rng)
	let vx = 0, vy = 0, vz = 0, ox = 0, oy = 0, oz = 0
	if (dir) {
		// FS applies the source rotation to ANGLE/ANGLE_CONE only; EXPLODE is isotropic in world
		// space (llviewerpartsource.cpp does not rotate the explode direction).
		const isAngle = psys.pattern === PSIM.PATTERN_ANGLE || psys.pattern === PSIM.PATTERN_ANGLE_CONE
		const d = (srcRot && isAngle) ? rotQuat(dir, srcRot) : dir
		const speed = psys.burstSpeedMin + (psys.burstSpeedMax - psys.burstSpeedMin) * rng()
		ox = d[0] * psys.burstRadius; oy = d[1] * psys.burstRadius; oz = d[2] * psys.burstRadius
		vx = d[0] * speed; vy = d[1] * speed; vz = d[2] * speed
	}
	st.px[i] = srcPos[0] + ox; st.py[i] = srcPos[1] + oy; st.pz[i] = srcPos[2] + oz
	st.vx[i] = vx; st.vy[i] = vy; st.vz[i] = vz
	st.age[i] = 0; st.life[i] = Math.max(0.01, psys.partMaxAge)
}

// Advance dt seconds: emit due bursts, integrate, retire (swap-remove). All vectors in SL
// axes (Z-up); the composable converts final positions SL→Three at buffer-write. srcPos =
// source SL position [x,y,z]; srcRot = source SL rotation [x,y,z,w] or null.
export function stepEmitter(st, psys, dt, srcPos, srcRot, rng, spawnEnabled = true) {
	const rate = Math.max(0.01, psys.burstRate)
	if (spawnEnabled) {
		st.emitAccum += dt
		let guard = 0
		while (st.emitAccum >= rate && guard++ < 64) {
			st.emitAccum -= rate
			const n = Math.max(1, psys.burstPartCount | 0)
			for (let k = 0; k < n; k++) spawn(st, psys, srcPos, srcRot, rng)
		}
	}
	const ax = psys.partAccel[0], ay = psys.partAccel[1], az = psys.partAccel[2]
	for (let i = 0; i < st.count; ) {
		st.age[i] += dt
		if (st.age[i] >= st.life[i]) {
			const last = --st.count
			st.px[i] = st.px[last]; st.py[i] = st.py[last]; st.pz[i] = st.pz[last]
			st.vx[i] = st.vx[last]; st.vy[i] = st.vy[last]; st.vz[i] = st.vz[last]
			st.age[i] = st.age[last]; st.life[i] = st.life[last]
			continue
		}
		st.vx[i] += ax * dt; st.vy[i] += ay * dt; st.vz[i] += az * dt
		st.px[i] += st.vx[i] * dt; st.py[i] += st.vy[i] * dt; st.pz[i] += st.vz[i] * dt
		i++
	}
}

// Color (rgb), alpha, scale at normalized age f∈[0,1], honoring interp flags.
export function sampleAppearance(psys, f) {
	const ic = (psys.partFlags & PSIM.PART_INTERP_COLOR) !== 0
	const is = (psys.partFlags & PSIM.PART_INTERP_SCALE) !== 0
	const sc = psys.startColor, ec = psys.endColor
	const color = ic ? [sc[0] + (ec[0] - sc[0]) * f, sc[1] + (ec[1] - sc[1]) * f, sc[2] + (ec[2] - sc[2]) * f] : [sc[0], sc[1], sc[2]]
	const alpha = ic ? sc[3] + (ec[3] - sc[3]) * f : sc[3]
	const s0 = psys.startScale[0], s1 = psys.endScale[0]
	const scale = is ? s0 + (s1 - s0) * f : s0
	return { color, alpha, scale }
}
