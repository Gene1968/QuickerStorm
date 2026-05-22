<script setup>
import { ref, computed, reactive, onMounted } from 'vue'
import { PresenceRepo } from '@/api/backend.js'
import { useModalAudio } from '@/composables/useModalAudio.js'
useModalAudio()

const emit = defineEmits(['close'])

const _env = import.meta.env.VITE_APP_ENV || 'development'
const isProduction = _env === 'production' || _env === 'im'
const envLabel = isProduction ? 'production' : 'local/staging'

const isDevUser = (u) => u.email?.includes('@localhost')

const loading      = ref(true)
const error        = ref(null)
const includeBots  = ref(false)
// { email → true } — which rows have their device list expanded
const expandedEmails = reactive({})

// One entry per real person, grouped by AuthUserId (falling back to email for legacy null-auth rows).
// Devices maps are merged across all rows belonging to the same auth user.
const userRows = ref([])

function toggleExpand (email) {
	expandedEmails[email] = !expandedEmails[email]
}

onMounted(async () => {
	try {
		const items = await PresenceRepo.fetchAll()

		// Sort most-recent first so the primary row's name/stats win when grouping
		const sorted = [...items].sort((a, b) =>
			(b.LastSeen || '') > (a.LastSeen || '') ? 1 : -1
		)

		const STALE_MS = 2 * 60 * 1000
		// Map: canonical key (authUserId or lowercase email) → merged entry.
		// Dev rows (@localhost) use email as the key so they don't merge with
		// the real user who shares the same auth_user_id.
		const grouped = new Map()

		for (const item of sorted) {
			const isDev = item.Email?.includes('@localhost')
			const key = isDev ? item.Email?.toLowerCase() : (item.AuthUserId || item.Email?.toLowerCase())
			if (!key) continue

			let prefs = null
			try { prefs = item.Preferences ? JSON.parse(item.Preferences) : null } catch { /* */ }

			const title = item.Title?.trim() || ''

			if (!grouped.has(key)) {
				const online = item.LastSeen && Date.now() - new Date(item.LastSeen).getTime() < STALE_MS
				grouped.set(key, {
					name:    title || item.Email || '',
					email:   item.Email?.toLowerCase() || '',
					lastSeen: item.LastSeen || null,
					status:  online ? (item.Status || 'online') : 'offline',
					clientStats: prefs?.clientStats ?? null,
					names: title ? new Set([title]) : new Set(),
					devices: prefs?.devices ? { ...prefs.devices } : {},
				})
			} else {
				const entry = grouped.get(key)
				// Accumulate all display names seen across rows
				if (title) entry.names.add(title)
				// Merge devices from older/additional rows — don't overwrite existing device IDs
				if (prefs?.devices) {
					for (const [devId, devData] of Object.entries(prefs.devices)) {
						if (!entry.devices[devId]) entry.devices[devId] = devData
					}
				}
			}
		}

		userRows.value = [...grouped.values()]
	} catch (err) {
		error.value = err.message || 'Failed to load metrics'
	} finally {
		loading.value = false
	}
})

// One logical user per auth identity; dev/bot accounts excluded by default
const realUsers = computed(() => userRows.value.filter(u => includeBots.value || !isDevUser(u)))

const rows = computed(() => realUsers.value.map(u => {
	const cs      = u.clientStats
	const deviceList = Object.values(u.devices)
	const devices = deviceList.length > 0 ? u.devices : null
	// Sort names: most-recent (primary) first, rest alphabetically
	const names = [u.name, ...[...u.names].filter(n => n !== u.name).sort()].filter(Boolean)
	return {
		name:         u.name     || '—',
		email:        u.email    || '',
		names,
		lastSeen:     u.lastSeen || null,
		status:       u.status,
		browser:      cs?.browser      ?? null,
		os:           cs?.os           ?? null,
		perfTier:     cs?.perfTier     ?? null,
		isLowEnd:     cs?.isLowEnd     ?? null,
		isMidRange:   cs?.isMidRange   ?? null,
		everLowEnd:   cs?.everLowEnd   ?? null,
		everMidRange: cs?.everMidRange ?? null,
		nightCount:   cs?.nightCount   ?? 0,
		dayCount:     cs?.dayCount     ?? 0,
		sessionCount: cs?.sessionCount ?? 0,
		screenW:      cs?.screenW      ?? null,
		screenH:      cs?.screenH      ?? null,
		dpr:          cs?.dpr          ?? null,
		cores:        cs?.cores        ?? null,
		ramGb:        cs?.ramGb        ?? null,
		gpuRenderer:  cs?.gpuRenderer  ?? null,
		mobile:       cs?.mobile       ?? null,
		devices,
	}
}))

// ── Stat card helpers ────────────────────────────────────────────────
const total = computed(() => realUsers.value.length)

const activeToday = computed(() => {
	const midnight = new Date()
	midnight.setHours(0, 0, 0, 0)
	return rows.value.filter(r => r.lastSeen && new Date(r.lastSeen).getTime() >= midnight.getTime()).length
})

const lowEndNow    = computed(() => rows.value.filter(r => r.isLowEnd   === true).length)
const midRangeNow  = computed(() => rows.value.filter(r => r.isMidRange === true).length)
const everLowEnd   = computed(() => rows.value.filter(r => r.everLowEnd  === true).length)
const everMidRange = computed(() => rows.value.filter(r => r.everMidRange === true).length)
const nightMajority = computed(() => rows.value.filter(r => r.nightCount > r.dayCount).length)
const dayMajority   = computed(() => rows.value.filter(r => r.dayCount >= r.nightCount && (r.nightCount + r.dayCount) > 0).length)

// ── Bar chart data ───────────────────────────────────────────────────
function countBy(key, values) {
	const counts = {}
	for (const v of values) counts[v] = 0
	for (const r of rows.value) {
		const val = r[key]
		if (val && counts[val] !== undefined) counts[val]++
	}
	return values.map(v => ({ label: v, count: counts[v] }))
}

const browsers = computed(() => countBy('browser', ['Chrome', 'Edge', 'Firefox', 'Safari', 'Opera', 'Other']))
const oses     = computed(() => countBy('os',      ['Windows', 'macOS', 'iOS', 'iPadOS', 'Android', 'Linux', 'Other']))
const perfTiers = computed(() => countBy('perfTier', ['std', 'mid', 'low']))

const maxBrowserCount = computed(() => Math.max(1, ...browsers.value.map(b => b.count)))
const maxOsCount      = computed(() => Math.max(1, ...oses.value.map(o => o.count)))
const maxTierCount    = computed(() => Math.max(1, ...perfTiers.value.map(t => t.count)))

const totalNightSessions = computed(() => rows.value.reduce((s, r) => s + (r.nightCount || 0), 0))
const totalDaySessions   = computed(() => rows.value.reduce((s, r) => s + (r.dayCount   || 0), 0))
const maxSessionCount    = computed(() => Math.max(1, totalNightSessions.value, totalDaySessions.value))

// ── Relative time ────────────────────────────────────────────────────
function relativeTime(dateStr) {
	if (!dateStr) return '—'
	const d = new Date(dateStr)
	const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
	const yesterdayMidnight = new Date(midnight); yesterdayMidnight.setDate(midnight.getDate() - 1)
	if (d >= midnight) return 'today'
	if (d >= yesterdayMidnight) return 'yesterday'
	const days = Math.floor((midnight - d) / (1000 * 60 * 60 * 24))
	return `${days}d ago`
}

/* function boolCell(val) {
	if (val === null || val === undefined) return '—'
	return val ? 'yes' : 'no'
} */
</script>

<template>
	<Teleport to="body">
		<div class="ava-modal-overlay metrics-overlay" @click.self="emit('close')">
			<div class="ava-modal metrics-panel">
				<div class="ava-modal-header flex items-center justify-between py-4 px-5 shrink-0">
					<span class="mp-title">QuickerStorm Metrics <span class="text-xs font-normal opacity-55 tracking-normal">({{ envLabel }})</span></span>
					<label v-if="!isProduction" class="flex items-center gap-1.5 text-[0.75rem] text-tm cursor-pointer select-none ml-auto mr-4">
						<input type="checkbox" v-model="includeBots" class="accent-[var(--color-accent)] cursor-pointer" />
						Include localhost/IP devs
					</label>
					<button class="ava-close text-base py-1 px-2 rounded leading-none" @click="emit('close')" aria-label="Close" title="Close">✕</button>
				</div>

				<div class="overflow-y-auto p-5 flex flex-col gap-3">
					<div v-if="loading" class="mp-loading">Loading…</div>
					<div v-else-if="error" class="mp-error">{{ error }}</div>
					<template v-else>

						<!-- Stat cards -->
						<div class="grid grid-cols-8 gap-3">
							<div class="ava-card rounded-[0.625rem] py-2 px-3 text-center">
								<div class="stat-value">{{ total }}</div>
								<div class="stat-label">Total Users</div>
							</div>
							<div class="ava-card rounded-[0.625rem] py-2 px-3 text-center">
								<div class="stat-value">{{ activeToday }}</div>
								<div class="stat-label">Active Today</div>
							</div>
							<div class="ava-card rounded-[0.625rem] py-2 px-3 text-center">
								<div class="stat-value">{{ lowEndNow }}</div>
								<div class="stat-label">Low-end Now</div>
							</div>
							<div class="ava-card rounded-[0.625rem] py-2 px-3 text-center">
								<div class="stat-value">{{ midRangeNow }}</div>
								<div class="stat-label">Mid-range Now</div>
							</div>
							<div class="ava-card rounded-[0.625rem] py-2 px-3 text-center">
								<div class="stat-value">{{ everLowEnd }}</div>
								<div class="stat-label">Ever Low-end</div>
							</div>
							<div class="ava-card rounded-[0.625rem] py-2 px-3 text-center">
								<div class="stat-value">{{ everMidRange }}</div>
								<div class="stat-label">Ever Mid-range</div>
							</div>
							<div class="ava-card rounded-[0.625rem] py-2 px-3 text-center">
								<div class="stat-value">{{ nightMajority }}</div>
								<div class="stat-label">Dark mode</div>
							</div>
							<div class="ava-card rounded-[0.625rem] py-2 px-3 text-center">
								<div class="stat-value">{{ dayMajority }}</div>
								<div class="stat-label">Light mode</div>
							</div>
						</div>

						<!-- Bar charts -->
						<div class="grid grid-cols-4 gap-3">
							<!-- Browser breakdown -->
							<div class="ava-card rounded-[0.625rem] py-1.5 px-3.5">
								<div class="chart-title">Browser</div>
								<div
									v-for="b in browsers" :key="b.label"
									class="flex items-center gap-2"
									:class="{ 'opacity-40': b.count === 0 }"
								>
									<span class="bar-label">{{ b.label }}</span>
									<div class="bar-track">
										<div
											class="bar-fill"
											:style="{ width: (b.count / maxBrowserCount * 100) + '%' }"
										/>
									</div>
									<span class="bar-count">{{ b.count }}</span>
								</div>
							</div>

							<!-- OS breakdown -->
							<div class="ava-card rounded-[0.625rem] py-1.5 px-3.5">
								<div class="chart-title">OS</div>
								<div
									v-for="o in oses" :key="o.label"
									class="flex items-center gap-2"
									:class="{ 'opacity-40': o.count === 0 }"
								>
									<span class="bar-label">{{ o.label }}</span>
									<div class="bar-track">
										<div
											class="bar-fill"
											:style="{ width: (o.count / maxOsCount * 100) + '%' }"
										/>
									</div>
									<span class="bar-count">{{ o.count }}</span>
								</div>
							</div>

							<!-- Perf tier breakdown -->
							<div class="ava-card rounded-[0.625rem] py-1.5 px-3.5">
								<div class="chart-title">Perf Tier</div>
								<div
									v-for="t in perfTiers" :key="t.label"
									class="flex items-center gap-2"
									:class="{ 'opacity-40': t.count === 0 }"
								>
									<span class="bar-label">{{ t.label }}</span>
									<div class="bar-track">
										<div
											class="bar-fill"
											:class="`bar-fill--tier-${t.label}`"
											:style="{ width: (t.count / maxTierCount * 100) + '%' }"
										/>
									</div>
									<span class="bar-count">{{ t.count }}</span>
								</div>
							</div>

							<!-- Night vs Day sessions -->
							<div class="ava-card rounded-[0.625rem] py-1.5 px-3.5">
								<div class="chart-title">Sessions: Light/Day vs Dark/Night</div>
								<div class="flex items-center gap-2">
									<span class="bar-label">Dark</span>
									<div class="bar-track">
										<div
											class="bar-fill bar-fill--night"
											:style="{ width: (totalNightSessions / maxSessionCount * 100) + '%' }"
										/>
									</div>
									<span class="bar-count">{{ totalNightSessions }}</span>
								</div>
								<div class="flex items-center gap-2">
									<span class="bar-label">Light</span>
									<div class="bar-track">
										<div
											class="bar-fill bar-fill--day"
											:style="{ width: (totalDaySessions / maxSessionCount * 100) + '%' }"
										/>
									</div>
									<span class="bar-count">{{ totalDaySessions }}</span>
								</div>
							</div>
						</div>

						<!-- Per-user table -->
						<div class="overflow-x-auto">
							<table class="metrics-table">
								<thead>
									<tr>
										<th>Name</th>
										<th>Browser</th>
										<th>OS</th>
										<th>Tier</th>
										<th>Ever L/M</th>
										<th>Dark sess.</th>
										<th>Light sess.</th>
										<th>Total sess.</th>
										<th>Viewport</th>
										<th>Cores</th>
										<th>RAM</th>
										<th>GPU</th>
										<th>Last seen</th>
									</tr>
								</thead>
								<tbody>
									<template v-for="r in rows" :key="r.email">
										<tr :class="{ 'bg-gray-900/50': isDevUser(r) }">
											<td class="text-t1 font-medium max-w-56 flex">
												<button
													v-if="r.devices || r.names.length > 1"
													class="bg-transparent border-none text-tm cursor-pointer text-[0.6875rem] p-0 pr-1 leading-none opacity-70 align-middle hover:opacity-100"
													:aria-label="expandedEmails[r.email] ? 'Collapse' : 'Expand history'"
													@click="toggleExpand(r.email)"
												>{{ expandedEmails[r.email] ? '▾' : '▸' }}</button>
												<span class="td-email">{{ r.email }}</span>
											</td>
											<td>{{ r.browser || '—' }}</td>
											<td>{{ r.os || '—' }}</td>
											<td :class="r.perfTier ? `td-tier-${r.perfTier}` : ''">{{ r.perfTier ?? '—' }}</td>
											<td>
												<span v-if="r.everLowEnd" class="text-[#f87171]">L</span>
												<span v-if="r.everLowEnd && r.everMidRange"> / </span>
												<span v-if="r.everMidRange" class="text-[#f0a83a]">M</span>
												<span v-if="!r.everLowEnd && !r.everMidRange">—</span>
											</td>
											<td>{{ r.nightCount || 0 }}</td>
											<td>{{ r.dayCount || 0 }}</td>
											<td>{{ r.sessionCount || 0 }}</td>
											<td>{{ r.screenW && r.screenH ? `${r.screenW}×${r.screenH}` : '—' }}</td>
											<td>{{ r.cores ?? '—' }}</td>
											<td title="Chromium caps this at 8gb to prevent fingerprinting">{{ r.ramGb != null ? (r.ramGb >= 8 ? '[≥8 GB]' : r.ramGb + ' GB') : '—' }}</td>
											<td class="max-w-56 overflow-hidden text-ellipsis" :title="r.gpuRenderer || ''">{{ r.gpuRenderer ?? '—' }}</td>
											<td>{{ relativeTime(r.lastSeen) }}</td>
										</tr>
										<tr v-if="expandedEmails[r.email] && (r.devices || r.names.length > 1)" class="devices-subrow">
											<td colspan="13">
												<!-- Display name history -->
												<div v-if="r.names.length > 1" class="flex items-center flex-wrap gap-1.5 mb-2">
													<span class="subrow-label">Names used:</span>
													<span v-for="n in r.names" :key="n" class="dev-chip">{{ n }}</span>
												</div>
												<!-- Device history -->
												<div v-if="r.devices" class="flex flex-col gap-1.5">
													<div v-for="(dev, devId) in r.devices" :key="devId" class="flex items-center flex-wrap gap-1.5">
														<span v-if="dev.displayName" class="dev-chip font-semibold">{{ dev.displayName }}</span>
														<span class="dev-label">{{ dev.deviceLabel || `${dev.os} · ${dev.browser}` }}</span>
														<span :class="`dev-chip dev-chip--tier-${dev.perfTier}`">{{ dev.perfTier }}</span>
														<span v-if="dev.screenW && dev.screenH" class="dev-chip">{{ dev.screenW }}×{{ dev.screenH }}</span>
														<span v-if="dev.dpr && dev.dpr !== 1" class="dev-chip">{{ dev.dpr }}x DPR</span>
														<span v-if="dev.cores" class="dev-chip">{{ dev.cores }}c</span>
														<span v-if="dev.ramGb != null" class="dev-chip">{{ dev.ramGb >= 8 ? '≥8' : dev.ramGb }}GB</span>
														<span v-if="dev.gpuRenderer" class="dev-chip cursor-help" :title="dev.gpuRenderer">GPU</span>
														<span class="dev-chip opacity-60">{{ relativeTime(dev.lastSeen) }}</span>
													</div>
												</div>
											</td>
										</tr>
									</template>
								</tbody>
							</table>
						</div>

					</template>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
.metrics-overlay {
	position: fixed;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 600;
}

.metrics-panel {
	width: min(72rem, 96vw);
	max-height: 92vh;
	border-radius: 0.75rem;
	box-shadow: 0 16px 64px rgba(0, 0, 0, 0.6);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

.mp-title {
	font-size: clamp(0.9375rem, 1vw, 1.125rem);
	font-weight: 700;
	color: var(--color-t1);
	letter-spacing: 0.04em;
}

.mp-loading,
.mp-error {
	color: var(--color-tm);
	font-size: clamp(0.8125rem, 0.85vw, 1rem);
	padding: 2rem 0;
	text-align: center;
}
.mp-error { color: #f87171; }

/* ── Stat cards ─────────────────────────────────────────────────────── */
.stat-value {
	font-size: clamp(1.375rem, 1.75vw, 2rem);
	font-weight: 700;
	color: var(--color-accent);
	line-height: 1.2;
}

.stat-label {
	font-size: clamp(0.6875rem, 0.7vw, 0.8125rem);
	color: var(--color-t2);
	margin-top: 0.25rem;
}

/* ── Bar charts ─────────────────────────────────────────────────────── */
.chart-title {
	font-size: clamp(0.75rem, 0.75vw, 0.875rem);
	font-weight: 600;
	color: var(--color-t2);
	margin-bottom: 0.625rem;
	letter-spacing: 0.05em;
	text-transform: uppercase;
}

.bar-label {
	width: 4.5rem;
	font-size: clamp(0.6875rem, 0.7vw, 0.8125rem);
	color: var(--color-t2);
	flex-shrink: 0;
}

.bar-track {
	flex: 1;
	height: 0.5rem;
	background: rgba(255,255,255,0.06);
	border-radius: 0.25rem;
	overflow: hidden;
}

.bar-fill {
	height: 100%;
	background: var(--color-accent);
	border-radius: 0.25rem;
	transition: width 0.4s ease;
	min-width: 0;
}
.bar-fill--night     { background: #7c6af0; }
.bar-fill--day       { background: #f0a83a; }
.bar-fill--tier-std  { background: #22c55e; }
.bar-fill--tier-mid  { background: #f0a83a; }
.bar-fill--tier-low  { background: #f87171; }

.bar-count {
	width: 1.75rem;
	font-size: clamp(0.625rem, 0.65vw, 0.75rem);
	color: var(--color-t2);
	text-align: right;
	flex-shrink: 0;
}

/* ── Per-user table ─────────────────────────────────────────────────── */
.metrics-table {
	width: 100%;
	border-collapse: collapse;
	font-size: clamp(0.6875rem, 0.7vw, 0.8125rem);
}

.metrics-table th {
	padding: 0.5rem 0.625rem;
	text-align: left;
	color: var(--color-tm);
	font-weight: 600;
	font-size: clamp(0.625rem, 0.65vw, 0.75rem);
	text-transform: uppercase;
	letter-spacing: 0.06em;
	border-bottom: 1px solid var(--color-brd);
	white-space: nowrap;
	background: var(--color-card2);
}

.metrics-table td {
	padding: 0.4375rem 0.625rem;
	color: var(--color-t2);
	border-bottom: 1px solid rgba(0,0,0,0.2);
	white-space: nowrap;
}

.metrics-table tbody tr:hover td { background: rgba(0,0,0,0.1); }

.td-email {
	display: block;
	font-size: clamp(0.625rem, 0.65vw, 0.75rem);
	color: var(--color-t1);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.td-tier-low { color: #f87171; font-weight: 600; }
.td-tier-mid { color: #f0a83a; }
.td-tier-std { color: #22c55e; }

/* ── Device / history sub-rows ──────────────────────────────────────── */
.devices-subrow td {
	background: var(--color-card2);
	padding: 0.5rem 0.625rem 0.625rem 2.25rem;
	border-bottom: 1px solid var(--color-brd);
}

.subrow-label {
	font-size: clamp(0.5625rem, 0.6vw, 0.6875rem);
	color: var(--color-tm);
	text-transform: uppercase;
	letter-spacing: 0.05em;
	flex-shrink: 0;
}

.dev-label {
	font-size: clamp(0.6875rem, 0.7vw, 0.8125rem);
	color: var(--color-t1);
	font-weight: 500;
	min-width: 12rem;
}

.dev-chip {
	font-size: clamp(0.5625rem, 0.6vw, 0.6875rem);
	color: var(--color-t2);
	background: rgba(255,255,255,0.06);
	border: 1px solid var(--color-brd);
	border-radius: 0.25rem;
	padding: 0.0625rem 0.375rem;
	white-space: nowrap;
}
.dev-chip--tier-low { color: #f87171; }
.dev-chip--tier-mid { color: #f0a83a; }
.dev-chip--tier-std { color: #22c55e; }
</style>
