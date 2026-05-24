<script setup>
import { ref, computed, nextTick } from 'vue'
import { useLocalChat }  from '@/composables/useLocalChat'
import { useAvatarStore } from '@/stores/avatarStore'
import { useUiStore }     from '@/stores/uiStore'
import FloaterWindow      from '@/components/FloaterWindow.vue'

const avatar = useAvatarStore()
const ui     = useUiStore()
const { messages, send } = useLocalChat()

const activeTab  = ref('nearby')
const chatInput  = ref('')
const msgEl      = ref(null)

// TODO: openIMs — populated by incoming IM events; shape: { agentId, agentName, messages[] }
// Switching to a new IM from WorldView should push here + set activeTab = agentId
const openIMs = ref([])

const tabs = computed(() => [
	{ id: 'contacts', label: 'Contacts', icon: '👥' },
	{ id: 'nearby',   label: 'Nearby',   icon: '📡' },
	...openIMs.value.map(im => ({ id: im.agentId, label: im.agentName, icon: '💬' })),
])

const floaterTitle = computed(() =>
	avatar.displayName ? `Conversations — ${avatar.displayName}` : 'Conversations'
)

const TYPE_CLASS = {
	0: 'text-white/50 italic',          // whisper
	1: 'text-t1',                        // normal
	2: 'text-yellow-400 font-semibold',  // shout
}

async function submitChat() {
	const msg = chatInput.value.trim()
	if (!msg) return
	send(msg)
	chatInput.value = ''
	await nextTick()
	if (msgEl.value) msgEl.value.scrollTop = 0
}

// TODO: persist position + size to indexedDB (too many floaters for localStorage)
// See docs/tech-debt.md
</script>

<template>
	<FloaterWindow
		id="conversations"
		:title="floaterTitle"
		:wrap-style="{ width: '25vw', height: '33vh', resize: 'both' }"
		:default-pos="{ left: '0.125%', top: '7%' }"
		@close="ui.toggleChat()"
	>
		<!-- ── Body: vertical tabs + content ─────────────────────── -->
		<div class="flex flex-1 min-h-0">

			<!-- Vertical tab strip -->
			<nav class="flex flex-col shrink-0 w-[4.5rem] border-r border-brd overflow-y-auto">
				<button
					v-for="tab in tabs"
					:key="tab.id"
					class="flex flex-col items-center gap-0.5 py-2 px-1 text-xs leading-tight hover:bg-white/5 transition-colors border-l-2"
					:class="activeTab === tab.id
						? 'bg-white/10 text-accent border-accent'
						: 'text-white/50 hover:text-white/70 border-transparent'"
					@click="activeTab = tab.id"
				>
					<span class="text-sm leading-none">{{ tab.icon }}</span>
					<span class="truncate w-full text-center mt-0.5">{{ tab.label }}</span>
				</button>
			</nav>

			<!-- Content area -->
			<div class="flex flex-col flex-1 min-w-0 min-h-0">

				<!-- Contacts ───────────────────────────────────────── -->
				<template v-if="activeTab === 'contacts'">
					<div class="flex-1 flex items-center justify-center text-white/30 text-xs italic select-none">
						Contacts — coming soon
					</div>
				</template>

				<!-- Nearby Chat ─────────────────────────────────────── -->
				<template v-else-if="activeTab === 'nearby'">
					<div
						ref="msgEl"
						class="flex-1 overflow-y-auto px-2.5 py-1.5 flex flex-col-reverse gap-0.5 min-h-0"
					>
						<div
							v-for="m in [...messages].reverse().slice(0, 60)"
							:key="m.id"
							:class="['text-xs leading-snug', TYPE_CLASS[m.chatType] ?? 'text-t1']"
						>
							<span class="text-accent font-medium">{{ m.fromName }}:</span>
							{{ m.message }}
						</div>
						<div v-if="!messages.length" class="text-white/30 text-xs italic">
							No messages yet.
						</div>
					</div>
					<form
						class="flex gap-1.5 px-2 py-1.5 border-t border-brd shrink-0"
						@submit.prevent="submitChat"
					>
						<input
							v-model="chatInput"
							type="text"
							placeholder="Say something… (Enter)"
							class="flex-1 bg-white/10 border border-white/20 text-t1 placeholder-white/30 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
							maxlength="1023"
						/>
						<button
							type="submit"
							class="px-2 py-0.5 bg-accent text-white rounded text-xs hover:opacity-80 shrink-0"
						>Send</button>
					</form>
				</template>

				<!-- IM tab (per avatar) ──────────────────────────────── -->
				<template v-else>
					<div class="flex-1 flex items-center justify-center text-white/30 text-xs italic select-none">
						IM session — coming soon
					</div>
				</template>

			</div>
		</div>
	</FloaterWindow>
</template>
