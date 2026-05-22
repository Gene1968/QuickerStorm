import * as THREE from "three"

/**
 * Wall-mounted intercom panel (faces +Z in local space).
 * @returns {THREE.Group}
 */
export function createOfficeIntercom () {
	const g = new THREE.Group()

	const plateMat = new THREE.MeshStandardMaterial({
		color: 0x1a1f2b,
		roughness: 0.55,
		metalness: 0.3,
	})
	const grillMat = new THREE.MeshStandardMaterial({
		color: 0x111520,
		roughness: 0.8,
	})
	const btnMat = new THREE.MeshStandardMaterial({
		color: 0x00b4d8,
		roughness: 0.35,
		metalness: 0.5,
		emissive: new THREE.Color(0x003a50),
		emissiveIntensity: 0.6,
	})
	const ledMat = new THREE.MeshStandardMaterial({
		color: 0x00ff88,
		roughness: 0.2,
		emissive: new THREE.Color(0x00ff88),
		emissiveIntensity: 1.8,
	})

	const plate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.30, 0.04), plateMat)
	g.add(plate)

	const grill = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.10, 0.012), grillMat)
	grill.position.set(0, 0.075, 0.015)
	g.add(grill)

	const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.016, 16), btnMat)
	btn.rotation.x = Math.PI / 2
	btn.position.set(0, -0.055, 0.022)
	g.add(btn)

	const led = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.012, 8), ledMat)
	led.rotation.x = Math.PI / 2
	led.position.set(0, 0.118, 0.022)
	g.add(led)

	const lc = document.createElement("canvas")
	lc.width = 256
	lc.height = 40
	const lx = lc.getContext("2d")
	lx.fillStyle = "#0d1320"
	lx.fillRect(0, 0, 256, 40)
	lx.fillStyle = "rgba(0,180,216,0.9)"
	lx.font = 'bold 15px "Segoe UI", Arial, sans-serif'
	lx.textAlign = "center"
	lx.textBaseline = "middle"
	lx.fillText("MEETING ANNOUNCEMENT", 128, 20)
	const labelPlate = new THREE.Mesh(
		new THREE.PlaneGeometry(0.22, 0.034),
		new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(lc), transparent: true }),
	)
	labelPlate.position.set(0, -0.175, 0.021)
	g.add(labelPlate)

	return g
}
