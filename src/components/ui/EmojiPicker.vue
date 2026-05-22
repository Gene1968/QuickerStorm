<script setup>
/**
 * EmojiPicker — lightweight popover for inserting emoji into a message.
 *
 * Curated common-set keyed by category. No external library; a future
 * upgrade to emoji-mart or unicode CLDR can drop in behind the same API.
 *
 * Props: anchor element ref (positions popover next to it).
 * Emits: select(emoji), close.
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'

const props = defineProps({
	anchor: { type: Object, default: null }, // HTMLElement or ref-wrapped element
})
const emit = defineEmits(['select', 'close'])

const root = ref(null)
const top = ref(0)
const left = ref(0)

const CATEGORIES = [
	{ name: 'Smileys', items: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🥳','😎','🤓','🧐'] },
	{ name: 'People', items: ['👋','🤚','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🙏','💪','🫶','🦾'] },
	{ name: 'Nature', items: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆','🦉','🦄','🐝','🐛','🦋','🐌','🐞','🐢','🐍','🦖','🐙','🦑','🦀','🐳','🐬','🐠','🐟','🐊','🌲','🌳','🌵','🌴','🌷','🌹','🌻','🌸','🍀','🍁','🍂','☀️','🌤️','⛅','🌧️','⛈️','🌪️','🌈','⭐','🌙'] },
	{ name: 'Food',   items: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍒','🍑','🥭','🍍','🥝','🍅','🥑','🍆','🌽','🥕','🥒','🥦','🍄','🥖','🍞','🧀','🥩','🍗','🍔','🍟','🍕','🌭','🌮','🌯','🥪','🍳','🍝','🍜','🍣','🍤','🍱','🥟','🍚','🍰','🎂','🍩','🍪','🍫','🍬','🍿','🧂','☕','🍵','🍺','🍷','🥂','🥤','🧋'] },
	{ name: 'Activity', items: ['⚽','🏀','🏈','⚾','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🥊','🥋','⛳','⛸️','🎣','🎽','🎿','🛷','🥌','🎯','🪁','🎮','🕹️','🎲','🎰','🧩'] },
	{ name: 'Travel', items: ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🚲','🛵','🏍️','🛺','🚨','🚔','🚍','🚘','✈️','🛫','🛬','🛩️','💺','🚀','🛸','🚁','🛶','⛵','🚤','⛴️','🛥️','🚢','⚓','⛽','🗺️','🗽','🗼','🏰','🏯','🏟️','🎡','🎢','🎠','⛲','⛱️'] },
	{ name: 'Objects', items: ['💎','🔔','🎵','🎶','📱','💻','⌨️','🖥️','🖨️','📷','📹','🎥','🎙️','🎚️','🎛️','📺','📻','⏰','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯️','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','🧾','💼','📁','📂','📅','📆','📇','📈','📉','📊','📋','📌','📍','📎','🖇️','📏','📐','✂️','🗂️','📦','✉️','📧','📨','📩','📪','📫','📬','📭','📮','🗳️','✏️','🖊️','🖋️','📝','📚','📖','🔖','🏷️','🗞️','📰','📓','📔','📒','📕','📗','📘','📙','🔍','🔎','🔬','🔭'] },
	{ name: 'Symbols', items: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','💯','✔️','✅','❌','⭕','❗','❓','❕','❔','‼️','⁉️','🔥','✨','🎉','🎊','💫','⚡','💥','🔔','🚀','👀','💭','💬'] },
]

const RECENT_KEY = 'QuickerStorm:emoji:recent'
const recents = ref([])

function loadRecents () {
	try {
		const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
		recents.value = Array.isArray(raw) ? raw.slice(0, 24) : []
	} catch { recents.value = [] }
}

function saveRecent (emoji) {
	const next = [emoji, ...recents.value.filter(e => e !== emoji)].slice(0, 24)
	recents.value = next
	try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* full storage */ }
}

function pick (emoji) {
	saveRecent(emoji)
	emit('select', emoji)
}

function position () {
	const a = props.anchor?.value || props.anchor
	if (!a || !root.value) return
	const r = a.getBoundingClientRect()
	const popH = 320
	const popW = 320
	let t = r.top - popH - 8
	if (t < 8) t = r.bottom + 8
	let l = r.right - popW
	if (l < 8) l = 8
	if (l + popW > window.innerWidth - 8) l = window.innerWidth - popW - 8
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
	loadRecents()
	await nextTick()
	position()
	document.addEventListener('mousedown', onDocumentClick)
	document.addEventListener('keydown', onKey)
	window.addEventListener('resize', position)
})

onBeforeUnmount(() => {
	document.removeEventListener('mousedown', onDocumentClick)
	document.removeEventListener('keydown', onKey)
	window.removeEventListener('resize', position)
})

const sections = computed(() => {
	const out = []
	if (recents.value.length) out.push({ name: 'Recent', items: recents.value })
	for (const c of CATEGORIES) out.push(c)
	return out
})
</script>

<template>
	<Teleport to="body">
		<div
			ref="root"
			class="ep-popover"
			:style="{ top: `${top}px`, left: `${left}px` }"
			role="dialog"
			aria-label="Emoji picker"
		>
			<div class="ep-scroll">
				<template v-for="sec in sections" :key="sec.name">
					<div class="ep-section-title">{{ sec.name }}</div>
					<div class="ep-grid">
						<button
							v-for="(e, i) in sec.items"
							:key="`${sec.name}-${i}`"
							class="ep-cell"
							@click="pick(e)"
							:title="e"
						>{{ e }}</button>
					</div>
				</template>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
.ep-popover {
	position: fixed;
	width: 20rem;
	height: 20rem;
	background: var(--color-card);
	border: 0.0625rem solid var(--color-brd2);
	border-radius: 0.625rem;
	box-shadow: 0 0.625rem 1.875rem rgba(0, 0, 0, 0.35);
	z-index: 1200;
	overflow: hidden;
	display: flex;
	flex-direction: column;
}

.ep-scroll {
	flex: 1;
	overflow-y: auto;
	padding: 0.5rem;
}

.ep-section-title {
	font-size: 0.6875rem;
	font-weight: 700;
	color: var(--color-t2);
	text-transform: uppercase;
	letter-spacing: 0.04em;
	padding: 0.375rem 0.25rem 0.25rem;
	position: sticky;
	top: 0;
	background: var(--color-card);
}

.ep-grid {
	display: grid;
	grid-template-columns: repeat(8, 1fr);
	gap: 0.125rem;
}

.ep-cell {
	background: transparent;
	border: 0;
	border-radius: 0.375rem;
	padding: 0.25rem;
	font-size: 1.25rem;
	cursor: pointer;
	line-height: 1;
	aspect-ratio: 1 / 1;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: background 0.1s;
}

.ep-cell:hover {
	background: var(--color-card2);
}

.ep-cell:active {
	transform: scale(0.92);
}
</style>
