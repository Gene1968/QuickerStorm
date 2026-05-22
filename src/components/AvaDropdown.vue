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
	}

})

const selected = ref()
const selecting = ref(false)

onMounted(() => {
	// console.log("Model: ", model.value)
	selected.value = model.value
	// setSelected(props.defaultValue)
})

const setSelected = (option) => {
	//console.log(option)
	selected.value = option
	selecting.value = false
	model.value = option
}

const toggleSelecting = () => {
	selecting.value = !selecting.value
}

</script>

<template>
	<div class="custom-dropdown flex flex-col justify-center bg-white p-2 rounded-lg border border-neutral-50" :class="selecting? 'outline outline-2 outline-primary-50' : ''">
		<div @click="toggleSelecting" class="flex items-center overflow-hidden gap-4 min-h-[1.875rem] min-w-[6.25rem] px-2 py-1" >
			<span v-if="model" class="grow overflow-hidden text-nowrap">{{ model? model : props.placeholder }}</span>
			<span v-if="props.placeholder && !model" class="text-neutral-50">{{ props.placeholder }}</span>
			<div class="flex items-center pr-2 ml-auto">
				<component class="h-[0.625rem] w-[0.625rem]" :is="getIcon('chevron')" />
			</div>
		</div>
		<div v-if="selecting" class="options-container overflow-auto max-h-[12.5rem] min-w-full mt-2 border border-neutral-50 rounded-lg" @mouseleave="selecting = false">
			<div
				v-for="option in props.options"
				v-bind:key="option"
				class=" hover:bg-primary-70 hover:text-white px-4 rounded-md text-nowrap"
				@click="setSelected(option)"
				>
					{{ option }}
			</div>
		</div>
	</div>
</template>

<style scoped>
.custom-dropdown {
	@apply relative
}
.options-container {
	@apply absolute top-[100%] bg-neutral-20 right-0 z-30 p-2 rounded-lg shadow-white
}
.drop-icon {
	@apply transition-transform duration-300 ease-in-out
}
</style>
