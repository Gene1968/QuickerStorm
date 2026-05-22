import * as THREE from 'three'

/**
 * Original Mondrian-style painting — canvas texture on a framed plane.
 * Front face is +Z; caller should rotate group by Math.PI for south-wall mounting.
 */
export function createOfficeMondrianPainting () {
	const CW = 600, CH = 440

	const canvas = document.createElement('canvas')
	canvas.width = CW
	canvas.height = CH
	const ctx = canvas.getContext('2d')

	const BG     = '#f2edda'
	const RED    = '#d42012'
	const BLUE   = '#1545b8'
	const YELLOW = '#f8c400'
	const BLACK  = '#0f0a04'
	const LW     = 14

	// --- Composition ---
	// Three columns: 0-210 | 210-400 | 400-600
	// Left col horizontal only at y=290 (full); right cols also at y=162.
	// Cells:
	//   top-left (0–210, 0–290): RED (large)
	//   center-top (210–400, 0–162): YELLOW
	//   center-bottom (210–400, 290–440): BLUE
	//   bottom-right (400–600, 290–440): RED
	//   everything else: BG

	ctx.fillStyle = BG
	ctx.fillRect(0, 0, CW, CH)

	// Color fills (drawn first; lines overdraw edges)
	ctx.fillStyle = RED
	ctx.fillRect(0, 0, 212, 292)         // large red top-left
	ctx.fillRect(402, 290, 200, 152)     // small red bottom-right

	ctx.fillStyle = YELLOW
	ctx.fillRect(208, 0, 194, 164)       // yellow center-top

	ctx.fillStyle = BLUE
	ctx.fillRect(208, 288, 194, 154)     // blue center-bottom

	// --- Black grid lines ---
	ctx.fillStyle = BLACK

	// Outer border
	ctx.fillRect(0, 0, CW, LW)
	ctx.fillRect(0, CH - LW, CW, LW)
	ctx.fillRect(0, 0, LW, CH)
	ctx.fillRect(CW - LW, 0, LW, CH)

	// Vertical at x=210
	ctx.fillRect(210 - LW / 2, 0, LW, CH)
	// Vertical at x=400
	ctx.fillRect(400 - LW / 2, 0, LW, CH)
	// Horizontal at y=162, only right of x=210
	ctx.fillRect(210, 162 - LW / 2, CW - 210, LW)
	// Horizontal at y=290, full width
	ctx.fillRect(0, 290 - LW / 2, CW, LW)

	// --- Three.js geometry ---
	const PW = 2.60   // painting width  (m)
	const PH = 1.90   // painting height (m)
	const FW = 0.055  // frame border width (m)
	const FD = 0.048  // frame depth (m)

	const g = new THREE.Group()

	// Frame — thin black gallery-style
	const frameMat = new THREE.MeshStandardMaterial({ color: 0x0c0a08, roughness: 0.55, metalness: 0.08 })
	const frame = new THREE.Mesh(
		new THREE.BoxGeometry(PW + FW * 2, PH + FW * 2, FD),
		frameMat,
	)
	g.add(frame)

	// Canvas face — slightly proud of frame front
	const texture = new THREE.CanvasTexture(canvas)
	texture.colorSpace = THREE.SRGBColorSpace
	const faceMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.92, metalness: 0.0 })
	const face = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), faceMat)
	face.position.z = FD / 2 + 0.002
	g.add(face)

	return g
}
