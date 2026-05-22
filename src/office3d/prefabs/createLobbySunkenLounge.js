import * as THREE from "three"

/**
 * Seat pads lie on an ellipse in room XZ: (ringRx·cos θ, ringRz·sin θ) (see
 * `lobbyPitSeatRing`).  TorusGeometry is built in the XY plane; for a flat
 * ring in XZ we use **scale (ringRx, ringRz, yThin)** *before*
 * `rotation.x = -π/2` so local +X / +Y become world +X / +Z and `yThin` maps
 * to world ±Y (cushion height), not the wrong axes.
 * Cushion mesh uses ~3% larger scale than the pad math so the band reads
 * slightly outside the click targets.
 */
export const LOBBY_SUNKEN_SEAT_RING = {
	rx: 4.2,
	rz: 5.85,
}

/** Warm, patterned area rug — read clearly against marble, not a floor clone. */
function createPitRugMap () {
	const w = 512
	const c = document.createElement("canvas")
	c.width = w
	c.height = w
	const ctx = c.getContext("2d")
	// Muted indigo + rust patchwork base
	const bg = ctx.createLinearGradient(0, 0, w, w)
	bg.addColorStop(0, "#2d3550")
	bg.addColorStop(0.45, "#4a3248")
	bg.addColorStop(1, "#1e2d4a")
	ctx.fillStyle = bg
	ctx.fillRect(0, 0, w, w)
	// Soft diamond / lattice (reads at low zoom)
	const step = 32
	const alpha = 0.14
	ctx.lineWidth = 1.2
	for (let i = -2; i < 20; i++) {
		for (const sign of [1, -1]) {
			const off = i * step * 1.1 * sign
			ctx.strokeStyle = `rgba(220, 200, 180, ${alpha})`
			ctx.beginPath()
			for (let x = 0; x <= w; x += 8) {
				const y = 0.55 * x + off
				if (x === 0) ctx.moveTo(x, y)
				else ctx.lineTo(x, y)
			}
			ctx.stroke()
		}
	}
	for (let k = 0; k < 4; k++) {
		for (const row of [0, 0.3, 0.5, 0.7, 0.9]) {
			const cx = w * (0.15 + k * 0.2)
			const cy = w * row
			const rx = 18 + (k * 3) % 7
			const ry = 12
			const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx * 1.2)
			gr.addColorStop(0, `rgba(100, 140, 150, 0.09)`)
			gr.addColorStop(0.5, "transparent")
			ctx.fillStyle = gr
			ctx.beginPath()
			ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
			ctx.fill()
		}
	}
	const tex = new THREE.CanvasTexture(c)
	tex.colorSpace = THREE.SRGBColorSpace
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping
	tex.repeat.set(2.2, 2.8)
	tex.needsUpdate = true
	return tex
}

/**
 * West-lobby sunken pit: oval rug, cushion **torus**, **vertical** back tube,
 * N–S table + fire. The back is a `Tube` on a horizontal **outer** ellipse
 * (upright wall cross-section), not a second coplanar torus that meets waists.
 *
 * @param {{ sofa: THREE.Material; accent: THREE.Material; rug: THREE.Material }} _mats
 *   `rug` is unused; pit uses its own map so the rug doesn’t read as marble.
 * @param {{ ringRx?: number; ringRz?: number }} [opts]
 * @returns {THREE.Group}
 */
export function createLobbySunkenLounge (_mats, opts = {}) {
	const g = new THREE.Group()
	const sofa = _mats.sofa
	const accent = _mats.accent

	const ringRx = opts.ringRx ?? LOBBY_SUNKEN_SEAT_RING.rx
	const ringRz = opts.ringRz ?? LOBBY_SUNKEN_SEAT_RING.rz
	const meshRx = ringRx * 1.03
	const meshRz = ringRz * 1.03

	const pitRugTex = createPitRugMap()
	const rugMat = new THREE.MeshStandardMaterial({
		map: pitRugTex,
		color: 0xffffff,
		roughness: 0.91,
		metalness: 0.02,
		// Lighter emissive tint so the rug “reads” in shadow / vs floor
		emissive: new THREE.Color(0x0a0a12),
		emissiveIntensity: 0.32,
	})
	rugMat.side = THREE.DoubleSide
	rugMat.polygonOffset = true
	rugMat.polygonOffsetFactor = -0.5
	rugMat.polygonOffsetUnits = -0.5
	rugMat.needsUpdate = true

	// ── Single continuous cushion ring (elliptical torus) ───────────
	const tubeC = 0.10
	const cushionYFlat = 0.22
	const cushion = new THREE.Mesh(
		new THREE.TorusGeometry(0.95, tubeC, 12, 96),
		sofa,
	)
	cushion.scale.set(meshRx, meshRz, cushionYFlat)
	cushion.rotation.x = -Math.PI / 2
	cushion.position.y = 0.08
	cushion.castShadow = true
	cushion.receiveShadow = true
	cushion.name = "lobby-pit-cushion-torus"
	g.add(cushion)

	// Filled **oval** in the torus hole (not under the tube)
	const voidMargin = 0.92
	const innerAx = (1 - tubeC) * meshRx * voidMargin
	const innerBz = (1 - tubeC) * meshRz * voidMargin
	const pit = new THREE.Mesh(
		new THREE.CircleGeometry(1, 64),
		rugMat,
	)
	pit.scale.set(innerAx, innerBz, 1)
	pit.rotation.x = -Math.PI / 2
	pit.position.y = 0.012
	pit.name = "lobby-pit-rug-oval"
	pit.renderOrder = 1
	pit.receiveShadow = true
	g.add(pit)

	// ── Vertical back ring: `Tube` on **horizontal** outer ellipse. Cross-sections
	//     stay mostly **upright** (Frenet frame), so a rail behind sitters, not a flat disc.
	const backMat = sofa.clone()
	backMat.map = null
	backMat.color = new THREE.Color(0x242b3a)
	backMat.color.multiplyScalar(0.7)
	backMat.roughness = Math.min(0.95, (backMat.roughness ?? 0.6) + 0.1)
	backMat.needsUpdate = true
	// Slightly **outside** seat row so the tube’s inward half clears seated avatars
	const aBack = meshRx + 0.26
	const bBack = meshRz + 0.26
	const railY = 0.125
	const ec = new THREE.EllipseCurve(0, 0, aBack, bBack, 0, Math.PI * 2, false, 0)
	const ecPts = ec.getPoints(100)
	const path3 = new THREE.CatmullRomCurve3(
		ecPts.map(p => new THREE.Vector3(p.x, railY, p.y)),
		true,
		"catmullrom",
		0.12,
	)
	// Rail cross-section; mesh scaled 2.5× on Y so the back reads taller
	const tubeR = 0.1
	const backYScale = 2.25
	const backGeo = new THREE.TubeGeometry(path3, 120, tubeR, 10, true)
	const back = new THREE.Mesh(backGeo, backMat)
	back.name = "lobby-pit-back-tube"
	back.scale.set(1, backYScale, 1)
	back.castShadow = true
	back.receiveShadow = true
	g.add(back)

	// ── Center table + fire (long axis N–S / +Z) ─────────────────────
	const tableTopGeo = new THREE.BoxGeometry(1.95, 0.11, 3.35)
	const tableTop = new THREE.Mesh(
		tableTopGeo,
		accent,
	)
	tableTop.position.set(0, 0.07, 0)
	tableTop.castShadow = true
	tableTop.receiveShadow = true
	g.add(tableTop)

	const tableLeg = new THREE.Mesh(
		new THREE.BoxGeometry(1.35, 0.2, 2.35),
		accent,
	)
	tableLeg.position.set(0, 0.19, 0)
	tableLeg.material = tableLeg.material.clone()
	tableLeg.material.color?.multiplyScalar(0.72)
	g.add(tableLeg)

	const glassMat = new THREE.MeshPhysicalMaterial({
		color: 0xc8e8f0,
		metalness: 0.02,
		roughness: 0.06,
		transmission: 0.55,
		thickness: 0.35,
		transparent: true,
		opacity: 0.88,
	})
	const bowl = new THREE.Mesh(
		new THREE.CylinderGeometry(0.68, 0.58, 0.2, 32, 1, true),
		glassMat,
	)
	bowl.position.set(0, 0.36, 0)
	bowl.castShadow = true
	g.add(bowl)

	const ember = new THREE.Mesh(
		new THREE.CylinderGeometry(0.44, 0.38, 0.07, 24),
		new THREE.MeshStandardMaterial({
			color: 0xff6a1a,
			emissive: new THREE.Color(0xff4400),
			emissiveIntensity: 1.1,
			roughness: 0.45,
		}),
	)
	ember.position.set(0, 0.32, 0)
	g.add(ember)

	const flameCore = new THREE.Mesh(
		new THREE.SphereGeometry(0.2, 16, 12),
		new THREE.MeshBasicMaterial({
			color: 0xffcc66,
			transparent: true,
			opacity: 0.55,
		}),
	)
	flameCore.position.set(0, 0.45, 0)
	g.add(flameCore)

	return g
}
