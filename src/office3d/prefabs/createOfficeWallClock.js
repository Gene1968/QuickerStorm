/**
 * Round analog wall clock — procedural Three.js prefab.
 * Intended for room furniture lists; parent group supplies world position + Y rotation (wall facing).
 *
 * Performance: one `Date` per instance per frame is negligible; dozens of clocks would still be fine.
 * For many instances you could switch to a single shared ticker passing `now` into `update(now)`.
 */
import * as THREE from "three"

/**
 * @param {object} [options]
 * @param {number} [options.mountY=1.62] — center height on the wall (m), relative to furniture group floor
 * @param {number} [options.radius=0.42] — face radius (m)
 * @param {number} [options.frameColor=0xc0c8d0] — bezel / rim tint
 * @param {number} [options.faceColor=0xf4f6f7] — dial
 * @param {number} [options.handDark=0x1c2430] — hour + minute hands
 * @param {number} [options.secondColor=0xc83228] — second hand
 */
export function createOfficeWallClock (options = {}) {
	const mountY = options.mountY ?? 1.62
	const R = options.radius ?? 0.42
	const frameColor = options.frameColor ?? 0xc0c8d0
	const faceColor = options.faceColor ?? 0xf4f6f7
	const handDark = options.handDark ?? 0x1c2430
	const secondColor = options.secondColor ?? 0xc83228

	const root = new THREE.Group()
	root.name = "wall-clock"
	root.position.y = mountY

	const frameMat = new THREE.MeshStandardMaterial({
		color: frameColor,
		roughness: 0.08,
		metalness: 0.92,
	})
	const faceMat = new THREE.MeshStandardMaterial({
		color: faceColor,
		roughness: 0.88,
		metalness: 0.02,
	})
	const handMat = new THREE.MeshStandardMaterial({
		color: handDark,
		roughness: 0.15,
		metalness: 0.82,
	})
	const secondMat = new THREE.MeshStandardMaterial({
		color: secondColor,
		roughness: 0.45,
		metalness: 0.2,
	})
	const hubMat = new THREE.MeshStandardMaterial({
		color: 0xa8b4bc,
		roughness: 0.12,
		metalness: 0.88,
	})

	// Slight recess: back disc
	const back = new THREE.Mesh(
		new THREE.CircleGeometry(R * 1.06, 48),
		frameMat,
	)
	back.position.z = -0.024
	root.add(back)

	// Front face (normal +Z — toward room interior when wall group is oriented correctly)
	const face = new THREE.Mesh(new THREE.CircleGeometry(R * 0.94, 48), faceMat)
	face.position.z = 0.006
	root.add(face)

	// Flat outer ring — RingGeometry is front-facing only, invisible from behind
	const rim = new THREE.Mesh(
		new THREE.RingGeometry(R * 0.93, R * 1.06, 48),
		frameMat,
	)
	rim.position.z = 0.007
	root.add(rim)

	// Hour ticks — flat planes, invisible from behind
	const tickMajorMat = new THREE.MeshStandardMaterial({
		color: handDark,
		roughness: 0.15,
		metalness: 0.82,
	})
	const tickInner = R * 0.78
	const tickOuter = R * 0.92
	for (let i = 0; i < 12; i++) {
		const a = (i / 12) * Math.PI * 2
		const x1 = Math.sin(a) * tickInner
		const y1 = Math.cos(a) * tickInner
		const x2 = Math.sin(a) * tickOuter
		const y2 = Math.cos(a) * tickOuter
		const len = Math.hypot(x2 - x1, y2 - y1)
		const tick = new THREE.Mesh(
			new THREE.PlaneGeometry(0.028, len),
			tickMajorMat,
		)
		tick.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0.018)
		tick.rotation.z = -a
		root.add(tick)
	}

	// Flat plane hands — invisible from behind
	function makeHand ({ width, length, material }) {
		const g = new THREE.Group()
		const geo = new THREE.PlaneGeometry(width, length)
		geo.translate(0, length / 2, 0)
		const mesh = new THREE.Mesh(geo, material)
		g.add(mesh)
		return g
	}

	const hourHand = makeHand({
		width: R * 0.11,
		length: R * 0.52,
		material: handMat,
	})
	hourHand.position.z = 0.028
	root.add(hourHand)

	const minuteHand = makeHand({
		width: R * 0.075,
		length: R * 0.78,
		material: handMat,
	})
	minuteHand.position.z = 0.032
	root.add(minuteHand)

	const secondHand = makeHand({
		width: R * 0.028,
		length: R * 0.88,
		material: secondMat,
	})
	secondHand.position.z = 0.038
	root.add(secondHand)

	const hub = new THREE.Mesh(new THREE.CircleGeometry(0.04, 20), hubMat)
	hub.position.z = 0.042
	root.add(hub)

	function update (now = new Date()) {
		const ms = now.getMilliseconds()
		const s = now.getSeconds() + ms / 1000
		const m = now.getMinutes() + s / 60
		const h = (now.getHours() % 12) + m / 60

		// Clockwise from 12 → negative Z rotation (RH, +Z toward viewer)
		const tau = Math.PI * 2
		secondHand.rotation.z = -(s / 60) * tau
		minuteHand.rotation.z = -(m / 60) * tau
		hourHand.rotation.z = -(h / 12) * tau
	}

	update()

	return { root, update }
}
