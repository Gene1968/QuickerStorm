<script setup>
/**
 * AvatarContextMenu — right-click menu on another avatar. Structure + order mirror FS
 * menu_avatar_other (lowercased, our convention); enabled items have real backing
 * today, the rest are DISABLED roadmap placeholders. Rows render via <ContextMenuItem>.
 */
import { computed, onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import { useInstantMessage } from '@/composables/useInstantMessage'
import { useGridSocialStore } from '@/stores/gridSocialStore'
import { useSocial } from '@/composables/useSocial'
import { useContextMenuPosition } from '@/composables/useContextMenuPosition'
import ContextMenuItem from '@/components/ContextMenuItem.vue'

const ui = useUiStore()
const im = useInstantMessage()
const social = useGridSocialStore()
const { offerFriendship } = useSocial()

const menu = computed(() => ui.avatarMenu)

// Measure + slide on-screen on both axes (flips upward near the screen bottom).
const { el: menuEl, style } = useContextMenuPosition(menu)

function close() { ui.closeAvatarMenu() }

function startIM() {
	if (!menu.value) return
	im.openWith(menu.value.agentId, menu.value.name)
	ui.showChat = true
	ui.focusFloater('conversations')
	close()
}

function viewProfile() {
	if (!menu.value) return
	ui.openProfile(menu.value.agentId)
	close()
}

function addFriend() {
	if (menu.value) offerFriendship(menu.value.agentId, menu.value.name, 'Will you be my friend?')
	ui.closeAvatarMenu()
}

function refreshTextures() {
	if (!menu.value) return
	ui.requestTextureRefresh(menu.value.localId)
	close()
}

function faceToward() {
	if (!menu.value) return
	window.dispatchEvent(new CustomEvent('qs:face-toward', { detail: { localId: menu.value.localId } }))
	close()
}

// ── Self-avatar actions ────────────────────────────────────────────────────
function openWearing()    { ui.openAppearanceOnTab('wearing'); close() }
function openOutfits()    { ui.toggleAppearanceOnTab('outfits'); close() }
function openSelfProfile(){ ui.openProfile(null); close() }   // null target = own profile
function openFriends()    { ui.openChatOnTab('contacts'); close() }

// FS shares one export cluster across self + other avatars → our quickerSTORM submenu.
const quickerStormSub = {
	label: 'quickerSTORM',
	submenu: [
		{ label: 'Inspect textures!',	disabled: true },
		{ label: 'Mesh export',			disabled: true },
		{ label: 'Avatar XML export',	disabled: true },
		{ label: 'Avatar textures',		disabled: true },
		{ label: 'Avatar animations',	disabled: true },
		{ label: 'OXP export',			disabled: true },
		{ label: 'Add particles',		disabled: true },
	],
}

// FS menu_avatar_self order, lowercased; enabled = real backing, else disabled roadmap.
const selfItems = computed(() => [
	quickerStormSub,
	{ sep: true },
	{ label: 'Sit down',			disabled: true },
	{ label: 'Stand up',			disabled: true },
	{ sep: true },
	{
		label: 'Appearance',
		submenu: [
			{ label: 'Now wearing…',						action: openWearing },
			{ label: 'Outfits',	checked: () => ui.showAppearance && ui.appearanceActiveTab === 'outfits', action: openOutfits },
			{ label: 'Edit shape',		disabled: true },
			{ label: 'Edit outfit',		disabled: true },
		],
	},
	{
		label: 'Take off',
		submenu: [
			{
				label: 'Clothes',
				submenu: [
					{ label: 'Shirt',		disabled: true },
					{ label: 'Pants',		disabled: true },
					{ label: 'Skirt',		disabled: true },
					{ label: 'Shoes',		disabled: true },
					{ label: 'Socks',		disabled: true },
					{ label: 'Jacket',		disabled: true },
					{ label: 'Gloves',		disabled: true },
					{ label: 'Undershirt',	disabled: true },
					{ label: 'Underpants',	disabled: true },
					{ label: 'Tattoo',		disabled: true },
					{ label: 'Physics',		disabled: true },
					{ label: 'Alpha',		disabled: true },
					{ sep: true },
					{ label: 'All clothes',	disabled: true },
				],
			},
			{ label: 'HUD',				disabled: true },
			{ label: 'Detach all',		disabled: true },
		],
	},
	{ label: 'Hover height',		disabled: true },
	{ sep: true },
	{ label: 'My profile…',								action: openSelfProfile },
	{ sep: true },
	{ label: 'Reset skeleton',		disabled: true },
	{ label: 'Reset skeleton and animations',	disabled: true },
	{ sep: true },
	{
		label: 'Community',
		submenu: [
			{ label: 'Friends',								action: openFriends },
			{ label: 'Groups',			disabled: true },
			{ label: 'Profile',								action: openSelfProfile },
		],
	},
	{ sep: true },
	{ label: 'Texture refresh',							action: refreshTextures },
])

// FS menu_avatar_other order, lowercased; enabled = real backing, else disabled roadmap.
const otherItems = computed(() => [
	quickerStormSub,
	{ label: 'View profile',							action: viewProfile },
	...(!social.isFriend(menu.value?.agentId)
	? [{ label: 'Add friend',						action: addFriend }]
	: []),
	{ label: 'Give calling card',	disabled: true },
	{ label: 'Send IM…',								action: startIM },
	{ label: 'Invite to group',		disabled: true },
	{ sep: true },
	{ label: 'Zoom in',				disabled: true },
	{ label: 'Face towards avatar',						action: faceToward },
	{ sep: true },
	{ label: 'Reset skeleton',		disabled: true },
	{ label: 'Reset skeleton and animations',	disabled: true },
	{ sep: true },
	{
		label: 'Annoyance',
		submenu: [
			{ label: 'Block',				disabled: true },
			{ label: 'Report',				disabled: true },
			{ label: 'Freeze',				disabled: true },
			{ label: 'Eject',				disabled: true },
			{ sep: true },
			{ label: 'Derender',			disabled: true },
			{ label: 'Derender + blacklist',	disabled: true },
		],
	},
	{ label: 'Pay',					disabled: true },
	{ label: 'Texture refresh',							action: refreshTextures },
])

const items = computed(() => (menu.value?.isSelf ? selfItems.value : otherItems.value))

function onDocClick(e) {
	if (!menu.value) return
	if (e.target?.closest?.('[data-avatar-context-menu]')) return
	close()
}
function onKey(e) {
	if (e.key === 'Escape' && menu.value) close()
}

onMounted(() => {
	document.addEventListener('click', onDocClick)
	window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
	document.removeEventListener('click', onDocClick)
	window.removeEventListener('keydown', onKey)
})
</script>

<template>
	<div
		v-if="menu"
		ref="menuEl"
		data-avatar-context-menu
		:style="style"
		class="fixed z-[200] min-w-[10rem] bg-panel border border-edge rounded-sm shadow-lg text-xs text-fg select-none"
		@contextmenu.prevent
	>
		<div class="px-3 py-1.5 text-accent font-medium border-b border-edge truncate">{{ menu.name }}</div>
		<ContextMenuItem v-for="(it, i) in items" :key="i" :item="it" />
	</div>
</template>
