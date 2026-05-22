<script setup>
/**
 * OfficeShelf — app shortcut bar shown at the bottom of the canvas
 * when the user is in their own office room.
 * Shows My Apps (IsDefault + user-pinned) as a horizontal scrollable row.
 * Reuses the same localStorage pin key as AppGrid.
 */
import { ref, computed, onMounted } from 'vue'
import ListApi from '@/api/ListApi.js'
import { config } from '@/config/configuration.js'
import { usePinnedApps } from '@/composables/usePinnedApps.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { appNavigationUrl } from '@/utils/appLink.js'

const apps        = ref([])
const avatarStore = useAvatarStore()
const { pinnedNames, isUnpinnedDefault } = usePinnedApps()

function resolveUrl(url) {
	if (!url || !url.includes('google.com')) return url
	return url.replace(/\/u\/\d+\//, `/u/${avatarStore.googleAccountIndex}/`)
}

const appsApi = ListApi(config.siteUrl, 'apps')

onMounted(async () => {
	try {
		const raw = await appsApi.getAll({
			$select: 'AppName,AppUrl,IconEmoji,Description,SortOrder,IsDefault,IsActive,OpenInNewTab',
		})
		apps.value = (raw?.d?.results || []).filter(a => a.IsActive)
	} catch (e) {
		console.warn('[OfficeShelf] Failed to load apps:', e.message)
	}
})

const shelfApps = computed(() =>
	apps.value
		.filter(a => (a.IsDefault && !isUnpinnedDefault(a)) || pinnedNames.value.has(a.AppName))
		.sort((a, b) => {
			const sa = a.SortOrder != null ? Number(a.SortOrder) : 999
			const sb = b.SortOrder != null ? Number(b.SortOrder) : 999
			return sa !== sb ? sa - sb : (a.AppName || '').localeCompare(b.AppName || '')
		})
)

function openApp (app) {
	const url = appNavigationUrl(resolveUrl(app.AppUrl))
	if (!url) return
	if (app.OpenInNewTab !== false) window.open(url, '_blank', 'noopener,noreferrer')
	else window.location.href = url
}

</script>

<template>
	<div class="office-shelf">
		<div class="shelf-inner">
			<!-- App tiles -->
			<button
				v-for="app in shelfApps"
				:key="app.AppName"
				class="shelf-tile"
				:title="app.Description || app.AppName"
				@click="openApp(app)"
			>
				<span class="shelf-icon">{{ app.IconEmoji || '🔗' }}</span>
				<span class="shelf-name">{{ app.AppName }}</span>
			</button>

		</div>
	</div>
</template>

<style scoped>
.office-shelf {
	position: absolute;
	bottom: 2.75rem;
	left: 0;
	right: 0;
	display: flex;
	justify-content: center;
	padding: 0 1rem 0.25rem;
	pointer-events: none;
	z-index: 25;
}

.shelf-inner {
	display: flex;
	align-items: flex-end;
	justify-content: center;
	flex-wrap: wrap;
	gap: 0.125rem;
	background: rgba(10, 18, 30, 0.82);
	border: 1px solid var(--color-brd2);
	border-bottom: none;
	border-radius: 0.75rem 0.75rem 0 0;
	backdrop-filter: blur(14px);
	padding: 0.25rem 0.5rem 0.25rem;
	max-width: 80vw;
	overflow-x: auto;
	pointer-events: all;
	scrollbar-width: none;
}
.shelf-inner::-webkit-scrollbar { display: none; }

.shelf-tile {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.2rem;
	padding: 0.375rem 0.5rem;
	background: none;
	border: 1px solid transparent;
	border-radius: 0.5rem;
	cursor: pointer;
	transition: background 0.12s, border-color 0.12s, transform 0.1s;
	flex-shrink: 0;
}
.shelf-tile:hover {
	background: rgba(0, 180, 216, 0.12);
	border-color: rgba(0, 180, 216, 0.28);
	transform: translateY(-0.1875rem);
}

.shelf-icon {
	font-size: 1.375rem;
	line-height: 1;
}


.shelf-name {
	font-size: 0.5rem;
	font-weight: 600;
	color: var(--color-t2);
	white-space: nowrap;
	max-width: 3.5rem;
	overflow: hidden;
	text-overflow: ellipsis;
}
.shelf-tile:hover .shelf-name { color: var(--color-t1); }


/* Light mode */
/* Light mode overrides live in index.css */
</style>
