<script setup>
// PermCheckbox — FS-style tri-state permission checkbox (PACKAGE B, 2026-07-03).
// Renders one aggregated perm bit: checked / unchecked / indeterminate-faded (mixed or FS
// "tentative" quirk) / disabled-faded (perms unknown or not editable). View-model mapping lives
// in permCheckboxState.js (pure, unit-tested). Emits `toggle(newSet)` — the parent sends
// ObjectPermissions + re-selects; the click stays visible optimistically until the refetched
// ObjectProperties masks flow back through `row.state`.
import { computed, ref, watchEffect } from 'vue'
import { permCheckboxView } from './permCheckboxState.js'

const props = defineProps({
	row:   { type: Object, required: true },  // { state, tentative, canEdit }
	label: { type: String, required: true },
	title: { type: String, default: '' },
})
const emit = defineEmits(['toggle'])

const view = computed(() => permCheckboxView(props.row?.state, {
	tentative: props.row?.tentative,
	canEdit: props.row?.canEdit,
}))

// `indeterminate` is a DOM property, not an attribute — sync it (and checked) whenever the
// sim-derived view changes. Between a user click and the ObjectProperties refetch the DOM keeps
// the optimistic value (view didn't change, so this effect doesn't re-run); if the sim refuses
// AND returns identical masks, the box stays optimistic until the next select — acceptable, the
// edit gate is already owner-only.
const box = ref(null)
watchEffect(() => {
	if (!box.value) return
	box.value.checked = view.value.checked
	box.value.indeterminate = view.value.indeterminate
})
</script>

<template>
	<label
		:title="title"
		class="inline-flex items-center gap-1 select-none"
		:class="[view.faded ? 'opacity-60' : '', view.disabled ? 'cursor-not-allowed' : 'cursor-pointer']"
	>
		<input
			ref="box"
			type="checkbox"
			class="accent-accent shrink-0"
			:checked="view.checked"
			:disabled="view.disabled"
			@change="emit('toggle', $event.target.checked)"
		/>
		<span>{{ label }}</span>
	</label>
</template>
