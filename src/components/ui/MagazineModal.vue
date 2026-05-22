<script setup>
import { computed } from 'vue'
import { ExternalLink as ArrowTopRightOnSquareIcon, X as XMarkIcon } from '@lucide/vue'
import { useModalAudio } from '@/composables/useModalAudio.js'
useModalAudio()

const props = defineProps({
	url: { type: String, required: true },
})
defineEmits(['close'])

const hostname = computed(() => {
	try { return new URL(props.url).hostname.replace(/^www\./, '') }
	catch { return props.url }
})
</script>

<template>
	<div class="mag-backdrop" @click.self="$emit('close')">
		<div class="mag-modal">
			<div class="mag-header">
				<span class="mag-title">{{ hostname }}</span>
				<div class="mag-header-actions">
					<a :href="url" target="_blank" rel="noopener noreferrer" class="mag-open-btn" title="Open in new tab">
						<ArrowTopRightOnSquareIcon style="width:0.9rem;height:0.9rem" />
						Open full page
					</a>
					<button class="mag-close" @click="$emit('close')" title="Close">
						<XMarkIcon style="width:1rem;height:1rem" />
					</button>
				</div>
			</div>
			<div class="mag-body">
				<iframe :src="url" class="mag-frame" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
			</div>
		</div>
	</div>
</template>

<style scoped>
.mag-backdrop {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.65);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 600;
	backdrop-filter: blur(4px);
}

.mag-modal {
	width: min(72rem, 92vw);
	height: min(50rem, 88vh);
	background: var(--color-card);
	border: 1px solid var(--color-brd);
	border-radius: 0.75rem;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
}

.mag-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0.625rem 0.875rem;
	background: var(--color-card2);
	border-bottom: 1px solid var(--color-brd);
	gap: 0.75rem;
	flex-shrink: 0;
}

.mag-title {
	font-size: 0.8125rem;
	font-weight: 600;
	color: var(--color-t1);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.mag-header-actions {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	flex-shrink: 0;
}

.mag-open-btn {
	display: flex;
	align-items: center;
	gap: 0.3rem;
	font-size: 0.75rem;
	color: var(--color-tm);
	text-decoration: none;
	padding: 0.25rem 0.5rem;
	border-radius: 0.375rem;
	border: 1px solid var(--color-brd);
	transition: color 0.12s, border-color 0.12s;
}
.mag-open-btn:hover {
	color: var(--color-t1);
	border-color: var(--color-brd2);
}

.mag-close {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 1.75rem;
	height: 1.75rem;
	background: none;
	border: 1px solid var(--color-brd);
	border-radius: 0.375rem;
	color: var(--color-tm);
	cursor: pointer;
	transition: color 0.12s, border-color 0.12s;
}
.mag-close:hover {
	color: var(--color-t1);
	border-color: var(--color-brd2);
}

.mag-body {
	flex: 1;
	overflow: hidden;
}

.mag-frame {
	width: 100%;
	height: 100%;
	border: none;
	display: block;
	background: #fff;
}
</style>
