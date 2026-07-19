<script setup>
import { ref } from 'vue'
import { useGridStore } from '@/stores/gridStore'
import AddGridModal from './AddGridModal.vue'

const store = useGridStore()
const showAdd = ref(false)

function onChange(e) {
	if (e.target.value === '__add__') {
		// Reset to current before opening modal so select doesn't show "__add__"
		e.target.value = store.selectedNick
		showAdd.value	= true
	} else {
		store.selectGrid(e.target.value)
	}
}
</script>

<template>
	<div class="flex flex-row gap-3">
		<select
			class="flex-1 bg-panel-alt border border-edge rounded-sm w-full py-1 px-2 text-fg focus:outline-hidden focus:ring-2 focus:ring-accent"
			:value="store.selectedNick"
			@change="onChange"
		>
			<!-- SL system grids -->
			<optgroup label="Second Life">
				<option v-for="g in store.grids.filter(g => g.system)" :key="g.nick" :value="g.nick">
					{{ g.name }}
				</option>
			</optgroup>

			<!-- OpenSim built-in grids -->
			<optgroup label="OpenSim Grids">
				<option v-for="g in store.grids.filter(g => !g.system && !g.userAdded)" :key="g.nick" :value="g.nick">
					{{ g.name }}
				</option>
			</optgroup>

			<!-- User-added grids -->
			<optgroup v-if="store.grids.some(g => g.userAdded)" label="My Grids">
				<option v-for="g in store.grids.filter(g => g.userAdded)" :key="g.nick" :value="g.nick">
					{{ g.name }}
				</option>
			</optgroup>

			<option value="__add__">+ Add Grid…</option>
		</select>

		<!-- Delete user-added grid -->
		<button
			v-if="store.isUserGrid(store.selectedNick)"
			class="border border-edge hover:border-red-500 rounded-sm py-1 px-2 text-fg-subtle hover:text-red-500 transition-colors"
			title="Remove this grid"
			@click="store.removeUserGrid(store.selectedNick)"
		>×</button>

		<!-- Info icon — links to grid's about/login page -->
		<a
			v-else-if="store.selectedGrid?.about || store.selectedGrid?.loginPage"
			:href="store.selectedGrid?.about ?? store.selectedGrid?.loginPage"
			target="_blank"
			rel="noopener noreferrer"
			class="border border-edge bg-accent rounded-sm py-0 px-2.5 text-xl text-white leading-[2rem] hover:opacity-80 transition-colors"
			title="Visit the grid's website"
		>↗</a>
	</div>

	<!-- Grid detail hints (register / forgot password) -->
	<div v-if="store.selectedGrid" class="flex gap-3 justify-end mt-1 pe-12 text-xs text-fg">
		<a
			v-if="store.selectedGrid.register"
			:href="store.selectedGrid.register"
			target="_blank" rel="noopener noreferrer"
			class="hover:text-accent underline"
		>Register</a>
		<a
			v-if="store.selectedGrid.password"
			:href="store.selectedGrid.password"
			target="_blank" rel="noopener noreferrer"
			class="hover:text-accent underline"
		>Forgot password</a>
	</div>

	<AddGridModal v-if="showAdd" @close="showAdd = false" />
</template>
