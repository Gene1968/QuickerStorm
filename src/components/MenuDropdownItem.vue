<script setup>
/**
 * MenuDropdownItem — one row inside a MenuBar dropdown. Recursive: an item with a
 * `submenu` renders a nested flyout whose children are MenuDropdownItem again, so
 * the FS menu tree (up to 3 levels: Avatar ▸ Take Off ▸ Clothes ▸ Shirt) works
 * with no per-level markup.
 *
 * item: { label, kbd?, action?, disabled?, sep?, submenu?, title?, checked? }
 *   sep      → divider
 *   submenu  → Item[] (hover to open, CSS-only flyout)
 *   checked  → () => bool; renders a ✓ in a reserved column when true
 *   title    → native tooltip (use for items whose effect isn't obvious)
 */
import { computed } from 'vue'
import { playSound } from '@/composables/useAudio'

const props = defineProps({
	item: { type: Object, required: true },
})

// disabled may be a boolean (static) OR a () => bool (reactive, like `checked`) so an item can
// enable/disable off live state (e.g. "Delete" only when an object is selected). Backward-compatible.
const isDisabled = computed(() =>
	typeof props.item.disabled === 'function' ? props.item.disabled() : props.item.disabled,
)
</script>

<template>
	<div v-if="item.sep" class="mb-sep" />

	<!-- Submenu parent (hover reveals nested flyout) -->
	<div v-else-if="item.submenu" class="mb-sub-wrap">
		<button
			class="mb-item mb-item--has-sub"
			:class="{ 'mb-item--disabled': isDisabled }"
			:disabled="isDisabled"
			:title="item.title"
			@click="playSound('tick.mp3', 0.6)"
		>
			<span class="mb-item-label">
				<span v-if="item.checked" class="mb-item-check">{{ item.checked() ? '✓' : '' }}</span>{{ item.label }}
			</span>
			<span class="mb-item-arrow">›</span>
		</button>
		<div class="mb-submenu">
			<MenuDropdownItem
				v-for="(sub, j) in item.submenu"
				:key="j"
				:item="sub"
			/>
		</div>
	</div>

	<!-- Leaf item -->
	<button
		v-else
		class="mb-item"
		:class="{ 'mb-item--disabled': isDisabled }"
		:disabled="isDisabled"
		:title="item.title"
		@click="playSound('tick.mp3', 0.6); !isDisabled && item.action && item.action()"
	>
		<span class="mb-item-label">
			<span v-if="item.checked" class="mb-item-check">{{ item.checked() ? '✓' : '' }}</span>{{ item.label }}
		</span>
		<span v-if="item.kbd" class="mb-item-kbd">{{ item.kbd }}</span>
	</button>
</template>

<style scoped>
/* ── Item ────────────────────────────────────────────────────────────────── */
.mb-item {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1.5rem;
	border: none;
	background: none;
	padding: 0.1875rem 0.65rem 0.1875rem 1.4rem;
	width: 100%;
	font-size: 0.75rem;
	color: rgba(255, 255, 255, 0.85);
	cursor: pointer;
	text-align: left;
	line-height: 1.5;
	transition: background 0.08s;
}

.mb-item:hover:not(.mb-item--disabled) {
	background: rgba(255, 255, 255, 0.1);
	color: #fff;
}

.mb-item--disabled {
	opacity: 0.35;
	cursor: not-allowed;
}

.mb-item-label { flex: 1; white-space: nowrap; }

/* Reserve a fixed check column so toggling on/off doesn't shift the label. */
.mb-item-check {
	display: inline-block;
	width: 1.1em;
	margin-left: -1rem;
	margin-right: 0.2rem;
	color: var(--accent, #6cf);
	font-weight: 700;
}

.mb-item-kbd {
	font-size: 0.625rem;
	color: var(--fg-muted, #6cf);
	font-family: monospace;
	white-space: nowrap;
	flex-shrink: 0;
}

/* ── Nested submenu ──────────────────────────────────────────────────────── */
/* WHY: Pure CSS hover — no extra Vue state. mb-sub-wrap is position:relative so
   mb-submenu anchors to its right edge. Sibling hover keeps the flyout open while
   moving the mouse rightward into it. Recursion gives each level its own flyout. */
.mb-sub-wrap {
	position: relative;
}

.mb-item--has-sub {
	cursor: default;
}

.mb-item-arrow {
	font-size: 0.75rem;
	color: rgba(255, 255, 255, 0.4);
	flex-shrink: 0;
	line-height: 1;
}

.mb-submenu {
	display: none;
	position: absolute;
	top: 0;
	left: 100%;
	min-width: 13rem;
	background: rgba(14, 18, 28, 0.97);
	border: 1px solid rgba(255, 255, 255, 0.12);
	border-radius: 0 0.375rem 0.375rem 0.375rem;
	box-shadow: 4px 8px 24px rgba(0, 0, 0, 0.6);
	padding: 0.25rem 0;
	z-index: 801;
	flex-direction: column;
}

.mb-sub-wrap:hover > .mb-submenu {
	display: flex;
}

/* ── Separator ───────────────────────────────────────────────────────────── */
.mb-sep {
	height: 1px;
	background: rgba(255, 255, 255, 0.1);
	margin: 0.2rem 0;
}
</style>
