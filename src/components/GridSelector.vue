<script setup>
import { ref } from 'vue'
import { useGridStore } from '@/stores/gridStore'
import AddGridModal from './AddGridModal.vue'

const store	 = useGridStore()
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
			class="flex-1 w-full px-3 py-2 rounded bg-card2 border border-brd text-t1 focus:outline-none focus:ring-2 focus:ring-accent"
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
			class="px-2 py-2 rounded border border-brd hover:border-red-500 text-t2 hover:text-red-500 transition-colors"
			title="Remove this grid"
			@click="store.removeUserGrid(store.selectedNick)"
		>×</button>

		<!-- Info icon — links to grid's about/login page -->
		<a
			v-else-if="store.selectedGrid?.about || store.selectedGrid?.loginPage"
			:href="store.selectedGrid?.about ?? store.selectedGrid?.loginPage"
			target="_blank"
			rel="noopener noreferrer"
			class="px-2 py-2 rounded border border-brd bg-accent2 text-white hover:opacity-80 transition-colors text-sm"
			title="Grid website"
		>↗</a>
	</div>

	<!-- Grid detail hints (register / forgot password) -->
	<div v-if="store.selectedGrid" class="flex gap-3 justify-end mt-1 pe-12 text-xs text-t1">
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
