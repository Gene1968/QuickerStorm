<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { openModal, closeModal } from "@/composables/useModalStack.js";
import { useOfficeStore } from "@/stores/officeStore.js";
import { useAvatarStore } from "@/stores/avatarStore.js";
import { usePresenceStore } from "@/stores/presenceStore.js";
// import { useSlack } from "@/composables/useSlack.js";
import { useAudio } from "@/composables/useAudio.js";
import { useMessaging } from "@/composables/useMessaging.js";
import { talkingPeers } from "@/composables/useProximityVoice.js";
import { QUICK_NAV, ALL_ROOMS, OFFICES } from "@/config/officeLayout.js";
import {
	slackStatusFromProfile,
	slackStatusForDisplay,
} from "@/utils/slackStatusFormat.js";
import NewConversationModal from '@/components/ui/NewConversationModal.vue'
import CreateChannelModal from '@/components/ui/CreateChannelModal.vue'
import SidebarPolls from '@/components/sidebar/SidebarPolls.vue'
import {
	Home as HomeIcon,
	Users as UserGroupIcon,
	MessageSquare as ChatBubbleLeftRightIcon,
	Hash as HashtagIcon,
	Grid2x2 as Squares2X2Icon,
	// UsersIcon,
	Tv as TvIcon,
	Cake as CakeIcon,
	Zap as BoltIcon,
	ChevronsLeft as ChevronDoubleLeftIcon,
	ChevronsRight as ChevronDoubleRightIcon,
	Mail as EnvelopeIcon,
} from "@lucide/vue";

const officeStore = useOfficeStore();
const avatarStore = useAvatarStore();
const presenceStore = usePresenceStore();
// const userStore = useUserStore();
// const slack = useSlack();
// ── Slack stub: all Slack calls are disabled; provide inert refs so the
//    template doesn't throw while we still reference `slack.*` in markup.
const slack = {
	isLoaded: ref(false),
	members: ref([]),
	myChannels: ref([]),
	myChannelsLoading: ref(false),
	totalDmUnread: ref(0),
	dmUnreadCounts: ref({}),
	channelHasUnread: ref({}),
	activeDmChannel: ref(null),
	presenceMap: ref({}),
	fetchPanelPresence: () => {},
	fetchMyChannels: () => Promise.resolve(),
	pollUnreadCounts: () => {},
	openDm: () => {},
	openDmWithUser: () => Promise.resolve(),
	dmUser: () => Promise.resolve(),
};
const messaging = useMessaging();
const { playSound } = useAudio();

const googleIdx = computed(() => avatarStore.googleAccountIndex);
const _gmailUrl = computed(
	() => `https://mail.google.com/mail/u/${googleIdx.value}/`,
);
const _calendarUrl = computed(
	() => `https://calendar.google.com/calendar/u/${googleIdx.value}/r/month`,
);

const collapsed = ref(localStorage.getItem('ava_sidebar_collapsed') === '1');
// Keep --canvas-left CSS var in sync + persist user pref
watch(
	collapsed,
	(val) => {
		document.documentElement.style.setProperty(
			"--canvas-left",
			val ? "var(--sidebar-collapsed-w)" : "var(--sidebar-w)",
		);
		localStorage.setItem('ava_sidebar_collapsed', val ? '1' : '0');
	},
	{ immediate: true },
);
const showRooms = ref(true);
const showQuickerStorm = ref(true);
const showOffline = ref(false);
const showChannels = ref(false);
const showGroupDMs = ref(false);
const showNewConversation = ref(false);
const showCreateChannel = ref(false);

const currentRoomId = computed(() => officeStore.currentRoomId);
const STATUS_LABELS = {
	online: "Online",
	away: "Away",
	busy: "Busy",
	offline: "Offline",
};
const myPresenceLabel = computed(
	() => STATUS_LABELS[avatarStore.status] || "Offline",
);
const mySlackDisplay = computed(() =>
	slackStatusForDisplay(avatarStore.slackStatus),
);

// ── Native messaging helpers ──────────────────────────────────────────
function relativeTime(ts) {
	if (!ts) return '';
	const d = new Date(ts);
	const now = new Date();
	const diffMs = now - d;
	const diffMin = Math.floor(diffMs / 60_000);
	if (diffMin < 1) return 'now';
	if (diffMin < 60) return `${diffMin}m`;
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) return `${diffHr}h`;
	const diffDay = Math.floor(diffHr / 24);
	if (diffDay < 7) return `${diffDay}d`;
	return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function truncateBody(body, max = 40) {
	if (!body) return '';
	return body.length > max ? body.slice(0, max) + '…' : body;
}
const myName = computed(() => avatarStore.displayName || "You");
const myInitials = computed(() => avatarStore.avatarInitials);
const myColor = computed(() => avatarStore.color);
const statusColor = computed(() => avatarStore.statusColor);
// Dev/test users have synthetic @localhost emails — hide them when offline so stale
// rows don't pollute the list, but always show real users regardless of status.
const isDevUser = (u) => u.email?.includes("@localhost");

const QuickerStormUsers = computed(() => {
	const online = presenceStore.users.filter((u) => u.status !== "offline");
	const offlineReal = presenceStore.users.filter(
		(u) => u.status === "offline" && !isDevUser(u),
	);
	return [...online, ...offlineReal].sort((a, b) =>
		(a.name || "").localeCompare(b.name || ""),
	);
});

const onlineCount = computed(() => presenceStore.onlineUsers.length);
// Exclude offline dev/test rows from the total so stale tabs don't inflate the count
const teamTotal = computed(
	() =>
		presenceStore.users.filter(
			(u) => u.status !== "offline" || !isDevUser(u),
		).length,
);

const STATUS_COLORS = {
	online: "#00c853",
	away: "#ff6d00",
	busy: "#f44336",
	offline: "#4d6080",
};
function userStatusColor(user) {
	return STATUS_COLORS[user.status] || STATUS_COLORS.offline;
}

const usersInRoom = computed(
	() => (roomId) => presenceStore.usersInRoom(roomId),
)
const usersInOfficesCount = computed(() =>
	presenceStore.users.filter(u => u.status !== 'offline' && /^office-\d+$/.test(u.roomId)).length
)

const _roomIcon = {
	lobby: HomeIcon,
	conference: TvIcon,
	"meeting-a": ChatBubbleLeftRightIcon,
	"meeting-b": ChatBubbleLeftRightIcon,
	"break-room": CakeIcon,
	gym: BoltIcon,
};

const statusOptions = [
	{ value: "online", label: "Online", color: "#00c853" },
	{ value: "away", label: "Away", color: "#ff6d00" },
	{ value: "busy", label: "Busy", color: "#f44336" },
	{ value: "offline", label: "Offline", color: "#4d6080" },
];

const showStatusMenu = ref(false);
const myPresenceEl = ref(null);
const sidebarBodyRef = ref(null);
const statusMenuFixedStyle = ref({});
const statusDraft = ref(""); // combined "🎵 text" or ":shortcode: text"
const selectedEmoji = ref(""); // chosen emoji to prepend
const showEmojiPicker = ref(false);
const emojiSearch = ref("");

const EMOJI_CATEGORIES = {
	"Frequently Used": [
		"😀", "😊", "🙂", "😎", "🤔", "😴", "🤒", "😤",
		"👋", "👍", "🎉", "❤️", "🔥", "✅", "⛔", "🚫",
	],
	"Work": [
		"💻", "📞", "📅", "📝", "📊", "📧", "💼", "🏢",
		"🖥️", "⌨️", "🖨️", "📁", "📌", "✏️", "🗂️", "📎",
		"🔔", "🔇", "🔒", "🔑", "💡", "📋", "🗓️", "⏰",
	],
	"Status": [
		"🏠", "🚗", "🚌", "✈️", "🚀", "🌴", "🏖️", "⛱️",
		"🍕", "🍔", "☕", "🍽️", "🎧", "🎵", "📖", "🏃",
		"🧘", "💪", "🏋️", "🎮", "📺", "🛌", "🔨", "🧑‍💻",
	],
	"People": [
		"😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂",
		"🙂", "🙃", "😉", "😊", "😇", "🥰", "😍", "🤩",
		"😘", "😋", "😛", "🤪", "😜", "🤑", "🤗", "🤭",
		"🤫", "🤔", "🫡", "🤐", "😐", "😑", "😶", "🫥",
		"😏", "😒", "🙄", "😬", "🤥", "😌", "😔", "😪",
		"🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮", "🥵",
		"🥶", "🥴", "😵", "🤯", "🥳", "🥸", "😎", "🤓",
		"😤", "😠", "😡", "🤬", "😈", "💀", "💩", "🤡",
	],
	"Nature": [
		"🌞", "🌙", "⭐", "🌈", "☁️", "⛈️", "❄️", "🔥",
		"🌊", "🌸", "🌺", "🌻", "🌿", "🍀", "🍂", "🍁",
		"🐶", "🐱", "🐻", "🦊", "🐼", "🐨", "🦁", "🐸",
	],
	"Objects": [
		"⚽", "🏀", "🏈", "🎾", "🎯", "🎲", "🎸", "🎹",
		"🎤", "🎬", "📷", "💎", "💰", "🎁", "🏆", "🥇",
		"🔧", "🛠️", "⚙️", "🧪", "🧲", "💊", "🩺", "🧬",
	],
	"Symbols": [
		"❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍",
		"💯", "💢", "💬", "👁️‍🗨️", "🕐", "🕑", "🕒", "🕓",
		"✅", "❌", "⚠️", "🔴", "🟢", "🔵", "⬛", "⬜",
	],
};

const filteredEmojiCategories = computed(() => {
	const q = emojiSearch.value.trim().toLowerCase();
	if (!q) return EMOJI_CATEGORIES;
	// Flatten, filter, return single category
	const all = Object.values(EMOJI_CATEGORIES).flat();
	const unique = [...new Set(all)];
	// Simple search: we can't search by name without a map, so just return all when searching
	// In practice, users will browse categories or just scroll
	return { "Results": unique };
});

function pickEmoji(emoji) {
	if (selectedEmoji.value === emoji) {
		selectedEmoji.value = "";
	} else {
		selectedEmoji.value = emoji;
	}
	showEmojiPicker.value = false;
	// Rebuild the draft: replace any existing emoji prefix with new choice
	const { text } = parseStatusDraft(statusDraft.value);
	statusDraft.value = selectedEmoji.value
		? `${selectedEmoji.value} ${text}`
		: text;
}
const statusExpiry = ref("2h"); // '0' | '30m' | '1h' | '2h' | '4h' | 'today' | 'week'
const statusCustomSaving = ref(false);
const statusCustomError = ref("");

let statusMenuRepositionOff = null;
function layoutStatusMenu() {
	const el = myPresenceEl.value;
	if (!el) return;
	const r = el.getBoundingClientRect();
	const marginL = 10; // 0.625rem — matches prior inset from sidebar
	const gap = 4;
	statusMenuFixedStyle.value = {
		top: `${Math.round(r.bottom + gap)}px`,
		left: `${Math.round(r.left + marginL)}px`,
	};
}

function detachStatusMenuReposition() {
	statusMenuRepositionOff?.();
	statusMenuRepositionOff = null;
}

watch(showStatusMenu, async (open) => {
	if (open) {
		openModal();
		const e = avatarStore.statusEmoji.trim();
		const t = avatarStore.statusMessage.trim();
		statusDraft.value = e && t ? `${e} ${t}` : e || t;
		selectedEmoji.value = e || "";
		statusExpiry.value = "2h";
		statusCustomError.value = "";
		detachStatusMenuReposition();
		await nextTick();
		layoutStatusMenu();
		const onReposition = () => {
			layoutStatusMenu();
		};
		const scrollEl = sidebarBodyRef.value;
		window.addEventListener("resize", onReposition);
		scrollEl?.addEventListener("scroll", onReposition, { passive: true });
		statusMenuRepositionOff = () => {
			window.removeEventListener("resize", onReposition);
			scrollEl?.removeEventListener("scroll", onReposition);
		};
	} else {
		detachStatusMenuReposition();
		closeModal();
		showEmojiPicker.value = false;
	}
});
watch(collapsed, () => {
	if (showStatusMenu.value) void nextTick(() => layoutStatusMenu());
});

onUnmounted(() => {
	detachStatusMenuReposition();
});

// Parse "🎵 text" or ":coffee: text" or just "text" from the combined input.
function parseStatusDraft(raw) {
	const s = (raw || "").trim();
	// :shortcode: at start
	const sc = s.match(/^(:[a-z0-9_+\-]+:)\s*(.*)$/is); // eslint-disable-line no-useless-escape
	if (sc) return { emoji: sc[1], text: sc[2].trim() };
	// Unicode emoji character(s) at start
	/* eslint-disable no-misleading-character-class */
	const ue = s.match(
		/^([\p{Emoji_Presentation}\p{Extended_Pictographic}][\u200d\ufe0f\u{1f3fb}-\u{1f3ff}]*)\s*(.*)$/u,
	);
	/* eslint-enable no-misleading-character-class */
	if (ue && ue[1]) return { emoji: ue[1], text: ue[2].trim() };
	return { emoji: "", text: s };
}

/* function computeExpiryTimestamp(option) {
	if (!option || option === "0") return 0;
	const now = Math.floor(Date.now() / 1000);
	switch (option) {
		case "30m":
			return now + 30 * 60;
		case "1h":
			return now + 60 * 60;
		case "2h":
			return now + 2 * 60 * 60;
		case "4h":
			return now + 4 * 60 * 60;
		case "today": {
			const d = new Date();
			d.setHours(23, 59, 59, 0);
			return Math.floor(d.getTime() / 1000);
		}
		case "week": {
			const d = new Date();
			const daysToFri = (5 - d.getDay() + 7) % 7 || 7;
			d.setDate(d.getDate() + daysToFri);
			d.setHours(23, 59, 59, 0);
			return Math.floor(d.getTime() / 1000);
		}
	}
	return 0;
} */
const showSlackPanel = ref(false);
const dmTarget = ref(null); // Slack member currently being messaged
const dmText = ref("");
const dmSending = ref(false);
const dmError = ref("");
const inviteSending = ref(new Set()); // member IDs currently sending
const inviteSent = ref(new Set()); // member IDs that were sent successfully

// Slack IDs that already have an quickerSTORM presence row (matched via slackId field)
const QuickerStormSlackIds = computed(
	() => new Set(presenceStore.users.map((u) => u.slackId).filter(Boolean)),
);

// Slack members who are either not in quickerSTORM at all, or currently offline.
// Online/away/busy quickerSTORM users are already in the main sidebar list.
const slackOnlyUsers = computed(() => {
	if (!slack.isLoaded.value) return [];
	const presenceByEmail = new Map(
		presenceStore.users
			.filter((u) => u.email)
			.map((u) => [u.email.toLowerCase(), u]),
	);
	// const myEmail = userStore.user?.Email?.toLowerCase() || "";
	return slack.members.value
		.filter((m) => {
			if (m.is_bot || m.deleted || !m.profile?.email) return false;
			const email = m.profile.email.toLowerCase();
			// if (email === myEmail) return false;
			const avaUser = presenceByEmail.get(email);
			// Include if never joined quickerSTORM, or currently offline
			return !avaUser || avaUser.status === 'offline';
		})
		.sort((a, b) => {
			const nameA = (
				a.profile?.display_name ||
				a.real_name ||
				""
			).toLowerCase();
			const nameB = (
				b.profile?.display_name ||
				b.real_name ||
				""
			).toLowerCase();
			return nameA.localeCompare(nameB);
		});
});

// Fetch presence + channels the first time the panel is opened
watch(showSlackPanel, (open) => {
	if (open) {
		slack.fetchPanelPresence(slackOnlyUsers.value.map((m) => m.id));
		if (!slack.myChannels.value.length) slack.fetchMyChannels();
	}
});
watch(showChannels, (open) => {
	if (!open) return;
	if (!slack.myChannels.value.length)
		slack.fetchMyChannels().then(() => slack.pollUnreadCounts());
	else slack.pollUnreadCounts();
});

function slackInitials(m) {
	const name = m.profile?.display_name || m.real_name || "";
	const parts = name.trim().split(" ").filter(Boolean);
	if (parts.length >= 2) return (parts[0][0] + parts.at(-1)[0]).toUpperCase();
	return name.slice(0, 2).toUpperCase() || "?";
}

function slackStatusText(m) {
	return slackStatusFromProfile(m);
}

function QuickerStormStatusLine(user) {
	return slackStatusForDisplay(user.slackStatus);
}

// Deterministic muted color from Slack user ID
function slackColor(m) {
	const palette = ["#3d5470", "#4a6070", "#3a5868", "#445e70", "#506070"];
	let h = 0;
	for (const c of m.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return palette[h % palette.length];
}

function toggleDM(member) {
	if (dmTarget.value?.id === member.id) {
		dmTarget.value = null;
		return;
	}
	dmTarget.value = member;
	dmText.value = "";
	dmError.value = "";
}

async function sendDM() {
	if (!dmTarget.value || !dmText.value.trim()) return;
	dmSending.value = true;
	dmError.value = "";
	try {
		// Use dmUser (not dmByEmail) to handle AVA vs SP email mismatch
		await slack.dmUser(
			{
				slackId: dmTarget.value.id,
				name: dmTarget.value.profile?.real_name,
				email: dmTarget.value.profile?.email,
			},
			dmText.value.trim(),
		);
		playSound('sent.mp3');
		dmTarget.value = null;
		dmText.value = "";
	} catch (err) {
		dmError.value = err.message || "Failed to send";
	} finally {
		dmSending.value = false;
	}
}

async function inviteUser(member) {
	if (inviteSending.value.has(member.id)) return;
	const name = member.profile?.display_name || member.real_name || "there";
	inviteSending.value = new Set([...inviteSending.value, member.id]);
	try {
		await slack.dmUser(
			{
				slackId: member.id,
				name: member.profile?.real_name,
				email: member.profile?.email,
			},
			// `Hey ${name}! Come hang out with us in quickerSTORM 👋 ${window.location.href}`,
			`Hey ${name}! Come hang out with us in quickerSTORM 👋 https://app.quickerSTORM.net/`,
			// `Hey ${name}! Come hang out with us in quickerSTORM 👋 https://inclusivemedium.sharepoint.com/QuickerStorm/SiteAssets/index.aspx`,
			{ forceBot: true },
		);
		inviteSent.value = new Set([...inviteSent.value, member.id]);
		setTimeout(() => {
			inviteSent.value = new Set(
				[...inviteSent.value].filter((id) => id !== member.id),
			);
		}, 3000);
	} catch (err) {
		console.warn("[sidebar] invite failed:", err.message);
	} finally {
		inviteSending.value = new Set(
			[...inviteSending.value].filter((id) => id !== member.id),
		);
	}
}

// Split channels into DMs and named channels, each sorted alphabetically
const _myDMs = computed(() =>
	slack.myChannels.value
		.filter((c) => c.is_im)
		.sort((a, b) => (a._dmName || "").localeCompare(b._dmName || "")),
);
const myNamedChannels = computed(() =>
	slack.myChannels.value
		.filter((c) => !c.is_im && !c.is_mpim && c.name)
		.sort((a, b) => {
			// Starred/favorited channels float to the top, then alphabetical within each group
			if (!!a.is_starred !== !!b.is_starred) return a.is_starred ? -1 : 1;
			return (a.name || "").localeCompare(b.name || "");
		}),
);
// Group DMs: most recently active first.
// Slack's `priority` field (0–1) is the most reliable recency indicator for DMs/MPIMs
// (it's what Slack itself uses to order the DM list). Fall back to latest.ts, then updated.
const myGroupDMs = computed(() =>
	slack.myChannels.value
		.filter((c) => c.is_mpim)
		.sort(
			(a, b) =>
				(b.priority || 0) - (a.priority || 0) ||
				(parseFloat(b.latest?.ts) || 0) -
					(parseFloat(a.latest?.ts) || 0) ||
				(b.updated || 0) - (a.updated || 0),
		)
		.slice(0, 8),
);

// Maps Slack user ID → unread count from their DM channel (used across all user lists)
const dmUnreadBySlackId = computed(() => {
	const map = {};
	for (const ch of slack.myChannels.value.filter((c) => c.is_im && c.user)) {
		const n = slack.dmUnreadCounts.value[ch.id] || 0;
		if (n) map[ch.user] = n;
	}
	return map;
});

// Total DM unreads specifically from Slack-only users (for section header badge)
const slackOnlyDmUnread = computed(() =>
	slackOnlyUsers.value.reduce(
		(sum, m) => sum + (dmUnreadBySlackId.value[m.id] || 0),
		0,
	),
);

// Total unread across all Group DMs (for section header badge)
const groupDmsUnread = computed(() =>
	myGroupDMs.value.reduce(
		(sum, ch) => sum + (slack.dmUnreadCounts.value[ch.id] || 0),
		0,
	),
);

// ── Native messaging unreads for sidebar section badges ──────────────
const groupDmsNativeUnread = computed(() =>
	messaging.groupConversations.value.reduce(
		(sum, c) => sum + (messaging.unreadCounts.value[c.id] || 0), 0,
	),
);
const channelsUnread = computed(() =>
	messaging.channelConversations.value.reduce(
		(sum, c) => sum + (messaging.unreadCounts.value[c.id] || 0), 0,
	),
);

const SLACK_WORKSPACE_URL =
	import.meta.env.VITE_SLACK_WORKSPACE_URL || "https://app.slack.com";

function openSlackChannel(channelId) {
	// Optimistically clear the unread badge — next poll will re-read from Slack
	if (slack.dmUnreadCounts.value[channelId]) {
		slack.dmUnreadCounts.value = {
			...slack.dmUnreadCounts.value,
			[channelId]: 0,
		};
	}
	// /archives/{id} deep-links directly to the channel in any Slack client
	window.open(
		`${SLACK_WORKSPACE_URL}/archives/${channelId}`,
		"_blank",
		"noopener,noreferrer",
	);
}

function _openDmFlyout(channel) {
	slack.openDm(channel);
}

// Open the full DM flyout for a Slack-only member; fall back to compose box
async function openSlackMemberDm(member) {
	if (!avatarStore.slackUserToken) {
		toggleDM(member);
		return;
	}
	try {
		await slack.openDmWithUser({
			slackId: member.id,
			name: member.profile?.real_name,
			email: member.profile?.email,
		});
	} catch {
		toggleDM(member); // flyout failed — fall back to one-shot compose
	}
}

function navigate(roomId, opts = {}) {
	officeStore.navigateTo(roomId, opts);
}

function goToMyOffice() {
	// Picks preferred OFFICES slot / current occupant office only if no other user is
	// already in that room; otherwise first vacant office (see officeStore.goToMyOffice).
	officeStore.goToMyOffice();
}

async function setStatus(val) {
	await avatarStore.setStatus(val);
	showStatusMenu.value = false;
	// await slack.pushMyPresenceToSlack();
}

async function saveCustomStatus() {
	const { emoji, text } = parseStatusDraft(statusDraft.value);
	// const expiration = computeExpiryTimestamp(statusExpiry.value);
	statusCustomSaving.value = true;
	statusCustomError.value = "";
	try {
		await avatarStore.setSlackCustom(emoji, text);
		// if (avatarStore.slackUserToken) {
		// 	await slack.setMyStatus(
		// 		avatarStore.slackUserToken,
		// 		text,
		// 		emoji,
		// 		expiration,
		// 	);
		// }
		// await slack.pushMyPresenceToSlack();
	} catch (e) {
		statusCustomError.value = e.message || "Could not update Slack";
	} finally {
		statusCustomSaving.value = false;
	}
}

async function clearCustomStatus() {
	statusCustomSaving.value = true;
	statusCustomError.value = "";
	try {
		await avatarStore.setSlackCustom("", "");
		statusDraft.value = "";
		statusExpiry.value = "0";
		// if (avatarStore.slackUserToken) {
		// 	await slack.clearMyStatus();
		// }
	} catch (e) {
		statusCustomError.value = e.message || "Could not clear Slack status";
	} finally {
		statusCustomSaving.value = false;
	}
}

defineEmits(["open-avatar", "open-settings"]);

function getRoomLabel(roomId) {
	if (!roomId) return "";
	return ALL_ROOMS.find((r) => r.id === roomId)?.name || roomId;
}

function roomPresenceLabel(user) {
	if (!user.roomId) return "";
	const office = OFFICES.find((o) => o.id === user.roomId);
	if (office) {
		// For the local user, rely on officeStore.myCurrentOfficeId (set by actual
		// navigation + isVisitingOffice flag) rather than the dynamic OFFICES slot
		// assignment, which reshuffles whenever anyone joins or leaves.
		if (String(user.id) === String(presenceStore.myUserId)) {
			return officeStore.isVisitingOffice
				? `Visiting ${office.name}`
				: `Working in ${office.name}`;
		}
		return `Working in ${office.name}`;
	}
	return `In ${getRoomLabel(user.roomId)}`;
}

function isUserTalking(user) {
	return talkingPeers.value.has(String(user.id));
}
</script>

<template>
	<aside
		class="sidebar"
		:class="{ collapsed: collapsed, uncollapsed: !collapsed }"
	>
		<!-- ── Logo / Company ─────────────────────────────── -->
		<div class="sidebar-top">
			<div class="brand" v-if="!collapsed">
				<div class="brand-mark">AVA</div>
				<div class="brand-sub">VERSE</div>
			</div>
			<div class="brand-icon" v-else>A</div>

			<button
				class="collapse-btn"
				@click="collapsed = !collapsed; playSound('pop.mp3', 0.7)"
				:data-tooltip="collapsed ? 'Expand' : 'Collapse'"
				:title="collapsed ? 'Expand' : 'Collapse'"
			>
				<ChevronDoubleLeftIcon v-if="!collapsed" class="icon-sm" />
				<ChevronDoubleRightIcon v-else class="icon-sm" />
			</button>
		</div>

		<div class="sidebar-body" ref="sidebarBodyRef">
			<!-- ── My Avatar / Status ─────────────────────────── -->
			<div
				class="my-presence"
				ref="myPresenceEl"
				@click="showStatusMenu = !showStatusMenu; playSound('pop.mp3', 0.7)"
			>
				<div class="avatar-bubble" :style="{ background: myColor }">
					{{ myInitials }}
					<span
						class="status-pip"
						:style="{ background: statusColor }"
					></span>
				</div>
				<div class="my-info" v-if="!collapsed">
					<div class="my-name">{{ myName }}</div>
					<div class="my-status-stack">
						<div class="my-status-line">{{ myPresenceLabel }}</div>
						<div v-if="mySlackDisplay" class="my-slack-line">
							{{ mySlackDisplay }}
						</div>
					</div>
				</div>
			</div>

			<!-- Status picker (Teleport: full-viewport click-out + dim, same as UserPopup) -->
			<Teleport to="body">
				<Transition name="fade">
					<div
						v-if="showStatusMenu"
						class="status-menu-backdrop"
						aria-hidden="true"
						@pointerdown="showStatusMenu = false"
						@wheel.stop.prevent
					/>
				</Transition>
				<Transition name="fade">
					<div
						v-if="showStatusMenu"
						class="status-menu elevation-3 fixed z-[200] w-[16.375rem]"
						:style="statusMenuFixedStyle"
						role="dialog"
						aria-label="Set status"
						@click.stop
						@pointerdown.stop
					>
						<button
							v-for="opt in statusOptions"
							:key="opt.value"
							class="status-opt"
							:class="{ active: avatarStore.status === opt.value }"
							@click.stop="setStatus(opt.value)"
						>
							<span
								class="status-pip-sm"
								:style="{ background: opt.color }"
							></span>
							{{ opt.label }}
						</button>
						<div class="status-custom">
							<div class="status-custom-label">Status</div>
							<div class="status-input-row" @click.stop>
								<button
									type="button"
									class="emoji-trigger"
									@click="showEmojiPicker = !showEmojiPicker"
									:title="selectedEmoji || 'Pick emoji'"
								>
									{{ selectedEmoji || "😀" }}
								</button>
								<input
									type="text"
									class="status-custom-input status-text-input"
									v-model="statusDraft"
									maxlength="110"
									placeholder="What you're up to…"
									@click.stop
									@keydown.enter.stop="saveCustomStatus"
								/>
							</div>
							<Transition name="fade">
								<div
									v-if="showEmojiPicker"
									class="emoji-picker-popup"
									@click.stop
								>
									<div
										v-for="(emojis, category) in filteredEmojiCategories"
										:key="category"
										class="emoji-category"
									>
										<div class="emoji-category-label">{{ category }}</div>
										<div class="emoji-grid">
											<button
												v-for="em in emojis"
												:key="em"
												type="button"
												class="emoji-btn"
												:class="{ active: selectedEmoji === em }"
												@click="pickEmoji(em)"
												:title="em"
											>
												{{ em }}
											</button>
										</div>
									</div>
								</div>
							</Transition>
							<div class="status-custom-label">Clear after</div>
							<select
								class="status-custom-input status-expiry-select"
								v-model="statusExpiry"
								@click.stop
							>
								<option value="0">Don't clear</option>
								<option value="30m">30 minutes</option>
								<option value="1h">1 hour</option>
								<option value="2h">2 hours</option>
								<option value="4h">4 hours</option>
								<option value="today">Today</option>
								<option value="week">This week</option>
							</select>
							<div class="status-custom-actions">
								<button
									type="button"
									class="status-custom-btn"
									@click.stop="saveCustomStatus"
									:disabled="statusCustomSaving"
								>
									{{ statusCustomSaving ? "…" : "Save" }}
								</button>
								<button
									type="button"
									class="status-custom-btn status-custom-btn--ghost"
									@click.stop="clearCustomStatus"
									:disabled="statusCustomSaving"
								>
									Clear
								</button>
							</div>
							<p
								v-if="!avatarStore.slackUserToken"
								class="status-custom-hint"
							>
								Connect Slack in Settings to sync this to your Slack
								profile.
							</p>
							<p v-if="statusCustomError" class="status-custom-error">
								{{ statusCustomError }}
							</p>
						</div>
					</div>
				</Transition>
			</Teleport>

			<!-- ── Online count ───────────────────────────────── -->
			<!-- <div class="section-label" v-if="!collapsed">
			<UserGroupIcon class="icon-xs" />
			{{ onlineCount }} online
		</div> -->

			<!-- ── Room navigation ───────────────────────────── -->
			<nav class="room-nav">
				<button
					v-if="!collapsed"
					type="button"
					class="sidebar-section-toggle"
					@click="showRooms = !showRooms; playSound('pop.mp3', 0.7)"
				>
					<Squares2X2Icon
						class="sidebar-section-icon"
						aria-hidden="true"
					/>
					<span class="sidebar-section-label truncate"
						>quickerSTORM rooms</span
					>
					<span class="sidebar-section-chevron">{{
						showRooms ? "▾" : "▸"
					}}</span>
				</button>
				<div class="section-label" v-else><!-- Rms --></div>

				<template v-if="showRooms || collapsed">
					<button
						class="nav-item animated-border"
						:class="{ active: currentRoomId === 'lobby' }"
						@click="navigate('lobby')"
						data-tooltip="Lobby"
						title="Lobby"
					>
						<HomeIcon class="icon-sm" />
						<span v-if="!collapsed">Lobby</span>
						<span
							v-if="!collapsed && usersInRoom('lobby').length"
							class="room-count"
							:title="`${usersInRoom('lobby').length} users in Lobby`"
							>{{ usersInRoom("lobby").length }}</span
						>
					</button>

					<button
						class="nav-item animated-border"
						:class="{
							active:
								!!officeStore.myCurrentOfficeId &&
								currentRoomId === officeStore.myCurrentOfficeId,
						}"
						@click="goToMyOffice"
						data-tooltip="My Office"
						title="My Office"
					>
						<component :is="UserGroupIcon" class="icon-sm" />
						<span v-if="!collapsed">My Office</span>
						<span
							v-if="!collapsed && usersInOfficesCount"
							class="room-count room-count--offices"
							:title="`${usersInOfficesCount} user${usersInOfficesCount === 1 ? '' : 's'} in offices`"
						>{{ usersInOfficesCount }}</span>
					</button>

					<button
						v-for="room in QUICK_NAV.slice(1)"
						:key="room.id"
						class="nav-item animated-border"
						:class="{ active: currentRoomId === room.id }"
						@click="navigate(room.id)"
						:data-tooltip="room.label"
						:title="room.label"
					>
						<span class="room-emoji">{{ room.icon }}</span>
						<span v-if="!collapsed">{{ room.label }}</span>
						<span
							v-if="!collapsed && usersInRoom(room.id).length"
							class="room-count"
							:title="`${usersInRoom(room.id).length} users in ${room.label}`"
						>
							{{ usersInRoom(room.id).length }}
						</span>
					</button>
				</template>
			</nav>

			<!-- ── Who's online ──────────────────────────────── -->
			<div class="online-list" v-if="!collapsed">
				<button
					type="button"
					class="sidebar-section-toggle"
					@click="showQuickerStorm = !showQuickerStorm; playSound('pop.mp3', 0.7)"
				>
					<UserGroupIcon
						class="sidebar-section-icon"
						aria-hidden="true"
					/>
					<span class="sidebar-section-label truncate"
						>quickerSTORM users</span
					>
					<span
						@click.stop="showOffline = !showOffline; playSound('pop.mp3', 0.7)"
						v-if="teamTotal"
						class="sidebar-section-badge"
						:title="`${onlineCount} of ${teamTotal} online. Toggle offline users on/off`"
						>{{ onlineCount }}/{{ teamTotal }}</span
					>
					<span class="sidebar-section-chevron">{{
						showQuickerStorm ? "▾" : "▸"
					}}</span>
				</button>
				<template v-if="showQuickerStorm">
					<div
						v-for="user in showOffline
							? QuickerStormUsers
							: QuickerStormUsers.filter(
									(user) =>
										user.status !== 'offline',
								)"
						:key="user.id"
						class="user-row"
						:class="{
							speaking: isUserTalking(user),
							offline: user.status === 'offline',
						}"
						@click="
							user.status !== 'offline' && navigate(user.roomId, { forceVisit: true })
						"
						:title="`click to visit ${user.name}`"
					>
						<div
							class="user-bubble"
							:style="{ background: user.color }"
						>
							{{ user.name?.slice(0, 2).toUpperCase() || "??" }}
							<span
								class="status-pip"
								:style="{ background: userStatusColor(user) }"
							></span>
							<span
								v-if="isUserTalking(user)"
								class="talking-ring"
							/>
						</div>
						<div class="user-info">
							<div class="user-name">{{ user.name }}</div>
							<div
								class="user-room"
								v-if="user.status === 'offline'"
							>
								Offline
							</div>
							<div class="user-room" v-else>
								{{ roomPresenceLabel(user) }}
							</div>
							<div
								class="user-room"
								v-if="
									user.status !== 'offline' &&
									user.slackStatus
								"
								:title="QuickerStormStatusLine(user)"
							>
								{{ QuickerStormStatusLine(user) }}
							</div>
						</div>
						<span
							v-if="messaging.dmUnreadByAuthId.value[user.authUserId]"
							class="ch-unread-badge user-dm-badge"
							title="Unread messages"
							@click.stop="messaging.openDmWithUser(user)"
						>{{ messaging.dmUnreadByAuthId.value[user.authUserId] }}</span>
						<button
							v-else-if="user.authUserId"
							class="user-row-dm p-3"
							title="Open DM"
							@click.stop="messaging.openDmWithUser(user)"
						>
							💬
						</button>
					</div>
				</template>
			</div>

			<!-- ── Group DMs ────────────────────────────────── -->
			<div class="slack-away" v-if="!collapsed">
				<button
					type="button"
					class="sidebar-section-toggle"
					@click="showGroupDMs = !showGroupDMs; playSound('pop.mp3', 0.7)"
				>
					<ChatBubbleLeftRightIcon
						class="sidebar-section-icon"
						aria-hidden="true"
					/>
					<span class="sidebar-section-label truncate"
						>Group DMs</span
					>
					<span
						v-if="groupDmsNativeUnread"
						class="sidebar-section-badge sidebar-section-badge--red"
						>{{ groupDmsNativeUnread }}</span
					>
					<span class="sidebar-section-chevron">{{
						showGroupDMs ? "▾" : "▸"
					}}</span>
				</button>

				<Transition name="fade">
					<div v-if="showGroupDMs" class="slack-away-list">
						<button
							class="section-action-btn"
							@click.stop="showNewConversation = true"
						>New Group</button>
						<div
							v-if="!messaging.conversationsLoaded.value"
							class="slack-empty pulse"
						>
							Loading…
						</div>
						<div
							v-else-if="!messaging.groupConversations.value.length"
							class="slack-empty"
						>
							No group conversations yet
						</div>
						<div
							v-for="conv in messaging.groupConversations.value.slice(0, 20)"
							:key="conv.id"
							class="slack-user-row ch-row"
							@click="messaging.openConversation(conv.id)"
						>
							<div
								class="slack-bubble"
								:style="{ background: messaging.getConversationDisplayInfo(conv).color }"
							>
								{{ messaging.getConversationDisplayInfo(conv).initials }}
							</div>
							<div class="slack-info">
								<div class="slack-name">
									{{ messaging.getConversationDisplayInfo(conv).name }}
								</div>
								<div class="slack-status-text" v-if="conv.lastMessage">
									{{ truncateBody(conv.lastMessage.body) }}
									<span class="msg-time-hint">· {{ relativeTime(conv.lastMessage.created_at) }}</span>
								</div>
							</div>
							<span
								v-if="messaging.unreadCounts.value[conv.id]"
								class="ch-unread-badge"
								>{{ messaging.unreadCounts.value[conv.id] }}</span
							>
						</div>
					</div>
				</Transition>
			</div>

			<!-- ── Channels ────────────────────────────────────── -->
			<div class="slack-away" v-if="!collapsed">
				<button
					type="button"
					class="sidebar-section-toggle"
					@click="showChannels = !showChannels; playSound('pop.mp3', 0.7)"
				>
					<HashtagIcon
						class="sidebar-section-icon"
						aria-hidden="true"
					/>
					<span class="sidebar-section-label truncate"
						>Channels</span
					>
					<span
						v-if="channelsUnread"
						class="sidebar-section-badge sidebar-section-badge--red"
						>{{ channelsUnread }}</span
					>
					<span class="sidebar-section-chevron">{{
						showChannels ? "▾" : "▸"
					}}</span>
				</button>

				<Transition name="fade">
					<div v-if="showChannels" class="slack-away-list">
						<button
							class="section-action-btn"
							@click.stop="showCreateChannel = true"
						>New Channel</button>
						<div
							v-if="!messaging.conversationsLoaded.value"
							class="slack-empty pulse"
						>
							Loading…
						</div>
						<div
							v-else-if="!messaging.channelConversations.value.length"
							class="slack-empty"
						>
							No channels yet
						</div>
						<div
							v-for="ch in messaging.channelConversations.value"
							:key="ch.id"
							class="slack-user-row ch-row"
							@click="messaging.openConversation(ch.id)"
						>
							<span class="ch-sigil">{{ ch.is_private ? '🔒' : '#' }}</span>
							<div class="slack-info">
								<div class="slack-name" :class="{ 'ch-name--unread': messaging.unreadCounts.value[ch.id] }">
									{{ ch.title || 'Untitled' }}
								</div>
								<div class="slack-status-text" v-if="ch.lastMessage">
									{{ truncateBody(ch.lastMessage.body) }}
									<span class="msg-time-hint">· {{ relativeTime(ch.lastMessage.created_at) }}</span>
								</div>
							</div>
							<span
								v-if="messaging.unreadCounts.value[ch.id]"
								class="ch-unread-badge"
								>{{ messaging.unreadCounts.value[ch.id] }}</span
							>
						</div>
					</div>
				</Transition>
			</div>

			<!-- ── Slack Channels (hidden — native messaging replaces Slack) ── -->
			<div
				class="slack-away"
				v-if="false && !collapsed && avatarStore.slackUserToken"
			>
				<button
					type="button"
					class="sidebar-section-toggle"
					@click="showChannels = !showChannels"
				>
					<HashtagIcon
						class="sidebar-section-icon"
						aria-hidden="true"
					/>
					<span class="sidebar-section-label truncate"
						>Slack channels<span v-if="myNamedChannels.length">
							({{ myNamedChannels.length }})</span
						></span
					>
					<span
						v-if="slack.totalDmUnread.value"
						class="sidebar-section-badge sidebar-section-badge--red"
						>{{ slack.totalDmUnread.value }}</span
					>
					<!-- <span v-else-if="slack.myChannels.value.length" class="sidebar-section-badge">{{ slack.myChannels.value.length }}</span> -->
					<span class="sidebar-section-chevron">{{
						showChannels ? "▾" : "▸"
					}}</span>
				</button>

				<Transition name="fade">
					<div v-if="showChannels" class="slack-away-list">
						<div
							v-if="slack.myChannelsLoading.value"
							class="slack-empty pulse"
						>
							Loading channels…
						</div>
						<div
							v-else-if="!slack.myChannels.value.length"
							class="slack-empty"
						>
							No channels found
						</div>

						<!-- Named channels -->
						<template v-if="myNamedChannels.length">
							<div
								v-for="ch in myNamedChannels"
								:key="ch.id"
								class="slack-user-row ch-row"
								@click="openSlackChannel(ch.id)"
								:title="
									ch.is_starred
										? 'Starred'
										: ch.is_private
											? 'Private channel'
											: 'Public channel'
								"
							>
								<span class="ch-sigil">{{
									ch.is_starred
										? "⭐"
										: ch.is_private
											? "🔒"
											: "#"
								}}</span>
								<div class="slack-info">
									<div
										class="slack-name"
										:class="{
											'ch-name--unread':
												slack.channelHasUnread.value[
													ch.id
												],
										}"
									>
										{{ ch.name }}
									</div>
								</div>
								<span
									v-if="slack.dmUnreadCounts.value[ch.id]"
									class="ch-unread-badge"
								>
									{{ slack.dmUnreadCounts.value[ch.id] }}
								</span>
								<span
									v-else-if="
										slack.channelHasUnread.value[ch.id]
									"
									class="ch-unread-dot"
								/>
								<span v-else class="ch-ext">↗</span>
							</div>
						</template>
					</div>
				</Transition>
			</div>

			<!-- ── On Slack (not yet in quickerSTORM) ───────────── -->
			<!-- ── Slack Everyone (hidden — native messaging replaces Slack) ── -->
			<div class="slack-away" v-if="false && !collapsed && slack.isLoaded.value">
				<button
					type="button"
					class="sidebar-section-toggle"
					@click="showSlackPanel = !showSlackPanel"
				>
					<ChatBubbleLeftRightIcon
						class="sidebar-section-icon"
						aria-hidden="true"
					/>
					<span class="sidebar-section-label truncate"
						>Slack everyone
						<span v-if="slackOnlyUsers.length"
							>({{ slackOnlyUsers.length }})</span
						></span
					>
					<span
						v-if="slackOnlyDmUnread"
						class="sidebar-section-badge sidebar-section-badge--red"
						>{{ slackOnlyDmUnread }}</span
					>
					<!-- <span v-else-if="slackOnlyUsers.length" class="sidebar-section-badge">{{ slackOnlyUsers.length }}</span> -->
					<span class="sidebar-section-chevron">{{
						showSlackPanel ? "▾" : "▸"
					}}</span>
				</button>

				<Transition name="fade">
					<div v-if="showSlackPanel" class="slack-away-list">
						<div v-if="!slackOnlyUsers.length" class="slack-empty">
							Everyone's already here!
						</div>
						<template
							v-for="member in slackOnlyUsers"
							:key="member.id"
						>
							<div
								class="slack-user-row"
								:class="{
									'ch-row--active':
										slack.activeDmChannel.value?.user ===
										member.id,
								}"
								@click="openSlackMemberDm(member)"
							>
								<div
									class="slack-bubble"
									:style="{ background: slackColor(member) }"
								>
									{{ slackInitials(member) }}
									<span
										class="slack-presence-pip"
										:class="
											slack.presenceMap.value[
												member.id
											] === 'active'
												? 'pip-active'
												: 'pip-away'
										"
										v-if="
											member.id in slack.presenceMap.value
										"
									/>
								</div>
								<div class="slack-info">
									<div class="slack-name">
										{{
											member.profile?.display_name ||
											member.real_name
										}}
									</div>
									<div
										class="slack-status-text"
										v-if="slackStatusText(member)"
										:title="slackStatusText(member)"
									>
										{{ slackStatusText(member) }}
									</div>
								</div>
								<span
									v-if="dmUnreadBySlackId[member.id]"
									class="ch-unread-badge"
								>
									{{ dmUnreadBySlackId[member.id] || 0 }}
								</span>
								<button
									v-else
									class="slack-invite-btn"
									:class="{
										sent: inviteSent.has(member.id),
										sending: inviteSending.has(member.id),
										member: QuickerStormSlackIds.has(member.id),
									}"
									:title="
										inviteSent.has(member.id)
											? 'Invite sent!'
											: QuickerStormSlackIds.has(member.id)
												? 'Reinvite to quickerSTORM'
												: 'Invite to quickerSTORM'
									"
									@click.stop="inviteUser(member)"
								>
									<span
										v-if="inviteSent.has(member.id)"
										class="invite-check"
										>✓</span
									>
									<span
										v-else-if="inviteSending.has(member.id)"
										>…</span
									>
									<EnvelopeIcon
										v-else
										class="slack-invite-icon"
									/>
								</button>
							</div>

							<!-- Inline DM compose -->
							<div
								v-if="dmTarget?.id === member.id"
								class="slack-dm-box"
							>
								<textarea
									class="slack-dm-input"
									v-model="dmText"
									placeholder="Message…"
									rows="2"
									@keydown.enter.ctrl="sendDM"
									autofocus
								/>
								<div class="slack-dm-footer">
									<span class="slack-dm-hint" v-if="!dmError"
										>Ctrl+Enter to send</span
									>
									<span class="slack-dm-error" v-else>{{
										dmError
									}}</span>
									<div class="slack-dm-btns">
										<button
											class="sdm-cancel"
											@click.stop="dmTarget = null"
										>
											Cancel
										</button>
										<button
											class="sdm-send"
											:disabled="
												!dmText.trim() || dmSending
											"
											@click.stop="sendDM"
										>
											{{ dmSending ? "…" : "Send" }}
										</button>
									</div>
								</div>
							</div>
						</template>
					</div>
				</Transition>
			</div>

			<!-- ── Group DMs (hidden — native messaging replaces Slack) ── -->
			<div
				class="slack-away"
				v-if="false &&
					!collapsed &&
					avatarStore.slackUserToken &&
					myGroupDMs.length
				"
			>
				<button
					type="button"
					class="sidebar-section-toggle"
					@click="showGroupDMs = !showGroupDMs"
				>
					<ChatBubbleLeftRightIcon
						class="sidebar-section-icon"
						aria-hidden="true"
					/>
					<span
						class="sidebar-section-label truncate"
						title="Group DMs are a work-in-progress"
						>Group DMs (WIP)</span
					>
					<span
						v-if="groupDmsUnread"
						class="sidebar-section-badge sidebar-section-badge--red"
						>{{ groupDmsUnread }}</span
					>
					<span class="sidebar-section-chevron">{{
						showGroupDMs ? "▾" : "▸"
					}}</span>
				</button>
				<Transition name="fade">
					<div v-if="showGroupDMs" class="slack-away-list">
						<div
							v-for="ch in myGroupDMs"
							:key="ch.id"
							class="slack-user-row ch-row"
							@click="openSlackChannel(ch.id)"
						>
							<span class="ch-sigil">👥</span>
							<div class="slack-info">
								<div
									class="slack-name"
									:title="
										ch.name
											?.replace(/^mpdm-/, '')
											.replace(/--/g, ', ')
											.replace(/-\d+$/, '')
									"
								>
									{{
										ch.name
											?.replace(/^mpdm-/, "")
											.replace(/--/g, ", ")
											.replace(/-\d+$/, "")
									}}
								</div>
							</div>
							<span
								v-if="slack.dmUnreadCounts.value[ch.id]"
								class="ch-unread-badge"
								>{{ slack.dmUnreadCounts.value[ch.id] }}</span
							>
							<span v-else class="ch-ext">↗</span>
						</div>
					</div>
				</Transition>
			</div>

			<!-- ── Integrations ──────────────────────────────── -->
			<!-- <div class="integrations" v-if="!collapsed">
			<div class="section-label">Integrations</div>
			<a href="https://app.slack.com" target="_blank" class="int-btn" data-tooltip="Slack">
				<span class="int-icon">💬</span> Slack
			</a>
			<a href="https://zoom.us" target="_blank" class="int-btn" data-tooltip="Zoom">
				<span class="int-icon">🎥</span> Zoom
			</a>
			<a :href="gmailUrl" target="_blank" class="int-btn" data-tooltip="Gmail">
				<span class="int-icon">📧</span> Gmail
			</a>
			<a :href="calendarUrl" target="_blank" class="int-btn" data-tooltip="Calendar">
				<span class="int-icon">📅</span> Calendar
			</a>
			<div v-if="!collapsed" class="google-acct-row" title="Getting your personal Google account? Change this to match your AVA account (usually 1)">
				<span class="google-acct-label">Google acct</span>
				<button class="g-idx-btn" @click="avatarStore.setGoogleAccountIndex(googleIdx - 1)" :disabled="googleIdx === 0">−</button>
				<span class="g-idx-val">{{ googleIdx }}</span>
				<button class="g-idx-btn" @click="avatarStore.setGoogleAccountIndex(googleIdx + 1)" :disabled="googleIdx >= 9">+</button>
			</div>
		</div> -->

			<!-- ── Polls (room-scoped) ─────────────────── -->
			<div class="sidebar-polls-slot">
				<SidebarPolls :collapsed="collapsed" />
			</div>
		</div>

		<!-- ── Bottom actions ────────────────────────────── -->
		<div class="sidebar-bottom hidden">
			<button
				class="bottom-btn"
				@click="$emit('open-avatar')"
				data-tooltip="Edit Avatar"
				title="Edit Avatar"
			>
				<span>🎭</span>
				<span v-if="!collapsed">Avatar</span>
			</button>
			<button
				class="bottom-btn"
				@click="$emit('open-settings')"
				data-tooltip="Settings"
				title="Settings"
			>
				<span>⚙️</span>
				<span v-if="!collapsed">Settings</span>
			</button>
		</div>
	</aside>

	<NewConversationModal
		v-if="showNewConversation"
		@close="showNewConversation = false"
	/>

	<CreateChannelModal
		v-if="showCreateChannel"
		@close="showCreateChannel = false"
	/>
</template>

<style scoped>
.sidebar {
	width: var(--sidebar-w);
	min-width: var(--sidebar-w);
	height: 100vh;
	background: var(--color-side);
	border-right: 1px solid var(--color-brd);
	display: flex;
	flex-direction: column;
	overflow: visible;
	transition:
		width 0.25s,
		min-width 0.25s;
	flex-shrink: 0;
	z-index: 550;
	user-select: none;
}
/* Scroll lives here so header/footer escape overflow clipping; [data-tooltip]::after can extend past the column edge. */
.sidebar-body {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	overflow-x: hidden;
}
.sidebar-polls-slot {
	border-top: 1px solid var(--color-brd);
	margin-top: 0.5rem;
	padding-bottom: 0.5rem;
}
/* Room nav (inside .sidebar-body) still clips absolute ::after; anchor-positioned fixed tooltips escape the scrollport. */
@supports (position-anchor: auto) {
	.sidebar-body [data-tooltip]::after {
		position: fixed;
		position-anchor: auto;
		left: anchor(right);
		top: anchor(center);
		transform: translateY(-50%);
		margin-left: 0.5rem;
	}
}
.sidebar.collapsed {
	align-items: center;
	width: 3.25rem;
	min-width: 3.25rem;
}

/* ── Brand ── */
.sidebar-top {
	display: flex;
	align-items: center;
	justify-content: space-between;
	border-bottom: 1px solid var(--color-brd);
	padding: 0.875rem 0 0.625rem 0.75rem;
	width: 100%;
	flex-shrink: 0;
}
.sidebar:not(.collapsed) .sidebar-top {
	padding-right: 0.75rem;
}
.brand {
	display: flex;
	align-items: baseline;
	gap: 0.125rem;
}
.brand-mark {
	font-family: "EurostileExtended", "RobotoFlex", sans-serif;
	font-size: clamp(1.25rem, 1.35vw, 1.625rem);
	font-weight: 800;
	color: var(--color-accent3);
	letter-spacing: -0.02em;
}
.brand-sub {
	font-size: 0.8rem;
	font-weight: 600;
	color: var(--color-tm);
	letter-spacing: 0.12em;
}
.brand-icon {
	font-size: clamp(1.25rem, 1.35vw, 1.625rem);
	font-weight: 800;
	color: var(--color-accent3);
	text-align: center;
}
.collapse-btn {
	background: none;
	border: none;
	cursor: pointer;
	color: var(--color-tm);
	padding: 0.25rem;
	border-radius: 0.25rem;
	transition: color 0.15s;
	display: flex;
	align-items: center;
}
.collapse-btn:hover {
	color: var(--color-t2);
}

/* ── Presence ── */
.my-presence {
	display: flex;
	align-items: center;
	gap: 0.625rem;
	padding: 0.65rem;
	cursor: pointer;
	border-bottom: 1px solid var(--color-brd);
	transition: background 0.15s;
	flex-shrink: 0;
}
.my-presence:hover {
	background: rgba(255, 255, 255, 0.03);
}
.avatar-bubble {
	width: 2.125rem;
	height: 2.125rem;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 0.75rem;
	font-weight: 700;
	color: rgba(255, 255, 255, 0.9);
	position: relative;
	flex-shrink: 0;
}
.status-pip {
	position: absolute;
	bottom: 0;
	right: 0;
	width: 0.625rem;
	height: 0.625rem;
	border-radius: 50%;
	border: 2px solid var(--color-side);
}
.status-pip-sm {
	display: inline-block;
	width: 0.5rem;
	height: 0.5rem;
	border-radius: 50%;
	margin-right: 0.375rem;
}
.my-info {
	flex: 1;
	min-width: 0;
}
.my-name {
	font-size: clamp(0.75rem, 0.75vw, 0.9375rem);
	font-weight: 600;
	color: var(--color-t1);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.my-status-stack {
	display: flex;
	flex-direction: column;
	gap: 0.125rem;
	min-width: 0;
}
.my-status-line {
	font-size: 0.6875rem;
	color: var(--color-tm);
}
.my-slack-line {
	font-size: 0.625rem;
	color: var(--color-tm);
	line-height: 1.25;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

/* Status menu — position from statusMenuFixedStyle; Teleport to body for canvas overlay */
.status-menu {
	background: var(--color-card2);
	border: 1px solid var(--color-brd);
	border-radius: 0.375rem;
	min-height: 20rem;
	overflow: hidden;
}
/* Full-viewport dim + blur; z below .status-menu (z-[200]), matches DmFlyout / modals */
.status-menu-backdrop {
	position: fixed;
	inset: 0;
	z-index: 198;
	cursor: default;
	background: rgba(0, 0, 0, 0.4);
	backdrop-filter: blur(4px);
	-webkit-backdrop-filter: blur(4px);
}
.status-opt {
	width: 100%;
	display: flex;
	align-items: center;
	padding: 0.5rem 0.75rem;
	background: none;
	border: none;
	color: var(--color-t2);
	font-size: clamp(0.7rem, 0.7vw, 0.875rem);
	cursor: pointer;
	transition:
		background 0.12s,
		color 0.12s;
}
.status-opt:hover,
.status-opt.active {
	background: rgba(255, 255, 255, 0.05);
	color: var(--color-t1);
}
.status-custom {
	padding: 0.5rem 0.75rem 0.625rem;
	border-top: 1px solid var(--color-brd);
}
.status-input-row {
	display: flex;
	gap: 0.375rem;
	align-items: center;
	margin-bottom: 0.5rem;
}
.emoji-trigger {
	flex-shrink: 0;
	width: 2rem;
	height: 2rem;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 1.1rem;
	border: 1px solid var(--color-brd);
	border-radius: 0.25rem;
	background: rgba(0, 0, 0, 0.45);
	cursor: pointer;
	transition: border-color 0.15s;
}
.emoji-trigger:hover {
	border-color: var(--color-accent3);
}
.status-text-input {
	flex: 1;
	margin-bottom: 0 !important;
}
.emoji-picker-popup {
	max-height: 14rem;
	overflow-y: auto;
	background: var(--color-bg, #1a1f2e);
	border: 1px solid var(--color-brd);
	border-radius: 0.375rem;
	padding: 0.375rem;
	margin-bottom: 0.5rem;
}
.emoji-picker-popup::-webkit-scrollbar {
	width: 4px;
}
.emoji-picker-popup::-webkit-scrollbar-thumb {
	background: rgba(255, 255, 255, 0.15);
	border-radius: 2px;
}
.emoji-category {
	margin-bottom: 0.25rem;
}
.emoji-category-label {
	font-size: 0.5625rem;
	font-weight: 600;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-tm);
	padding: 0.25rem 0.125rem 0.125rem;
}
.emoji-grid {
	display: flex;
	flex-wrap: wrap;
	gap: 0.0625rem;
}
.emoji-btn {
	width: 1.625rem;
	height: 1.625rem;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 0.85rem;
	border: 1px solid transparent;
	border-radius: 0.25rem;
	background: transparent;
	cursor: pointer;
	padding: 0;
	transition: background 0.12s, border-color 0.12s;
}
.emoji-btn:hover {
	background: rgba(255, 255, 255, 0.08);
}
.emoji-btn.active {
	background: rgba(0, 180, 216, 0.2);
	border-color: var(--color-accent3);
}
.status-custom-label {
	font-size: 0.5625rem;
	font-weight: 600;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--color-tm);
	margin-bottom: 0.25rem;
}
.status-custom-input {
	width: 100%;
	box-sizing: border-box;
	padding: 0.375rem 0.5rem;
	margin-bottom: 0.5rem;
	font-size: clamp(0.65rem, 0.65vw, 0.8125rem);
	background: rgba(0, 0, 0, 0.45);
	border: 1px solid var(--color-brd);
	border-radius: 0.25rem;
	color: var(--color-t1);
	user-select: none;
}
.status-custom-input::placeholder {
	color: var(--color-tm);
	opacity: 0.7;
}
.status-expiry-select {
	cursor: pointer;
	appearance: auto;
}
.status-custom-actions {
	display: flex;
	gap: 0.375rem;
	margin-top: 0.25rem;
}
.status-custom-btn {
	flex: 1;
	padding: 0.375rem 0.5rem;
	font-size: clamp(0.65rem, 0.65vw, 0.8125rem);
	font-weight: 600;
	border-radius: 0.25rem;
	border: 1px solid var(--color-brd);
	background: rgba(0, 180, 216, 0.2);
	color: var(--color-accent3);
	cursor: pointer;
}
.status-custom-btn:disabled {
	opacity: 0.5;
	cursor: default;
}
.status-custom-btn--ghost {
	background: transparent;
	color: var(--color-t2);
	font-weight: 500;
}
.status-custom-hint,
.status-custom-error {
	margin: 0.375rem 0 0;
	font-size: 0.5625rem;
	line-height: 1.35;
}
.status-custom-hint {
	color: var(--color-tm);
}
.status-custom-error {
	color: #f44336;
}

/* ── Sections ── */
.section-label {
	display: flex;
	align-items: center;
	gap: 0.3125rem;
	padding: 0.5rem 0.75rem 0.25rem;
	font-size: 0.625rem;
	font-weight: 700;
	color: var(--color-tm);
	letter-spacing: 0.08em;
	text-transform: uppercase;
	flex-shrink: 0;
}

/* ── Room nav ── */
.nav-item {
	width: 100%;
	display: flex;
	align-items: center;
	gap: 0.625rem;
	background: none;
	border: 1px solid transparent;
	border-radius: 0.4375rem;
	padding: 0.35rem 0.65rem;
	font-size: clamp(0.75rem, 0.75vw, 0.9375rem);
	color: var(--color-t2);
	cursor: pointer;
	transition:
		background 0.12s,
		color 0.12s,
		border-color 0.12s;
}
.sidebar.collapsed .nav-item {
	justify-content: center;
}
.nav-item:hover {
	background: rgba(255, 255, 255, 0.05);
	color: var(--color-t1);
}
.nav-item.active {
	background: rgba(0, 180, 216, 0.12);
	color: var(--color-accent3);
	border-color: rgba(0, 180, 216, 0.3);
}
.room-emoji {
	flex-shrink: 0;
	width: 1.125rem;
	font-size: 0.875rem;
}
.sidebar.collapsed .room-emoji {
	font-size: 1.35rem;
	width: 100%;
}
.room-count {
	margin-left: auto;
	background: var(--color-green);
	color: #fff;
	font-size: 0.625rem;
	font-weight: 600;
	border-radius: 0.625rem;
	padding: 0.0625rem 0.375rem;
}
.room-count--offices {
	background: transparent;
	color: var(--color-tm);
	border: 1px solid var(--color-brd2);
}

/* ── Online list ── */
.online-list {
	border-top: 1px solid var(--color-brd);
	flex-shrink: 0;
}
.user-row {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.375rem;
	border-radius: 0.375rem;
	cursor: pointer;
	transition: background 0.12s;
}
.user-row:hover {
	background: rgba(255, 255, 255, 0.04);
}
.user-bubble {
	width: 1.75rem;
	height: 1.75rem;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 0.6rem;
	font-weight: 700;
	color: rgba(255, 255, 255, 0.85);
	position: relative;
	flex-shrink: 0;
}
.user-info {
	min-width: 0;
}
.user-name {
	font-size: clamp(0.7rem, 0.7vw, 0.875rem);
	color: var(--color-t1);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.user-room {
	font-size: 0.625rem;
	color: var(--color-tm);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

/* Talking indicator */
.talking-ring {
	position: absolute;
	inset: -0.1875rem;
	border-radius: 50%;
	border: 2px solid #00c853;
	animation: talk-pulse 0.9s ease-in-out infinite;
	pointer-events: none;
}
@keyframes talk-pulse {
	0%,
	100% {
		opacity: 1;
		transform: scale(1);
	}
	50% {
		opacity: 0.4;
		transform: scale(1.15);
	}
}
.user-row.speaking .user-name {
	color: #5f5;
	font-weight: 700;
}
.user-row.offline {
	opacity: 0.45;
	cursor: default;
}
.user-row.offline:hover {
	background: none;
}
.user-row-dm {
	flex-shrink: 0;
	margin-left: auto;
	background: none;
	border: none;
	font-size: 1rem;
	cursor: pointer;
	border-radius: 0.25rem;
	opacity: 0;
	transition:
		opacity 0.12s,
		background 0.12s;
	line-height: 1;
}
.user-row:hover .user-row-dm {
	opacity: 1;
}
.user-row-dm:hover {
	background: rgba(255, 255, 255, 0.1);
}
/* DM unread badge in quickerSTORM user rows */
.user-dm-badge {
	margin-left: auto;
	flex-shrink: 0;
	cursor: pointer;
}
/* ── Integrations ── */
.integrations {
	padding: 0.25rem 0.5rem 0.5rem;
	border-top: 1px solid var(--color-brd);
}
.int-btn {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.375rem 0.5rem;
	border-radius: 0.375rem;
	color: var(--color-t2);
	font-size: clamp(0.7rem, 0.7vw, 0.875rem);
	transition:
		background 0.12s,
		color 0.12s;
}
.int-btn:hover {
	background: rgba(255, 255, 255, 0.05);
	color: var(--color-t1);
}
.int-icon {
	font-size: 0.8125rem;
}

.google-acct-row {
	display: flex;
	align-items: center;
	gap: 0.25rem;
	padding: 0.1875rem 0.5rem 0.3125rem;
}
.google-acct-label {
	font-size: 0.625rem;
	color: var(--color-tm);
	flex: 1;
	white-space: nowrap;
}
.g-idx-btn {
	background: var(--color-brd);
	border: none;
	border-radius: 0.1875rem;
	color: var(--color-t2);
	font-size: 0.75rem;
	line-height: 1;
	width: 1.25rem;
	height: 1.25rem;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: background 0.12s;
}
.g-idx-btn:hover:not(:disabled) {
	background: var(--color-brd2);
	color: var(--color-t1);
}
.g-idx-btn:disabled {
	opacity: 0.3;
	cursor: default;
}
.g-idx-val {
	font-size: 0.75rem;
	font-weight: 700;
	color: var(--color-t2);
	min-width: 1rem;
	text-align: center;
}

/* ── Bottom ── */
.sidebar-bottom {
	padding: 0.5rem 0.375rem;
	border-top: 1px solid var(--color-brd);
	display: flex;
	flex-direction: column;
	gap: 0.125rem;
	flex-shrink: 0;
	background: var(--color-side);
	z-index: 1;
}
.bottom-btn {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.4375rem 0.5rem;
	background: none;
	border: none;
	border-radius: 0.375rem;
	color: var(--color-tm);
	font-size: clamp(0.7rem, 0.7vw, 0.875rem);
	cursor: pointer;
	transition:
		background 0.12s,
		color 0.12s;
}
.bottom-btn:hover {
	background: rgba(255, 255, 255, 0.05);
	color: var(--color-t1);
}

.icon-sm {
	width: 1rem;
	height: 1rem;
	flex-shrink: 0;
}
.sidebar.collapsed .icon-sm {
	margin: 0.25rem auto;
	width: 1.25rem;
	height: 1.25rem;
}
.icon-xs {
	width: 0.75rem;
	height: 0.75rem;
	flex-shrink: 0;
}

/* ── Collapsible section headers (Rooms, Team, Slack, …) ── */
.sidebar-section-toggle {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	box-sizing: border-box;
	background: var(--color-card2);
	border: 1px solid var(--color-brd);
	border-radius: 0.375rem;
	margin: 0.25rem 0.125rem 0.125rem 0.125rem;
	padding: 0.5rem 0.35rem;
	width: 100%;
	color: var(--color-tm);
	font-size: 0.625rem;
	font-weight: 700;
	letter-spacing: 0.08em;
	line-height: 1;
	text-transform: uppercase;
	cursor: pointer;
	transition:
		background 0.15s,
		border-color 0.15s,
		color 0.15s;
}
.sidebar-section-toggle:hover {
	background: #ffffff55;
	color: var(--color-t2);
	border-color: var(--color-brd2);
}
.sidebar-section-icon {
	width: 0.875rem;
	height: 0.875rem;
	flex-shrink: 0;
	color: var(--color-accent);
	opacity: 0.92;
}
.sidebar-section-toggle:hover .sidebar-section-icon {
	opacity: 1;
}
.sidebar-section-label {
	flex: 1;
	min-width: 0;
	text-align: left;
}
.sidebar-section-badge {
	flex-shrink: 0;
	background: var(--color-accent-orng);
	color: #000;
	font-size: 0.625rem;
	font-weight: 600;
	border-radius: 0.625rem;
	padding: 0.125rem 0.375rem;
	white-space: nowrap;
}
.sidebar-section-chevron {
	flex-shrink: 0;
	font-size: 1.125rem;
	line-height: 1;
	opacity: 0.9;
}
.sidebar-section-toggle--nested {
	width: 100%;
	max-width: 100%;
	margin-left: 0;
	margin-right: 0;
	margin-top: 0.25rem;
}

/* ── Channel rows ── */
.ch-group-label {
	font-size: 0.5625rem;
	font-weight: 700;
	color: var(--color-tm);
	letter-spacing: 0.06em;
	text-transform: uppercase;
	padding: 0.375rem 0.375rem 0.125rem;
}
.ch-row {
	cursor: pointer;
}
.ch-row--active {
	background: rgba(255, 255, 255, 0.07);
	border-radius: 0.25rem;
}
.ch-unread-badge {
	flex-shrink: 0;
	background: var(--color-red);
	color: #fff;
	font-size: 0.5625rem;
	font-weight: 700;
	border-radius: 0.625rem;
	padding: 0.0625rem 0.3125rem;
	min-width: 1rem;
	text-align: center;
}
.sidebar-section-badge--red {
	background: var(--color-red) !important;
}
.ch-sigil {
	width: 1.625rem;
	height: 1.625rem;
	flex-shrink: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 0.75rem;
	color: var(--color-tm);
}
.ch-ext {
	font-size: 0.625rem;
	color: var(--color-tm);
	flex-shrink: 0;
	opacity: 0;
	transition: opacity 0.12s;
}
.ch-row:hover .ch-ext {
	opacity: 1;
}
.ch-row:hover .ch-sigil {
	color: var(--color-accent);
}
.ch-name--unread {
	font-weight: 600;
}
.ch-unread-dot {
	flex-shrink: 0;
	width: 0.4375rem;
	height: 0.4375rem;
	border-radius: 50%;
	background: var(--color-tm);
}

/* ── On Slack panel ── */
.slack-away {
	border-top: 1px solid var(--color-brd);
	flex-shrink: 0;
	padding-top: 0.375rem;
}

.slack-away-list {
	padding: 0.125rem 0.375rem 0.375rem;
}

.slack-empty {
	font-size: 0.6875rem;
	color: var(--color-tm);
	padding: 0.375rem;
	font-style: italic;
}

.slack-user-row {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.25rem 0.375rem;
	border-radius: 0.375rem;
	cursor: pointer;
	transition: background 0.12s;
}
.slack-user-row:hover {
	background: rgba(255, 255, 255, 0.04);
}

.slack-bubble {
	width: 1.625rem;
	height: 1.625rem;
	border-radius: 50%;
	flex-shrink: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 0.5625rem;
	font-weight: 700;
	color: rgba(255, 255, 255, 0.75);
	position: relative;
}
.slack-info {
	flex: 1;
	min-width: 0;
}
.slack-name {
	font-size: clamp(0.7rem, 0.7vw, 0.875rem);
	color: var(--color-t2);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.slack-status-text {
	font-size: 0.625rem;
	color: var(--color-tm);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.msg-time-hint {
	color: var(--color-tm);
	opacity: 0.7;
	font-size: 0.5625rem;
}
.sidebar-section-header-row {
	display: flex;
	align-items: center;
}
.sidebar-section-header-row .sidebar-section-toggle {
	flex: 1;
	min-width: 0;
}
/* "New Group" / "New Channel" button shown inside expanded section */
.section-action-btn {
	display: block;
	width: calc(100% - 0.25rem);
	margin: 0.125rem auto 0.375rem;
	padding: 0.3125rem 0.5rem;
	background: rgba(0, 180, 216, 0.08);
	border: 1px dashed var(--color-brd2);
	border-radius: 0.3125rem;
	color: var(--color-accent3);
	font-size: 0.6875rem;
	font-weight: 600;
	cursor: pointer;
	text-align: center;
	transition: background 0.12s, border-color 0.12s;
}
.section-action-btn:hover {
	background: rgba(0, 180, 216, 0.16);
	border-color: var(--color-accent3);
}
html.light .section-action-btn {
	background: rgba(0, 119, 182, 0.06);
	color: #005a8c;
}
html.light .section-action-btn:hover {
	background: rgba(0, 119, 182, 0.12);
	color: #004570;
}

.slack-presence-pip {
	position: absolute;
	bottom: 0;
	right: 0;
	width: 0.5rem;
	height: 0.5rem;
	border-radius: 50%;
	border: 2px solid var(--color-side);
}
.pip-active {
	background: #00c853;
}
.pip-away {
	background: #4d6080;
}

.slack-invite-btn {
	background: none;
	border: none;
	cursor: pointer;
	padding: 0.125rem 0.25rem;
	border-radius: 0.25rem;
	color: var(--color-tm);
	opacity: 0.6;
	transition:
		opacity 0.12s,
		color 0.12s;
	flex-shrink: 0;
	display: flex;
	align-items: center;
}
.slack-invite-btn:hover {
	opacity: 1;
	color: var(--color-accent);
}
.slack-invite-btn.sent {
	opacity: 1;
	color: var(--color-green);
}
.slack-invite-btn.sending {
	opacity: 0.5;
	cursor: default;
}
.slack-invite-btn.member {
	color: var(--color-bg2);
}
.invite-check {
	font-size: 0.75rem;
	font-weight: 700;
}
.slack-invite-icon {
	width: 0.875rem;
	height: 0.875rem;
}

/* Inline DM compose */
.slack-dm-box {
	margin: 0.125rem 0.375rem 0.375rem 2.125rem;
	background: var(--color-card2);
	border: 1px solid var(--color-brd);
	border-radius: 0.4375rem;
	padding: 0.5rem;
}
.slack-dm-input {
	width: 100%;
	background: var(--color-card);
	border: 1px solid var(--color-brd2);
	border-radius: 0.3125rem;
	color: var(--color-t1);
	font-size: 0.75rem;
	padding: 0.375rem 0.5rem;
	resize: none;
	outline: none;
	font-family: inherit;
	box-sizing: border-box;
	transition: border-color 0.15s;
}
.slack-dm-input:focus {
	border-color: var(--color-accent);
}
.slack-dm-input::placeholder {
	color: var(--color-tm);
}

.slack-dm-footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-top: 0.3125rem;
}
.slack-dm-hint {
	font-size: 0.625rem;
	color: var(--color-tm);
}
.slack-dm-error {
	font-size: 0.625rem;
	color: var(--color-red);
}
.slack-dm-btns {
	display: flex;
	gap: 0.3125rem;
}

.sdm-cancel {
	background: none;
	border: 1px solid var(--color-brd);
	border-radius: 0.3125rem;
	color: var(--color-tm);
	font-size: 0.6875rem;
	padding: 0.1875rem 0.5rem;
	cursor: pointer;
	transition: color 0.12s;
}
.sdm-cancel:hover {
	color: var(--color-t1);
}

.sdm-send {
	background: var(--color-accent2);
	border: none;
	border-radius: 0.3125rem;
	color: #fff;
	font-size: 0.6875rem;
	font-weight: 600;
	padding: 0.1875rem 0.625rem;
	cursor: pointer;
	transition: background 0.12s;
}
.sdm-send:hover:not(:disabled) {
	background: var(--color-accent);
}
.sdm-send:disabled {
	opacity: 0.4;
	cursor: not-allowed;
}

/* ── Light mode overrides ── */
html.light .my-presence:hover {
	background: rgba(0, 100, 180, 0.06);
}
html.light .nav-item:hover {
	background: rgba(0, 100, 180, 0.08);
	color: var(--color-t1);
}
html.light .nav-item.active {
	background: rgba(0, 119, 182, 0.14);
	color: var(--color-accent2);
	border-color: rgba(0, 119, 182, 0.5);
	box-shadow: inset 3px 0 0 var(--color-accent);
}
html.light .status-opt:hover,
html.light .status-opt.active {
	background: rgba(0, 100, 180, 0.07);
}
html.light .user-row:hover {
	background: rgba(0, 100, 180, 0.06);
}
html.light .int-btn:hover {
	background: rgba(0, 100, 180, 0.07);
	color: var(--color-t1);
}
html.light .bottom-btn:hover {
	background: rgba(0, 100, 180, 0.07);
	color: var(--color-t1);
}
html.light .slack-user-row:hover {
	background: rgba(0, 100, 180, 0.06);
}
html.light .slack-name {
	color: var(--color-t1);
}
html.light .sidebar-section-toggle:hover {
	background: rgba(255, 255, 255, 0.65);
	color: var(--color-t2);
	border-color: var(--color-brd2);
}
</style>
