<script setup>
/**
 * ChannelBookmarksBar — pinned URL bar for a channel.
 *
 * Self-contained: fetches the channel's bookmarks on mount, subscribes to
 * Supabase Realtime so adds/removes by other members appear live, and
 * exposes inline add + per-chip remove.
 *
 * Used inside DmFlyout for channel conversations only.
 */
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useMessaging } from '@/composables/useMessaging.js'

const props = defineProps({
	channelId: { type: String, required: true },
})

const messaging = useMessaging()

const bookmarks = ref([])
const loading = ref(false)
const error = ref('')
const showAdd = ref(false)
const newUrl = ref('')
const newLabel = ref('')
const adding = ref(false)
const urlInputEl = ref(null)

let unsubscribe = null

async function load () {
	bookmarks.value = []
	error.value = ''
	loading.value = true
	try {
		bookmarks.value = await messaging.fetchBookmarks(props.channelId)
	} catch (e) {
		error.value = e?.message || 'Failed to load bookmarks'
	} finally {
		loading.value = false
	}
}

function setupSubscription () {
	teardown()
	unsubscribe = messaging.subscribeBookmarks(props.channelId, {
		onInsert: (row) => {
			if (bookmarks.value.some(b => b.id === row.id)) return
			bookmarks.value = [...bookmarks.value, row].sort(_byPosition)
		},
		onDelete: (row) => {
			bookmarks.value = bookmarks.value.filter(b => b.id !== row.id)
		},
		onUpdate: (row) => {
			bookmarks.value = bookmarks.value
				.map(b => b.id === row.id ? row : b)
				.sort(_byPosition)
		},
	})
}

function teardown () {
	if (unsubscribe) { try { unsubscribe() } catch { /* ignore */ } }
	unsubscribe = null
}

function _byPosition (a, b) {
	if (a.position !== b.position) return a.position - b.position
	return new Date(a.created_at) - new Date(b.created_at)
}

watch(() => props.channelId, () => {
	load()
	setupSubscription()
}, { immediate: true })

onMounted(() => {
	// channelId watcher with immediate:true already loads + subscribes.
})

onUnmounted(teardown)

function _hostnameOf (raw) {
	try { return new URL(raw).hostname.replace(/^www\./, '') } catch { return raw }
}

function faviconFor (url) {
	const host = _hostnameOf(url)
	return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`
}

function openBookmark (b) {
	window.open(b.url, '_blank', 'noopener,noreferrer')
}

function toggleAdd () {
	showAdd.value = !showAdd.value
	error.value = ''
	if (showAdd.value) {
		newUrl.value = ''
		newLabel.value = ''
		nextTick(() => urlInputEl.value?.focus())
	}
}

function _normalizeUrl (raw) {
	const trimmed = raw.trim()
	if (!trimmed) return null
	if (/^https?:\/\//i.test(trimmed)) return trimmed
	return `https://${trimmed}`
}

async function submitAdd () {
	const url = _normalizeUrl(newUrl.value)
	if (!url) { error.value = 'URL required'; return }
	try { new URL(url) } catch { error.value = 'Invalid URL'; return }

	const label = newLabel.value.trim() || _hostnameOf(url)
	adding.value = true
	error.value = ''
	try {
		const row = await messaging.addBookmark(props.channelId, url, label)
		// Optimistic in case the realtime echo lags
		if (!bookmarks.value.some(b => b.id === row.id)) {
			bookmarks.value = [...bookmarks.value, row].sort(_byPosition)
		}
		showAdd.value = false
		newUrl.value = ''
		newLabel.value = ''
	} catch (e) {
		error.value = e?.message || 'Failed to add'
	} finally {
		adding.value = false
	}
}

async function removeBookmark (b) {
	const prev = bookmarks.value
	bookmarks.value = bookmarks.value.filter(x => x.id !== b.id)
	try {
		await messaging.removeBookmark(b.id)
	} catch (e) {
		bookmarks.value = prev
		error.value = e?.message || 'Failed to remove'
	}
}
</script>

<template>
	<div class="cbb-wrap">
		<div class="cbb-row">
			<a
				v-for="b in bookmarks"
				:key="b.id"
				class="cbb-chip"
				:href="b.url"
				target="_blank"
				rel="noopener noreferrer"
				@click.prevent="openBookmark(b)"
				:title="b.url"
			>
				<img class="cbb-fav" :src="faviconFor(b.url)" alt="" />
				<span class="cbb-label">{{ b.label }}</span>
				<button
					class="cbb-remove"
					title="Remove bookmark"
					@click.stop.prevent="removeBookmark(b)"
				>✕</button>
			</a>

			<button
				v-if="!loading"
				class="cbb-add-btn"
				:class="{ 'cbb-add-btn--active': showAdd }"
				@click="toggleAdd"
				:title="showAdd ? 'Cancel' : 'Add bookmark'"
			>
				{{ showAdd ? '✕' : '+' }}
			</button>

			<span v-if="loading && !bookmarks.length" class="cbb-loading">Loading…</span>
		</div>

		<div v-if="showAdd" class="cbb-add-form">
			<input
				ref="urlInputEl"
				v-model="newUrl"
				class="cbb-input"
				type="text"
				placeholder="https://…"
				@keydown.enter="submitAdd"
				:disabled="adding"
			/>
			<input
				v-model="newLabel"
				class="cbb-input cbb-input--label"
				type="text"
				placeholder="Label (optional)"
				@keydown.enter="submitAdd"
				:disabled="adding"
			/>
			<button class="cbb-save-btn" @click="submitAdd" :disabled="adding || !newUrl.trim()">
				{{ adding ? '…' : 'Add' }}
			</button>
		</div>

		<div v-if="error" class="cbb-error">{{ error }}</div>
	</div>
</template>

<style scoped>
.cbb-wrap {
	border-bottom: 0.0625rem solid var(--color-brd);
	padding: 0.4375rem 0.5rem;
	flex-shrink: 0;
}

.cbb-row {
	display: flex;
	align-items: center;
	gap: 0.3125rem;
	flex-wrap: nowrap;
	overflow-x: auto;
	scrollbar-width: thin;
}

.cbb-chip {
	display: inline-flex;
	align-items: center;
	gap: 0.3125rem;
	background: rgba(255, 255, 255, 0.05);
	border: 0.0625rem solid var(--color-brd);
	border-radius: 999px;
	padding: 0.1875rem 0.625rem 0.1875rem 0.4375rem;
	color: var(--color-t1);
	text-decoration: none;
	font-size: 0.6875rem;
	white-space: nowrap;
	flex-shrink: 0;
	max-width: 12rem;
	transition: background 0.12s, border-color 0.12s;
	position: relative;
}

.cbb-chip:hover {
	background: rgba(255, 255, 255, 0.1);
	border-color: var(--color-brd2);
}

.cbb-fav {
	width: 0.875rem;
	height: 0.875rem;
	flex-shrink: 0;
	border-radius: 0.125rem;
	background: rgba(0, 0, 0, 0.2);
}

.cbb-label {
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 9rem;
}

.cbb-remove {
	background: none;
	border: 0;
	color: var(--color-tm);
	cursor: pointer;
	font-size: 0.75rem;
	line-height: 1;
	padding: 0 0.0625rem;
	margin-left: 0.125rem;
	opacity: 0;
	transition: opacity 0.12s, color 0.12s;
}

.cbb-chip:hover .cbb-remove { opacity: 1; }
.cbb-remove:hover { color: var(--color-red); }

.cbb-add-btn {
	background: rgba(255, 255, 255, 0.05);
	border: 0.0625rem dashed var(--color-brd);
	color: var(--color-tm);
	border-radius: 999px;
	width: 1.5rem;
	height: 1.5rem;
	font-size: 0.875rem;
	line-height: 1;
	cursor: pointer;
	flex-shrink: 0;
	transition: background 0.12s, color 0.12s;
}

.cbb-add-btn:hover {
	background: rgba(255, 255, 255, 0.12);
	color: var(--color-t1);
}

.cbb-add-btn--active {
	color: var(--color-red);
	border-style: solid;
}

.cbb-loading {
	font-size: 0.6875rem;
	color: var(--color-tm);
}

.cbb-add-form {
	display: flex;
	gap: 0.3125rem;
	margin-top: 0.4375rem;
}

.cbb-input {
	flex: 1;
	background: rgba(0, 0, 0, 0.2);
	border: 0.0625rem solid var(--color-brd);
	border-radius: 0.3125rem;
	color: var(--color-t1);
	font-size: 0.75rem;
	padding: 0.3125rem 0.4375rem;
	min-width: 0;
}

.cbb-input--label { flex: 0.7; }

.cbb-input:focus { outline: none; border-color: var(--color-accent3); }
.cbb-input:disabled { opacity: 0.6; }

.cbb-save-btn {
	background: var(--color-accent3);
	color: #fff;
	border: 0;
	border-radius: 0.3125rem;
	padding: 0.3125rem 0.625rem;
	font-size: 0.75rem;
	font-weight: 600;
	cursor: pointer;
	flex-shrink: 0;
}

.cbb-save-btn:disabled { opacity: 0.4; cursor: default; }

.cbb-error {
	font-size: 0.625rem;
	color: var(--color-red);
	margin-top: 0.3125rem;
}
</style>
