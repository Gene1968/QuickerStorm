<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useUiStore }      from '@/stores/uiStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useWorldStore }   from '@/stores/worldStore'
import { useMapStore }     from '@/stores/mapStore'
import { useTeleport }     from '@/composables/useTeleport'
import { useLLUDP }        from '@/composables/useLLUDP'
import { useAudio }        from '@/composables/useAudio'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket'
import { S } from '@shared/protocol.js'
import FloaterWindow       from '@/components/FloaterWindow.vue'

const ui      = useUiStore()
const session = useSessionStore()
const world   = useWorldStore()
const map     = useMapStore()
const { requestTeleport, requestHomeTeleport } = useTeleport()
const { sendMapQuery, sendMapNameQuery, sendMapTeleport } = useLLUDP()
const { on, off } = useRealtimeSocket()
const { playSound } = useAudio()

const showPeople   = ref(true)
const showInfohubs = ref(false)
const showLandSale = ref(false)
const showEventsG  = ref(false)
const showEventsM  = ref(false)
const showEventsA  = ref(false)

const coordX = ref(128)
const coordY = ref(128)
const coordZ = ref(50)
const searchQuery    = ref('')
const searchResults  = ref([])
const selectedResult = ref(null)
const status         = ref('')

// Current region grid coords (indices, not meters).
const curRegionX = computed(() => Math.floor((session.regionX ?? 0) / 256))
const curRegionY = computed(() => Math.floor((session.regionY ?? 0) / 256))

// Continuous zoom: regionsAcross = 2^viewZoom. Zoom 1 = 2 regions, 5 = 32. Float values
// yield intermediate scales for smooth wheel scrolling.
const regionsAcross = computed(() => Math.pow(2, map.viewZoom))

// SVG viewport size — fills container; we track its pixel rect via ResizeObserver
const mapEl = ref(null)
const viewW = ref(600)
const viewH = ref(400)

let ro = null

function onMapResize() {
	if (!mapEl.value) return
	const r = mapEl.value.getBoundingClientRect()
	viewW.value = r.width
	viewH.value = r.height
}

// Px per region grid unit
const pxPerRegion = computed(() => Math.min(viewW.value, viewH.value) / regionsAcross.value)

// Convert grid (rx, ry) → SVG pixel coord (origin top-left)
function gridToPx(rx, ry) {
	const cx = viewW.value / 2
	const cy = viewH.value / 2
	const px = cx + (rx - map.viewCenterX) * pxPerRegion.value
	// SL Y axis points north (up); SVG Y points down — flip
	const py = cy - (ry - map.viewCenterY) * pxPerRegion.value
	return { px, py }
}

// Convert local pixel (relative to map element) → grid coords
function pxToGrid(px, py) {
	const cx = viewW.value / 2
	const cy = viewH.value / 2
	const rx = map.viewCenterX + (px - cx) / pxPerRegion.value
	const ry = map.viewCenterY - (py - cy) / pxPerRegion.value
	return { rx, ry }
}

// Rendered tiles — filter cached regions to those overlapping the viewport (+1 margin).
// Tile spans grid square (rx..rx+1, ry..ry+1). Top-left in SVG = (rx, ry+1) due to Y flip.
// Use center-then-subtract pattern to keep math identical to currentRegionRect (otherwise
// tiles drift by half a region relative to the outline).
const tiles = computed(() => {
	const half = regionsAcross.value / 2 + 1
	const minX = Math.floor(map.viewCenterX - half)
	const maxX = Math.ceil(map.viewCenterX + half)
	const minY = Math.floor(map.viewCenterY - half)
	const maxY = Math.ceil(map.viewCenterY + half)
	const out = []
	for (const b of map.regions.values()) {
		if (b.regionX < minX || b.regionX > maxX) continue
		if (b.regionY < minY || b.regionY > maxY) continue
		const { px, py } = gridToPx(b.regionX + 0.5, b.regionY + 0.5)
		out.push({
			...b,
			px: px - pxPerRegion.value / 2,
			py: py - pxPerRegion.value / 2,
			size: pxPerRegion.value,
		})
	}
	return out
})

const avatarDot = computed(() => {
	const ap = world.avatarPos
	if (!ap) return null
	// avatar SL pos (x,y) within current region (0..regionSize). Convert to grid units.
	const sizeX = session.regionSizeX || 256
	const sizeY = session.regionSizeY || 256
	const rx = curRegionX.value + ap.x / sizeX
	const ry = curRegionY.value + ap.y / sizeY
	return gridToPx(rx, ry)
})

// Other nearby avatars (from ObjectUpdate-driven world.avatars) plotted as green dots.
// Their pos is region-local SL metres; map to grid via the current region origin. Own avatar
// is excluded (drawn separately as the purple dot) by matching session.agentId.
const peopleDots = computed(() => {
	if (!showPeople.value) return []
	const myId = session.agentId?.toLowerCase()
	const sx = session.regionSizeX || 256
	const sy = session.regionSizeY || 256
	return world.avatars
		.filter(av => av.pos && av.fullId?.toLowerCase() !== myId)
		.map(av => {
			const rx = curRegionX.value + av.pos[0] / sx
			const ry = curRegionY.value + av.pos[1] / sy
			const { px, py } = gridToPx(rx, ry)
			return { id: av.localId, px, py, name: av.name || 'Avatar' }
		})
})

// Heading cone (~120° FOV) at the own avatar, showing facing direction. Map is north-up
// (gridToPx flips Y), so the same SVG-vector math as the minimap applies. Fixed pixel radius.
const FOV_HALF = Math.PI / 3
const CONE_R   = 22
const headingCone = computed(() => {
	const a = avatarDot.value
	if (!a) return null
	const phi = Math.atan2(-Math.cos(ui.cameraYaw), -Math.sin(ui.cameraYaw))
	const x1 = a.px + CONE_R * Math.cos(phi - FOV_HALF)
	const y1 = a.py + CONE_R * Math.sin(phi - FOV_HALF)
	const x2 = a.px + CONE_R * Math.cos(phi + FOV_HALF)
	const y2 = a.py + CONE_R * Math.sin(phi + FOV_HALF)
	return `M ${a.px} ${a.py} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${CONE_R} ${CONE_R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`
})

const currentRegionRect = computed(() => {
	const { px, py } = gridToPx(curRegionX.value + 0.5, curRegionY.value + 0.5)
	return {
		px: px - pxPerRegion.value / 2,
		py: py - pxPerRegion.value / 2,
		size: pxPerRegion.value,
	}
})

// Selected point: precise sub-region spot — { rx, ry, block, lx, ly }. Null = none.
const selectedSpot = ref(null)

const selectedDot = computed(() => {
	if (!selectedSpot.value) return null
	return gridToPx(selectedSpot.value.rx, selectedSpot.value.ry)
})

function regionColor(b) {
	// Access: 13=PG, 21=Mature, 42=Adult, 254=down. Tile palette is land tones —
	// backdrop is ocean so any tile reads as "ground".
	if (b.access === 254 || b.access === 255) return '#2a2a2a'  // offline — grey
	if (b.access === 42) return '#7a4a3a'                        // Adult — terracotta
	if (b.access === 21) return '#9a8a4a'                        // Mature — sand
	return '#5a7a3a'                                              // PG — grass
}

// ── Pan + zoom interaction ────────────────────────────────────────────────
let isPanning = false
let panStartX = 0
let panStartY = 0
let panStartCenterX = 0
let panStartCenterY = 0
let panMovedPx = 0  // total mouse travel during drag — treat <CLICK_THRESHOLD as click
const CLICK_THRESHOLD = 4

// Hovered region + tooltip pos (in element px, relative to wrapper). null = no hover.
const hoverBlock = ref(null)
const hoverPx    = ref({ x: 0, y: 0 })
const hoverPos   = ref({ rx: 0, ry: 0, lx: 0, ly: 0 })

function onMouseDown(e) {
	if (e.button !== 0) return
	isPanning = true
	panMovedPx = 0
	panStartX = e.clientX
	panStartY = e.clientY
	panStartCenterX = map.viewCenterX
	panStartCenterY = map.viewCenterY
}

function onMouseMove(e) {
	const rect = mapEl.value?.getBoundingClientRect()
	if (rect) {
		const px = e.clientX - rect.left
		const py = e.clientY - rect.top
		const { rx, ry } = pxToGrid(px, py)
		const regionX = Math.floor(rx)
		const regionY = Math.floor(ry)
		hoverPx.value = { x: px, y: py }
		hoverPos.value = {
			rx: regionX,
			ry: regionY,
			lx: Math.floor((rx - regionX) * 256),
			ly: Math.floor((ry - regionY) * 256),
		}
		hoverBlock.value = map.getRegion(regionX, regionY)
	}
	if (!isPanning) return
	const dx = e.clientX - panStartX
	const dy = e.clientY - panStartY
	panMovedPx = Math.max(panMovedPx, Math.abs(dx) + Math.abs(dy))
	map.viewCenterX = panStartCenterX - dx / pxPerRegion.value
	map.viewCenterY = panStartCenterY + dy / pxPerRegion.value
}

function onMouseUp(e) {
	if (!isPanning) return
	isPanning = false
	if (panMovedPx < CLICK_THRESHOLD) {
		onMapClick(e)
		return
	}
	queueQuery()
}

function onMouseLeave() {
	if (isPanning) {
		isPanning = false
		queueQuery()
	}
	hoverBlock.value = null
}

// Single click: select region under cursor → populate coords + search query, mark spot.
function onMapClick(e) {
	if (!mapEl.value) return
	const rect = mapEl.value.getBoundingClientRect()
	const px = e.clientX - rect.left
	const py = e.clientY - rect.top
	const { rx, ry } = pxToGrid(px, py)
	const regionX = Math.floor(rx)
	const regionY = Math.floor(ry)
	const block = map.getRegion(regionX, regionY)
	const lx = Math.floor((rx - regionX) * 256)
	const ly = Math.floor((ry - regionY) * 256)
	coordX.value = lx
	coordY.value = ly
	selectedSpot.value = { rx, ry, block, lx, ly }
	if (block) {
		selectedResult.value = block
		searchQuery.value = block.name
		flashStatus(`Selected: ${block.name} (${lx},${ly})`)
	} else {
		selectedResult.value = null
		flashStatus(`No region at (${regionX},${regionY})`)
	}
}

function onWheel(e) {
	e.preventDefault()
	if (!mapEl.value) return
	const rect = mapEl.value.getBoundingClientRect()
	const px = e.clientX - rect.left
	const py = e.clientY - rect.top
	// Grid point under cursor BEFORE zoom — anchor for zoom-toward-cursor.
	const before = pxToGrid(px, py)
	// Smooth continuous step. deltaY can be ±100 (line) or ±~3 (pixel) — normalize.
	const step = Math.max(-0.5, Math.min(0.5, e.deltaY / 200))
	const newZoom = Math.max(1, Math.min(8, map.viewZoom + step))
	if (newZoom === map.viewZoom) return
	map.setZoom(newZoom)
	// Recompute centerX/Y so the same grid point stays under the same screen pixel.
	const newRegionsAcross = Math.pow(2, newZoom)
	const newPxPerRegion = Math.min(viewW.value, viewH.value) / newRegionsAcross
	const cx = viewW.value / 2
	const cy = viewH.value / 2
	map.viewCenterX = before.rx - (px - cx) / newPxPerRegion
	map.viewCenterY = before.ry + (py - cy) / newPxPerRegion
	queueQuery()
}

// Resolve target Z for a teleport. Priority:
//   1. flying → preserve current avatar Z so user doesn't drop
//   2. same-region → terrain height at (lx, ly) + 0.25 if patch available
//   3. cross-region → block.waterHeight + 0.25 as safe fallback (sim places on ground if higher)
//   4. unknown → 23 (typical OS sea level)
// User can still edit coordZ explicitly for high-altitude TP; pass `explicit=true`.
function resolveTeleportZ(regionX, regionY, lx, ly, block, explicit) {
	if (explicit && Number.isFinite(Number(coordZ.value))) return Number(coordZ.value)
	if (ui.flying && world.avatarPos) return world.avatarPos.z
	const sameRegion = regionX === curRegionX.value && regionY === curRegionY.value
	if (sameRegion) {
		const ix = Math.max(0, Math.min(512, Math.floor(lx)))
		const iy = Math.max(0, Math.min(512, Math.floor(ly)))
		const h = world.terrainHeights?.[iy * 513 + ix]
		if (Number.isFinite(h) && h > 0) return h + 0.25
	}
	if (block && Number.isFinite(block.waterHeight) && block.waterHeight > 0) {
		return block.waterHeight + 0.25
	}
	return 23
}

// Dbl-click → teleport. Don't gate on cached block (chunk may not have arrived yet —
// previous "try again later" UX was the early-exit at `if (!block)`). Sim rejects bad
// targets via TeleportFailed; benign here. Plays woosh + closes floater on dispatch.
function onDblClick(e) {
	const rect = mapEl.value.getBoundingClientRect()
	const px = e.clientX - rect.left
	const py = e.clientY - rect.top
	const { rx, ry } = pxToGrid(px, py)
	const regionX = Math.floor(rx)
	const regionY = Math.floor(ry)
	const localX = (rx - regionX) * 256
	const localY = (ry - regionY) * 256
	const block = map.getRegion(regionX, regionY)
	if (block && (block.access === 254 || block.access === 255)) {
		flashStatus(`"${block.name}" is offline.`)
		return
	}
	const targetZ = resolveTeleportZ(regionX, regionY, localX, localY, block, false)
	const sameRegion = regionX === curRegionX.value && regionY === curRegionY.value
	if (sameRegion) {
		// requestTeleport plays woosh internally.
		requestTeleport({ x: localX, y: localY, z: targetZ })
	} else {
		playSound('woosh.mp3')
		sendMapTeleport(regionX, regionY, localX, localY, targetZ)
	}
	const label = block?.name ?? `(${regionX},${regionY})`
	flashStatus(`Teleporting to ${label} (z=${targetZ.toFixed(1)})…`)
	// Close floater on dispatch — user expects "I clicked, I'm going". If TP fails sim
	// surfaces via separate notification (or user reopens map).
	ui.toggleMap()
}

// ── MapBlockReply ingestion ───────────────────────────────────────────────
// useRealtimeSocket dispatches envelope payloads as the `d` field directly, not the full msg.
function onMapBlocks(d) {
	const blocks = d?.blocks ?? []
	map.setRegions(blocks)
	// Refresh search results immediately — covers the case where reply re-adds already-cached
	// regions (Map.size doesn't change → watcher misses), and the empty-search-then-name-query case.
	const q = searchQuery.value?.trim().toLowerCase()
	if (q) {
		const hits = [...map.regions.values()].filter(b => b.name.toLowerCase().includes(q))
		searchResults.value = hits.slice(0, 50)
	}
}

// ── Query coalescing ──────────────────────────────────────────────────────
let queryTimer = null
function queueQuery() {
	if (queryTimer) clearTimeout(queryTimer)
	queryTimer = setTimeout(doQuery, 250)
}

// Issue MapBlockRequest(s) covering the visible viewport, chunked into 16×16 tiles aligned
// to sim grid (so chunk coords are stable across pan/zoom and cache invalidation is sensible).
// Skip chunks fetched within CHUNK_TTL_MS — cached results render immediately, no sim hit.
const QUERY_CHUNK = 16
function doQuery() {
	const pxr = pxPerRegion.value || 1
	const halfX = Math.ceil((viewW.value / 2) / pxr) + 1
	const halfY = Math.ceil((viewH.value / 2) / pxr) + 1
	const minX = Math.max(0, Math.floor(map.viewCenterX - halfX))
	const maxX = Math.floor(map.viewCenterX + halfX)
	const minY = Math.max(0, Math.floor(map.viewCenterY - halfY))
	const maxY = Math.floor(map.viewCenterY + halfY)
	const chunkMinX = Math.floor(minX / QUERY_CHUNK)
	const chunkMaxX = Math.floor(maxX / QUERY_CHUNK)
	const chunkMinY = Math.floor(minY / QUERY_CHUNK)
	const chunkMaxY = Math.floor(maxY / QUERY_CHUNK)
	let sent = 0
	for (let cx = chunkMinX; cx <= chunkMaxX; cx++) {
		for (let cy = chunkMinY; cy <= chunkMaxY; cy++) {
			if (map.chunkFresh(cx, cy)) continue
			map.markChunkQueried(cx, cy)
			const x0 = cx * QUERY_CHUNK
			const y0 = cy * QUERY_CHUNK
			sendMapQuery(x0, x0 + QUERY_CHUNK - 1, y0, y0 + QUERY_CHUNK - 1)
			sent++
		}
	}
	if (sent > 0) flashStatus(`Querying ${sent} grid chunk${sent === 1 ? '' : 's'}…`)
}

function doTeleport() {
	requestTeleport({ x: Number(coordX.value), y: Number(coordY.value), z: Number(coordZ.value) })
}

function copySlurl() {
	const region = session.regionName || 'Unknown'
	const url    = `secondlife://${encodeURIComponent(region)}/${coordX.value}/${coordY.value}/${coordZ.value}`
	navigator.clipboard.writeText(url).catch(() => {})
	flashStatus('SLurl copied.')
}

function clearMap() {
	searchQuery.value    = ''
	searchResults.value  = []
	selectedResult.value = null
	status.value         = ''
}

// Clear the region search field + its results (× button in the search box).
function clearSearch() {
	searchQuery.value    = ''
	searchResults.value  = []
	selectedResult.value = null
	if (searchRetryTimer) clearTimeout(searchRetryTimer)
}

// MapNameRequest reply sometimes dropped by sim under load. Auto-retry once after 2s
// if no matching block appears in the cache.
let searchRetryTimer = null
function doSearch() {
	const q = searchQuery.value.trim()
	if (!q) return
	if (searchRetryTimer) clearTimeout(searchRetryTimer)
	const wanted = q.toLowerCase()
	const beforeHits = [...map.regions.values()].filter(b => b.name.toLowerCase().includes(wanted)).length
	sendMapNameQuery(q)
	flashStatus(`Searching "${q}"…`)
	searchRetryTimer = setTimeout(() => {
		const after = [...map.regions.values()].filter(b => b.name.toLowerCase().includes(wanted)).length
		if (after <= beforeHits) {
			flashStatus(`Retrying "${q}"…`)
			sendMapNameQuery(q)
		}
	}, 2000)
}

// When MapBlockReply arrives from a name query, surface single-match results.
watch(() => map.regions.size, () => {
	if (!searchQuery.value) return
	const q = searchQuery.value.toLowerCase()
	const hits = [...map.regions.values()].filter(b => b.name.toLowerCase().includes(q))
	searchResults.value = hits.slice(0, 30)
})

function centerOnMe() {
	map.setCenter(curRegionX.value + 0.5, curRegionY.value + 0.5)
	queueQuery()
}

function goHome() {
	requestHomeTeleport()   // → C.TP_HOME → TeleportLandmarkRequest(zero UUID); sim sends us home
	flashStatus('Teleporting home…')
	ui.toggleMap()
}

let _flashTimer = null
function flashStatus(msg) {
	status.value = msg
	clearTimeout(_flashTimer)
	_flashTimer = setTimeout(() => { status.value = '' }, 2500)
}

// Map access code → small chip rendered before region name in result list.
// Mirrors FS world-map: G/M/A/× badges by maturity rating.
function accessBadge(access) {
	if (access === 13)  return { label: 'G', text: 'General', cls: 'bg-green-500/80  text-white' }
	if (access === 21)  return { label: 'M', text: 'Moderate', cls: 'bg-yellow-500/80 text-black' }
	if (access === 42)  return { label: 'A', text: 'Adult', cls: 'bg-red-500/80    text-white' }
	if (access === 254 || access === 255) return { label: '×', text: 'Offline', cls: 'bg-gray-600/80 text-white' }
	return { label: '?', text: 'unknown', cls: 'bg-gray-700/60 text-white/70' }
}

let _panRaf = null
function selectResult(r) {
	selectedResult.value = r
	selectedSpot.value = { rx: r.regionX + 0.5, ry: r.regionY + 0.5, block: r, lx: 128, ly: 128 }
	coordX.value = 128
	coordY.value = 128

	const targetX = r.regionX + 0.5
	const targetY = r.regionY + 0.5
	const startX  = map.viewCenterX
	const startY  = map.viewCenterY
	const dur = 900 // ms
	const t0  = performance.now()

	if (_panRaf) cancelAnimationFrame(_panRaf)
	function step(now) {
		const p = Math.min(1, (now - t0) / dur)
		const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2 // ease-in-out quad
		map.viewCenterX = startX + (targetX - startX) * e
		map.viewCenterY = startY + (targetY - startY) * e
		if (p < 1) _panRaf = requestAnimationFrame(step)
	}
	_panRaf = requestAnimationFrame(step)
}

onMounted(() => {
	on(S.MAP_BLOCKS, onMapBlocks)
	if (mapEl.value) {
		ro = new ResizeObserver(onMapResize)
		ro.observe(mapEl.value)
		onMapResize()
	}
	// Initial center: current region.
	if (curRegionX.value > 0 || curRegionY.value > 0) {
		map.setCenter(curRegionX.value + 0.5, curRegionY.value + 0.5)
	}
	doQuery()
})

onUnmounted(() => {
	off(S.MAP_BLOCKS, onMapBlocks)
	ro?.disconnect()
	if (queryTimer) clearTimeout(queryTimer)
})
</script>

<template>
	<FloaterWindow
		id="map"
		title="🗺 World Map"
		:wrap-style="{ width: '62vw', height: '68vh', minWidth: '640px', minHeight: '400px', resize: 'both' }"
		:default-pos="{ left: '50%', top: '53%', transform: 'translate(-50%, -50%)' }"
		@close="ui.toggleMap()"
	>
		<div class="flex flex-1 min-h-0 overflow-hidden">

			<!-- ══ MAP AREA ════════════════════════════════════════════ -->
			<div class="flex flex-col flex-1 min-w-0 relative bg-[#163a5a] border-r border-brd">

				<div
					ref="mapEl"
					class="flex-1 relative overflow-hidden select-none cursor-crosshair active:cursor-grabbing"
					@mousedown="onMouseDown"
					@mousemove="onMouseMove"
					@mouseup="onMouseUp"
					@mouseleave="onMouseLeave"
					@wheel="onWheel"
					@dblclick="onDblClick"
				>
					<svg
						class="absolute inset-0 w-full h-full pointer-events-none"
						:viewBox="`0 0 ${viewW} ${viewH}`"
						preserveAspectRatio="none"
					>
						<!-- Ocean backdrop + faint sim-grid lines for orientation -->
						<defs>
							<pattern
								id="mapgrid"
								:width="pxPerRegion" :height="pxPerRegion"
								patternUnits="userSpaceOnUse"
							>
								<path
									:d="`M ${pxPerRegion} 0 L 0 0 0 ${pxPerRegion}`"
									fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="0.5"
								/>
							</pattern>
						</defs>
						<rect width="100%" height="100%" fill="url(#mapgrid)"/>

						<!-- Region tiles -->
						<g>
							<rect
								v-for="t in tiles"
								:key="`${t.regionX},${t.regionY}`"
								:x="t.px" :y="t.py" :width="t.size" :height="t.size"
								:fill="regionColor(t)" fill-opacity="0.92"
								stroke="#000000" stroke-opacity="0.35" stroke-width="0.5"
							/>
						</g>

						<!-- Region name labels (bottom-left of tile, when tile big enough) -->
						<g v-if="map.viewZoom <= 3">
							<text
								v-for="t in tiles"
								:key="`label-${t.regionX},${t.regionY}`"
								:x="t.px + 4" :y="t.py + t.size - 4"
								fill="#e2e8f0" font-size="11" font-family="sans-serif"
								pointer-events="none"
								style="paint-order: stroke; stroke: #000; stroke-width: 2; stroke-opacity: 0.7;"
							>{{ t.name }}</text>
						</g>

						<!-- Region agent counts (top-right) -->
						<g v-if="map.viewZoom <= 3">
							<text
								v-for="t in tiles.filter(x => x.agents > 0)"
								:key="`agents-${t.regionX},${t.regionY}`"
								:x="t.px + t.size - 4" :y="t.py + 12"
								fill="#10b981" font-size="9" font-family="monospace"
								text-anchor="end" pointer-events="none"
							>👤{{ t.agents }}</text>
						</g>

						<!-- Selected spot — red disc, fixed pixel size at any zoom -->
						<g v-if="selectedDot" pointer-events="none">
							<circle :cx="selectedDot.px" :cy="selectedDot.py" r="15"
								fill="transparent" stroke="#ef4444" stroke-width="6"/>
						</g>

						<!-- Current region outline (purple) -->
						<rect
							:x="currentRegionRect.px" :y="currentRegionRect.py"
							:width="currentRegionRect.size" :height="currentRegionRect.size"
							fill="none" stroke="#7c3aed" stroke-width="2"
							pointer-events="none"
						/>

						<!-- Own avatar heading cone (FOV wedge) -->
						<path
							v-if="headingCone"
							:d="headingCone"
							fill="#7c3aed55" stroke="#7c3aedaa" stroke-width="0.75"
							pointer-events="none"
						/>

						<!-- Own avatar dot (purple) -->
						<circle
							v-if="avatarDot"
							:cx="avatarDot.px" :cy="avatarDot.py" r="4"
							fill="#7c3aed" stroke="#ffffff" stroke-width="1.5"
							pointer-events="none"
						/>

						<!-- Other nearby avatars — green dots, drawn on top so they stay visible
						     even when standing right next to your own (purple) dot -->
						<g pointer-events="none">
							<circle
								v-for="d in peopleDots" :key="`av-${d.id}`"
								:cx="d.px" :cy="d.py" r="4"
								fill="#22c55e" stroke="#0a0a0a" stroke-width="1.5"
							><title>{{ d.name }}</title></circle>
						</g>
					</svg>

					<!-- Selected spot label — fixed font size, immune to zoom -->
					<div
						v-if="selectedSpot && selectedDot"
						class="absolute -translate-x-1/2 translate-y-12 pointer-events-none text-sm font-mono whitespace-nowrap z-10"
						:style="{ left: (selectedDot.px + 10) + 'px', top: (selectedDot.py - 22) + 'px' }"
					>
						<div class="bg-black/85 text-red-200 px-1.5 py-0.5 rounded shadow"
							style="paint-order: stroke; stroke: #000; stroke-width: 2;">
							<span v-if="selectedSpot.block" class="font-semibold">{{ selectedSpot.block.name }}</span>
							<span v-else class="text-white/50 italic">no region</span>
							<span class="text-white/70 ml-1">({{ selectedSpot.lx }}, {{ selectedSpot.ly }}, {{ coordZ }})</span>
						</div>
					</div>

					<!-- Hover tooltip — follows cursor at any zoom -->
					<div
						v-if="hoverBlock"
						class="absolute pointer-events-none bg-black/85 text-white text-xs font-mono px-2 py-1 rounded shadow-lg whitespace-nowrap z-10"
						:style="{ left: (hoverPx.x + 12) + 'px', top: (hoverPx.y + 12) + 'px' }"
					>
						<div class="font-semibold">{{ hoverBlock.name }}</div>
						<div class="text-white/60">grid ({{ hoverBlock.regionX }}, {{ hoverBlock.regionY }}) · ({{ hoverPos.lx }}, {{ hoverPos.ly }})</div>
						<div class="text-white/60">access={{ hoverBlock.access }} · agents={{ hoverBlock.agents }}</div>
					</div>

					<!-- Status overlay -->
					<div class="absolute bottom-2 left-3 pointer-events-none flex flex-col gap-0.5">
						<span class="text-white/70 text-2xs font-mono">
							center=({{ map.viewCenterX.toFixed(1) }},{{ map.viewCenterY.toFixed(1) }}) zoom={{ map.viewZoom }} regions={{ map.regions.size }}
						</span>
						<span class="text-white/40 text-2xs">Drag to pan · wheel to zoom · click to select · double-click to teleport</span>
					</div>
				</div>

				<!-- Zoom bar -->
				<div class="flex items-center gap-2 px-3 py-1.5 border-t border-brd bg-card shrink-0">
					<button
						class="text-tm text-xs px-1.5 hover:text-accent"
						title="Zoom in" @click="map.setZoom(map.viewZoom - 1); queueQuery()"
					>−</button>
					<input
						type="range" min="1" max="8" step="0.25" :value="map.viewZoom"
						class="flex-1 h-1 accent-accent cursor-pointer"
						@input="e => { map.setZoom(Number(e.target.value)); queueQuery() }"
					/>
					<button
						class="text-tm text-xs px-1.5 hover:text-accent"
						title="Zoom out" @click="map.setZoom(map.viewZoom + 1); queueQuery()"
					>+</button>
					<span class="text-tm/60 text-2xs ml-2">{{ regionsAcross }} regions across</span>
				</div>
			</div>

			<!-- ══ RIGHT SIDEBAR ═════════ -->
			<div class="flex flex-col w-64 shrink-0 overflow-y-auto text-xs">

				<div class="px-3 py-1.5 bg-card2 border-b border-brd text-2xs font-semibold text-white/60 uppercase tracking-widest shrink-0">
					Legend
				</div>
				<div class="px-3 py-2 border-b border-brd flex flex-col gap-1.5 shrink-0">
					<div class="flex items-center justify-between mb-0.5">
						<button
							class="flex items-center gap-1 text-t1 hover:text-accent transition-colors"
							title="Center map on avatar"
							@click="centerOnMe"
						>
							<span class="inline-block w-3 h-3 rounded-full bg-[#7c3aed] border-2 border-white shadow"/>
							<span>Me</span>
						</button>
						<button
							class="flex items-center gap-1 text-t1 hover:text-accent transition-colors"
							title="Teleport home — Phase 2"
							@click="goHome"
						>
							<span>🏠</span><span>Go Home</span>
						</button>
					</div>

					<div class="flex align-start justify-between">
						<div>
							<label class="flex items-center gap-1.5 cursor-pointer hover:text-accent text-t1">
								<input v-model="showPeople" type="checkbox" class="accent-accent"/>
								<span class="w-2 h-2 rounded-full bg-green-400 shrink-0"/>
								<span>People</span>
							</label>
							<label class="flex items-center gap-1.5 text-tm/50 cursor-not-allowed" title="TO-DO">
								<input v-model="showInfohubs" type="checkbox" class="accent-accent" disabled/>
								<span class="text-blue-400 shrink-0">ℹ</span>
								<span>Infohub</span>
							</label>
							<label class="flex items-center gap-1.5 text-tm/50 cursor-not-allowed" title="TO-DO">
								<input v-model="showLandSale" type="checkbox" class="accent-accent" disabled/>
								<span class="text-yellow-400 shrink-0">🏷</span>
								<span>Land Sale</span>
							</label>
						</div>
						<div>
							<div class="mt-1 mb-0.5 text-2xs text-white/40 uppercase tracking-wide">Events</div>
							<label class="flex items-center gap-1.5 text-tm/50 cursor-not-allowed" title="TO-DO">
								<input v-model="showEventsG" type="checkbox" class="accent-accent" disabled/>
								<span class="w-2 h-2 rounded-full bg-green-500 shrink-0"/>
								<span>General</span>
							</label>
							<label class="flex items-center gap-1.5 text-tm/50 cursor-not-allowed" title="TO-DO">
								<input v-model="showEventsM" type="checkbox" class="accent-accent" disabled/>
								<span class="w-2 h-2 rounded-full bg-yellow-500 shrink-0"/>
								<span>Moderate</span>
							</label>
							<label class="flex items-center gap-1.5 text-tm/50 cursor-not-allowed" title="TO-DO">
								<input v-model="showEventsA" type="checkbox" class="accent-accent" disabled/>
								<span class="w-2 h-2 rounded-full bg-red-500 shrink-0"/>
								<span>Adult</span>
							</label>
						</div>
					</div>
				</div>

				<div class="px-3 py-1.5 bg-card2 border-b border-brd text-2xs font-semibold text-white/60 uppercase tracking-widest shrink-0">
					Find on Map
				</div>
				<div class="px-1 py-1 border-b border-brd flex flex-col gap-1.5 shrink-0">
					<select
						class="w-full bg-card2 border border-brd text-tm rounded px-1.5 py-1 text-xs opacity-50 cursor-not-allowed"
						disabled title="Online Friends — TO-DO"
					>
						<option>👥 Online Friends</option>
					</select>
					<select
						class="w-full bg-card2 border border-brd text-tm rounded px-1.5 py-1 text-xs opacity-50 cursor-not-allowed"
						disabled title="My Landmarks — TO-DO"
					>
						<option>🏁 My Landmarks</option>
					</select>
					<div class="flex gap-1">
						<div class="relative flex-1 min-w-0">
							<input
								v-model="searchQuery"
								type="text"
								placeholder="Regions by name…"
								class="w-full bg-card2 border border-brd rounded-xl text-t1 placeholder-tm pl-1.5 pr-6 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
								@keydown.enter="doSearch"
							/>
							<button
								v-if="searchQuery"
								class="absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-tm hover:text-t1 hover:bg-white/10 leading-none"
								title="Clear search"
								aria-label="Clear search"
								@click="clearSearch"
							>×</button>
						</div>
						<button
							class="bg-accent text-white rounded text-xs hover:opacity-80 shrink-0 min-w-[3.25rem]"
							@click="doSearch"
						>Find</button>
					</div>
					<div
						class="bg-card2 border border-brd rounded overflow-y-auto"
						style="min-height:9.5rem;max-height:14rem"
					>
						<div
							v-if="!searchResults.length"
							class="flex items-center justify-center h-16 text-t1 italic text-xs"
						>
							No results
						</div>
						<button
							v-for="r in searchResults"
							:key="`${r.regionX},${r.regionY}`"
							class="w-full text-left px-2 py-1 text-xs truncate hover:bg-accent/20 transition-colors flex items-center gap-1.5"
							:class="selectedResult?.name === r.name ? 'bg-accent/30 text-white' : 'text-t1'"
							@click="selectResult(r)"
						>
							<span
								:class="['inline-flex items-center justify-center shrink-0 rounded-sm font-bold text-2xs w-4 h-4 leading-none', accessBadge(r.access).cls]"
								:title="`access ${accessBadge(r.access).text}`"
							>{{ accessBadge(r.access).label }}</span>
							<span class="truncate">{{ r.name }}</span>
							<span class="text-tm/50 text-2xs ml-auto shrink-0">({{ r.regionX }},{{ r.regionY }})</span>
						</button>
					</div>
				</div>

				<div class="px-3 py-1.5 bg-card2 border-b border-brd text-2xs font-semibold text-white/60 uppercase tracking-widest shrink-0">
					Location
				</div>
				<div class="flex flex-col gap-1.5 p-1">
					<div class="flex items-center justify-evenly gap-x-1.5 gap-y-1">
						<span class="text-tm font-mono text-2xs text-right">X/Y/Z:</span>
						<input
							v-model.number="coordX"
							type="number" id="coordX" min="1" max="255" step="1"
							class="bg-card2 border border-brd text-t1 rounded px-1.5 py-1 text-xs text-center w-full focus:outline-none focus:ring-1 focus:ring-accent"
						/>
						<input
							v-model.number="coordY"
							type="number" id="coordY" min="1" max="255" step="1"
							class="bg-card2 border border-brd text-t1 rounded px-1.5 py-1 text-xs text-center w-full focus:outline-none focus:ring-1 focus:ring-accent"
						/>
						<input
							v-model.number="coordZ"
							type="number" id="coordZ" min="0" max="4096" step="1"
							class="bg-card2 border border-brd text-t1 rounded px-1.5 py-1 text-xs text-center w-full focus:outline-none focus:ring-1 focus:ring-accent"
						/>
					</div>
					<div class="flex gap-1">
						<button
							class="flex-1 py-1 bg-accent border border-brd text-white rounded text-xs font-semibold hover:opacity-60 transition-opacity"
							@click="doTeleport"
						>
							Teleport
						</button>
						<button
							class="flex-1 py-1 bg-card2 border border-brd text-t1 rounded text-xs hover:bg-white/5 transition-colors text-nowrap"
							title="Copy SLurl to clipboard"
							@click="copySlurl"
						>Copy SLurl</button>
						<button
							class="flex-1 py-1 bg-card2 border border-brd text-t1 rounded text-xs hover:bg-white/5 transition-colors"
							@click="clearMap"
						>Clear</button>
					</div>
					<div class="flex gap-1 opacity-40">
						<button
							class="flex-1 py-1 bg-card2 border border-brd text-tm rounded text-xs cursor-not-allowed"
							disabled title="TO-DO"
						>Show Selection</button>
						<button
							class="flex-1 py-1 bg-card2 border border-brd text-tm rounded text-xs cursor-not-allowed"
							disabled title="TO-DO"
						>Track Region</button>
					</div>
					<p v-if="status" class="text-yellow-400 text-sm text-center">{{ status }}</p>
				</div>
			</div>
		</div>
	</FloaterWindow>
</template>
