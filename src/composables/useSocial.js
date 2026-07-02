// src/composables/useSocial.js — drives the grid-social pipeline over the WS bridge.
// Inbound: routes FRIEND_STATUS / SELF_GROUPS / AGENT_DATA / AVATAR_PROPS / PARCEL_INFO /
// NAME_REPLY envelopes into gridSocialStore. Outbound: profile/parcel/name requests and the
// (gated) friend-management actions. The login buddy-list itself is loaded by useGridLogin
// (folded into LOGIN_OK); this composable resolves friend names + live status afterwards.
import { onMounted, onUnmounted, watch } from 'vue'
import { useRealtimeSocket } from './useRealtimeSocket'
import { useGridSocialStore } from '@/stores/gridSocialStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { useSessionStore } from '@/stores/sessionStore'
import { C, S } from '@shared/protocol.js'

let registered = false
let nameWatcher = null
// Pending avatar-picker queries: queryId -> resolve fn. Module-level so the singleton handler resolves them.
const pickerQueries = new Map()

export function useSocial() {
	const { on, emit } = useRealtimeSocket()
	const social   = useGridSocialStore()
	const notif    = useNotificationStore()
	const session  = useSessionStore()

	// ── Outbound requests ──────────────────────────────────────────────────────
	function requestProfile(avatarId)   { if (avatarId) emit(C.AVATAR_PROPS_REQ, { avatarId }) }
	function requestParcelInfo(parcelId) { if (parcelId) emit(C.PARCEL_INFO_REQ, { parcelId }) }
	function requestNames(ids) {
		const todo = (ids || []).filter(id => id && !social.nameFor(id))
		if (todo.length) emit(C.NAME_REQ, { ids: todo })
	}

	// ── Friend management (gated by confirm dialogs in the UI) ──────────────────
	function offerFriendship(toAgentId, toAgentName, message) {
		if (!toAgentId) return
		emit(C.FRIEND_OFFER, { toAgentId, toAgentName, message })
		notif.notify({ tab: 'system', title: 'Friendship offered', body: `You offered friendship to ${toAgentName || toAgentId.slice(0, 8)}.` })
	}

	/** Add-Friend name search. Resolves to [{ id, name }] (empty on timeout). */
	function findAvatars(query) {
		return new Promise((resolve) => {
			const queryId = crypto.randomUUID()
			pickerQueries.set(queryId, resolve)
			emit(C.AVATAR_PICKER_REQ, { query, queryId })
			// WHY: never leave a hanging promise if the sim returns nothing.
			setTimeout(() => {
				if (pickerQueries.has(queryId)) { pickerQueries.delete(queryId); resolve([]) }
			}, 8000)
		})
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

	function onAvatarPickerReply(d) {
		const r = pickerQueries.get(d?.queryId)
		if (r) { pickerQueries.delete(d.queryId); r(d?.avatars || []) }
	}

	function onFriendRightsChanged(d) {
		const me = (session.agentId || '').toLowerCase()
		if ((d?.relatedId || '').toLowerCase() === me) {
			// The friend (d.agentId) changed what they grant me → my rightsHas.
			social.applyRightsChange({ agentId: d.agentId, rightsHas: d.rights })
		} else if ((d?.agentId || '').toLowerCase() === me) {
			// I changed what I grant d.relatedId → that friend's rightsGiven.
			social.applyRightsChange({ agentId: d.relatedId, rightsGiven: d.rights })
		}
	}

	// Friendship dialogs ride on ImprovedInstantMessage (S.IM_RECV). useInstantMessage ignores
	// non-zero dialogs, so we own 38/39/40 here.
	function onFriendshipIm(d) {
		const fromName = d?.fromAgentName || (d?.fromAgentId || '').slice(0, 8)
		if (d?.dialog === 38) {
			const transactionId = d.imId
			const { groupId } = notif.notify({
				tab: 'system', sticky: true,
				title: `Friendship offer from ${fromName}`,
				body: d.message || 'Will you be my friend?',
				actions: [
					{ label: 'Accept', variant: 'primary', run: () => {
						respondFriendship(transactionId, true)
						social.addFriend(d.fromAgentId, fromName)
						notif.dismissGroup(groupId)
					} },
					{ label: 'Decline', variant: 'ghost', run: () => {
						respondFriendship(transactionId, false)
						notif.dismissGroup(groupId)
					} },
				],
			})
		} else if (d?.dialog === 39) {
			social.addFriend(d.fromAgentId, fromName)
			notif.notify({ tab: 'system', title: `${fromName} accepted your friendship offer.` })
		} else if (d?.dialog === 40) {
			notif.notify({ tab: 'system', title: `${fromName} declined your friendship offer.` })
		}
	}

	onMounted(() => {
		if (!registered) {
			on(S.FRIEND_STATUS, onFriendStatus)
			on(S.SELF_GROUPS,   onSelfGroups)
			on(S.AGENT_DATA,    onAgentData)
			on(S.AVATAR_PROPS,  onAvatarProps)
			on(S.PARCEL_INFO,   onParcelInfo)
			on(S.NAME_REPLY,    onNameReply)
			on(S.AVATAR_PICKER_REPLY,   onAvatarPickerReply)
			on(S.FRIEND_RIGHTS_CHANGED, onFriendRightsChanged)
			on(S.IM_RECV,               onFriendshipIm, 'friendship-im')  // keyed: no HMR/remount handler stacking
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
		offerFriendship, respondFriendship, removeFriend, setFriendRights, findAvatars,
	}
}
