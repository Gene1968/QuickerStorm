<script setup>
/**
 * StandStopFlying — FS LLPanelStandStopFlying (llmoveview.cpp:569-589 setStandStopFlyingMode):
 * a standalone always-available panel, NOT part of the Movement floater. FS anchors it
 * bottom-center above the chat bar (panel_toolbar_view.xml:156-195 chat_bar_stand_fly_stack;
 * FS:Zi pinned it to a fixed spot). One mode at a time: Stand wins while seated (object OR
 * ground sit — LLVOAvatar::sitDown fires for both, llvoavatar.cpp:8961-8967/7076/9045), and
 * Stop Flying re-asserts after standing if still flying (llmoveview.cpp:256-260, EXT-871).
 *
 * Stand → qs:stand-up (useWorldEngine.standUp → one-shot AGENT_CONTROL_STAND_UP).
 * Stop Flying → qs:toggle-fly {fly:false} (same engine path as the F key / MenuBar).
 */
import { computed } from 'vue'
import { useUiStore } from '@/stores/uiStore.js'

const ui = useUiStore()

const mode = computed(() => (ui.isSitting ? 'stand' : ui.flying ? 'stopfly' : null))

function stand()      { window.dispatchEvent(new CustomEvent('qs:stand-up')) }
function stopFlying() { window.dispatchEvent(new CustomEvent('qs:toggle-fly', { detail: { fly: false } })) }
</script>

<template>
	<div
		v-if="mode"
		class="fixed left-1/2 bottom-[2.5rem] z-40 pointer-events-auto"
	>
		<button
			v-if="mode === 'stand'"
			class="custom px-4 py-0.5 rounded-md border border-edge/70 bg-panel-alt/90 text-fg text-sm shadow-md backdrop-blur-sm hover:bg-accent-dark hover:text-white hover:border-accent transition-colors"
			title="Stand up from your current seat"
			@click="stand"
		>Stand</button>
		<button
			v-else
			class="custom px-2 py-0.5 rounded-md border border-edge/70 bg-panel-alt/90 text-fg text-sm shadow-md backdrop-blur-sm hover:bg-accent-dark hover:text-white hover:border-accent transition-colors"
			title="Stop flying"
			@click="stopFlying"
		>Stop Flying</button>
	</div>
</template>
