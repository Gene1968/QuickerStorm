// src/composables/useSocial.js — drives the grid-social pipeline over the WS bridge.
// Inbound: routes FRIEND_STATUS / SELF_GROUPS / AGENT_DATA / AVATAR_PROPS / PARCEL_INFO /
// NAME_REPLY envelopes into gridSocialStore. Outbound: profile/parcel/name requests and the
// (gated) friend-management actions. The login buddy-list itself is loaded by useGridLogin
// (folded into LOGIN_OK); this composable resolves friend names + live status afterwards.
import { onMounted, onUnmounted, watch } from 'vue'
import { useRealtimeSocket } from './useRealtimeSocket'
import { useGridSocialStore } from '@/stores/gridSocialStore'
import { C, S } from '@shared/protocol.js'

let registered = false
let nameWatcher = null

export function useSocial() {
	const { on, emit } = useRealtimeSocket()
	const social = useGridSocialStore()

	// ── Outbound requests ──────────────────────────────────────────────────────
	function requestProfile(avatarId)   { if (avatarId) emit(C.AVATAR_PROPS_REQ, { avatarId }) }
	function requestParcelInfo(parcelId) { if (parcelId) emit(C.PARCEL_INFO_REQ, { parcelId }) }
	function requestNames(ids) {
		const todo = (ids || []).filter(id => id && !social.nameFor(id))
		if (todo.length) emit(C.NAME_REQ, { ids: todo })
	}

	// ── Friend management (gated by confirm dialogs in the UI) ──────────────────
	function offerFriendship(toAgentId, toAgentName, message) {
		if (toAgentId) emit(C.FRIEND_OFFER, { toAgentId, toAgentName, message })
	}
	function respondFriendship(transactionId, accept, folderId) {
		if (transactionId) emit(C.FRIEND_RESPOND, { transactionId, accept: !!accept, folderId })
	}
	function removeFriend(agentId) { if (agentId) emit(C.FRIEND_REMOVE, { agentId }) }
	function setFriendRights(agentId, rights) {
		if (agentId) emit(C.FRIEND_RIGHTS, { agentId, rights: rights | 0 })
	}

	// ── Inbound handlers ────────────────────────────────────────────────────────
	function onFriendStatus(d) { social.setFriendStatus(!!d?.online, d?.ids || []) }
	function onSelfGroups(d)   { social.setSelfGroups(d?.groups || []) }
	function onAgentData(d)    { social.setAgentData(d || {}) }
	function onNameReply(d)    { social.applyNames(d?.names || {}) }
	function onAvatarProps(d) {
		if (!d?.avatarId) return
		const frag = {}
		if (d.properties) frag.properties = d.properties
		if (d.interests)  frag.interests  = d.interests
		if (d.groups)     frag.groups     = d.groups
		social.mergeProfile(d.avatarId, frag)
	}
	function onParcelInfo(d) { social.setParcel(d?.parcel) }

	onMounted(() => {
		if (!registered) {
			on(S.FRIEND_STATUS, onFriendStatus)
			on(S.SELF_GROUPS,   onSelfGroups)
			on(S.AGENT_DATA,    onAgentData)
			on(S.AVATAR_PROPS,  onAvatarProps)
			on(S.PARCEL_INFO,   onParcelInfo)
			on(S.NAME_REPLY,    onNameReply)
			// WHY: friends arrive (with UUIDs only) on login. Resolve any unresolved names as the
			// list changes — UUIDNameRequest is cheap and batched. Watcher persists for the session.
			nameWatcher = watch(
				() => social.friends.map(f => f.id).join(','),
				() => requestNames(social.friends.filter(f => !f.name).map(f => f.id)),
				{ immediate: true },
			)
			registered = true
		}
	})
	// Handlers persist for the session — module-level state survives component unmount.
	onUnmounted(() => {})

	return {
		requestProfile, requestParcelInfo, requestNames,
		offerFriendship, respondFriendship, removeFriend, setFriendRights,
	}
}
