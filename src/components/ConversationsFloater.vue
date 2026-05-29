<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import { useLocalChat }  from '@/composables/useLocalChat'
import { useInstantMessage } from '@/composables/useInstantMessage'
import { useAvatarStore } from '@/stores/avatarStore'
import { useUiStore }     from '@/stores/uiStore'
import { playSound } from '@/composables/useAudio'
import { ChevronDownIcon, XIcon } from '@lucide/vue'
import FloaterWindow      from '@/components/FloaterWindow.vue'
import 'emoji-picker-element'

const avatar = useAvatarStore()
const ui     = useUiStore()
const { messages, send } = useLocalChat()
const im     = useInstantMessage()

const activeTab  = ref('nearby')
const chatInput  = ref('')
const imInput    = ref('')
const msgEl      = ref(null)
const imLogEl    = ref(null)
const inputEl    = ref(null)
const imInputEl  = ref(null)
const showEmoji  = ref(false)

// WHY: tabs derived from active IM conversations + fixed nearby/contacts.
// im.activeId switching is mirrored to activeTab so right-click → "IM" focuses correctly.
const tabs = computed(() => [
	{ id: 'contacts', label: 'Contacts', icon: '👥' },
	{ id: 'nearby',   label: 'Nearby Chat',   icon: '📡' },
	...[...im.conversations.value.values()].map(c => ({
		id: c.agentId, label: c.agentName, icon: '💬', closable: true,
	})),
])

const activeConv = computed(() => im.conversations.value.get(activeTab.value) ?? null)

watch(() => im.activeId.value, (id) => { if (id) activeTab.value = id })

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
	im.setActive(id?.includes('-') ? id : null)
	await nextTick()
	if (id === 'nearby') inputEl.value?.focus()
	else if (activeConv.value) imInputEl.value?.focus()
}

function closeImTab(id, e) {
	e?.stopPropagation()
	im.close(id)
	if (activeTab.value === id) activeTab.value = 'nearby'
}

async function submitIM() {
	const text = imInput.value.trim()
	if (!text || !activeConv.value) return
	im.send(activeConv.value.agentId, text)
	imInput.value = ''
	await nextTick()
	if (imLogEl.value) imLogEl.value.scrollTop = 0
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
	const emoji   = e.detail.unicode
	const isNearby = activeTab.value === 'nearby'
	const el      = isNearby ? inputEl.value : imInputEl.value
	if (el) {
		const model = isNearby ? chatInput : imInput
		const start = el.selectionStart ?? model.value.length
		const end   = el.selectionEnd   ?? model.value.length
		model.value = model.value.slice(0, start) + emoji + model.value.slice(end)
		nextTick(() => {
			const pos = start + [...emoji].length  // WHY: emoji may be multi-codepoint
			el.setSelectionRange(pos, pos)
			el.focus()
		})
	} else {
		const model = isNearby ? chatInput : imInput
		model.value += emoji
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
			<nav class="vtabs w-[9rem]">
				<div
					v-for="tab in tabs"
					:key="tab.id"
					class="relative group"
				>
					<button
						:class="activeTab === tab.id
							? 'active'
							: ''"
						@click="selectTab(tab.id)"
					>
						<span class="-mt-0.5 text-base leading-none">{{ tab.icon }}</span>
						<span class="w-full text-start leading-none truncate">{{ tab.label }}</span>
					</button>
					<button
						v-if="tab.closable"
						class="absolute top-0.5 right-0.5 opacity-0 hover:opacity-100 text-gray-400 hover:text-gray-900"
						title="Close conversation"
						@click="closeImTab(tab.id, $event)"
					>
						<XIcon class="w-3 h-3" />
					</button>
				</div>
			</nav>

			<!-- Content area -->
			<div class="flex flex-col flex-1 min-w-0 min-h-0">

				<!-- Contacts ───────────────────────────────────────── -->
				<template v-if="activeTab === 'contacts'">
					<div class="flex-1 flex items-center justify-center text-gray-200 text-xs italic select-none">
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
						<div v-if="!messages.length" class="py-4 text-gray-200 text-xs italic">
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
								class="flex items-center px-2 py-1 bg-accent2 text-white rounded text-base hover:opacity-80"
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
							class="hidden px-2 py-1 bg-accent text-white rounded text-xs hover:opacity-80 shrink-0"
						>Send</button>
					</form>
				</template>

				<!-- IM tab (per avatar) ──────────────────────────────── -->
				<template v-else-if="activeConv">
					<div
						ref="imLogEl"
						class="flex-1 overflow-y-auto px-2.5 py-1.5 flex flex-col-reverse gap-0.5 min-h-0 cursor-text"
						@click="imInputEl?.focus()"
					>
						<div
							v-for="(m, i) in [...activeConv.messages].reverse().slice(0, 200)"
							:key="i"
							class="text-xs leading-snug text-t1"
						>
							<span class="text-accent font-medium">{{ m.from }}:</span>
							{{ m.text }}
						</div>
						<div v-if="!activeConv.messages.length" class="py-4 text-gray-200 text-xs italic">
							No messages yet — say hello.
						</div>
					</div>
					<form
						class="flex gap-1.5 px-2 py-1.5 border-t border-brd shrink-0"
						@submit.prevent="submitIM"
					>
						<input
							ref="imInputEl"
							v-model="imInput"
							type="text"
							:placeholder="`To ${activeConv.agentName}`"
							class="flex-1 bg-white/10 border border-t1 text-t1 placeholder-white/30 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
							maxlength="1023"
						/>
						<div class="relative shrink-0">
							<button
								title="Show emoji panel"
								class="flex items-center px-2 py-1 bg-accent2 text-white rounded text-base hover:opacity-80"
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

				<template v-else>
					<div class="flex-1 flex items-center justify-center text-gray-200 text-xs italic select-none">
						Right-click an avatar to start an IM.
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
