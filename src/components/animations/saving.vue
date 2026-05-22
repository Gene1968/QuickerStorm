<script setup>

defineProps({
	message: {
		type: String,
		default: ''
	},
	size: {
		type: String,
		default: '20px'
	}
})

</script>

<template>
	<div class="flex flex-col gap-1 justify-center items-center">
		<div class="relative flex items-center justify-center" :style="{ width: size, height: size }">
			<span class="save-animation text-primary-70/25" :style="{ fontSize: size }" style="animation-delay: -1.7s;">.</span>
			<span class="save-animation text-primary-70/50" :style="{ fontSize: size }" style="animation-delay: -1.8s;">.</span>
			<span class="save-animation text-primary-70/75" :style="{ fontSize: size }" style="animation-delay: -1.9s;">.</span>
			<span class="save-animation text-primary-70" :style="{ fontSize: size }" style="animation-delay: -2s;">.</span>
		</div>
		<span class="text-2xl capitalize">{{ message }}</span>
	</div>
</template>

<style scoped>
.save-animation {
	position: absolute;
	animation: spin 2s infinite;
	animation-delay: -1s;
}

@keyframes spin {
	0% {
		transform: rotate(0deg);
	}
	50% {
		transform: rotate(360deg);
	}
	100% {
		transform: rotate(360deg);
	}
}
</style>

