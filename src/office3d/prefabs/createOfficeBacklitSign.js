import * as THREE from "three"

/**
 * Large cyan backlit lobby-style sign; optional `text` on canvas plane.
 * @param {{ text?: string }} [options]
 * @returns {THREE.Group}
 */
export function createOfficeBacklitSign (options = {}) {
	const g = new THREE.Group()
	const text = options.text

	const sign = new THREE.Mesh(
		new THREE.BoxGeometry(3.5, 0.6, 0.06),
		new THREE.MeshStandardMaterial({
			color: 0x00b4d8,
			emissive: new THREE.Color(0x00b4d8),
			emissiveIntensity: 0.4,
		}),
	)
	g.add(sign)

	if (text) {
		const cw = 512
		const ch = 88
		const canvas = document.createElement("canvas")
		canvas.width = cw
		canvas.height = ch
		const ctx = canvas.getContext("2d")
		ctx.fillStyle = "#00b4d8"
		ctx.fillRect(0, 0, cw, ch)
		ctx.fillStyle = "rgba(255,255,255,0.92)"
		ctx.font = 'bold 46px "Segoe UI", Arial, sans-serif'
		ctx.textAlign = "center"
		ctx.textBaseline = "middle"
		ctx.fillText(text, cw / 2, ch / 2)
		const label = new THREE.Mesh(
			new THREE.PlaneGeometry(3.4, 0.55),
			new THREE.MeshBasicMaterial({
				map: new THREE.CanvasTexture(canvas),
				transparent: true,
			}),
		)
		label.position.z = 0.04
		g.add(label)
	}

	return g
}
