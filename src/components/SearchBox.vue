<script setup>
	const model = defineModel()
</script>


<template>
	<div class="search-component">
		<input class="w-full rounded-lg " type="text" placeholder="Search requests" v-model="model">
	</div>
</template>


<style scoped>
input:active,
input:focus {
	@apply border-0 outline-0 bg-white text-neutral-50
}
input {
	@apply h-[2.5rem]
}
</style>
