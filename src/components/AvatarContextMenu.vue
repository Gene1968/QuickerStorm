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
import { useLLUDP } from '@/composables/useLLUDP'
import { useNotifications } from '@/composables/useNotifications'
import { useContextMenuPosition } from '@/composables/useContextMenuPosition'
import ContextMenuItem from '@/components/ContextMenuItem.vue'

const ui = useUiStore()
const im = useInstantMessage()
const social = useGridSocialStore()
const { offerFriendship } = useSocial()
const { inviteToGroup } = useLLUDP()
const { notifyInfo } = useNotifications()

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

function zoomIn() {
	if (!menu.value) return
	window.dispatchEvent(new CustomEvent('qs:zoom-to-object', { detail: { localId: menu.value.localId } }))
	close()
}

function pay() {
	if (!menu.value) return
	ui.openPayFloater({ targetId: menu.value.agentId, targetName: menu.value.name, kind: 'avatar' })
	close()
}

function inspectAvatar() {
	if (!menu.value) return
	ui.openInspectAvatar(menu.value.agentId)
	close()
}

// ── Self-avatar actions ────────────────────────────────────────────────────
function openWearing()    { ui.openAppearanceOnTab('wearing'); close() }
function openOutfits()    { ui.toggleAppearanceOnTab('outfits'); close() }
function openSelfProfile(){ ui.openProfile(null); close() }   // null target = own profile
function openFriends()    { ui.openChatOnTab('contacts'); close() }

// WHY qs:sit-ground / qs:stand-up: useWorldEngine.js already defines sitOnGround()/standUp() (see
// the composable's return object) but WorldCanvas.vue only destructures {hoverAction, hoverPos,
// altFocus, screenToDropPoint} from it — nothing outside the engine's own closure can call them
// yet. Bridging via a window CustomEvent mirrors the exact pattern already wired end-to-end for
// 'qs:face-toward' just above (useWorldEngine.js:5707 onFaceToward). This file's task report notes
// useWorldEngine.js needs `window.addEventListener('qs:sit-ground', () => sitOnGround())` /
// `('qs:stand-up', () => standUp())` alongside its existing qs:face-toward registration (and
// ObjectContextMenu.vue's qs:stand-up / qs:zoom-to-object dispatch, same gap) before these take effect.
function sitDown() {
	window.dispatchEvent(new CustomEvent('qs:sit-ground'))
	close()
}
function standUp() {
	window.dispatchEvent(new CustomEvent('qs:stand-up'))
	close()
}

// FS menu_avatar_other has no "Invite to group" submenu of our own groups — we add one since the
// task calls for it: lists useGridSocialStore().groups by name, invites the target avatar into
// whichever is picked. The sim gives no confirmation either way for a disabled-groups grid
// (InviteGroupRequest is fire-and-forget), so we toast optimistically like FS's own "invitation
// sent" messaging (llgroupmgr.cpp sendGroupMemberInvites has no success ack either).
function inviteToGroupAction(group) {
	if (!menu.value || !group) return
	inviteToGroup({ groupId: group.id, inviteeIds: [menu.value.agentId] })
	notifyInfo('Invitation sent', `Invited ${menu.value.name} to "${group.name}".`)
	close()
}
const groupInviteSub = computed(() => {
	if (!social.groups.length) {
		return { label: 'Invite to group', disabled: true, title: "You aren't a member of any groups" }
	}
	return {
		label: 'Invite to group',
		submenu: social.groups.map(g => ({ label: g.name, action: () => inviteToGroupAction(g) })),
	}
})

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
	{ label: 'Sit down',			disabled: !!ui.isSitting,	action: sitDown },
	{ label: 'Stand up',			disabled: !ui.isSitting,	action: standUp },
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
	{ label: 'Inspect',								action: inspectAvatar },
	...(!social.isFriend(menu.value?.agentId)
	? [{ label: 'Add friend',						action: addFriend }]
	: []),
	{ label: 'Give calling card',	disabled: true },
	{ label: 'Send IM…',								action: startIM },
	groupInviteSub.value,
	{ sep: true },
	{ label: 'Zoom in',								action: zoomIn },
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
	{ label: 'Pay',											action: pay },
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
		<div class="px-3 py-1 text-accent font-medium border-b border-edge truncate">{{ menu.name }}</div>
		<ContextMenuItem v-for="(it, i) in items" :key="i" :item="it" />
	</div>
</template>
