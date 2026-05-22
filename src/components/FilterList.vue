<script setup>
import { ref, onMounted } from 'vue'
import { getIcon } from '@/composables/iconChoices'

const model = defineModel()

const props = defineProps({
	options : {
		type: Array
	},
	data: {
		type: Object
	},
	defaultValue : {
		type: String
	},
	special: {
		type: String
	},
	placeholder: {
		type: String
	},
	filterKey: {
		type: String
	},
	clearSearch: {
		type: Function
	}
})

const selected = ref()
const selecting = ref(false)

onMounted(() => {
	// console.log("Model: ", model.value)
	selected.value = model.value
	// setSelected(props.defaultValue)
})

const toggleSelecting = () => {
	clearSearch()
	selecting.value = !selecting.value
}

const toggleOption = (option) => {
	if (model.value.filter.includes(option)) {
		model.value.filter = model.value.filter.filter(item => item !== option)
	} else {
		model.value.filter.push(option)
		model.value.key = props.filterKey
	}
	// clear other filters
	model.value.filter.forEach(item => {
		if (!props.options.includes(item)) {
			model.value.filter.splice(model.value.filter.indexOf(item), 1)
		}
	})
}

const clearSearch = () => {
	props.clearSearch()
}
</script>

<template>
	<div class="custom-dropdown flex flex-col justify-center  p-2 rounded-lg w-fit">
		<div @click="toggleSelecting" class="flex gap-2 items-center overflow-hidden w-fit">
			<span v-if="props.placeholder" class="text-neutral-70">{{ props.placeholder }}</span>
			<div class="flex items-center ml-auto transition-transform duration-300" :class="selecting? 'rotate-180' : ''">
				<component class="h-[0.625rem] w-[0.625rem]" :is="getIcon('chevron')" />
			</div>
		</div>
		<div v-if="selecting" class="options-container" @mouseleave="selecting = false">
			<div
				v-for="option in props.options"
				v-bind:key="option"
				class="px-4 rounded-md text-nowrap cursor-pointer flex gap-2"
				@click="toggleOption(option)"
				>
					<input type="checkbox" :value="option" :checked="model.filter.includes(option)" /> {{ option }}
			</div>
		</div>
	</div>
</template>

<style scoped>
.custom-dropdown {
	@apply relative
}
.options-container {
	@apply absolute top-[100%] bg-white right-0 z-30 px-2 py-6 rounded-lg mt-2 drop-shadow-2xl shadow-black flex flex-col gap-2;
}
.drop-icon {
	transition: transform .3s ease;
}
</style>
