<script setup>
/**
 * ReactionTray — Floating button + emoji picker for sending reactions.
 *
 * Closed: small floating button with smiley icon.
 * Open:   horizontal row of emoji buttons; click sends reaction + closes.
 */
import { ref } from 'vue'
import { useReactions, REACTION_EMOJI } from '@/composables/useReactions.js'

const { sendReaction } = useReactions()

const open = ref(false)

function toggle() { open.value = !open.value }

function pick(emoji) {
	sendReaction(emoji)
	open.value = false
}
</script>

<template>
	<div class="reaction-tray" :class="{ open }">
		<div v-if="open" class="rt-grid">
			<button
				v-for="emoji in REACTION_EMOJI"
				:key="emoji"
				class="rt-emoji-btn"
				@click="pick(emoji)"
				:title="`React with ${emoji}`"
			>{{ emoji }}</button>
		</div>
		<button class="rt-toggle" @click="toggle" :title="open ? 'Close' : 'React'">
			<span v-if="!open" class="rt-toggle-icon">😊</span>
			<span v-else class="rt-toggle-icon">✕</span>
		</button>
	</div>
</template>

<style scoped>
.reaction-tray {
	display: flex;
	align-items: center;
	gap: 0.375rem;
}

.rt-toggle {
	display: flex; align-items: center; justify-content: center;
	background: var(--color-card);
	border: 1px solid var(--color-brd);
	border-radius: 50%;
	width: 2.375rem; height: 2.375rem;
	font-size: 1.125rem;
	color: var(--color-t1);
	cursor: pointer;
	transition: background 0.15s, border-color 0.15s;
	box-shadow: 0 0.375rem 1rem rgba(0, 0, 0, 0.18);
}
.rt-toggle:hover { background: var(--color-card2); border-color: var(--color-brd2); }

.rt-toggle-icon { line-height: 1; }

.rt-grid {
	display: grid;
	grid-template-columns: repeat(10, 1fr);
	gap: 0.25rem;
	background: var(--color-card);
	border: 1px solid var(--color-brd);
	border-radius: 1.375rem;
	padding: 0.375rem 0.5rem;
	box-shadow: 0 0.375rem 1rem rgba(0, 0, 0, 0.18);
}

.rt-emoji-btn {
	width: 2rem; height: 2rem;
	border: none;
	background: transparent;
	font-size: 1.125rem;
	cursor: pointer;
	border-radius: 0.5rem;
	display: flex; align-items: center; justify-content: center;
	transition: background 0.1s, transform 0.1s;
	line-height: 1;
}
.rt-emoji-btn:hover { background: var(--color-card2); transform: scale(1.15); }
.rt-emoji-btn:active { transform: scale(0.95); }

@media (max-width: 700px) {
	.rt-grid {
		grid-template-columns: repeat(5, 1fr);
		max-width: 220px;
	}
}
</style>
