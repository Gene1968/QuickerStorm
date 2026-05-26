<script setup>
import { ref, computed } from 'vue'
import { useUiStore }     from '@/stores/uiStore'
import { useAvatarStore } from '@/stores/avatarStore'
import FloaterWindow      from '@/components/FloaterWindow.vue'
import {
	WrenchIcon, ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon,
	CogIcon, Trash2Icon, ShoppingBagIcon, FilterIcon, ArrowUpDownIcon, PlusIcon,
} from '@lucide/vue'

const ui     = useUiStore()
const avatar = useAvatarStore()

// ── View state ─────────────────────────────────────────────────────────────
const activeTab  = ref('wearing')    // 'gallery' | 'outfits' | 'wearing'
const editMode   = ref(false)
const filterText = ref('')
const expanded   = ref({ body: true, clothing: true, attachments: false })
const showAddMore = ref(false)

// ── Edit mode — local copies so user can undo cleanly ──────────────────────
const editColor     = ref('')
const editSkinTone  = ref('')
const editHairColor = ref('')
const editHairStyle = ref('')

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

// ── Wearing tab data — built from avatarStore ──────────────────────────────
const wearableGroups = computed(() => {
	const q = filterText.value.toLowerCase()
	const groups = [
		{
			id: 'body',
			label: 'Body Parts',
			items: [
				{ id: 'shape',    label: 'Shape',    detail: 'Classic Avatar',    color: null,              icon: '🧍' },
				{ id: 'skin',     label: 'Skin',     detail: 'Skin Tone',         color: avatar.skinTone,   icon: '🫀' },
				{ id: 'hair',     label: 'Hair',     detail: avatar.hairStyle,    color: avatar.hairColor,  icon: '💇' },
				{ id: 'eyes',     label: 'Eyes',     detail: 'Default',           color: null,              icon: '👁' },
			],
		},
		{
			id: 'clothing',
			label: 'Clothing',
			items: [
				{ id: 'outfit',   label: 'Outfit Color', detail: 'Primary',       color: avatar.color,      icon: '👕' },
			],
		},
		{
			id: 'attachments',
			label: 'Attachments',
			items: [],
		},
	]
	if (!q) return groups
	return groups.map(g => ({
		...g,
		items: g.items.filter(i =>
			i.label.toLowerCase().includes(q) || i.detail.toLowerCase().includes(q)
		),
	}))
})

const totalWorn = computed(() =>
	wearableGroups.value.slice(0, 2).reduce((n, g) => n + g.items.length, 0)
)

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
		:wrap-style="{ width: '23vw', height: '60vh', minWidth: '300px', minHeight: '440px', resize: 'both' }"
		:default-pos="{ right: '20%', bottom: '5rem' }"
		@close="ui.toggleAppearance()"
	>
		<div class="flex flex-col flex-1 min-h-0 text-xs text-t1">

			<!-- ── Current Look header (always visible) ──────────────── -->
			<div class="flex items-center gap-2 px-2.5 py-2 border-b border-brd shrink-0 bg-card2">
				<span class="text-2xl leading-none shrink-0">👕</span>
				<div class="flex flex-col flex-1 min-w-0">
					<span class="text-[10px] text-white/50 uppercase tracking-wide leading-none mb-0.5">
						{{ editMode ? 'Now editing…' : 'Now wearing…' }}
					</span>
					<span class="text-sm font-semibold text-t1 leading-tight truncate">
						{{ avatar.displayName || 'My Avatar' }}
					</span>
				</div>
				<!-- Wrench / edit toggle -->
				<button
					class="p-1.5 rounded hover:bg-white/10 transition-colors shrink-0"
					:class="editMode ? 'text-accent' : 'text-white/50 hover:text-white'"
					:title="editMode ? 'Exit Edit' : 'Edit this outfit'"
					@click="editMode ? exitEdit() : openEdit()"
				>
					<WrenchIcon class="w-4 h-4" />
				</button>
			</div>

			<!-- ══════════════════════════════════════════════════════════ -->
			<!-- NORMAL MODE                                               -->
			<!-- ══════════════════════════════════════════════════════════ -->
			<template v-if="!editMode">

				<!-- Filter toolbar -->
				<div class="flex items-center gap-0.5 px-1.5 py-1 border-b border-brd shrink-0">
					<input
						v-model="filterText"
						type="search"
						placeholder="Filter Outfits…"
						class="flex-1 min-w-0 bg-card2 border border-brd text-t1 placeholder-tm rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
					/>
					<button class="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white shrink-0" title="Options — Phase 2" disabled>
						<CogIcon class="w-3.5 h-3.5" />
					</button>
					<button class="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white shrink-0" title="Sort — Phase 2" disabled>
						<ArrowUpDownIcon class="w-3.5 h-3.5" />
					</button>
					<button class="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white shrink-0" title="Delete Outfit — Phase 2" disabled>
						<Trash2Icon class="w-3.5 h-3.5" />
					</button>
				</div>

				<!-- Tab bar -->
				<div class="flex border-b border-brd shrink-0">
					<button
						v-for="tab in [
							{ id: 'gallery', label: 'Outfit Gallery' },
							{ id: 'outfits', label: 'Outfits' },
							{ id: 'wearing', label: `Wearing (${totalWorn}/38 Att.)` },
						]"
						:key="tab.id"
						class="flex-1 py-1.5 text-[11px] font-medium border-b-2 transition-colors"
						:class="activeTab === tab.id
							? 'border-accent text-accent bg-white/5'
							: 'border-transparent text-white/50 hover:text-white hover:border-white/30'"
						@click="activeTab = tab.id"
					>
						{{ tab.label }}
					</button>
				</div>

				<!-- Tab content -->
				<div class="flex-1 overflow-y-auto min-h-0">

					<!-- Gallery tab ────────────────────────────────── -->
					<template v-if="activeTab === 'gallery'">
						<div class="grid grid-cols-3 gap-1.5 p-2">
							<div
								v-for="item in galleryItems"
								:key="item.id"
								class="flex flex-col items-center gap-1 cursor-pointer group"
								title="Outfit Gallery — Phase 2"
							>
								<div
									class="w-full aspect-square rounded border-2 border-brd group-hover:border-accent transition-colors"
									:style="{ background: `linear-gradient(135deg, ${item.color}55, ${item.color}22)` }"
								>
									<div class="flex items-center justify-center h-full text-2xl">👕</div>
								</div>
								<span class="text-[10px] text-tm text-center truncate w-full">{{ item.name }}</span>
							</div>
						</div>
						<div class="px-3 pb-2 text-tm/50 text-[10px] italic text-center">Outfit Gallery — Phase 2</div>
					</template>

					<!-- Outfits tab ─────────────────────────────────── -->
					<template v-else-if="activeTab === 'outfits'">
						<div class="flex flex-col">
							<div
								v-for="folder in outfitFolders"
								:key="folder.id"
								class="border-b border-brd/50 last:border-0"
							>
								<!-- Folder row -->
								<button
									class="flex items-center gap-1.5 w-full px-2.5 py-1.5 hover:bg-white/5 transition-colors text-left"
									@click="folder.open.value = !folder.open.value"
								>
									<component
										:is="folder.open.value ? ChevronDownIcon : ChevronRightIcon"
										class="w-3 h-3 text-white/40 shrink-0"
									/>
									<span class="text-t1 font-medium">{{ folder.label }}</span>
									<span class="ml-auto text-tm/50 text-[10px]">{{ folder.count }}</span>
								</button>
								<!-- Folder contents placeholder -->
								<template v-if="folder.open.value && folder.count > 0">
									<div class="px-4 py-1 text-tm/40 text-[11px] italic">
										Contents — Phase 2
									</div>
								</template>
								<template v-else-if="folder.open.value">
									<div class="px-4 py-1 text-tm/30 text-[11px] italic">Empty</div>
								</template>
							</div>
						</div>
						<div class="px-3 py-2 text-tm/40 text-[10px] italic text-center">
							Full outfit library — Phase 2
						</div>
					</template>

					<!-- Wearing tab ─────────────────────────────────── -->
					<template v-else>
						<div
							v-for="group in wearableGroups"
							:key="group.id"
							class="border-b border-brd/40 last:border-0"
						>
							<!-- Group header -->
							<button
								class="flex items-center gap-1.5 w-full px-2.5 py-1.5 hover:bg-white/5 transition-colors"
								@click="expanded[group.id] = !expanded[group.id]"
							>
								<component
									:is="expanded[group.id] ? ChevronDownIcon : ChevronRightIcon"
									class="w-3 h-3 text-white/40 shrink-0"
								/>
								<span class="text-t1 font-medium text-[11px]">{{ group.label }}</span>
								<span class="ml-auto text-tm/40 text-[10px]">{{ group.items.length }}</span>
							</button>
							<!-- Items -->
							<template v-if="expanded[group.id]">
								<div
									v-if="!group.items.length"
									class="px-6 py-1.5 text-tm/40 text-[11px] italic"
								>
									{{ group.id === 'attachments' ? 'No attachments worn.' : 'None' }}
								</div>
								<div
									v-for="item in group.items"
									:key="item.id"
									class="flex items-center gap-2 px-4 py-1.5 hover:bg-white/5 transition-colors"
								>
									<span class="text-sm leading-none shrink-0">{{ item.icon }}</span>
									<div class="flex flex-col flex-1 min-w-0">
										<span class="text-t1 font-medium leading-tight">{{ item.label }}</span>
										<span class="text-tm/60 text-[10px] leading-tight truncate">{{ item.detail }}</span>
									</div>
									<!-- Color swatch -->
									<div
										v-if="item.color"
										class="w-4 h-4 rounded border border-white/20 shrink-0"
										:style="{ background: item.color }"
										:title="item.color"
									/>
								</div>
							</template>
						</div>
					</template>

				</div>

				<!-- Bottom status bar -->
				<div class="flex items-center px-2.5 py-1.5 border-t border-brd shrink-0 bg-card2 gap-2">
					<span class="text-tm/50 text-[10px] flex-1">Complexity: — (Phase 2)</span>
					<button class="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white" title="Marketplace — Phase 2" disabled>
						<ShoppingBagIcon class="w-3.5 h-3.5" />
					</button>
				</div>

			</template>

			<!-- ══════════════════════════════════════════════════════════ -->
			<!-- EDIT MODE                                                 -->
			<!-- ══════════════════════════════════════════════════════════ -->
			<template v-else>

				<!-- Back + title row -->
				<div class="flex items-center gap-1.5 px-2 py-1.5 border-b border-brd shrink-0">
					<button
						class="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors shrink-0"
						title="Back to outfits"
						@click="exitEdit"
					>
						<ChevronLeftIcon class="w-4 h-4" />
					</button>
					<span class="text-sm font-semibold text-t1">Edit Outfit Parts</span>
				</div>

				<!-- Editable wearables list -->
				<div class="flex-1 overflow-y-auto min-h-0">

					<!-- Body Parts -->
					<div class="border-b border-brd/40">
						<button
							class="flex items-center gap-1.5 w-full px-2.5 py-1.5 hover:bg-white/5 transition-colors"
							@click="expanded.body = !expanded.body"
						>
							<component :is="expanded.body ? ChevronDownIcon : ChevronRightIcon" class="w-3 h-3 text-white/40 shrink-0" />
							<span class="text-t1 font-medium text-[11px]">Body Parts</span>
						</button>
						<template v-if="expanded.body">
							<!-- Shape (read-only) -->
							<div class="flex items-center gap-2 px-4 py-1.5">
								<span class="text-sm shrink-0">🧍</span>
								<div class="flex flex-col flex-1 min-w-0">
									<span class="text-t1 font-medium leading-tight">Shape</span>
									<span class="text-tm/50 text-[10px]">Classic Avatar — Phase 2</span>
								</div>
							</div>
							<!-- Skin -->
							<div class="flex items-center gap-2 px-4 py-1.5">
								<span class="text-sm shrink-0">🫀</span>
								<div class="flex flex-col flex-1 min-w-0">
									<span class="text-t1 font-medium leading-tight">Skin Tone</span>
								</div>
								<input
									v-model="editSkinTone"
									type="color"
									class="w-7 h-6 rounded border border-brd cursor-pointer bg-transparent"
									title="Skin tone color"
								/>
							</div>
							<!-- Hair -->
							<div class="flex items-center gap-2 px-4 py-1.5">
								<span class="text-sm shrink-0">💇</span>
								<div class="flex flex-col flex-1 min-w-0">
									<span class="text-t1 font-medium leading-tight">Hair</span>
									<select
										v-model="editHairStyle"
										class="bg-card2 border border-brd text-t1 rounded px-1 py-0.5 text-[10px] mt-0.5 focus:outline-none focus:ring-1 focus:ring-accent"
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
									class="w-7 h-6 rounded border border-brd cursor-pointer bg-transparent"
									title="Hair color"
								/>
							</div>
							<!-- Eyes (read-only) -->
							<div class="flex items-center gap-2 px-4 py-1.5 opacity-50">
								<span class="text-sm shrink-0">👁</span>
								<div class="flex flex-col flex-1 min-w-0">
									<span class="text-t1 font-medium leading-tight">Eyes</span>
									<span class="text-tm/50 text-[10px]">Default — Phase 2</span>
								</div>
							</div>
						</template>
					</div>

					<!-- Clothing -->
					<div class="border-b border-brd/40">
						<button
							class="flex items-center gap-1.5 w-full px-2.5 py-1.5 hover:bg-white/5 transition-colors"
							@click="expanded.clothing = !expanded.clothing"
						>
							<component :is="expanded.clothing ? ChevronDownIcon : ChevronRightIcon" class="w-3 h-3 text-white/40 shrink-0" />
							<span class="text-t1 font-medium text-[11px]">Clothing</span>
						</button>
						<template v-if="expanded.clothing">
							<!-- Outfit color -->
							<div class="flex items-center gap-2 px-4 py-1.5">
								<span class="text-sm shrink-0">👕</span>
								<div class="flex flex-col flex-1 min-w-0">
									<span class="text-t1 font-medium leading-tight">Outfit Color</span>
									<span class="text-tm/50 text-[10px]">Primary / accent color</span>
								</div>
								<input
									v-model="editColor"
									type="color"
									class="w-7 h-6 rounded border border-brd cursor-pointer bg-transparent"
									title="Outfit primary color"
								/>
							</div>
						</template>
					</div>

					<!-- Attachments -->
					<div class="border-b border-brd/40">
						<button
							class="flex items-center gap-1.5 w-full px-2.5 py-1.5 hover:bg-white/5 transition-colors"
							@click="expanded.attachments = !expanded.attachments"
						>
							<component :is="expanded.attachments ? ChevronDownIcon : ChevronRightIcon" class="w-3 h-3 text-white/40 shrink-0" />
							<span class="text-t1 font-medium text-[11px]">Attachments</span>
							<span class="ml-auto text-tm/40 text-[10px]">0</span>
						</button>
						<template v-if="expanded.attachments">
							<div class="px-6 py-2 text-tm/40 text-[11px] italic">No attachments worn.</div>
						</template>
					</div>

					<!-- Add More (stub expand) -->
					<div class="px-3 py-2 border-b border-brd/40">
						<button
							class="flex items-center gap-1.5 px-2 py-1 border border-brd rounded text-tm hover:bg-white/5 hover:text-t1 transition-colors text-[11px]"
							title="Browse inventory to add wearables — Phase 2"
							@click="showAddMore = !showAddMore"
						>
							<PlusIcon class="w-3 h-3" />
							Add More…
						</button>
						<div v-if="showAddMore" class="mt-2 px-1 py-3 bg-card2 border border-brd rounded text-center text-tm/40 text-[11px] italic">
							Inventory browser — Phase 2
						</div>
					</div>

				</div>

				<!-- Bottom bar: gear + complexity + shop -->
				<div class="flex items-center px-2 py-1.5 border-t border-brd shrink-0 bg-card2 gap-1">
					<button class="p-1 rounded hover:bg-white/10 text-white/40" title="Options — Phase 2" disabled>
						<CogIcon class="w-3.5 h-3.5" />
					</button>
					<span class="flex-1 text-tm/40 text-[10px] text-center">Complexity: — (Phase 2)</span>
					<button class="p-1 rounded hover:bg-white/10 text-white/40" title="Marketplace — Phase 2" disabled>
						<ShoppingBagIcon class="w-3.5 h-3.5" />
					</button>
				</div>

				<!-- Save / Save As… / Undo Changes -->
				<div class="flex gap-1 px-2 py-1.5 border-t border-brd shrink-0">
					<button
						class="flex-1 py-1.5 bg-accent text-white rounded text-xs font-semibold hover:opacity-80 transition-opacity"
						@click="saveOutfit"
					>Save</button>
					<button
						class="flex-1 py-1.5 bg-card2 border border-brd text-tm rounded text-xs hover:bg-white/5 transition-colors opacity-50 cursor-not-allowed"
						disabled title="Save As — Phase 2"
					>Save As…</button>
					<button
						class="flex-1 py-1.5 bg-card2 border border-brd text-t1 rounded text-xs hover:bg-white/5 transition-colors"
						@click="undoChanges"
					>Undo Changes</button>
				</div>

			</template>

		</div>
	</FloaterWindow>
</template>
