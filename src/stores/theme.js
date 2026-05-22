import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useThemeStore = defineStore('theme', () => {
	const isDark = ref(localStorage.getItem('theme') === 'dark')

	const toggleTheme = () => {
		isDark.value = !isDark.value
		localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
		updateTheme()
	}
	const updateTheme = () => {
		if (isDark.value) {
			document.documentElement.classList.add('dark')
			document.documentElement.classList.remove('light')
		} else {
			document.documentElement.classList.remove('dark')
			document.documentElement.classList.add('light')
		}
	}

	// Initialize theme
	updateTheme()

	return {
		isDark,
		toggleTheme
	}
}) 
