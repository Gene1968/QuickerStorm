<script setup>
/**
 * KudosFlyout — opens when the break-room kudos plaque is clicked.
 * Lists recent kudos (newest first) from the useKudos singleton feed.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { recentKudos } from '@/composables/useKudos.js'
import { usePresenceStore } from '@/stores/presenceStore.js'

const presenceStore = usePresenceStore()
const visible = ref(false)

function nameFor(authId) {
	if (!authId) return 'Someone'
	const u = presenceStore.users.find(p =>
		String(p.authUserId || p.auth_user_id) === String(authId),
	)
	return u?.name || u?.displayName || u?.email?.split('@')[0] || 'Someone'
}

function colorFor(authId) {
	const u = presenceStore.users.find(p =>
		String(p.authUserId || p.auth_user_id) === String(authId),
	)
	return u?.color || '#7a8aa8'
}

function timeAgo(iso) {
	if (!iso) return ''
	const t = Date.parse(iso)
	if (Number.isNaN(t)) return ''
	const sec = Math.max(0, Math.round((Date.now() - t) / 1000))
	if (sec < 60) return 'just now'
	if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
	if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
	return `${Math.floor(sec / 86400)}d ago`
}

const items = computed(() => recentKudos.value || [])

function open()  { visible.value = true }
function close() { visible.value = false }

function onKey(e) {
	if (visible.value && e.key === 'Escape') {
		e.preventDefault()
		close()
	}
}

onMounted(() => {
	window.addEventListener('ava-kudos-wall-click', open)
	document.addEventListener('keydown', onKey, true)
})
onUnmounted(() => {
	window.removeEventListener('ava-kudos-wall-click', open)
	document.removeEventListener('keydown', onKey, true)
})
</script>

<template>
	<Teleport to="body">
		<div v-if="visible" class="fixed inset-0 z-[320] bg-black/50" @click.self="close" />
		<Transition name="kf">
			<aside
				v-if="visible"
				class="ava-panel fixed right-4 top-1/2 -translate-y-1/2 z-[321] w-[22rem] max-h-[80vh] rounded-xl overflow-hidden shadow-[0_18px_56px_rgba(0,0,0,0.6)] flex flex-col"
			>
				<header class="flex items-center justify-between px-4 py-3 border-b border-brd">
					<div class="flex items-center gap-2">
						<span class="text-xl">✨</span>
						<div>
							<div class="text-sm font-bold text-t1">Kudos Wall</div>
							<div class="text-[0.6875rem] text-tm">Recent shout-outs</div>
						</div>
					</div>
					<button
						class="bg-transparent border-0 text-tm cursor-pointer text-xs px-1 py-0.5 rounded leading-none transition-colors hover:text-t1 hover:bg-white/[0.06]"
						@click="close"
					>✕</button>
				</header>

				<div class="flex-1 overflow-y-auto px-3 py-2.5">
					<div v-if="items.length === 0" class="text-tm text-xs text-center py-8">
						No kudos yet. Click someone's avatar and give the first one!
					</div>
					<div
						v-for="k in items"
						:key="k.Id"
						class="kf-card"
					>
						<div class="flex items-center gap-2 mb-1.5">
							<span class="kf-pill" :style="{ background: colorFor(k.FromUserId) }">
								{{ nameFor(k.FromUserId).slice(0, 1).toUpperCase() }}
							</span>
							<span class="text-[0.6875rem] text-t2">
								<strong class="text-t1">{{ nameFor(k.FromUserId) }}</strong>
								<span class="text-tm"> to </span>
								<strong class="text-t1">{{ nameFor(k.ToUserId) }}</strong>
							</span>
							<span class="text-[0.625rem] text-tm ml-auto">{{ timeAgo(k.Created) }}</span>
						</div>
						<p class="text-xs text-t1 leading-snug whitespace-pre-wrap">{{ k.Message }}</p>
					</div>
				</div>
			</aside>
		</Transition>
	</Teleport>
</template>

<style scoped>
.kf-card {
	background: rgba(255, 200, 80, 0.06);
	border: 1px solid rgba(255, 200, 80, 0.18);
	border-radius: 0.5rem;
	padding: 0.625rem 0.75rem;
	margin-bottom: 0.5rem;
}
.kf-pill {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.25rem;
	height: 1.25rem;
	border-radius: 50%;
	font-size: 0.625rem;
	font-weight: 700;
	color: rgba(255, 255, 255, 0.92);
}

.kf-enter-active, .kf-leave-active { transition: opacity 0.18s, transform 0.18s; }
.kf-enter-from, .kf-leave-to { opacity: 0; transform: translateX(0.75rem) translateY(-50%); }

:global(html.light) .kf-card {
	background: rgba(255, 180, 60, 0.10);
	border-color: rgba(255, 140, 30, 0.22);
}
</style>
