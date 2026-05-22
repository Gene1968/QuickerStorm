<script setup>
import { onMounted, onBeforeUnmount, computed } from 'vue'
import { getIcon } from '@/composables/iconChoices'

const props = defineProps({
	title: {
		type: String,
		required: true
	},
	close: {
		type: Function,
		required: true
	},
	width: {
		type: String
	},
	hideButtons: {
		type: Boolean,
		default: false
	}
})


const myWidth = computed(() => {
	return props.width
})

const handleOutsideClick = (event) => {
	if (event.target.id === 'modalBG') {
		props.close()
	}
}

onMounted(() => {
  document.getElementById('modalBG').addEventListener('click', handleOutsideClick)
})

onBeforeUnmount(() => {
  document.getElementById('modalBG').removeEventListener('click', handleOutsideClick)
})

const closeModal = () => {
	props.close()
}
</script>

<template>
	<div id="modalBG" class="fixed inset-0 bg-neutral-80/50 z-50 flex items-center justify-center">
		<div :class="'min-w-[ ' + props.width + ']'" class="inner-modal max-w-[95%] bg-neutral-10 rounded-lg max-h-[95vh] min-h-[12.5rem] relative">
			<div class="sticky top-0 flex items-center justify-between border-b border-neutral-50 p-5">
				<span class="text-2xl font-roboto-flex text-neutral-80 font-semibold">
					{{ props.title }}
				</span>
				<button class=" text-neutral-80 hover:bg-darken rounded-md p-2" @click="closeModal">
					<component class="h-[0.9375rem] w-[0.9375rem]" :is="getIcon('close')" />
				</button>
			</div>
			<div class="p-10">
				<slot name="content" class="max-w-[100%]">


				</slot>
			</div>
			<div v-if="!hideButtons" class="p-4 sticky bottom-[1.1875rem] rounded-b-lg bg-neutral-10 flex justify-end border-t border-neutral-50">
				<slot name="buttons">


				</slot>
			</div>

		</div>
	</div>
</template>

<style scoped>
.inner-modal {
	min-width: v-bind(myWidth)!important;
}
</style>
