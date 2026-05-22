import { useSessionLog } from '@/composables/useSessionLog'
import { useUserStore } from '@/stores/user'

export default {
	install: (app) => {
		const { logEvent, initializeSession } = useSessionLog()
		const userStore = useUserStore()

		// Setup batching for session logs
		let logQueue = []
		let isProcessing = false
		const BATCH_DELAY = 30000 // 30 seconds
		let batchTimeout = null

		const processLogQueue = async () => {
			if (logQueue.length === 0) {
				isProcessing = false
				return
			}

			const logs = [...logQueue]
			logQueue = [] // Clear the queue

			try {
				// Process all logs in the queue
				for (const log of logs) {
					await logEvent(log.event, log.details)
				}
			} catch (error) {
				dev.error('Error processing log batch:', error)
				// Optionally add failed logs back to queue
				// logQueue.push(...logs)
			}

			// If new logs were added during processing, start a new batch
			if (logQueue.length > 0) {
				startBatchTimer()
			} else {
				isProcessing = false
			}
		}

		const startBatchTimer = () => {
			isProcessing = true

			// Clear any existing timeout
			if (batchTimeout) {
				clearTimeout(batchTimeout)
			}

			// Set new timeout
			batchTimeout = setTimeout(() => {
				processLogQueue()
			}, BATCH_DELAY)
		}

		const queueLogEvent = (event, details) => {
			logQueue.push({ event, details })

			// If not already processing, start the batch timer
			if (!isProcessing) {
				startBatchTimer()
			}
		}

		// Setup idle detection
		let idleTimeout
		const resetIdleTimer = () => {
			clearTimeout(idleTimeout)
			idleTimeout = setTimeout(() => {
				queueLogEvent('User Idle', 'User has been inactive for 5 minutes')
			}, 5 * 60 * 1000)
		}

		// Setup visibility change detection
		const handleVisibilityChange = () => {
			if (document.visibilityState === 'visible') {
				queueLogEvent('Tab Visible', 'User returned to this tab')
				resetIdleTimer()
			} else {
				queueLogEvent('Tab Hidden', 'User switched to another tab')
			}
		}

		// Setup window focus detection
		const handleFocusChange = (isFocused) => {
			if (isFocused) {
				queueLogEvent('Window Focused', 'User returned to the application')
				resetIdleTimer()
			} else {
				queueLogEvent('Window Blurred', 'User left the application')
			}
		}

		// Add event listeners
		document.addEventListener('visibilitychange', handleVisibilityChange)
		window.addEventListener('focus', () => handleFocusChange(true))
		window.addEventListener('blur', () => handleFocusChange(false))

		// Add user activity listeners to reset idle timer
		const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart']
		activityEvents.forEach(event => {
			document.addEventListener(event, resetIdleTimer)
		})

		// Start idle timer
		resetIdleTimer()

		// Add click logging directive if not already registered
		if (!app._context.directives['click-log']) {
			app.directive('click-log', {
				mounted (el, binding) {
					el.addEventListener('click', async () => {
						// Get element details
						const elementType = el.tagName.toLowerCase()
						const elementId = el.id || ''
						const elementClass = el.className || ''
						const elementText = el.textContent?.trim() || ''
						const elementHref = el.href || ''
						const elementValue = el.value || ''
						const elementName = el.name || ''
						const elementRole = el.getAttribute('role') || ''
						const elementAriaLabel = el.getAttribute('aria-label') || ''

						// Build click details
						const details = {
							type: elementType,
							id: elementId,
							class: elementClass,
							text: elementText,
							href: elementHref,
							value: elementValue,
							name: elementName,
							role: elementRole,
							ariaLabel: elementAriaLabel,
							customDetails: binding.value || ''
						}

						queueLogEvent('Element Clicked', JSON.stringify(details))
					})
				}
			})
		}

		// Log global errors and persist to CN-Errors via useError
		app.config.errorHandler = async (error, instance, info) => {
			try {
				await logEvent('Error', `Error in ${info}: ${error?.message}`)
			} catch { /* ignore */ }
		}

		// Log unhandled promise rejections
		window.addEventListener('unhandledrejection', async (event) => {
			try {
				await logEvent('Unhandled Promise Rejection', event.reason?.message || 'Unknown error')
			} catch { /* ignore */ }
		})

		// Setup router logging when available
		if (app.router) {
			app.router.beforeEach(async (to, from, next) => {
				await logEvent('Navigation', `Navigated from ${from.path} to ${to.path}`)
				next()
			})
		}

		// Initialize session when user is authenticated
		const initializeSessionWhenReady = async () => {
			if (userStore.isInitialized && userStore.cnCurrentUser) {
				await initializeSession()
			} else {
				setTimeout(initializeSessionWhenReady, 500)
			}
		}

		// Start initialization process
		initializeSessionWhenReady()
	}
} 
