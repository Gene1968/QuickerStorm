<script setup>
/**
 * AvatarMaker — in-app avatar customizer.
 * No external dependencies. Stores skin tone, hair, and outfit color
 * as a JSON config in avatarStore.avatarUrl so other clients can render it.
 */
import { ref, computed } from 'vue'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { useModalAudio } from '@/composables/useModalAudio.js'
useModalAudio()

const emit = defineEmits(['close', 'done'])
const avatarStore = useAvatarStore()

const displayName = ref(avatarStore.displayName || '')
const jobTitle = ref(avatarStore.title || '')
const skinTone = ref(avatarStore.skinTone || '#C68642')
const hairColor = ref(avatarStore.hairColor || '#3B2314')
const hairStyle = ref(avatarStore.hairStyle || 'short')

// Outfit colors — parse saved values from the avatarUrl JSON config
const _savedCfg = (() => { try { return JSON.parse(avatarStore.avatarUrl || '{}') } catch { return {} } })()
const topColor = ref(_savedCfg.topColor || avatarStore.color || '#2E65B8')
const bottomColor = ref(_savedCfg.bottomColor || avatarStore.color || '#111111')

/** 'look' = body / hair / outfit; 'swag' = optional accessories (future store) */
const activeTab = ref('look')
// const facialHair  = ref(_savedCfg.facialHair || 'none')

const capEnabled = ref(!!_savedCfg.capEnabled)
const capColor = ref(_savedCfg.capColor || '#1e3a5f')

// Accessories
const headphones = ref(!!_savedCfg.headphones)

// Swag extras
const yetiMug = ref(!!_savedCfg.yetiMug)
// const sunglasses = ref(!!_savedCfg.sunglasses)
// const glasses = ref(!!_savedCfg.glasses)

const CAP_COLORS = [
	{ hex: '#1e3a5f', label: 'Navy' },
	{ hex: '#171717', label: 'Black' },
	{ hex: '#7f1d1d', label: 'Burgundy' },
	{ hex: '#14532d', label: 'Forest' },
	{ hex: '#e8e8e8', label: 'Stone' },
]

const SKIN_TONES = [
	'#FDDAB4', '#E8B58A', '#C68642', '#8D5524', '#4A2912', '#1C0A00',
]

const OUTFIT_COLORS = [
	'#111111', '#3A3A3A', '#909090', '#F2F2EE',  // black, charcoal, heather grey, white
	'#1B3A6B', '#2E65B8', '#4A82C8', '#7BB4D8',  // navy → light blue
	'#5C7A95', '#C47A88', '#8B3848', '#6A8C5A', '#7A5A8C', '#A05840',
]

const HAIR_COLORS = [
	'#0C0C0C', '#3D3D3D', '#808080', '#E8E8E8',
	'#1A1008', '#3B2314', '#7B4B2A',
	'#8B3520', '#C04A1A', '#D4956A',
	'#C49A42', '#E8C878',
	'#2255AA', '#8833AA',
]

const HAIR_STYLES = [
	{ value: 'none', label: 'Bald' },
	{ value: 'short', label: 'Short' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'long', label: 'Long' },
]

// const FACIAL_HAIR_STYLES = [
// 	{ value: 'none',     label: 'None'     },
// 	{ value: 'mustache', label: 'Mustache' },
// 	{ value: 'goatee',   label: 'Goatee'   },
// 	{ value: 'beard',    label: 'Beard'    },
// ]

// SVG preview helpers
// hairCapClipY: how far down the cap circle is clipped (= hairline position).
const hairCapClipY = computed(() => {
	if (hairStyle.value === 'none') return 0
	if (hairStyle.value === 'short') return 48
	return 54  // medium and long — visual diff comes from back strands
})

async function save () {
	if (!displayName.value.trim()) return
	const config = {
		type: 'custom',
		skinTone: skinTone.value,
		hairColor: hairColor.value,
		hairStyle: hairStyle.value,
		// facialHair:  facialHair.value,
		topColor: topColor.value,
		bottomColor: bottomColor.value,
		capEnabled: capEnabled.value,
		capColor: capColor.value,
		headphones: headphones.value,
		yetiMug: yetiMug.value,
		// sunglasses: sunglasses.value,
		// glasses: glasses.value,
	}
	await avatarStore.completeSetup({
		avatarUrl: JSON.stringify(config),
		color: topColor.value,
		skinTone: skinTone.value,
		hairColor: hairColor.value,
		hairStyle: hairStyle.value,
		displayName: displayName.value.trim(),
		title: jobTitle.value.trim(),
	})
	emit('done')
	emit('close')
}
</script>

<template>
	<Teleport to="body">
		<div class="am-overlay" @click.self="$emit('close')">
			<div class="am-panel">
				<!-- Header -->
				<div class="am-header">
					<h2 class="am-title">Your Avatar</h2>
					<button class="am-close" @click="$emit('close')">✕</button>
				</div>

				<div class="am-body">
					<!-- Left: customizer -->
					<div class="am-left">
						<div class="am-tabs" role="tablist">
							<button type="button" class="am-tab" :class="{ active: activeTab === 'look' }" role="tab" :aria-selected="activeTab === 'look'" @click="activeTab = 'look'">Look</button>
							<button type="button" class="am-tab" :class="{ active: activeTab === 'accessories' }" role="tab" :aria-selected="activeTab === 'accessories'" @click="activeTab = 'accessories'">Accessories</button>
							<button type="button" class="am-tab" :class="{ active: activeTab === 'swag' }" role="tab" :aria-selected="activeTab === 'swag'" @click="activeTab = 'swag'">Swag</button>
						</div>

						<template v-if="activeTab === 'look'">
							<!-- Profile -->
							<div class="section">
								<div class="section-title">Profile</div>
								<label class="field-label">Display Name *</label>
								<input class="field-input" v-model="displayName" placeholder="Your full name" />
								<label class="field-label">Title or role</label>
								<input class="field-input" v-model="jobTitle" placeholder="e.g. Product Manager" />
							</div>

							<!-- Skin tone -->
							<div class="section">
								<div class="section-title">Skin Tone</div>
								<div class="swatch-row">
									<button v-for="c in SKIN_TONES" :key="c" class="swatch skin-swatch" :class="{ selected: skinTone === c }" :style="{ background: c }" @click="skinTone = c" />
								</div>
							</div>

							<!-- Hair -->
							<div class="section">
								<div class="section-title">Hair Style</div>
								<div class="style-row">
									<button v-for="s in HAIR_STYLES" :key="s.value" class="style-btn" :class="{ selected: hairStyle === s.value }" @click="hairStyle = s.value">{{ s.label }}</button>
								</div>
								<div class="section-title" style="margin-top:0.625rem">Hair Color</div>
								<div class="swatch-row">
									<button v-for="c in HAIR_COLORS" :key="c" class="swatch" :class="{ selected: hairColor === c, disabled: hairStyle === 'none' }" :style="{ background: c }" :disabled="hairStyle === 'none'" @click="hairColor = c" />
								</div>
							</div>

							<!-- Facial Hair -->
							<!-- <div class="section">
								<div class="section-title">Facial Hair</div>
								<div class="style-row">
									<button
										v-for="s in FACIAL_HAIR_STYLES" :key="s.value"
										class="style-btn"
										:class="{ selected: facialHair === s.value }"
										@click="facialHair = s.value"
									>{{ s.label }}</button>
								</div>
							</div> -->

							<!-- Outfit -->
							<div class="section">
								<div class="section-title">Top / Shirt</div>
								<div class="swatch-row">
									<button v-for="c in OUTFIT_COLORS" :key="c" class="swatch" :class="{ selected: topColor === c }" :style="{ background: c }" @click="topColor = c" />
								</div>
								<div class="section-title" style="margin-top:0.625rem">Bottom / Pants</div>
								<div class="swatch-row">
									<button v-for="c in OUTFIT_COLORS" :key="c" class="swatch" :class="{ selected: bottomColor === c }" :style="{ background: c }" @click="bottomColor = c" />
								</div>
							</div>
						</template>

						<template v-else-if="activeTab === 'accessories'">
							<!-- <div class="section">
								<div class="section-title">Eyewear</div>
								<p class="swag-intro">Choose glasses or sunglasses for your avatar.</p>
								<label class="field-check">
									<input type="checkbox" v-model="glasses" @change="glasses && (sunglasses = false)" />
									<span>Regular glasses</span>
								</label>
								<label class="field-check">
									<input type="checkbox" v-model="sunglasses" @change="sunglasses && (glasses = false)" />
									<span>Sunglasses</span>
								</label>
							</div> -->
							<div class="section">
								<div class="section-title">Audio</div>
								<label class="field-check">
									<input type="checkbox" v-model="headphones" />
									<span>Headphones</span>
								</label>
							</div>
						</template>

						<template v-else-if="activeTab === 'swag'">
							<div class="section">
								<div class="section-title">Company cap</div>
								<p class="swag-intro">
									Optional baseball cap for the 3D office. The front uses our logo (same asset as other AVA branding).
								</p>
								<label class="field-check">
									<input type="checkbox" v-model="capEnabled" />
									<span>Wear cap in quickerSTORM</span>
								</label>
							</div>
							<div class="section" :class="{ 'section-dim': !capEnabled }">
								<div class="section-title">Cap color</div>
								<div class="swatch-row cap-swatch-row">
									<button v-for="c in CAP_COLORS" :key="c.hex" type="button" class="swatch cap-swatch" :class="{ selected: capColor === c.hex }" :style="{ background: c.hex }" :disabled="!capEnabled" :title="c.label" @click="capColor = c.hex" />
								</div>
								<p class="swag-hint">More items may land here later as a small swag store.</p>
							</div>
							<div class="section">
								<div class="section-title">Drinkware</div>
								<label class="field-check">
									<input type="checkbox" v-model="yetiMug" />
									<span>Use a quickerSTORM Yeti mug for your drinks</span>
								</label>
							</div>
						</template>
					</div>

					<!-- Right: live SVG preview -->
					<div class="am-right">
						<div class="preview-label-top">Preview</div>
						<svg class="avatar-svg" viewBox="0 0 160 260" xmlns="http://www.w3.org/2000/svg">
							<!-- Very long hair side strands (behind body) -->
							<template v-if="hairStyle === 'long'">
								<ellipse cx="54" cy="120" rx="13" ry="46" :fill="hairColor" />
								<ellipse cx="106" cy="120" rx="13" ry="46" :fill="hairColor" />
							</template>

							<!-- Back panel for medium hair (behind head) -->
							<ellipse v-if="hairStyle === 'medium'" cx="80" cy="118" rx="32" ry="24" :fill="hairColor" />

							<!-- Legs / pants -->
							<rect x="52" y="185" width="24" height="52" rx="10" :fill="bottomColor" />
							<rect x="84" y="185" width="24" height="52" rx="10" :fill="bottomColor" />

							<!-- Body / shirt -->
							<rect x="46" y="106" width="68" height="82" rx="10" :fill="topColor" />
							<!-- Arms -->
							<rect x="22" y="108" width="22" height="58" rx="11" :fill="topColor" />
							<rect x="116" y="108" width="22" height="58" rx="11" :fill="topColor" />

							<!-- Head -->
							<circle cx="80" cy="72" r="38" :fill="skinTone" />

							<!-- Hair cap: circle drawn ON TOP of head, clipped at the hairline.
								cy=70 sits the cap slightly above the head centre so it peeks
								4 px above the skull. r=40 creates a 2 px hair fringe around
								the sides at the clip boundary. -->
							<defs>
								<clipPath id="hair-cap-clip">
									<rect x="0" y="0" width="160" :height="hairCapClipY" />
								</clipPath>
								<linearGradient id="cap-logo-preview" x1="58" y1="36" x2="102" y2="52" gradientUnits="userSpaceOnUse">
									<stop stop-color="#91C2ED" />
									<stop offset="1" stop-color="#D8F2F4" />
								</linearGradient>
							</defs>
							<circle v-if="hairStyle !== 'none'" cx="80" cy="70" r="40" :fill="hairColor" clip-path="url(#hair-cap-clip)" />

							<!-- Optional baseball cap (simplified preview) -->
							<g v-if="capEnabled" class="cap-preview">
								<ellipse cx="80" cy="46" rx="40" ry="11" :fill="capColor" opacity="0.95" />
								<path d="M 40 52 Q 80 66 120 52 L 114 46 Q 80 58 46 46 Z" :fill="capColor" />
								<rect x="58" y="36" width="44" height="16" rx="3" fill="url(#cap-logo-preview)" opacity="0.92" />
							</g>

							<!-- Eyes (drawn after cap so they're always visible) -->
							<circle cx="68" cy="68" r="5" fill="rgba(0,0,0,0.55)" />
							<circle cx="92" cy="68" r="5" fill="rgba(0,0,0,0.55)" />
							<!-- Pupils -->
							<circle cx="69" cy="67" r="2" fill="rgba(255,255,255,0.35)" />
							<circle cx="93" cy="67" r="2" fill="rgba(255,255,255,0.35)" />

							<!-- Smile -->
							<path d="M 68 80 Q 80 90 92 80" stroke="rgba(0,0,0,0.35)" stroke-width="2" fill="none" stroke-linecap="round" />

							<!-- Facial hair (same color as hair) -->
							<!-- Mustache -->
							<!-- <path v-if="facialHair === 'mustache' || facialHair === 'beard'" d="M 66 82 Q 72 87 80 84 Q 88 87 94 82" :stroke="hairColor" stroke-width="3.5" fill="none" stroke-linecap="round" /> -->
							<!-- Goatee -->
							<!-- <template v-if="facialHair === 'goatee'">
								<path d="M 70 82 Q 74 86 80 84 Q 86 86 90 82" :stroke="hairColor" stroke-width="2.5" fill="none" stroke-linecap="round" />
								<ellipse cx="80" cy="93" rx="8" ry="7" :fill="hairColor" opacity="0.85" />
							</template> -->
							<!-- Full beard -->
							<!-- <template v-if="facialHair === 'beard'">
								<path d="M 54 74 Q 52 96 68 104 Q 80 110 92 104 Q 108 96 106 74" :fill="hairColor" opacity="0.75" />
							</template> -->

							<!-- Glasses / Sunglasses (drawn over eyes) -->
							<!-- <g v-if="glasses" class="glasses-preview">
								<circle cx="68" cy="68" r="10" fill="none" stroke="rgba(80,60,40,0.85)" stroke-width="2" />
								<circle cx="92" cy="68" r="10" fill="none" stroke="rgba(80,60,40,0.85)" stroke-width="2" />
								<line x1="78" y1="68" x2="82" y2="68" stroke="rgba(80,60,40,0.85)" stroke-width="2" />
								<line x1="58" y1="68" x2="52" y2="65" stroke="rgba(80,60,40,0.85)" stroke-width="1.5" />
								<line x1="102" y1="68" x2="108" y2="65" stroke="rgba(80,60,40,0.85)" stroke-width="1.5" />
							</g>
							<g v-if="sunglasses" class="sunglasses-preview">
								<rect x="56" y="60" width="22" height="16" rx="4" fill="rgba(20,20,20,0.85)" stroke="rgba(30,30,30,0.9)" stroke-width="1.5" />
								<rect x="82" y="60" width="22" height="16" rx="4" fill="rgba(20,20,20,0.85)" stroke="rgba(30,30,30,0.9)" stroke-width="1.5" />
								<line x1="78" y1="68" x2="82" y2="68" stroke="rgba(30,30,30,0.9)" stroke-width="2" />
								<line x1="56" y1="66" x2="50" y2="63" stroke="rgba(30,30,30,0.9)" stroke-width="1.5" />
								<line x1="104" y1="66" x2="110" y2="63" stroke="rgba(30,30,30,0.9)" stroke-width="1.5" />
							</g> -->

							<!-- Headphones -->
							<g v-if="headphones" class="headphones-preview">
								<path d="M 42 72 Q 42 36 80 36 Q 118 36 118 72" fill="none" stroke="rgba(50,50,50,0.9)" stroke-width="5" stroke-linecap="round" />
								<rect x="34" y="66" width="12" height="20" rx="5" fill="rgba(50,50,50,0.92)" />
								<rect x="114" y="66" width="12" height="20" rx="5" fill="rgba(50,50,50,0.92)" />
								<rect x="36" y="70" width="8" height="12" rx="3" fill="rgba(80,80,80,0.6)" />
								<rect x="116" y="70" width="8" height="12" rx="3" fill="rgba(80,80,80,0.6)" />
							</g>

							<!-- Status ring -->
							<circle cx="80" cy="252" r="24" fill="none" stroke="#00c853" stroke-width="4" opacity="0.7" />
						</svg>

						<div class="preview-name">{{ displayName || 'Your Name' }}</div>
						<div class="preview-title-text">{{ jobTitle || 'Your Title' }}</div>
					</div>
				</div>

				<!-- Footer actions -->
				<div class="am-footer">
					<button class="am-btn-cancel" @click="$emit('close')">Cancel</button>
					<button class="am-btn-save" :disabled="!displayName.trim()" @click="save">
						Save Avatar
					</button>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
.am-overlay {
	position: fixed;
	inset: 0;
	z-index: 600;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(4, 8, 14, 0.82);
	backdrop-filter: blur(6px);
}

.am-panel {
	width: min(48.75rem, 96vw);
	max-height: 92vh;
	background: var(--color-card);
	border: 1px solid var(--color-brd);
	border-radius: 0.875rem;
	display: flex;
	flex-direction: column;
	box-shadow: 0 24px 64px rgba(0, 0, 0, 0.65);
	overflow: hidden;
}

.am-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 1rem 1.375rem;
	border-bottom: 1px solid var(--color-brd);
	background: var(--color-card2);
	flex-shrink: 0;
}

.am-title {
	font-size: clamp(0.875rem, 0.875vw, 1.0625rem);
	font-weight: 700;
	color: var(--color-t1);
}

.am-close {
	background: none;
	border: none;
	color: var(--color-tm);
	font-size: clamp(0.8rem, 0.8vw, 0.9375rem);
	cursor: pointer;
	padding: 0.25rem 0.375rem;
	border-radius: 0.25rem;
}

.am-close:hover {
	color: var(--color-t1);
	background: rgba(255, 255, 255, 0.05);
}

.am-body {
	display: flex;
	flex: 1;
	overflow: hidden;
}

/* Left customizer */
.am-left {
	flex: 1;
	overflow-y: auto;
	padding: 1.125rem 1.25rem;
	display: flex;
	flex-direction: column;
	gap: 1.125rem;
	border-right: 1px solid var(--color-brd);
}

.am-tabs {
	display: flex;
	gap: 0.375rem;
	padding-bottom: 0.25rem;
	margin-bottom: 0.125rem;
	border-bottom: 1px solid var(--color-brd);
	flex-shrink: 0;
}

.am-tab {
	flex: 1;
	padding: 0.5rem 0.75rem;
	border-radius: 0.375rem 0.375rem 0 0;
	border: 1px solid transparent;
	border-bottom: none;
	background: transparent;
	color: var(--color-tm);
	font-size: clamp(0.7rem, 0.7vw, 0.8125rem);
	font-weight: 600;
	cursor: pointer;
	transition: color 0.12s, background 0.12s, border-color 0.12s;
}

.am-tab:hover {
	color: var(--color-t1);
	background: rgba(255, 255, 255, 0.04);
}

.am-tab.active {
	color: var(--color-accent);
	background: var(--color-card2);
	border-color: var(--color-brd);
	margin-bottom: -1px;
}

.swag-intro {
	font-size: 0.6875rem;
	color: var(--color-tm);
	line-height: 1.45;
	margin: 0;
}

.swag-hint {
	font-size: 0.625rem;
	color: var(--color-tm);
	opacity: 0.85;
	margin: 0.5rem 0 0;
	line-height: 1.4;
}

.field-check {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	font-size: 0.8125rem;
	color: var(--color-t2);
	cursor: pointer;
	margin-top: 0.25rem;
}

.field-check input {
	accent-color: var(--color-accent);
	width: 1rem;
	height: 1rem;
}

.section-dim {
	opacity: 0.45;
	pointer-events: none;
}

.cap-swatch-row {
	margin-top: 0.25rem;
}

.cap-swatch {
	border-radius: 0.375rem;
}

.section {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.section-title {
	font-size: 0.625rem;
	font-weight: 700;
	color: var(--color-tm);
	text-transform: uppercase;
	letter-spacing: 0.08em;
}

.field-label {
	font-size: 0.6875rem;
	color: var(--color-tm);
	margin-top: 0.125rem;
}

.field-input {
	background: var(--color-card2);
	border: 1px solid var(--color-brd);
	border-radius: 0.4375rem;
	color: var(--color-t1);
	font-size: clamp(0.75rem, 0.75vw, 0.9375rem);
	padding: 0.5rem 0.75rem;
	outline: none;
	transition: border-color 0.15s;
}

.field-input:focus {
	border-color: var(--color-accent);
}

.field-input::placeholder {
	color: var(--color-tm);
}

/* Swatches */
.swatch-row {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
}

.swatch {
	width: 1.875rem;
	height: 1.875rem;
	border-radius: 50%;
	border: 2px solid transparent;
	cursor: pointer;
	transition: transform 0.12s, border-color 0.12s;
	flex-shrink: 0;
}

.swatch:hover {
	transform: scale(1.15);
}

.swatch.selected {
	border-color: white;
	transform: scale(1.18);
}

.swatch.disabled {
	opacity: 0.3;
	cursor: not-allowed;
}

.skin-swatch {
	border-radius: 0.375rem;
}

/* Hair style buttons */
.style-row {
	display: flex;
	gap: 0.375rem;
}

.style-btn {
	flex: 1;
	padding: 0.375rem 0.25rem;
	border-radius: 0.375rem;
	background: var(--color-card2);
	border: 1px solid var(--color-brd);
	color: var(--color-t2);
	font-size: clamp(0.7rem, 0.7vw, 0.875rem);
	cursor: pointer;
	transition: border-color 0.12s, color 0.12s, background 0.12s;
}

.style-btn:hover {
	border-color: var(--color-brd2);
	color: var(--color-t1);
}

.style-btn.selected {
	border-color: var(--color-accent);
	color: var(--color-accent);
	background: rgba(0, 180, 216, 0.08);
}

/* Right preview */
.am-right {
	width: 12.5rem;
	flex-shrink: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 0.375rem;
	padding: 1.25rem 1rem;
	background: var(--color-bg);
}

.preview-label-top {
	font-size: 0.625rem;
	font-weight: 700;
	color: var(--color-tm);
	text-transform: uppercase;
	letter-spacing: 0.08em;
}

.avatar-svg {
	width: 8.75rem;
	height: auto;
	filter: drop-shadow(0 4px 16px rgba(0, 0, 0, 0.5));
}

.preview-name {
	font-size: clamp(0.75rem, 0.75vw, 0.9375rem);
	font-weight: 600;
	color: var(--color-t1);
	text-align: center;
	margin-top: 0.25rem;
}

.preview-title-text {
	font-size: 0.6875rem;
	color: var(--color-tm);
	text-align: center;
}

/* Footer */
.am-footer {
	display: flex;
	justify-content: flex-end;
	gap: 0.625rem;
	padding: 0.875rem 1.25rem;
	border-top: 1px solid var(--color-brd);
	background: var(--color-card2);
	flex-shrink: 0;
}

.am-btn-cancel {
	background: none;
	border: 1px solid var(--color-brd);
	border-radius: 0.4375rem;
	color: var(--color-t2);
	padding: 0.5rem 1.125rem;
	cursor: pointer;
	font-size: clamp(0.75rem, 0.75vw, 0.9375rem);
	transition: border-color 0.15s, color 0.15s;
}

.am-btn-cancel:hover {
	border-color: var(--color-brd2);
	color: var(--color-t1);
}

.am-btn-save {
	background: var(--color-accent2);
	border: none;
	border-radius: 0.4375rem;
	color: white;
	padding: 0.5rem 1.5rem;
	cursor: pointer;
	font-size: clamp(0.75rem, 0.75vw, 0.9375rem);
	font-weight: 600;
	transition: background 0.15s;
}

.am-btn-save:hover:not(:disabled) {
	background: var(--color-accent);
}

.am-btn-save:disabled {
	opacity: 0.4;
	cursor: not-allowed;
}
</style>
