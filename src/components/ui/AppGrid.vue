<script setup>
/**
 * AppGrid — nine-dot apps launcher.
 * "My apps": IsDefault=True + user-pinned apps, sorted by SortOrder then name.
 * "Add more apps": remaining optional apps, alphabetical within category,
 *   each with a ＋ checkbox to pin into "My apps". Pins saved to localStorage.
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { Grid2x2 as Squares2X2Icon } from '@lucide/vue'
import { useAudio } from '@/composables/useAudio.js'
import ListApi from '@/api/ListApi.js'
import { config } from '@/config/configuration.js'
import { usePinnedApps } from '@/composables/usePinnedApps.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { appNavigationUrl } from '@/utils/appLink.js'

const open     = ref(false)
const apps     = ref([])
const showMore = ref(false)
const panelRef = ref(null)

const { isPinned, isUnpinnedDefault, togglePin, unpin, hideDefault, restoreDefault } = usePinnedApps()
const { playSound } = useAudio()
const avatarStore = useAvatarStore()

function resolveUrl(url) {
	if (!url || !url.includes('google.com')) return url
	return url.replace(/\/u\/\d+\//, `/u/${avatarStore.googleAccountIndex}/`)
}

const appsApi = ListApi(config.siteUrl, 'apps')

onMounted(async () => {
	try {
		const raw = await appsApi.getAll({
			$select: 'AppName,AppUrl,IconEmoji,Description,Category,SortOrder,IsDefault,IsActive,OpenInNewTab',
		})
		apps.value = (raw?.d?.results || []).filter(a => a.IsActive)
	} catch (e) {
		console.warn('[AppGrid] Failed to load apps:', e.message)
	}
})

onUnmounted(() => {
	document.removeEventListener('keydown', onEscCapture, true)
})

// "My apps" = IsDefault (unless user hid it) + user-pinned, sorted by SortOrder then name
const myApps = computed(() =>
	apps.value
		.filter(a => (a.IsDefault && !isUnpinnedDefault(a)) || isPinned(a))
		.sort((a, b) => {
			const sa = a.SortOrder != null ? Number(a.SortOrder) : 999
			const sb = b.SortOrder != null ? Number(b.SortOrder) : 999
			return sa !== sb ? sa - sb : (a.AppName || '').localeCompare(b.AppName || '')
		})
)

// "Add more apps" = non-default unpinned apps + any defaults the user explicitly hid
const moreByCategory = computed(() => {
	const map = {}
	for (const app of apps.value) {
		const inMyApps = (app.IsDefault && !isUnpinnedDefault(app)) || isPinned(app)
		if (inMyApps) continue
		const cat = app.Category || 'Other'
		if (!map[cat]) map[cat] = []
		map[cat].push(app)
	}
	for (const cat of Object.keys(map)) {
		map[cat].sort((a, b) => (a.AppName || '').localeCompare(b.AppName || ''))
	}
	return map
})

const moreCount = computed(() => Object.values(moreByCategory.value).reduce((n, g) => n + g.length, 0))

function openApp (app) {
	const url = appNavigationUrl(resolveUrl(app.AppUrl))
	if (!url) return
	if (app.OpenInNewTab !== false) window.open(url, '_blank', 'noopener,noreferrer')
	else window.location.href = url
}

function toggle() {
	if (open.value) close()
	else { open.value = true; playSound('ui-open.mp3') }
}

function onEscCapture (e) {
	if (e.key !== 'Escape') return
	e.preventDefault()
	e.stopPropagation()
	close()
}
watch(open, (isOpen) => {
	document.removeEventListener('keydown', onEscCapture, true)
	if (isOpen) document.addEventListener('keydown', onEscCapture, true)
}, { flush: 'post' })

function close() {
	open.value = false
	showMore.value = false
	playSound('ui-dismiss.mp3')
}
</script>

<template>
	<div class="appgrid-wrap" ref="panelRef">
		<!-- Trigger -->
		<button
			class="appgrid-btn hud-btn flex items-center justify-center gap-1"
			:class="{ active: open }"
			@click="toggle"
			title="Any apps used by AVA can be added here"
		>
			<Squares2X2Icon style="width:15px;height:15px" />
			<span class="flex flex-col items-start justify-center gap-1">
				External sites/apps
				<small class="text-2xs">Open in new tab</small>
			</span>
		</button>

		<!-- Backdrop — intercepts clicks on canvas, preventing accidental floor nav -->
		<Teleport to="body">
			<div v-if="open" class="appgrid-backdrop" @pointerdown.stop="close" />
		</Teleport>

		<!-- Flyout panel -->
		<Transition name="ag-drop">
			<div v-if="open" class="appgrid-panel">
				<div class="ag-header">My Apps</div>

				<!-- My apps grid -->
				<div class="ag-grid">
					<div
						v-for="app in myApps"
						:key="app.AppName"
						class="ag-tile-wrap"
					>
						<button
							class="ag-tile"
							:title="app.Description || app.AppName"
							@click="openApp(app)"
						>
							<span class="ag-icon">{{ app.IconEmoji || '🔗' }}</span>
							<span class="ag-name">{{ app.AppName }}</span>
						</button>
						<!-- Remove button — always shown; defaults hide to More Apps, pinned apps unpin -->
						<button
							class="ag-unpin-btn"
							title="Remove from My Apps"
							@click.stop="app.IsDefault ? hideDefault(app) : unpin(app)"
						>×</button>
					</div>
				</div>

				<!-- More apps expander -->
				<template v-if="moreCount">
					<button class="ag-more-toggle" @click="showMore = !showMore">
						<span>{{ showMore ? '▴' : '▾' }}</span>
						<span>Add more apps</span>
						<span class="ag-more-count">{{ moreCount }}</span>
					</button>

					<Transition name="fade">
						<div v-if="showMore" class="ag-more-body">
							<template v-for="(catApps, cat) in moreByCategory" :key="cat">
								<div class="ag-cat-label">{{ cat }}</div>
								<div class="ag-grid">
									<div
										v-for="app in catApps"
										:key="app.AppName"
										class="ag-tile-wrap"
									>
										<button
											class="ag-tile ag-tile--dim"
											:title="app.Description || app.AppName"
											@click="openApp(app)"
										>
											<span class="ag-icon">{{ app.IconEmoji || '🔗' }}</span>
											<span class="ag-name">{{ app.AppName }}</span>
										</button>
										<!-- Pin checkbox -->
										<button
											class="ag-pin-btn"
											:class="{ pinned: isPinned(app) || isUnpinnedDefault(app) }"
											:title="'Add to My Apps'"
											@click.stop="app.IsDefault ? restoreDefault(app) : togglePin(app)"
										>＋</button>
									</div>
								</div>
							</template>
						</div>
					</Transition>
				</template>
			</div>
		</Transition>
	</div>
</template>

<style scoped>
/* ── Backdrop ── */
.appgrid-backdrop {
	position: fixed;
	inset: 0;
	z-index: 43;
}

/* ── Wrapper & trigger ── */
.appgrid-wrap {
	position: relative;
	z-index: 44;
}

.appgrid-btn.active {
	background: rgba(0, 180, 216, 0.15);
	border-color: rgba(0, 180, 216, 0.4);
	color: var(--color-accent);
}

/* ── Flyout panel ── */
.appgrid-panel {
	position: absolute;
	top: calc(100% + 0.375rem);
	left: 0;
	width: 25rem;
	max-height: 80vh;
	overflow-y: auto;
	background: var(--color-card);
	border: 1px solid var(--color-brd2);
	border-radius: 0.75rem;
	box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, 0.7);
	backdrop-filter: blur(12px);
	z-index: 600;
	padding: 0.75rem 0.625rem 0.5rem;
}

.ag-header {
	font-size: 0.625rem;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--color-tm);
	padding: 0 0.25rem 0.5rem;
	border-bottom: 1px solid var(--color-brd);
	margin-bottom: 0.5rem;
}

/* ── App tile grid ── */
.ag-grid {
	display: grid;
	grid-template-columns: repeat(5, 1fr);
	gap: 0.25rem;
	margin-bottom: 0.25rem;
}

/* Wrapper provides position context for the pin/unpin overlay button */
.ag-tile-wrap {
	position: relative;
}

.ag-tile {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.3rem;
	padding: 0.5rem 0.25rem;
	border-radius: 0.5rem;
	border: 1px solid transparent;
	background: none;
	cursor: pointer;
	transition: background 0.12s, border-color 0.12s;
	min-width: 0;
	width: 100%;
}
.ag-tile:hover {
	background: rgba(0, 180, 216, 0.1);
	border-color: rgba(0, 180, 216, 0.25);
}

.ag-icon {
	font-size: 1.375rem;
	line-height: 1;
}

.ag-name {
	font-size: 0.5625rem;
	font-weight: 600;
	color: var(--color-t2);
	text-align: center;
	line-height: 1.2;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 4.5rem;
}
.ag-tile:hover .ag-name { color: var(--color-t1); }

/* Dimmed optional tiles */
.ag-tile--dim { opacity: 0.6; }
.ag-tile--dim:hover { opacity: 1; }

/* ── Pin / unpin overlay buttons ── */
.ag-pin-btn,
.ag-unpin-btn {
	position: absolute;
	top: 0.125rem;
	right: 0.125rem;
	width: 1rem;
	height: 1rem;
	border-radius: 50%;
	border: none;
	font-size: 0.625rem;
	line-height: 1;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	opacity: 0;
	transition: opacity 0.12s, background 0.12s;
}

.ag-tile-wrap:hover .ag-pin-btn,
.ag-tile-wrap:hover .ag-unpin-btn {
	opacity: 1;
}

/* Always show pin button if already pinned */
.ag-pin-btn.pinned { opacity: 1; }

.ag-pin-btn {
	background: rgba(0, 180, 216, 0.2);
	color: var(--color-accent);
}
.ag-pin-btn:hover,
.ag-pin-btn.pinned {
	background: var(--color-accent);
	color: #fff;
}

.ag-unpin-btn {
	background: rgba(180, 0, 0, 0.15);
	color: var(--color-t2);
	font-size: 0.75rem;
}
.ag-unpin-btn:hover {
	background: #c0392b;
	color: #fff;
}

/* ── More expander ── */
.ag-more-toggle {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	width: 100%;
	padding: 0.375rem 0.375rem;
	background: none;
	border: none;
	border-top: 1px solid var(--color-brd);
	border-radius: 0;
	color: var(--color-tm);
	font-size: 0.625rem;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	cursor: pointer;
	margin-top: 0.25rem;
	transition: color 0.12s;
}
.ag-more-toggle:hover { color: var(--color-t2); }

.ag-more-count {
	background: var(--color-brd2);
	color: var(--color-t2);
	font-size: 0.5625rem;
	border-radius: 0.625rem;
	padding: 0.0625rem 0.375rem;
	margin-left: auto;
}

.ag-more-body { padding-top: 0.375rem; }

.ag-cat-label {
	font-size: 0.5625rem;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--color-tm);
	padding: 0.375rem 0.25rem 0.125rem;
}

/* ── Animation ── */
.ag-drop-enter-active { transition: opacity 0.15s, transform 0.15s; }
.ag-drop-leave-active { transition: opacity 0.1s, transform 0.1s; }
.ag-drop-enter-from, .ag-drop-leave-to { opacity: 0; transform: translateY(-6px) scale(0.97); }

.fade-enter-active { transition: opacity 0.15s; }
.fade-leave-active { transition: opacity 0.1s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ── Light mode ── */
:global(html.light) .appgrid-panel {
	box-shadow: 0 8px 32px rgba(0, 80, 160, 0.15);
}
:global(html.light) .ag-tile:hover {
	background: rgba(0, 100, 180, 0.08);
	border-color: rgba(0, 100, 180, 0.2);
}
:global(html.light) .appgrid-btn.active {
	background: rgba(0, 72, 170, 0.13);
	border-color: rgba(0, 72, 170, 0.65);
	color: #003d99;
}
</style>
