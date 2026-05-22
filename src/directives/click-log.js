import { useSessionLog } from '@/composables/useSessionLog'

export const clickLog = {
	mounted (el, binding) {
		const { logEvent } = useSessionLog()

		// Debounce configuration
		const DEBOUNCE_DELAY = 1000 // 1 second cooldown between clicks
		let lastClickTime = 0
		let isProcessing = false

		el.addEventListener('click', async () => {
			const now = Date.now()

			// Check if we're still in the debounce period or already processing
			if (now - lastClickTime < DEBOUNCE_DELAY || isProcessing) {
				// console.log('Click logged: Debounced (too frequent)')
				return
			}

			// Update last click time and set processing flag
			lastClickTime = now
			isProcessing = true

			try {
				const eventName = binding.value || el.textContent?.trim() || 'Element Clicked'
				const details = binding.arg || ''

				await logEvent(eventName, details)
			} catch (error) {
				dev.error('Error logging click event:', error)
			} finally {
				// Reset processing flag after a short delay to allow for the debounce period
				setTimeout(() => {
					isProcessing = false
				}, DEBOUNCE_DELAY)
			}
		})
	}
} 
