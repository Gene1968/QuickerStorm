import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export const useErrorStore = defineStore('error', () => {
	const errors = ref([])

	const getErrors = computed(() => errors.value)

	return { errors, getErrors }
})