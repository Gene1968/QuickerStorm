<script setup>
// TexturePreviewFloater — a draggable floater showing a single inventory texture, opened by
// double-clicking a texture item (useInventory.openInventoryItem → uiStore.openTexturePreview).
// MULTI-instance: one floater per texture, keyed by item UUID (mirrors FS llpreviewtexture — the
// user can open many at once to compare). Mounted via v-for over uiStore.texPreviewInstances.
// The fetch requests the FULL-RESOLUTION decode (getTextureUrl(id, { full: true })): the world texture
// pipeline downscales to MAX_TEX_DIM=512 to bound GPU/heap, so reusing the world blob would show e.g. a
// 1024×128 asset as 512×64. FS fetches the image at native resolution for the preview (BOOST_PREVIEW)
// and labels it with the TRUE asset size; the server returns those true J2C-header dims (srcWidth/Height).
//
// FS-parity sizing (llpreviewtexture.cpp): initial small; once the TRUE dimensions are known, resize to
// fit at native pixels (half-res if either dimension exceeds the viewport — no fixed 512 cap), clamp to
// a minimum, and nudge back on-screen. An aspect-ratio dropdown below the image constrains the preview
// area (letter/pillar-box) to a chosen ratio.
import { ref, computed, watch, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/uiStore.js'
import { getTextureUrl } from '@/composables/useTextureFetch.js'
import { computePreviewSize, buildAspectOptions, ASPECT_OPTIONS } from '@/lib/texturePreviewSizing.js'
import { CopyIcon } from '@lucide/vue'
import FloaterWindow from '@/components/FloaterWindow.vue'

const props = defineProps({
	// { id, key, assetId, name } from uiStore.texPreviewInstances
	instance: { type: Object, required: true },
})

const ui = useUiStore()

const name = computed(() => props.instance?.name || 'Texture')
const desc = computed(() => props.instance?.desc || '(No description)')
const uuid = computed(() => props.instance?.assetId || '')

const src     = ref(null)      // resolved object URL (or null while fetching / on failure)
const loading = ref(false)
const failed  = ref(false)
const dims    = ref(null)      // { w, h } — TRUE asset dims from the full-res fetch (J2C header)
const copied  = ref(false)

// FloaterWindow sizing — starts small; onImgLoad computes the FS-fit size and writes it here.
const floaterSize = ref({ width: '24rem', height: '20rem' })
// Aspect-ratio constraint: null = Unconstrained (object-fit:contain). Options + selection are
// derived from the texture's natural size once it loads.
const aspectOptions  = ref(ASPECT_OPTIONS)
const selectedRatio  = ref(null)     // number (w/h) or null

// WHY no local revoke of `src`: full-res preview object URLs are owned + revoked by useTextureFetch's
// own fullUrlCache (bounded LRU + teardown), NOT here — revoking one another floater still shows would
// 404 it. We only null our local reference on unmount; the source cache handles the lifecycle.

// Apply the FS sizing rule + aspect options from the TRUE asset dimensions. Sizing is dims-only (no DOM
// read) so it can run the moment the server reports srcWidth/srcHeight — before the <img> pixels decode.
// The on-screen reposition/nudge needs the floater's root element, done separately in onImgLoad (which
// has a reliable handle via the <img>). `rootEl` (optional) enables the nudge here when available.
function applyTrueDims(w, h, rootEl = null) {
	if (!w || !h) return
	dims.value = { w, h }

	let curPos = null
	if (rootEl) {
		const rect = rootEl.getBoundingClientRect()
		curPos = { left: rect.left, top: rect.top }
	}

	const fit = computePreviewSize(w, h, window.innerWidth, window.innerHeight, curPos)
	floaterSize.value = { width: `${fit.width}px`, height: `${fit.height}px` }
	if (rootEl && fit.left != null) {
		rootEl.style.left = `${fit.left}px`
		rootEl.style.top  = `${fit.top}px`
		rootEl.style.transform = 'none'
	}

	// Aspect-ratio dropdown: compute the texture's reduced ratio, append a custom option if needed,
	// and pre-select the matching option (FS default = the texture's own ratio, not Unconstrained).
	const { options, selectedLabel } = buildAspectOptions(w, h)
	aspectOptions.value = options
	const sel = options.find(o => o.label === selectedLabel)
	selectedRatio.value = sel ? sel.ratio : null
}

// Re-fetch whenever the target UUID changes (multi-instance: normally fetched once on mount, but
// watch immediate keeps it robust if the store ever re-targets an instance in place). The full-res
// fetch resolves { url, width, height } where w/h are the TRUE asset dims — used for label + sizing.
watch(uuid, (id) => {
	src.value = null
	dims.value = null
	failed.value = false
	copied.value = false
	if (!id) { loading.value = false; return }
	loading.value = true
	getTextureUrl(id, { full: true }).then((res) => {
		// Guard against a race: a newer target may have replaced this one mid-fetch.
		if (uuid.value !== id) return
		loading.value = false
		if (res?.url) {
			src.value = res.url
			applyTrueDims(res.width, res.height)   // label + floater size from server-reported true dims
		} else {
			failed.value = true
		}
	}, () => {
		if (uuid.value !== id) return
		loading.value = false
		failed.value = true
	})
}, { immediate: true })

// Once the <img> decodes we have a reliable handle to the floater root. Run the on-screen nudge now
// (reposition if the sized floater would overflow), and — as a fallback — set dims from the intrinsic
// pixels if the server didn't report true dims (older cached payload). With a full-res decode the
// intrinsic pixels equal the true dims.
function onImgLoad(e) {
	const img = e.target
	if (!img?.naturalWidth) return
	const rootEl = img.closest('.fixed')
	const w = dims.value?.w || img.naturalWidth
	const h = dims.value?.h || img.naturalHeight
	applyTrueDims(w, h, rootEl)
}
function onImgError() { failed.value = true; src.value = null }

// aspect-ratio <select> is bound to the label; map label → ratio (null = Unconstrained).
const selectedLabel = ref('Unconstrained')
watch(selectedRatio, () => {
	const match = aspectOptions.value.find(o => o.ratio === selectedRatio.value)
	selectedLabel.value = match ? match.label : 'Unconstrained'
})
function onAspectChange(e) {
	const label = e.target.value
	selectedLabel.value = label
	const opt = aspectOptions.value.find(o => o.label === label)
	selectedRatio.value = opt ? opt.ratio : null
}

// Constrain the image area to the selected ratio (letter/pillar-box). Unconstrained → contain-fit.
const imageAreaStyle = computed(() => {
	if (selectedRatio.value == null) return {}
	return { aspectRatio: String(selectedRatio.value), maxWidth: '100%', maxHeight: '100%', margin: 'auto' }
})
const imgClass = computed(() =>
	selectedRatio.value == null ? 'max-w-full max-h-full object-contain' : 'w-full h-full object-contain'
)

async function copyUuid() {
	if (!uuid.value) return
	try {
		await navigator.clipboard.writeText(uuid.value)
		copied.value = true
		setTimeout(() => { copied.value = false }, 1200)
	} catch { /* clipboard blocked (insecure context / permissions) — silent, non-critical */ }
}

function close() { ui.closeTexturePreview(props.instance.id) }

onUnmounted(() => { src.value = null })
</script>

<template>
	<FloaterWindow
		:id="instance.id"
		:title="'Texture: ' + name"
		:wrap-style="{ ...floaterSize, resize: 'both' }"
		:default-pos="{ left: 'calc(50vw - 12rem)', top: 'calc(50vh - 10rem)' }"
		@close="close"
	>
		<div class="flex flex-col flex-1 min-h-0 p-2 gap-2">
			<div class="flex items-center gap-2">
				<div class="text-xs">Description:</div>
				<input type="text" :value="desc" readonly class="border border-edge rounded-sm bg-fg/20 px-1.5 py-0.5 w-full text-sm text-fg read-only:opacity-60 read-only:cursor-not-allowed" />
			</div>
			<!-- Image area: ratio-constrained inner box (letter/pillar-box) or contain-fit. -->
			<div class="flex-1 min-h-0 flex items-center justify-center rounded-md bg-panel overflow-hidden">
				<div
					class="flex items-center justify-center overflow-hidden"
					:class="selectedRatio == null ? 'max-w-full max-h-full' : ''"
					:style="imageAreaStyle"
				>
					<div v-if="src" class="bgtrans max-w-full max-h-full">
						<img
							:src="src"
							:class="imgClass"
							alt=""
							@load="onImgLoad"
							@error="onImgError"
						/>
					</div>
					<div v-else-if="failed" class="text-2xs italic text-t1/50 px-3 text-center">
						Preview unavailable — the texture couldn't be fetched.
					</div>
					<div v-else class="text-2xs italic text-t1/40">
						Loading preview…
					</div>
				</div>
			</div>

			<!-- Aspect-ratio dropdown (FS floater_preview_texture combo_aspect_ratio). -->
			<div class="shrink-0 flex items-center justify-between gap-2 text-2xs text-t1/70">
				<div v-if="dims" class="tabular-nums">{{ dims.w }} × {{ dims.h }} px</div>
				<div v-else>&nbsp;</div>
				<div class="shrink-0 flex items-center gap-2">
					<label class="shrink-0">Aspect ratio:</label>
					<select
						:value="selectedLabel"
						class="qs-btn flex-1 min-w-0 bg-card border border-brd rounded-sm px-1.5 py-0.5 text-2xs text-t1"
						@change="onAspectChange"
					>
						<option v-for="opt in aspectOptions" :key="opt.label" :value="opt.label" class="bg-panel/70 text-fg">{{ opt.label }}</option>
					</select>
				</div>
			</div>

			<!-- Metadata: dimensions + UUID with copy button. -->
			<div class="shrink-0 flex flex-col gap-1 text-2xs text-t1/70">
				<div class="flex items-center gap-1 min-w-0">
					<span class="font-mono truncate select-all" :title="uuid">{{ uuid }}</span>
					<button
						class="shrink-0 p-1 rounded-sm text-t1/60 hover:text-t1 hover:bg-white/10 transition-colors"
						:title="copied ? 'Copied!' : 'Copy UUID'"
						aria-label="Copy UUID"
						@click="copyUuid"
					>
						<CopyIcon :size="12" />
					</button>
					<span v-if="copied" class="shrink-0 text-accent">Copied</span>
				</div>
			</div>
		</div>
	</FloaterWindow>
</template>

<style scoped>
.bgtrans {
	background-color: #444444ff;
	background-image: url('@/assets/img/bg-for-trans-imgs.webp');
	background-repeat: repeat;
	background-size: auto;
}
</style>
