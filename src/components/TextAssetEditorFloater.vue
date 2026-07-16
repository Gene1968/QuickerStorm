<script setup>
// TextAssetEditorFloater — view/edit/save a notecard or LSL script from inventory. MULTI-instance,
// keyed by item UUID (mirrors TexturePreviewFloater + FS floater_preview_notecard/_script). Opened by
// double-clicking a notecard/script item (useInventory.openInventoryItem → uiStore.openTextAsset).
// Loads the asset text on mount (useAssetUpload.fetchAssetText), Save uploads it back via the
// Update{Notecard,Script}AgentInventory 2-step cap. Script mode = monospace; no LSL syntax highlight or
// compile feedback in v1 (docs/superpowers/specs/2026-07-15-asset-upload-notecard-script-design.md).
import { ref, computed, watch } from 'vue'
import { useUiStore } from '@/stores/uiStore.js'
import { useInventoryStore } from '@/stores/inventoryStore.js'
import { useAssetUpload } from '@/composables/useAssetUpload.js'
import { useInventory } from '@/composables/useInventory.js'
import { useNotifications } from '@/composables/useNotifications'
import { Trash2Icon } from '@lucide/vue'
import FloaterWindow from '@/components/FloaterWindow.vue'

const props = defineProps({
	// { id, kind, itemId, assetId, name, folderId } from uiStore.textAssetInstances
	instance: { type: Object, required: true },
})

const ui = useUiStore()
const invStore = useInventoryStore()
const { saveAsset, fetchAssetText } = useAssetUpload()
const { trashItem } = useInventory()
const { notifyInfo, notifyError } = useNotifications()

const kind   = computed(() => props.instance?.kind || 'notecard')
// Read the item LIVE from the store so a rename in inventory updates this floater's title (FS parity);
// fall back to the snapshot the instance was opened with if the item isn't in the store.
const storeItem = computed(() => invStore.itemById(props.instance?.itemId))
const name   = computed(() => storeItem.value?.name || props.instance?.name || (kind.value === 'script' ? 'Script' : 'Notecard'))
const desc   = computed(() => storeItem.value?.desc ?? props.instance?.desc ?? '')
const isScript = computed(() => kind.value === 'script')
// UTF-8 byte size of the current text (what actually gets uploaded), mirroring FS's byte counter.
const byteLen = computed(() => new TextEncoder().encode(text.value || '').length)

const text    = ref('')
const loading = ref(false)
const failed  = ref(false)
const saving  = ref(false)
const dirty   = ref(false)

// Load the current asset text once (per item). A brand-new blank item has an empty/near-empty asset.
watch(() => props.instance?.assetId, (assetId) => {
	failed.value = false
	if (!assetId) { text.value = ''; loading.value = false; return }
	loading.value = true
	fetchAssetText({ kind: kind.value, assetId }).then((res) => {
		loading.value = false
		if (res?.error && res.error !== 'no_data') { failed.value = true; return }
		text.value = res?.text || ''
		dirty.value = false
	})
}, { immediate: true })

function onInput() { dirty.value = true }

async function save() {
	if (!props.instance?.itemId) { notifyError('Cannot save', 'This item has no id to save into.'); return }
	saving.value = true
	const res = await saveAsset({ kind: kind.value, itemId: props.instance.itemId, text: text.value })
	saving.value = false
	if (res?.ok) {
		// The sim minted a NEW immutable asset — repoint the item so a reopen fetches the saved bytes,
		// not the stale pre-save asset. (Also lets this floater's own reload show the saved text.)
		if (res.assetId) invStore.setItemAssetId(props.instance.itemId, res.assetId)
		dirty.value = false
		notifyInfo('Saved', `${isScript.value ? 'Script' : 'Notecard'} "${name.value}" saved.`)
	} else {
		notifyError('Save failed', res?.error || 'The grid rejected the upload.')
	}
}

// Ctrl/Cmd+S saves without leaving the textarea (FS notecard/script save shortcut).
function onKeydown(e) {
	if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
		e.preventDefault()
		if (!saving.value && !loading.value && !failed.value) save()
	}
}

// Delete → move the item to Trash (recoverable, like FS) and close the editor.
function del() {
	if (!props.instance?.itemId) return
	trashItem(props.instance.itemId)
	notifyInfo('Deleted', `"${name.value}" moved to Trash.`)
	close()
}

function close() { ui.closeTextAsset(props.instance.id) }
</script>

<template>
	<FloaterWindow
		:id="instance.id"
		:title="(isScript ? 'Script: ' : 'Notecard: ') + name"
		:wrap-style="{ width: '32rem', height: '24rem', resize: 'both' }"
		:default-pos="{ left: 'calc(50vw - 16rem)', top: 'calc(50vh - 12rem)' }"
		@close="close"
	>
		<div class="flex flex-col flex-1 min-h-0 p-2 gap-2">
			<div v-if="desc" class="shrink-0 flex items-center gap-2">
				<div class="text-xs text-t1/70">Description:</div>
				<input type="text" :value="desc" readonly class="border border-edge rounded-sm bg-fg/20 px-1.5 py-0.5 w-full text-sm text-fg read-only:opacity-60" />
			</div>

			<div v-if="loading" class="flex-1 min-h-0 flex items-center justify-center text-2xs italic text-t1/40">
				Loading…
			</div>
			<div v-else-if="failed" class="flex-1 min-h-0 flex items-center justify-center text-2xs italic text-t1/50 px-3 text-center">
				Couldn't load this {{ isScript ? 'script' : 'notecard' }}.
			</div>
			<textarea
				v-else
				v-model="text"
				:class="['flex-1 min-h-0 w-full resize-none rounded-sm border border-edge bg-fg/10 p-2 text-sm text-fg outline-none focus:border-accent', isScript ? 'font-mono' : '']"
				spellcheck="false"
				@input="onInput"
				@keydown="onKeydown"
			></textarea>

			<div class="shrink-0 flex items-center justify-between gap-2 text-2xs text-t1/60">
				<span class="tabular-nums">{{ byteLen }} bytes<span v-if="dirty" class="text-accent"> · unsaved</span></span>
				<div class="flex items-center gap-2">
					<button
						class="qs-btn p-1 rounded-sm text-t1/60 hover:text-red-400 hover:bg-white/10 disabled:opacity-40"
						title="Delete (move to Trash)"
						:disabled="!instance.itemId"
						@click="del"
					>
						<Trash2Icon :size="14" />
					</button>
					<button
						class="qs-btn px-3 py-1 text-sm rounded-sm bg-accent/80 text-white hover:bg-accent disabled:opacity-40"
						:disabled="saving || loading || failed"
						title="Save (Ctrl+S)"
						@click="save"
					>
						{{ saving ? 'Saving…' : 'Save' }}
					</button>
				</div>
			</div>
		</div>
	</FloaterWindow>
</template>
