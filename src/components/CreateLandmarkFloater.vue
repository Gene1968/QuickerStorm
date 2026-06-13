<script setup>
// CreateLandmarkFloater — Firestorm-style "Create Landmark" dialog. Opened from World →
// Landmark This Place and the LocationBar star. Creates a real inventory landmark of the
// current location via CreateInventoryItem (sim builds the LM asset from the avatar's pos).
// Fields: Name, Save-in folder (Favorites + Landmarks tree), Create new folder, My notes.
import { ref, computed, watch } from 'vue'
import { FolderPlusIcon } from '@lucide/vue'
import FloaterWindow from '@/components/FloaterWindow.vue'
import { useUiStore } from '@/stores/uiStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useInventory } from '@/composables/useInventory'
import { useAudio } from '@/composables/useAudio.js'

const ui      = useUiStore()
const session = useSessionStore()
const inv     = useInventoryStore()
const { createLandmark, createFolder } = useInventory()
const { playSound } = useAudio()

// Default name = prefill (region name) the opener passed, else current region.
const name  = ref(ui.createLandmarkPrefill?.name || session.regionName || 'Landmark')
const notes = ref('')

// Folder options recompute as inventory loads (Favorites + Landmarks tree, indented).
const folderOptions = computed(() => inv.landmarkTargetFolders())
// Pre-select from prefill folderId if provided (e.g. opened from Places › Favorites tab).
const selectedFolder = ref(ui.createLandmarkPrefill?.folderId || '')

// Default the selection to the Landmarks folder (or first option) once options appear.
watch(folderOptions, (opts) => {
	if (selectedFolder.value && opts.some(o => o.folderId === selectedFolder.value)) return
	const landmarks = opts.find(o => !o.favorite)   // first non-Favorites = Landmarks root
	selectedFolder.value = (landmarks || opts[0])?.folderId || ''
}, { immediate: true })

const indent = (depth) => '  '.repeat(depth)

// Inline "create new folder" UI
const creatingFolder = ref(false)
const newFolderName  = ref('')

function confirmNewFolder() {
	const nm = newFolderName.value.trim()
	if (!nm || !selectedFolder.value) { creatingFolder.value = false; return }
	// Nest the new folder under the currently-selected target folder, then select it.
	const id = createFolder({ name: nm, parentId: selectedFolder.value })
	if (id) selectedFolder.value = id
	newFolderName.value = ''
	creatingFolder.value = false
	playSound('tick.mp3', 0.6)
}

const canSave = computed(() => name.value.trim().length > 0 && !!selectedFolder.value)

function save() {
	if (!canSave.value) return
	createLandmark({ name: name.value.trim(), desc: notes.value.trim(), folderId: selectedFolder.value })
	playSound('tick.mp3', 0.6)
	ui.showCreateLandmark = false
}
function cancel() { ui.showCreateLandmark = false }
</script>

<template>
	<FloaterWindow
		id="create-landmark"
		title="Create Landmark"
		:wrap-style="{ width: '22rem' }"
		:default-pos="{ left: '50%', top: '38vh', transform: 'translate(-50%, -50%)' }"
		@close="cancel"
	>
		<div class="flex flex-col gap-2 p-3 text-xs text-fg">
			<h5 class="text-fg-subtle text-xl font-semibold">Landmark Details</h5>

			<label class="flex flex-col gap-1 mb-2">
				<span class="text-fg-subtle">Name:</span>
				<input
					v-model="name"
					type="text"
					class="qs-input px-2 py-1 rounded-sm bg-panel border border-edge text-fg"
					@keydown.enter.prevent="save"
				/>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-fg-subtle">Save this landmark in:</span>
				<select v-model="selectedFolder" class="qs-input px-2 py-1 rounded-sm bg-panel border border-edge text-fg">
					<option v-if="!folderOptions.length" value="">Loading folders…</option>
					<option v-for="o in folderOptions" :key="o.folderId" :value="o.folderId">
						{{ indent(o.depth) }}{{ o.favorite ? '★ ' : '' }}{{ o.name }}
					</option>
				</select>
			</label>

			<div v-if="!creatingFolder">
				<button class="qs-btn inline-flex items-center gap-2 -mt-2 mb-2 px-2 py-1 text-accent hover:underline" @click="creatingFolder = true">
					<FolderPlusIcon class="w-3.5 h-3.5" /> Create new folder…
				</button>
			</div>
			<div v-else class="flex items-center gap-1">
				<input
					v-model="newFolderName"
					type="text"
					placeholder="New folder name"
					class="qs-input flex-1 px-2 py-1 rounded-sm bg-panel border border-edge text-fg"
					@keydown.enter.prevent="confirmNewFolder"
					@keydown.esc.prevent="creatingFolder = false"
				/>
				<button class="qs-btn px-2 py-1 rounded-sm bg-accent text-white" @click="confirmNewFolder">Add</button>
				<button class="qs-btn px-2 py-1 rounded-sm border border-edge" @click="creatingFolder = false">✕</button>
			</div>

			<label class="flex flex-col gap-1">
				<span class="text-fg-subtle">My notes:</span>
				<textarea
					v-model="notes"
					rows="4"
					class="qs-input px-2 py-1 rounded-sm bg-panel border border-edge text-fg resize-none"
				></textarea>
			</label>

			<div class="flex justify-end gap-2 mb-1 pt-1">
				<button class="qs-btn px-3 py-1 rounded-sm border border-edge hover:bg-white/10" @click="cancel">Cancel</button>
				<button
					class="qs-btn px-3 py-1 rounded-sm bg-accent text-white disabled:opacity-40"
					:disabled="!canSave"
					@click="save"
				>OK</button>
			</div>
		</div>
	</FloaterWindow>
</template>
