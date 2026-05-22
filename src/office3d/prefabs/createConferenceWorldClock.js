/**
 * Digital multi-zone wall display for the conference room.
 * Uses `Intl` IANA zones; all rows show the same instant (browser clock).
 *
 * **Office / server reference** is **America/Los_Angeles** — highlighted in the UI
 * (not a separate clock source; every client uses local `Date` + zone conversion).
 */
import * as THREE from "three"

/** Canonical “office time” zone when explaining server or scheduling defaults */
export const WORLD_CLOCK_REFERENCE_TZ = "America/Los_Angeles"

const ROWS = [
	{ label: "Honolulu", tz: "Pacific/Honolulu" },
	{ label: "Los Angeles", tz: "America/Los_Angeles", reference: true },
	{ label: "Denver", tz: "America/Denver" },
	{ label: "New Orleans", tz: "America/Chicago" },
	{ label: "New York", tz: "America/New_York" },
]

/**
 * @param {object} [options]
 * @param {number} [options.width=5.5] — world units (m)
 * @param {number} [options.height=2.64] — world units (m)
 */
export function createConferenceWorldClock (options = {}) {
	const width = options.width ?? 5.5
	const height = options.height ?? 2.64

	const root = new THREE.Group()
	root.name = "world-clock"

	const CW = 2048
	const CH = 1120
	const canvas = document.createElement("canvas")
	canvas.width = CW
	canvas.height = CH
	const ctx = canvas.getContext("2d")

	const tex = new THREE.CanvasTexture(canvas)
	tex.colorSpace = THREE.SRGBColorSpace
	tex.generateMipmaps = false
	tex.minFilter = THREE.LinearFilter
	tex.magFilter = THREE.LinearFilter

	const formatters = ROWS.map((row) =>
		new Intl.DateTimeFormat(undefined, {
			timeZone: row.tz,
			hour: "numeric",
			minute: "2-digit",
			second: "2-digit",
			hour12: true,
			timeZoneName: "short",
		}),
	)

	const bezelMat = new THREE.MeshStandardMaterial({
		color: 0x0a1018,
		roughness: 0.55,
		metalness: 0.35,
	})
	const bezel = new THREE.Mesh(
		new THREE.BoxGeometry(width + 0.12, height + 0.1, 0.05),
		bezelMat,
	)
	root.add(bezel)

	const face = new THREE.Mesh(
		new THREE.PlaneGeometry(width, height),
		new THREE.MeshBasicMaterial({ map: tex }),
	)
	face.position.z = 0.028
	root.add(face)

	let lastPaintSecond = -1

	function paint (now) {
		const g = ctx.createLinearGradient(0, 0, 0, CH)
		g.addColorStop(0, "#0f1828")
		g.addColorStop(1, "#080c14")
		ctx.fillStyle = g
		ctx.fillRect(0, 0, CW, CH)

		ctx.strokeStyle = "rgba(0,180,216,0.35)"
		ctx.lineWidth = 4
		ctx.strokeRect(4, 4, CW - 8, CH - 8)

		ctx.fillStyle = "#7dd3e8"
		ctx.font = '600 76px "Segoe UI", system-ui, sans-serif'
		ctx.textAlign = "center"
		ctx.textBaseline = "middle"
		ctx.fillText("WORLD TIME", CW / 2, 120)

		const row0 = 156
		const rowH = (CH - row0 - 104) / ROWS.length

		for (let i = 0; i < ROWS.length; i++) {
			const row = ROWS[i]
			const y = row0 + i * rowH + rowH / 2
			const isRef = row.reference

			if (isRef) {
				ctx.fillStyle = "rgba(0,180,216,0.12)"
				ctx.fillRect(32, y - rowH / 2 + 4, CW - 64, rowH - 8)
			}

			ctx.textAlign = "left"
			ctx.fillStyle = isRef ? "#9ee8ff" : "#c8d8e8"
			ctx.font = isRef
				? '600 52px "Segoe UI", system-ui, sans-serif'
				: '500 48px "Segoe UI", system-ui, sans-serif'
			ctx.fillText(row.label, 80, y)

			const parts = formatters[i].formatToParts(now)
			const pick = (t) => parts.find((p) => p.type === t)?.value ?? ""
			const line = `${pick("hour")}:${pick("minute")}:${pick("second")} ${pick("dayPeriod")} ${pick("timeZoneName")}`.trim()

			ctx.textAlign = "right"
			ctx.fillStyle = isRef ? "#e8fcff" : "#f0f4fa"
			ctx.font = '500 52px "Cascadia Mono", "Consolas", monospace'
			ctx.fillText(line, CW - 72, y)
		}

		ctx.textAlign = "center"
		ctx.fillStyle = "rgba(180,200,220,0.75)"
		ctx.font = '400 36px "Segoe UI", system-ui, sans-serif'
		ctx.fillText(
			"Office / server reference time — Los Angeles (Pacific)",
			CW / 2,
			CH - 52,
		)
	}

	function update (now = new Date()) {
		const sec = Math.floor(now.getTime() / 1000)
		if (sec === lastPaintSecond) return
		lastPaintSecond = sec
		paint(now)
		tex.needsUpdate = true
	}

	update()

	function dispose() {
		tex.dispose()
	}

	return { root, update, dispose }
}
