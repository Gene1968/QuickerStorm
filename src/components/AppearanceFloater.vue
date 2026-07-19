<script setup>
import { ref, computed, onMounted } from 'vue'
import { useUiStore }     from '@/stores/uiStore'
import { useAvatarStore } from '@/stores/avatarStore'
import { useCurrentOutfit } from '@/composables/useCurrentOutfit'
import FloaterWindow      from '@/components/FloaterWindow.vue'
import {
	WrenchIcon, ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon,
	CogIcon, Trash2Icon, ShoppingBagIcon, FilterIcon, ArrowUpDownIcon, PlusIcon, XIcon,
} from '@lucide/vue'

const ui     = useUiStore()
const avatar = useAvatarStore()

// ── View state ─────────────────────────────────────────────────────────────
// WHY: activeTab lives in uiStore so menu/shortcut entries (Avatar ▸ Now wearing…,
// Outfits / Ctrl+O) can open the floater straight to a chosen tab.
const editMode   = ref(false)
const filterText = ref('')
const expanded   = ref({ body: true, clothing: true, attachments: false })
const showAddMore = ref(false)

// ── Edit mode — local copies so user can undo cleanly ──────────────────────
const editColor     = ref('')
const editSkinTone  = ref('')
const editHairColor = ref('')
const editHairStyle = ref('')

const showCogMenu   = ref(false)

function openEdit() {
	editColor.value     = avatar.color
	editSkinTone.value  = avatar.skinTone
	editHairColor.value = avatar.hairColor
	editHairStyle.value = avatar.hairStyle
	showAddMore.value   = false
	editMode.value      = true
}

function exitEdit() {
	editMode.value = false
}

function undoChanges() {
	// WHY: restore local edit state to current saved values — user can continue editing or exit
	editColor.value     = avatar.color
	editSkinTone.value  = avatar.skinTone
	editHairColor.value = avatar.hairColor
	editHairStyle.value = avatar.hairStyle
}

async function saveOutfit() {
	avatar.color     = editColor.value
	avatar.skinTone  = editSkinTone.value
	avatar.hairColor = editHairColor.value
	avatar.hairStyle = editHairStyle.value
	await avatar.save()
	exitEdit()
}

// ── Wearing tab data — real COF read (bundle 7·A) ──────────────────────────
// Body parts / clothing / attachments come from the Current Outfit Folder links resolved by
// useCurrentOutfit — replaces the old hardcoded groups faked from the legacy social avatarStore.
const outfit = useCurrentOutfit()
onMounted(() => outfit.refresh())

function toRow(item) {
	return {
		id: item.linkId,
		label: item.name || '(unnamed)',
		detail: outfit.detailFor(item),
		color: null,
		icon: outfit.iconFor(item),
		removable: outfit.canRemove(item),
		raw: item,
	}
}

// 7·B-4: detach an attachment / take off clothing straight from the Wearing tab.
function removeRow(row) {
	if (row.removable) outfit.removeWorn(row.raw)
}

const wearableGroups = computed(() => {
	const q = filterText.value.toLowerCase()
	const groups = [
		{ id: 'body',        label: 'Body Parts',  items: outfit.bodyParts.value.map(toRow) },
		{ id: 'clothing',    label: 'Clothing',    items: outfit.clothing.value.map(toRow) },
		{ id: 'attachments', label: 'Attachments', items: outfit.attachments.value.map(toRow) },
	]
	if (!q) return groups
	return groups.map(g => ({
		...g,
		items: g.items.filter(i =>
			i.label.toLowerCase().includes(q) || i.detail.toLowerCase().includes(q)
		),
	}))
})

const attCount = computed(() => outfit.attachments.value.length)

// ── Gallery placeholder data ───────────────────────────────────────────────
const galleryItems = [
	{ id: 1, name: 'Casual Friday',   color: '#2979ff' },
	{ id: 2, name: 'Business Formal', color: '#7c4dff' },
	{ id: 3, name: 'Weekend Vibes',   color: '#00c853' },
	{ id: 4, name: 'Evening Look',    color: '#ff4081' },
	{ id: 5, name: 'Sporty',          color: '#ff6d00' },
	{ id: 6, name: 'Classic',         color: '#00bcd4' },
]

// ── Outfits list placeholder ───────────────────────────────────────────────
const outfitFolders = [
	{ id: 1, label: 'My Outfits',  count: 6,  open: ref(true)  },
	{ id: 2, label: 'Library',     count: 12, open: ref(false) },
	{ id: 3, label: 'Shopping',    count: 0,  open: ref(false) },
]
</script>

<template>
	<FloaterWindow
		id="appearance"
		title="🪞 Appearance"
		:wrap-style="{ width: '23vw', height: '60vh', minWidth: '18rem', minHeight: '31rem', resize: 'both' }"
		:default-pos="{ left: 'calc(80vw - 23vw)', top: 'calc(100vh - 60vh - 5rem)' }"
		@close="ui.toggleAppearance()"
	>
		<div class="flex flex-col flex-1 min-h-0 text-xs text-fg">

			<!-- ── Current Look header (always visible) ──────────────── -->
			<div class="flex items-center gap-1 p-1.5 ps-0.5 border-b border-edge shrink-0 bg-panel-alt">
				<span class="text-3xl leading-none shrink-0 -mt-2">👕</span>
				<div class="flex flex-col flex-1 min-w-0">
					<span class="text-xs text-fg/50 uppercase tracking-wide leading-none mb-0.5">
						{{ editMode ? 'Now editing…' : 'Now wearing…' }}
					</span>
					<span class="text-sm font-semibold text-fg leading-tight truncate">
						{{ avatar.displayName || 'My Avatar' }}
					</span>
				</div>
				<!-- Wrench / edit toggle -->
				<button
					class="p-1.5 rounded-sm hover:bg-white/10 transition-colors shrink-0"
					:class="editMode ? 'text-accent' : 'text-fg/50 hover:text-fg'"
					:title="editMode ? 'Exit Edit' : 'Edit this outfit'"
					@click="editMode ? exitEdit() : openEdit()"
				>
					<WrenchIcon class="w-5 h-5" />
				</button>
			</div>

			<!-- ══════════════════════════════════════════════════════════ -->
			<!-- NORMAL MODE                                               -->
			<!-- ══════════════════════════════════════════════════════════ -->
			<template v-if="!editMode">

				<!-- Filter toolbar -->
				<div class="flex items-center gap-0.5 px-1.5 py-1 border-b border-edge shrink-0">
					<input
						v-model="filterText"
						type="search"
						placeholder="🔎 Filter Outfits&#8230;"
						class="flex-1 bg-fg/10 rounded-xl w-full me-1 px-2 py-1 text-xs text-fg placeholder-fg/70 focus:outline-hidden focus:ring-1 focus:ring-inset focus:ring-accent"
					/>
					<button class="p-1 rounded-sm hover:bg-white/10 text-fg/50 hover:text-fg shrink-0" title="Options — to-do" disabled>
						<CogIcon class="w-3.5 h-3.5" />
					</button>
					<button class="p-1 rounded-sm hover:bg-white/10 text-fg/50 hover:text-fg shrink-0" title="Sort — to-do" disabled>
						<ArrowUpDownIcon class="w-3.5 h-3.5" />
					</button>
					<button class="p-1 rounded-sm hover:bg-white/10 text-fg/50 hover:text-fg shrink-0" title="Delete Outfit — to-do" disabled>
						<Trash2Icon class="w-3.5 h-3.5" />
					</button>
				</div>

				<!-- Tab bar -->
				<div class="flex shrink-0 border-b border-edge pt-3">
					<button
						v-for="tab in [
							{ id: 'gallery', label: 'Outfit Gallery' },
							{ id: 'outfits', label: 'Outfits' },
							{ id: 'wearing', label: `Wearing (${attCount}/38 Att.)` },
						]"
						:key="tab.id"
						class="flex py-1 px-3 text-xs font-medium border-b-2 transition-colors"
						:class="ui.appearanceActiveTab === tab.id
							? 'border-accent text-accent bg-white/5'
							: 'border-transparent text-fg/50 hover:text-fg hover:border-white/30'"
						@click="ui.appearanceActiveTab = tab.id"
					>
						{{ tab.label }}
					</button>
				</div>

				<!-- Tab content -->
				<div class="flex-1 overflow-y-auto min-h-0">

					<!-- Gallery tab ────────────────────────────────── -->
					<template v-if="ui.appearanceActiveTab === 'gallery'">
						<div class="grid grid-cols-3 gap-1.5 p-2">
							<div
								v-for="item in galleryItems"
								:key="item.id"
								class="flex flex-col items-center gap-1 cursor-pointer group"
								title="Outfit Gallery — to-do"
							>
								<div
									class="w-full aspect-square rounded-sm border-2 border-edge group-hover:border-accent transition-colors"
									:style="{ background: `linear-gradient(135deg, ${item.color}55, ${item.color}22)` }"
								>
									<div class="flex items-center justify-center h-full text-2xl">👕</div>
								</div>
								<span class="text-xs text-fg-muted text-center truncate w-full">{{ item.name }}</span>
							</div>
						</div>
						<div class="px-3 pb-2 text-fg-muted/50 text-xs italic text-center">Outfit Gallery — to-do</div>
					</template>

					<!-- Outfits tab ─────────────────────────────────── -->
					<template v-else-if="ui.appearanceActiveTab === 'outfits'">
						<div class="flex flex-col">
							<div
								v-for="folder in outfitFolders"
								:key="folder.id"
								class="border-b border-edge/50 last:border-0"
							>
								<!-- Folder row -->
								<button
									class="flex items-center gap-1.5 w-full py-0.5 px-2 hover:bg-white/5 transition-colors text-left"
									@click="folder.open.value = !folder.open.value"
								>
									<component
										:is="folder.open.value ? ChevronDownIcon : ChevronRightIcon"
										class="w-3 h-3 text-fg/40 shrink-0"
									/>
									<span class="text-fg font-medium">{{ folder.label }}</span>
									<span class="ml-auto text-fg-muted/50 text-xs">{{ folder.count }}</span>
								</button>
								<!-- Folder contents placeholder -->
								<template v-if="folder.open.value && folder.count > 0">
									<div class="px-4 py-1 text-fg-muted/40 text-sm italic">
										Contents — to-do
									</div>
								</template>
								<template v-else-if="folder.open.value">
									<div class="px-4 py-1 text-fg-muted/30 text-sm italic">Empty</div>
								</template>
							</div>
						</div>
						<div class="px-3 py-2 text-fg-muted/40 text-xs italic text-center">
							Full outfit library — to-do
						</div>
					</template>

					<!-- Wearing tab ─────────────────────────────────── -->
					<template v-else>
						<div
							v-for="group in wearableGroups"
							:key="group.id"
							class="border-b border-edge/40 last:border-0"
						>
							<!-- Group header -->
							<button
								class="flex items-center gap-1.5 w-full py-0.5 px-2 hover:bg-white/5 transition-colors"
								@click="expanded[group.id] = !expanded[group.id]"
							>
								<component
									:is="expanded[group.id] ? ChevronDownIcon : ChevronRightIcon"
									class="w-3 h-3 text-fg/40 shrink-0"
								/>
								<span class="text-fg font-medium text-sm">{{ group.label }}</span>
								<span class="ml-auto text-fg-muted/40 text-xs">{{ group.items.length }}</span>
							</button>
							<!-- Items -->
							<template v-if="expanded[group.id]">
								<div
									v-if="!group.items.length"
									class="px-6 py-1.5 text-fg-muted/40 text-sm italic"
								>
									{{ group.id === 'attachments' ? 'No attachments worn.' : 'None' }}
								</div>
								<div
									v-for="item in group.items"
									:key="item.id"
									class="flex items-center gap-1.5 px-2 py-1 hover:bg-white/5 transition-colors group/row"
								>
									<span class="text-sm leading-none shrink-0">{{ item.icon }}</span>
									<div class="flex flex-col flex-1 min-w-0">
										<span class="text-fg font-medium leading-tight">{{ item.label }}</span>
										<span class="text-fg-muted/60 text-xs leading-tight truncate">{{ item.detail }}</span>
									</div>
									<!-- Color swatch -->
									<div
										v-if="item.color"
										class="w-4 h-4 rounded-sm border border-white/20 shrink-0"
										:style="{ background: item.color }"
										:title="item.color"
									/>
									<!-- Detach / take off (attachments + clothing; body parts only replace) -->
									<button
										v-if="item.removable"
										class="p-0.5 rounded-sm text-fg/30 hover:text-fg hover:bg-white/10 opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0"
										:title="group.id === 'attachments' ? 'Detach from yourself' : 'Take off'"
										@click.stop="removeRow(item)"
									>
										<XIcon class="w-3.5 h-3.5" />
									</button>
								</div>
							</template>
						</div>
					</template>

				</div>

				<!-- Bottom status bar -->
				<div class="relative flex items-center justify-between gap-2 shrink-0 border-t border-edge bg-panel-alt">
					<div class="flex items-center">
						<button class="ui-btn pe-0.5 ps-1" title="Show additional options" @click.stop="showCogMenu = !showCogMenu"><CogIcon class="w-3.5 h-3.5" /><ChevronDownIcon class="w-2.5 h-3.5" /></button>
						<div v-if="showCogMenu" class="absolute bottom-full mb-1 left-0 z-[60] min-w-[11rem] bg-panel border border-edge rounded-sm shadow-lg text-2xs" @click.stop>
							<button class="block w-full text-left px-2 py-1.5 hover:bg-white/10 text-fg disabled:opacity-40" title="(to-do)" disabled>Touch</button>
							<button class="block w-full text-left px-2 py-1.5 hover:bg-white/10 text-fg disabled:opacity-40" title="(to-do)" disabled>Edit</button>
							<button class="block w-full text-left px-2 py-1.5 hover:bg-white/10 text-fg disabled:opacity-40" title="(to-do)" disabled>Take off</button>
							<div class="border-t border-edge"></div>
							<button class="block w-full text-left px-2 py-1.5 hover:bg-white/10 text-fg disabled:opacity-40" title="(to-do)" disabled>Edit outfit</button>
							<button class="block w-full text-left px-2 py-1.5 hover:bg-white/10 text-fg disabled:opacity-40" title="(to-do)" disabled>Copy outfit list to clipboard</button>
						</div>
						<button class="ui-btn px-1" title="Marketplace — (to-do?)" disabled>
							<ShoppingBagIcon class="w-3.5 h-3.5" />
						</button>
					</div>
					<span class="flex-1 text-end text-fg-muted/80 text-xs pe-2">Complexity: ##,### (to-do)</span>
				</div>
				<div class="flex items-center justify-start gap-2 shrink-0 py-1 px-1.5 bg-panel">
					<button class="ui-btn w-20" title="Save (to-do)" :disabled="true">Save</button>
					<button class="ui-btn w-20" title="Save as (to-do)" disabled>Save as</button>
				</div>

			</template>

			<!-- ══════════════════════════════════════════════════════════ -->
			<!-- EDIT MODE                                                 -->
			<!-- ══════════════════════════════════════════════════════════ -->
			<template v-else>

				<!-- Back + title row -->
				<div class="flex items-center gap-1.5 px-2 py-1.5 border-b border-edge shrink-0">
					<button
						class="p-1 rounded-sm hover:bg-white/10 text-fg/60 hover:text-fg transition-colors shrink-0"
						title="Back to outfits"
						@click="exitEdit"
					>
						<ChevronLeftIcon class="w-4 h-4" />
					</button>
					<span class="text-sm font-semibold text-fg">Edit Outfit Parts</span>
				</div>

				<!-- Editable wearables list -->
				<div class="flex-1 overflow-y-auto min-h-0">

					<!-- Body Parts -->
					<div class="border-b border-edge/40">
						<button
							class="flex items-center gap-1.5 w-full py-0.5 px-2 hover:bg-white/5 transition-colors"
							@click="expanded.body = !expanded.body"
						>
							<component :is="expanded.body ? ChevronDownIcon : ChevronRightIcon" class="w-3 h-3 text-fg/40 shrink-0" />
							<span class="text-fg font-medium text-sm">Body Parts</span>
						</button>
						<template v-if="expanded.body">
							<!-- Shape (read-only) -->
							<div class="flex items-center gap-2 px-4 py-1.5">
								<span class="text-sm shrink-0">🧍</span>
								<div class="flex flex-col flex-1 min-w-0">
									<span class="text-fg font-medium leading-tight">Shape</span>
									<span class="text-fg-muted/50 text-xs">Classic Avatar — to-do</span>
								</div>
							</div>
							<!-- Skin -->
							<div class="flex items-center gap-2 px-4 py-1.5">
								<span class="text-sm shrink-0">🫀</span>
								<div class="flex flex-col flex-1 min-w-0">
									<span class="text-fg font-medium leading-tight">Skin Tone</span>
								</div>
								<input
									v-model="editSkinTone"
									type="color"
									class="w-7 h-6 rounded-sm border border-edge cursor-pointer bg-transparent"
									title="Skin tone color"
								/>
							</div>
							<!-- Hair -->
							<div class="flex items-center gap-2 px-4 py-1.5">
								<span class="text-sm shrink-0">💇</span>
								<div class="flex flex-col flex-1 min-w-0">
									<span class="text-fg font-medium leading-tight">Hair</span>
									<select
										v-model="editHairStyle"
										class="bg-panel-alt border border-edge text-fg rounded-sm px-1 py-0.5 text-xs mt-0.5 focus:outline-hidden focus:ring-1 focus:ring-accent"
									>
										<option value="none">None</option>
										<option value="short">Short</option>
										<option value="medium">Medium</option>
										<option value="long">Long</option>
									</select>
								</div>
								<input
									v-model="editHairColor"
									type="color"
									class="w-7 h-6 rounded-sm border border-edge cursor-pointer bg-transparent"
									title="Hair color"
								/>
							</div>
							<!-- Eyes (read-only) -->
							<div class="flex items-center gap-2 px-4 py-1.5 opacity-50">
								<span class="text-sm shrink-0">👁</span>
								<div class="flex flex-col flex-1 min-w-0">
									<span class="text-fg font-medium leading-tight">Eyes</span>
									<span class="text-fg-muted/50 text-xs">Default — to-do</span>
								</div>
							</div>
						</template>
					</div>

					<!-- Clothing -->
					<div class="border-b border-edge/40">
						<button
							class="flex items-center gap-1.5 w-full py-0.5 px-2 hover:bg-white/5 transition-colors"
							@click="expanded.clothing = !expanded.clothing"
						>
							<component :is="expanded.clothing ? ChevronDownIcon : ChevronRightIcon" class="w-3 h-3 text-fg/40 shrink-0" />
							<span class="text-fg font-medium text-sm">Clothing</span>
						</button>
						<template v-if="expanded.clothing">
							<!-- Outfit color -->
							<div class="flex items-center gap-2 px-4 py-1.5">
								<span class="text-sm shrink-0">👕</span>
								<div class="flex flex-col flex-1 min-w-0">
									<span class="text-fg font-medium leading-tight">Outfit Color</span>
									<span class="text-fg-muted/50 text-xs">Primary / accent color</span>
								</div>
								<input
									v-model="editColor"
									type="color"
									class="w-7 h-6 rounded-sm border border-edge cursor-pointer bg-transparent"
									title="Outfit primary color"
								/>
							</div>
						</template>
					</div>

					<!-- Attachments -->
					<div class="border-b border-edge/40">
						<button
							class="flex items-center gap-1.5 w-full py-0.5 px-2 hover:bg-white/5 transition-colors"
							@click="expanded.attachments = !expanded.attachments"
						>
							<component :is="expanded.attachments ? ChevronDownIcon : ChevronRightIcon" class="w-3 h-3 text-fg/40 shrink-0" />
							<span class="text-fg font-medium text-sm">Attachments</span>
							<span class="ml-auto text-fg-muted/40 text-xs">0</span>
						</button>
						<template v-if="expanded.attachments">
							<div class="px-6 py-2 text-fg-muted/40 text-sm italic">No attachments worn.</div>
						</template>
					</div>

					<!-- Add More (stub expand) -->
					<div class="px-3 py-2 border-b border-edge/40">
						<button
							class="flex items-center gap-1.5 px-2 py-1 border border-edge rounded-sm text-fg-muted hover:bg-white/5 hover:text-fg transition-colors text-sm"
							title="Browse inventory to add wearables — to-do"
							@click="showAddMore = !showAddMore"
						>
							<PlusIcon class="w-3 h-3" />
							Add More…
						</button>
						<div v-if="showAddMore" class="mt-2 px-1 py-3 bg-panel-alt border border-edge rounded-sm text-center text-fg-muted/40 text-sm italic">
							Inventory browser — to-do
						</div>
					</div>

				</div>

				<!-- Bottom bar: gear + complexity + shop -->
				<div class="flex items-center px-2 py-1.5 border-t border-edge shrink-0 bg-panel-alt gap-1">
					<button class="p-1 rounded-sm hover:bg-white/10 text-fg/40" title="Options — to-do" disabled>
						<CogIcon class="w-3.5 h-3.5" />
					</button>
					<span class="flex-1 text-fg-muted/40 text-xs text-center">Complexity: — (to-do)</span>
					<button class="p-1 rounded-sm hover:bg-white/10 text-fg/40" title="Marketplace — to-do" disabled>
						<ShoppingBagIcon class="w-3.5 h-3.5" />
					</button>
				</div>

				<!-- Save / Save As… / Undo Changes -->
				<div class="flex gap-1 px-2 py-1.5 border-t border-edge shrink-0">
					<button
						class="flex-1 py-1.5 bg-accent text-white rounded-sm text-xs font-semibold hover:opacity-80 transition-opacity"
						@click="saveOutfit"
					>Save</button>
					<button
						class="flex-1 py-1.5 bg-panel-alt border border-edge text-fg-muted rounded-sm text-xs hover:bg-white/5 transition-colors opacity-50 cursor-not-allowed"
						disabled title="Save As — to-do"
					>Save As…</button>
					<button
						class="flex-1 py-1.5 bg-panel-alt border border-edge text-fg rounded-sm text-xs hover:bg-white/5 transition-colors"
						@click="undoChanges"
					>Undo Changes</button>
				</div>

			</template>

		</div>
	</FloaterWindow>
</template>
