import * as THREE from "three"

/**
 * Parchment-style wall sign with optional `text` from layout JSON.
 * @param {{ text?: string }} [options]
 * @returns {THREE.Group}
 */
export function createOfficeWallSign (options = {}) {
	const g = new THREE.Group()
	const text = options.text

	const cvs = document.createElement("canvas")
	cvs.width = 704
	cvs.height = 128
	const c2d = cvs.getContext("2d")

	c2d.fillStyle = "#f5ead0"
	c2d.fillRect(0, 0, 704, 128)

	c2d.strokeStyle = "#5c3317"
	c2d.lineWidth = 6
	c2d.strokeRect(6, 6, 692, 116)

	c2d.strokeStyle = "#8b5e3c"
	c2d.lineWidth = 2
	c2d.strokeRect(14, 14, 676, 100)

	c2d.fillStyle = "#3b1f0a"
	c2d.textAlign = "center"
	c2d.textBaseline = "middle"
	c2d.font = "bold 52px serif"
	c2d.fillText(text || "Sign", 352, 64)

	const tex = new THREE.CanvasTexture(cvs)
	const panelMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })

	const panel = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.20, 0.012), panelMat)
	panel.position.y = 1.55
	g.add(panel)

	const frameMat = new THREE.MeshStandardMaterial({ color: 0x3b1f0a, roughness: 0.9 })
	const frame = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.26, 0.010), frameMat)
	frame.position.set(0, 1.55, -0.002)
	g.add(frame)

	const nailMat = new THREE.MeshStandardMaterial({
		color: 0x888888,
		metalness: 0.8,
		roughness: 0.2,
	})
	for (const nx of [-0.48, 0.48]) {
		const nail = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.015, 8), nailMat)
		nail.rotation.x = Math.PI / 2
		nail.position.set(nx, 1.55, 0.008)
		g.add(nail)
	}

	return g
}
