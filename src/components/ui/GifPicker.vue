<script setup>
/**
 * GifPicker — Giphy v1 search popover.
 *
 * Trending by default; debounced search query. Click selects the GIF and
 * emits its metadata for sending as a message attachment with kind='gif'.
 *
 * Requires VITE_GIPHY_KEY in the environment. With no key the picker
 * renders an inline note instead of crashing.
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'

const props = defineProps({
	anchor: { type: Object, default: null },
})
const emit = defineEmits(['select', 'close'])

const API_KEY = import.meta.env.VITE_GIPHY_KEY
const POPOVER_W = 320
const POPOVER_H = 400
const PAGE_SIZE = 24

const root = ref(null)
const top = ref(0)
const left = ref(0)
const query = ref('')
const results = ref([])
const loading = ref(false)
const error = ref('')

let debounceId = null
let activeFetchId = 0

const isConfigured = computed(() => !!API_KEY)

async function fetchTrending () {
	if (!API_KEY) return
	const fetchId = ++activeFetchId
	loading.value = true
	error.value = ''
	try {
		const url = `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(API_KEY)}&limit=${PAGE_SIZE}&rating=g`
		const res = await fetch(url)
		if (!res.ok) throw new Error(`Giphy ${res.status}`)
		const json = await res.json()
		if (fetchId !== activeFetchId) return
		results.value = (json.data || []).map(_mapGif)
	} catch (e) {
		if (fetchId !== activeFetchId) return
		error.value = e?.message || 'Failed to load GIFs'
		results.value = []
	} finally {
		if (fetchId === activeFetchId) loading.value = false
	}
}

async function fetchSearch (q) {
	if (!API_KEY) return
	const fetchId = ++activeFetchId
	loading.value = true
	error.value = ''
	try {
		const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(API_KEY)}&q=${encodeURIComponent(q)}&limit=${PAGE_SIZE}&rating=g`
		const res = await fetch(url)
		if (!res.ok) throw new Error(`Giphy ${res.status}`)
		const json = await res.json()
		if (fetchId !== activeFetchId) return
		results.value = (json.data || []).map(_mapGif)
	} catch (e) {
		if (fetchId !== activeFetchId) return
		error.value = e?.message || 'Search failed'
		results.value = []
	} finally {
		if (fetchId === activeFetchId) loading.value = false
	}
}

function _mapGif (g) {
	const previewImg = g.images?.fixed_width_small || g.images?.fixed_width
	const sendImg = g.images?.downsized_medium || g.images?.fixed_width || g.images?.original
	return {
		id: g.id,
		title: g.title || 'GIF',
		previewUrl: previewImg?.url,
		previewWidth: Number(previewImg?.width) || 100,
		previewHeight: Number(previewImg?.height) || 100,
		sendUrl: sendImg?.url,
		sendWidth: Number(sendImg?.width) || 0,
		sendHeight: Number(sendImg?.height) || 0,
		sendSize: Math.max(1, Number(sendImg?.size) || 1),
	}
}

watch(query, (val) => {
	if (debounceId) clearTimeout(debounceId)
	const q = val.trim()
	if (!q) {
		debounceId = setTimeout(fetchTrending, 0)
		return
	}
	debounceId = setTimeout(() => fetchSearch(q), 300)
})

function pick (gif) {
	if (!gif.sendUrl) return
	emit('select', {
		kind: 'gif',
		externalUrl: gif.sendUrl,
		filename: gif.title,
		mimeType: 'image/gif',
		sizeBytes: gif.sendSize,
		width: gif.sendWidth || null,
		height: gif.sendHeight || null,
		previewUrl: gif.previewUrl,
	})
}

function position () {
	const a = props.anchor?.value || props.anchor
	if (!a || !root.value) return
	const r = a.getBoundingClientRect()
	let t = r.top - POPOVER_H - 8
	if (t < 8) t = r.bottom + 8
	let l = r.right - POPOVER_W
	if (l < 8) l = 8
	if (l + POPOVER_W > window.innerWidth - 8) l = window.innerWidth - POPOVER_W - 8
	top.value = t
	left.value = l
}

function onDocumentClick (e) {
	if (!root.value) return
	const a = props.anchor?.value || props.anchor
	if (root.value.contains(e.target)) return
	if (a && a.contains(e.target)) return
	emit('close')
}

function onKey (e) {
	if (e.key === 'Escape') emit('close')
}

onMounted(async () => {
	await nextTick()
	position()
	document.addEventListener('mousedown', onDocumentClick)
	document.addEventListener('keydown', onKey)
	window.addEventListener('resize', position)
	fetchTrending()
})

onBeforeUnmount(() => {
	document.removeEventListener('mousedown', onDocumentClick)
	document.removeEventListener('keydown', onKey)
	window.removeEventListener('resize', position)
	activeFetchId++ // invalidate any in-flight fetch
	if (debounceId) clearTimeout(debounceId)
})
</script>

<template>
	<Teleport to="body">
		<div
			ref="root"
			class="gp-popover"
			:style="{ top: `${top}px`, left: `${left}px`, width: `${POPOVER_W}px`, height: `${POPOVER_H}px` }"
			role="dialog"
			aria-label="GIF picker"
		>
			<div v-if="!isConfigured" class="gp-empty">
				<p>Giphy isn't configured.</p>
				<p class="gp-hint">Set <code>VITE_GIPHY_KEY</code> and rebuild to enable GIFs.</p>
			</div>

			<template v-else>
				<div class="gp-search-row">
					<input
						v-model="query"
						class="gp-search"
						type="text"
						placeholder="Search GIFs…"
						autofocus
					/>
				</div>

				<div class="gp-grid-scroll">
					<div v-if="loading && !results.length" class="gp-empty">Loading…</div>
					<div v-else-if="error" class="gp-empty gp-empty--err">{{ error }}</div>
					<div v-else-if="!results.length" class="gp-empty">No GIFs found.</div>

					<div v-else class="gp-grid">
						<button
							v-for="g in results"
							:key="g.id"
							class="gp-cell"
							@click="pick(g)"
							:title="g.title"
						>
							<img
								v-if="g.previewUrl"
								:src="g.previewUrl"
								:alt="g.title"
								loading="lazy"
							/>
						</button>
					</div>
				</div>

				<div class="gp-attribution">Powered by GIPHY</div>
			</template>
		</div>
	</Teleport>
</template>

<style scoped>
.gp-popover {
	position: fixed;
	background: var(--color-card);
	border: 0.0625rem solid var(--color-brd2);
	border-radius: 0.625rem;
	box-shadow: 0 0.625rem 1.875rem rgba(0, 0, 0, 0.35);
	z-index: 1200;
	overflow: hidden;
	display: flex;
	flex-direction: column;
}

.gp-search-row {
	padding: 0.5rem;
	border-bottom: 0.0625rem solid var(--color-brd);
}

.gp-search {
	width: 100%;
	background: rgba(0, 0, 0, 0.2);
	border: 0.0625rem solid var(--color-brd);
	border-radius: 0.375rem;
	color: var(--color-t1);
	font-size: 0.8125rem;
	padding: 0.4375rem 0.625rem;
}

.gp-search:focus { outline: none; border-color: var(--color-accent3); }

.gp-grid-scroll {
	flex: 1;
	overflow-y: auto;
	padding: 0.5rem;
	scrollbar-width: thin;
}

.gp-grid {
	display: grid;
	grid-template-columns: repeat(2, 1fr);
	gap: 0.375rem;
}

.gp-cell {
	background: rgba(0, 0, 0, 0.15);
	border: 0;
	border-radius: 0.375rem;
	padding: 0;
	overflow: hidden;
	cursor: pointer;
	aspect-ratio: 1 / 1;
	transition: transform 0.1s, outline-color 0.1s;
	outline: 0.125rem solid transparent;
}

.gp-cell:hover {
	outline-color: var(--color-accent3);
}

.gp-cell:active {
	transform: scale(0.96);
}

.gp-cell img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
}

.gp-empty {
	text-align: center;
	color: var(--color-tm);
	font-size: 0.75rem;
	padding: 1rem;
}

.gp-empty--err { color: var(--color-red); }

.gp-hint {
	font-size: 0.6875rem;
	margin-top: 0.5rem;
}

.gp-hint code {
	background: rgba(255, 255, 255, 0.08);
	padding: 0.0625rem 0.25rem;
	border-radius: 0.1875rem;
}

.gp-attribution {
	text-align: center;
	font-size: 0.625rem;
	color: var(--color-tm);
	padding: 0.25rem;
	border-top: 0.0625rem solid var(--color-brd);
	letter-spacing: 0.06em;
}
</style>
