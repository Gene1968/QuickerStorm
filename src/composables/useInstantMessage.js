// src/composables/useInstantMessage.js — IM conversations via ImprovedInstantMessage (LLUDP)
// Module-level state so any floater/menu sharing the same composable sees the same conversations.
import { ref, onMounted, onUnmounted } from 'vue'
import { useRealtimeSocket } from './useRealtimeSocket'
import { useLLUDP } from './useLLUDP'
import { useSessionStore } from '@/stores/sessionStore'
import { useAvatarStore } from '@/stores/avatarStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useUiStore } from '@/stores/uiStore'
import { assetTypeName } from '@/utils/inventoryIcons'
import { playSound } from '@/composables/useAudio'
import { checkOfferThrottle } from '@/composables/useOfferThrottle'
import { C, S } from '@shared/protocol.js'

// SL asset type — inventory offers of a texture auto-open a preview on accept (FS parity).
const ASSET_TYPE_TEXTURE = 0

// SL IM dialog constants (phoenix-firestorm/indra/llmessage/llinstantmessage.h): an agent
// inventory give arrives as IM_INVENTORY_OFFERED; the reply dialogs (accepted = offer+1,
// declined = offer+2) are computed server-side. Task-object offers (9/10/11) are out of scope
// this pass — see docs/FEATURE-GAPS.md.
const IM_INVENTORY_OFFERED = 4
const IM_INVENTORY_ACCEPTED = 5
const IM_INVENTORY_DECLINED = 6

// Parse an agent inventory-offer BinaryBucket (base64) → { assetType, offeredId }.
// Wire layout (llimprocessing.cpp offer_agent_bucket_t): S8 asset_type + 16-byte LLUUID.
function parseOfferBucket(b64) {
	if (!b64) return null
	try {
		const bin = atob(b64)
		if (bin.length < 17) return null
		const assetType = bin.charCodeAt(0)
		let hex = ''
		for (let i = 1; i <= 16; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0')
		const offeredId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
		return { assetType, offeredId }
	} catch { return null }
}

// conversations: Map<remoteAgentId, { agentId, agentName, messages: [{from, text, ts, dialog}] }>
const conversations = ref(new Map())
const activeId      = ref(null)   // currently focused conversation (drives floater tab)
const unreadCount   = ref(0)

// WHY: localStorage key scoped to logged-in agent — switching avatars must not bleed history.
function storageKey(agentId) {
	return `qs_im_${agentId || 'anon'}`
}

function persist(agentId) {
	// WHY: Skip when agentId empty (pre-login or post-logout). Writing to qs_im_anon would
	// pollute the bucket and stomp another user's anon-bucket state.
	if (!agentId) return
	const serial = {}
	for (const [id, conv] of conversations.value) serial[id] = conv
	try { localStorage.setItem(storageKey(agentId), JSON.stringify(serial)) } catch {}
}

function load(agentId) {
	if (!agentId) return
	try {
		const raw = localStorage.getItem(storageKey(agentId))
		if (!raw) return
		const data = JSON.parse(raw)
		const m = new Map()
		for (const [id, conv] of Object.entries(data)) m.set(id, conv)
		conversations.value = m
	} catch {}
}

function ensureConv(agentId, agentName) {
	let conv = conversations.value.get(agentId)
	if (!conv) {
		conv = { agentId, agentName: agentName || agentId.slice(0, 8), messages: [] }
		conversations.value.set(agentId, conv)
		// trigger reactivity (Map set doesn't notify)
		conversations.value = new Map(conversations.value)
	} else if (agentName && conv.agentName !== agentName) {
		conv.agentName = agentName
	}
	return conv
}

let registered = false

export function useInstantMessage() {
	const { on, off, emit } = useRealtimeSocket()
	const { sendIM }  = useLLUDP()
	const session     = useSessionStore()
	const avatar      = useAvatarStore()
	const notif       = useNotificationStore()
	const inventory   = useInventoryStore()
	const ui          = useUiStore()

	// Inventory offers ride on ImprovedInstantMessage (S.IM_RECV) with inventory dialogs (4/5/6).
	// useSocial owns friendship dialogs (38/39/40); this composable owns normal IM (0) + inventory.
	// The IM_RECV subscription pattern allows multiple listeners, so both handlers coexist.
	function onInventoryOffer(d) {
		const fromName = d?.fromAgentName || (d?.fromAgentId || '').slice(0, 8)
		const bucket = parseOfferBucket(d.binaryBucket)
		const typeLabel = bucket ? assetTypeName(bucket.assetType) : 'item'
		// WHY: file the accepted item into the system folder matching the offered AssetType. For every
		// AssetType that has a dedicated system folder (Texture/Sound/Landmark/Clothing/Object/Notecard/
		// Bodypart/Animation/Gesture) SL's assetTypeToFolderType is an identity cast, so folderType ===
		// assetType. Fall back to the inventory root when the type has no dedicated system folder.
		// (OpenSim ignores this bucket for agent offers; it matters on SL/stricter sims.)
		const destFolderId = (bucket && inventory.findSystemFolder(bucket.assetType)) || inventory.rootId || ''
		const isTexture = !!bucket && bucket.assetType === ASSET_TYPE_TEXTURE
		const offeredName = d.message || typeLabel

		// WHY: the offer surfaces inline in the giver's IM thread (FS shows the offer in the IM window
		// when a session with that agent exists). We add the entry unconditionally so opening the IM
		// tab later still shows it; the corner toast stays too, matching FS.
		const conv = ensureConv(d.fromAgentId, fromName)
		const offerMsg = {
			kind: 'offer',
			from: fromName,
			fromId: d.fromAgentId,
			text: offeredName,
			typeLabel,
			ts: Date.now(),
			resolved: null,   // null = pending; 'accepted' | 'declined' after action
		}
		conv.messages.push(offerMsg)
		conversations.value = new Map(conversations.value)
		if (activeId.value !== d.fromAgentId) unreadCount.value++
		persist(session.agentId)

		// WHY: the SAME reply drives both the inline IM buttons and the corner toast, so it must be
		// idempotent — otherwise accepting inline then clicking the still-live toast (or vice-versa)
		// would emit a SECOND C.IM_OFFER_REPLY (a duplicate accept) to the sim. Guard on resolved.
		let toastGroupId = null
		const reply = (accept) => {
			if (offerMsg.resolved) return
			emit(C.IM_OFFER_REPLY, {
				imId: d.imId,
				accept,
				fromAgentId: d.fromAgentId,
				offerDialog: IM_INVENTORY_OFFERED,
				destFolderId: accept ? destFolderId : '',
			})
			// Mark the inline entry resolved so its Accept/Decline buttons disable.
			offerMsg.resolved = accept ? 'accepted' : 'declined'
			conversations.value = new Map(conversations.value)
			persist(session.agentId)
			// Dismiss the corner toast too so it can't linger with live actions after an inline decision.
			if (toastGroupId) notif.dismissGroup(toastGroupId)
			// FS parity: on accepting a TEXTURE offer, auto-open its preview without stealing focus,
			// gated by the rolling-window throttle so a flood of offers doesn't bury the screen.
			// MANUAL double-click opens go through uiStore directly and bypass this path entirely.
			if (accept && isTexture && bucket.offeredId && checkOfferThrottle()) {
				// (assetId, name, desc, key) — key by the offered inventory id so a re-offer focuses.
				ui.openTexturePreview(bucket.offeredId, offeredName, '', bucket.offeredId)
			}
		}
		// Expose the reply handler on the inline entry so ConversationsFloater can call it.
		offerMsg.reply = reply

		playSound('chime.mp3', 0.5)
		const { groupId } = notif.notify({
			tab: 'system', sticky: true,
			title: `${fromName} is offering you ${typeLabel === 'item' ? 'an item' : `a ${typeLabel}`}`,
			body: d.message || '',
			actions: [
				{ label: 'Accept',  variant: 'primary', run: () => reply(true) },
				{ label: 'Decline', variant: 'ghost',   run: () => reply(false) },
			],
		})
		toastGroupId = groupId   // let the shared reply() dismiss the toast on inline resolution
	}

	function onImRecv(d) {
		// WHY: dialog 0=MessageFromAgent, 1=MessageBox, 4=FromTaskAsAlert, 19=BusyAutoResponse, etc.
		if (d.dialog === IM_INVENTORY_OFFERED) { onInventoryOffer(d); return }
		if (d.dialog === IM_INVENTORY_ACCEPTED || d.dialog === IM_INVENTORY_DECLINED) {
			// FS parity: dialog 5 = "[NAME] received your inventory offer." (InventoryAccepted),
			// dialog 6 = "[NAME] declined your inventory offer." (InventoryDeclined). OpenSim delivers
			// dialog-5 ~0.4s after the offer as a transmission/receipt ACK — this is the "arrived / done
			// transmitting" signal (matters most for large items/folders), NOT the recipient manually
			// accepting (OpenSim never relays that). NAME must be the RECIPIENT: the ACK arrives with
			// fromAgentId = the recipient but fromAgentName = the GIVER's name (verified 2026-07-02, an
			// OpenSim quirk), so resolve the recipient's real name from our own give record first.
			const rid = d.fromAgentId
			const name = inventory.giveRecipientName(rid) || conversations.value.get(rid)?.agentName || d.fromAgentName || (rid || '').slice(0, 8)
			const verb = d.dialog === IM_INVENTORY_ACCEPTED ? 'received' : 'declined'
			notif.notify({ tab: 'system', title: `${name} ${verb} your inventory offer.` })
			return
		}
		// Only handle 0 (normal IM) below; other dialogs (group invites, requests) are Phase 3.
		if (d.dialog !== 0) return
		const isNew = !conversations.value.has(d.fromAgentId)
		const conv = ensureConv(d.fromAgentId, d.fromAgentName)
		if (isNew) playSound('chime.mp3', 0.5)
		conv.messages.push({ from: d.fromAgentName, fromId: d.fromAgentId, text: d.message, ts: d.timestamp * 1000, dialog: d.dialog })
		conversations.value = new Map(conversations.value)
		if (activeId.value !== d.fromAgentId) unreadCount.value++
		persist(session.agentId)
	}

	// Singleton hookup — multiple call sites won't double-bind.
	onMounted(() => {
		if (!registered) {
			// Keyed so an HMR reload / remount replaces the prior callback instead of stacking a new one
			// (fixed duplicate offer toasts — 3 identical "…is offering you…" on one relayed IM).
			on(S.IM_RECV, onImRecv, 'im-recv')
			registered = true
		}
		if (session.agentId && conversations.value.size === 0) load(session.agentId)
	})
	onUnmounted(() => { /* keep registered — module-level state survives component unmount */ })

	function openWith(agentId, agentName) {
		ensureConv(agentId, agentName)
		activeId.value = agentId
		unreadCount.value = 0
	}

	function setActive(agentId) {
		activeId.value = agentId
		if (agentId) unreadCount.value = 0
	}

	function send(toAgentId, text) {
		if (!text.trim()) return
		const conv = ensureConv(toAgentId)
		const fromName = avatar.displayName || 'User'
		sendIM(toAgentId, fromName, text)
		conv.messages.push({ from: 'Me', text, ts: Date.now(), dialog: 0 })
		conversations.value = new Map(conversations.value)
		persist(session.agentId)
	}

	function close(agentId) {
		conversations.value.delete(agentId)
		conversations.value = new Map(conversations.value)
		if (activeId.value === agentId) activeId.value = null
		persist(session.agentId)
	}

	return {
		conversations, activeId, unreadCount,
		openWith, setActive, send, close,
	}
}

export function loadIMHistory(agentId) { load(agentId) }
