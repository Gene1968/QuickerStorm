<script setup>
/**
 * ContextMenuItem — one row inside a right-click context menu (Object / Avatar /
 * Inventory). Recursive: an item with a `submenu` renders a nested flyout whose
 * children are ContextMenuItem again, so FS's nested context menus work with no
 * per-level markup.
 *
 * Themed (bg-panel / text-fg / border-edge) so it tracks the app's light/dark
 * toggle — unlike the always-dark <MenuDropdownItem> used by the top MenuBar.
 *
 * item: { label, action?, disabled?, sep?, submenu?, title?, checked?, danger?, kbd? }
 *   sep      → divider
 *   submenu  → Item[] (hover to open, CSS-only flyout)
 *   checked  → () => bool; renders a ✓ in a reserved column when true
 *   danger   → () => bool | bool; renders the row in the danger colour (e.g. armed Delete)
 *   disabled → greyed; no backing yet / not valid for this target
 *   title    → native tooltip
 */
import { computed } from 'vue'
import { playSound } from '@/composables/useAudio'

const props = defineProps({
	item: { type: Object, required: true },
})

const isDanger = computed(() => {
	const d = props.item.danger
	return typeof d === 'function' ? d() : !!d
})
function onClick() {
	if (props.item.disabled) return
	playSound('tick.mp3', 0.6)
	props.item.action && props.item.action()
}
</script>

<template>
	<div v-if="item.sep" class="my-1 border-t border-edge" />

	<!-- Submenu parent (hover reveals nested flyout) -->
	<div v-else-if="item.submenu" class="cmi-sub relative">
		<button
			class="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left hover:bg-white/10"
			:class="{ 'text-fg/40': item.disabled }"
			:title="item.title"
		>
			<span class="truncate">
				<span v-if="item.checked" class="cmi-check">{{ item.checked() ? '✓' : '' }}</span>{{ item.label }}
			</span>
			<span class="text-fg/40">›</span>
		</button>
		<div class="cmi-flyout min-w-[11rem] bg-panel border border-edge rounded-sm shadow-lg">
			<ContextMenuItem v-for="(sub, j) in item.submenu" :key="j" :item="sub" />
		</div>
	</div>

	<!-- Leaf item -->
	<button
		v-else
		class="flex w-full items-center justify-between gap-4 px-3 py-1 text-left"
		:class="[
			item.disabled ? 'text-fg/40 cursor-not-allowed' : 'hover:bg-white/10',
			isDanger ? 'text-red-400 font-medium' : '',
		]"
		:disabled="item.disabled"
		:title="item.title"
		@click="onClick"
	>
		<span class="truncate">
			<span v-if="item.checked" class="cmi-check">{{ item.checked() ? '✓' : '' }}</span>{{ item.label }}
		</span>
		<span v-if="item.kbd" class="text-2xs text-fg/40 font-mono shrink-0">{{ item.kbd }}</span>
	</button>
</template>

<style scoped>
/* Reserve a check column so toggling on/off doesn't shift the label. */
.cmi-check {
	display: inline-block;
	width: 1.1em;
	margin-left: -0.25rem;
	color: var(--color-accent, #6cf);
	font-weight: 700;
}

/* CSS-only flyout: anchor to the row's right edge; reveal on hover of the wrapper. */
.cmi-flyout {
	display: none;
	position: absolute;
	top: 0;
	left: 100%;
	z-index: 1;
	padding: 0.25rem 0;
}
.cmi-sub:hover > .cmi-flyout {
	display: block;
}
</style>
