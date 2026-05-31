// src/stores/gridSocialStore.js — grid-social state: friends, groups, profiles, parcels.
// WHY: kept SEPARATE from presenceStore (which is quickerSTORM web-collab presence — a different
// concept). This store owns SL/OpenSim grid data only: the buddy list (from login), live online
// status (OnlineNotification), self group membership (AgentGroupDataUpdate), other avatars'
// profiles (AvatarPropertiesReply), and parcel info (ParcelInfoReply). All populated via the
// useSocial composable from server { t, d } envelopes. See docs/superpowers/specs/2026-05-29-social-easy-wins-design.md
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// Friend rights bit flags (SL LLRelationship).
export const RIGHT_ONLINE = 1   // can see my online status
export const RIGHT_MAP    = 2   // can locate me on the map
export const RIGHT_MODIFY = 4   // can modify my objects

// Pure bit helpers for rights bitmasks (exported for the Contacts UI + tests).
export const hasRight = (mask, bit) => (Number(mask) & bit) !== 0
export const setRight = (mask, bit, on) => on ? (Number(mask) | bit) : (Number(mask) & ~bit)

// WHY: LLUDP decoders emit lowercase UUIDs; the XML-RPC login buddy_id casing can differ.
// Normalize every id to lowercase at ingestion + lookup so online-status/name/profile joins match.
const lc = (id) => (id || '').toLowerCase()

export const useGridSocialStore = defineStore('gridSocial', () => {
	// friends: [{ id, name, rightsGiven, rightsHas, online }]
	const friends   = ref([])
	// self groups: [{ id, name, insignia, powers, acceptNotices, contribution }]
	const groups    = ref([])
	const activeGroupId = ref('')
	const groupTitle    = ref('')
	// profiles: Map<avatarId, { properties?, interests?, groups? }> — lazy, filled on request
	const profiles  = ref(new Map())
	// parcels: Map<parcelId, ParcelInfoData>
	const parcels   = ref(new Map())
	// names: Map<uuid, "First Last"> — resolved via UUIDNameReply
	const names     = ref(new Map())
	const gestures       = ref([])
	const globalTextures = ref({})
	const loginFlags     = ref({})

	// ── Getters ──────────────────────────────────────────────────────────────
	const onlineFriends  = computed(() => friends.value.filter(f => f.online))
	const friendCount    = computed(() => friends.value.length)
	const onlineCount    = computed(() => onlineFriends.value.length)
	const friendById     = (id) => friends.value.find(f => f.id === lc(id))
	const isFriend       = (id) => friends.value.some(f => f.id === lc(id))
	const profileFor     = (id) => profiles.value.get(lc(id)) ?? null
	const nameFor        = (id) => names.value.get(lc(id)) ?? ''

	// ── Mutations ──────────────────────────────────────────────────────────────
	/** Populate from the login `social` payload (folded into LOGIN_OK — resume-safe). */
	function loadFromLogin(social) {
		const s = social ?? {}
		friends.value        = (s.friends ?? []).map(f => ({ ...f, id: lc(f.id) }))
		gestures.value       = s.gestures ?? []
		globalTextures.value = s.globalTextures ?? {}
		loginFlags.value     = s.loginFlags ?? {}
		groups.value         = []
		activeGroupId.value  = ''
		groupTitle.value     = ''
		profiles.value       = new Map()
		parcels.value        = new Map()
		names.value          = new Map()
	}

	/** Apply OnlineNotification / OfflineNotification. */
	function setFriendStatus(online, ids) {
		const set = new Set((ids || []).map(lc))
		friends.value = friends.value.map(f => set.has(f.id) ? { ...f, online } : f)
	}

	/** Insert a friend if not already present (optimistic add on accept/accepted). */
	function addFriend(id, name = '', rightsGiven = 0, rightsHas = 0) {
		const key = lc(id)
		if (!key || friends.value.some(f => f.id === key)) return
		friends.value = [...friends.value, { id: key, name, rightsGiven, rightsHas, online: false }]
	}

	/** Patch one friend's rights bits (only fields that are defined). */
	function applyRightsChange({ agentId, rightsGiven, rightsHas } = {}) {
		const key = lc(agentId)
		friends.value = friends.value.map(f => {
			if (f.id !== key) return f
			const next = { ...f }
			if (rightsGiven !== undefined) next.rightsGiven = rightsGiven | 0
			if (rightsHas   !== undefined) next.rightsHas   = rightsHas | 0
			return next
		})
	}

	/** Optimistic local set of rights-I-grant, before the sim confirms via ChangeUserRights. */
	function setRightsGivenLocal(id, bitmask) {
		applyRightsChange({ agentId: id, rightsGiven: bitmask | 0 })
	}

	/** Apply UUIDNameReply — fill friend display names + name cache. */
	function applyNames(map) {
		const m = new Map(names.value)
		for (const [id, name] of Object.entries(map ?? {})) m.set(lc(id), name)
		names.value = m
		friends.value = friends.value.map(f => (!f.name && m.has(f.id)) ? { ...f, name: m.get(f.id) } : f)
	}

	/** Apply AgentGroupDataUpdate — self group list. */
	function setSelfGroups(list) { groups.value = (list ?? []).map(g => ({ ...g, id: lc(g.id) })) }

	/** Apply AgentDataUpdate — active group + title. */
	function setAgentData(d) {
		if (d?.activeGroupId !== undefined) activeGroupId.value = d.activeGroupId
		if (d?.groupTitle !== undefined)    groupTitle.value    = d.groupTitle
	}

	/** Merge a profile reply fragment (properties / interests / groups) into the cache. */
	function mergeProfile(avatarId, fragment) {
		if (!avatarId) return
		const key = lc(avatarId)
		const cur = profiles.value.get(key) ?? {}
		const next = { ...cur, ...fragment }
		const m = new Map(profiles.value)
		m.set(key, next)
		profiles.value = m
	}

	/** Store a ParcelInfoReply. */
	function setParcel(parcel) {
		if (!parcel?.parcelId) return
		const m = new Map(parcels.value)
		m.set(lc(parcel.parcelId), parcel)
		parcels.value = m
	}

	function clear() { loadFromLogin(null) }

	return {
		friends, groups, activeGroupId, groupTitle, profiles, parcels, names,
		gestures, globalTextures, loginFlags,
		onlineFriends, friendCount, onlineCount, friendById, isFriend, profileFor, nameFor,
		loadFromLogin, setFriendStatus, addFriend, applyRightsChange, setRightsGivenLocal,
		applyNames, setSelfGroups, setAgentData,
		mergeProfile, setParcel, clear,
	}
})
