<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import { useLocalChat }  from '@/composables/useLocalChat'
import { useAvatarStore } from '@/stores/avatarStore'
import { useUiStore }     from '@/stores/uiStore'
import { playSound } from '@/composables/useAudio'
import { ChevronDownIcon } from '@lucide/vue'
import FloaterWindow      from '@/components/FloaterWindow.vue'
import 'emoji-picker-element'

const avatar = useAvatarStore()
const ui     = useUiStore()
const { messages, send } = useLocalChat()

const activeTab  = ref('nearby')
const chatInput  = ref('')
const msgEl      = ref(null)
const inputEl    = ref(null)
const showEmoji  = ref(false)

// TODO: openIMs — populated by incoming IM events; shape: { agentId, agentName, messages[] }
// Switching to a new IM from WorldView should push here + set activeTab = agentId
const openIMs = ref([])

const tabs = computed(() => [
	{ id: 'contacts', label: 'Contacts', icon: '👥' },
	{ id: 'nearby',   label: 'Nearby Chat',   icon: '📡' },
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

function onInput() {
	if (chatInput.value.length === 1) playSound('typing.mp3', 0.3)
}

async function selectTab(id) {
	activeTab.value = id
	if (id === 'nearby') {
		await nextTick()
		inputEl.value?.focus()
	}
}

function focusInput() {
	inputEl.value?.focus()
}

function toggleEmoji(e) {
	e.stopPropagation()
	showEmoji.value = !showEmoji.value
}

function closeEmoji() {
	showEmoji.value = false
}

function onEmojiClick(e) {
	const emoji = e.detail.unicode
	const el    = inputEl.value
	if (el) {
		const start = el.selectionStart ?? chatInput.value.length
		const end   = el.selectionEnd   ?? chatInput.value.length
		chatInput.value = chatInput.value.slice(0, start) + emoji + chatInput.value.slice(end)
		nextTick(() => {
			const pos = start + [...emoji].length  // WHY: emoji may be multi-codepoint
			el.setSelectionRange(pos, pos)
			el.focus()
		})
	} else {
		chatInput.value += emoji
	}
	showEmoji.value = false
}

// Close picker on any outside click
watch(showEmoji, (val) => {
	if (val) setTimeout(() => document.addEventListener('click', closeEmoji, { once: true }), 0)
})

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
		:wrap-style="{ width: '29vw', height: '36vh', resize: 'both' }"
		:default-pos="{ left: '0.125%', top: '7%' }"
		@close="ui.toggleChat()"
	>
		<!-- ── Body: vertical tabs + content ─────────────────────── -->
		<div class="flex flex-1 min-h-0">

			<!-- Vertical tab strip -->
			<nav class="flex flex-col shrink-0 w-[7rem] border-r border-brd overflow-y-auto">
				<button
					v-for="tab in tabs"
					:key="tab.id"
					class="flex flex-col items-center gap-0.5 py-2 px-1 text-xs leading-tight hover:bg-white/5 transition-colors border-l-2"
					:class="activeTab === tab.id
						? 'bg-white/10 text-accent border-accent'
						: 'text-white/50 hover:text-white/70 border-transparent'"
					@click="selectTab(tab.id)"
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
						class="flex-1 overflow-y-auto px-2.5 py-1.5 flex flex-col-reverse gap-0.5 min-h-0 cursor-text"
						@click="focusInput"
					>
						<div
							v-for="m in [...messages].reverse().slice(0, 60)"
							:key="m.id"
							:class="['text-xs leading-snug', TYPE_CLASS[m.chatType] ?? 'text-t1']"
						>
							<span class="text-accent font-medium">{{ m.fromName }}:</span>
							{{ m.message }}
						</div>
						<div v-if="!messages.length" class="py-4 text-white/30 text-xs italic">
							No messages yet.
						</div>
					</div>
					<form
						class="flex gap-1.5 px-2 py-1.5 border-t border-brd shrink-0"
						@submit.prevent="submitChat"
					>
						<input
							ref="inputEl"
							v-model="chatInput"
							type="text"
							placeholder="To nearby chat"
							class="flex-1 bg-white/10 border border-t1 text-t1 placeholder-white/30 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
							maxlength="1023"
							@input="onInput"
						/>
						<div class="relative shrink-0">
							<button
								title="Show emoji panel"
								class="flex items-center px-2 py-0.5 bg-accent text-white rounded text-base hover:opacity-80"
								@click="toggleEmoji"
							>
								<span class="text-base leading-none">🙂</span>
								<ChevronDownIcon class="w-3.5 h-3.5 ml-0.5" />
							</button>
							<div
								v-if="showEmoji"
								class="absolute bottom-full right-0 mb-1 z-50"
								@click.stop
							>
								<emoji-picker class="dark" @emoji-click="onEmojiClick" />
							</div>
						</div>
						<button
							type="submit"
							class="hidden px-2 py-0.5 bg-accent text-white rounded text-xs hover:opacity-80 shrink-0"
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

<style>
/* WHY: emoji-picker-element uses shadow DOM — CSS vars cross the boundary, scoped attrs don't */
emoji-picker {
	--background:               #16161e;
	--border-color:             rgba(255,255,255,0.12);
	--indicator-color:          var(--color-accent, #7c3aed);
	--input-border-color:       rgba(255,255,255,0.2);
	--input-font-color:         #e2e2e2;
	--input-placeholder-color:  rgba(255,255,255,0.35);
	--outline-color:            transparent;
	--category-font-color:      rgba(255,255,255,0.45);
	--emoji-size:               1.35rem;
	--num-columns:              8;
	width:  352px;
	height: 300px;
	border-radius: 0.375rem;
	box-shadow: 0 8px 32px rgba(0,0,0,0.6);
}
</style>
