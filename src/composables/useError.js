import { useErrorStore } from '@/stores/error.js'
import { useSteward } from '@/components/Steward'
import { ResultsItemRepository } from '@/api/helpers/resultsRepository'
import { config } from '@/config/configuration.js'
import { useUserStore } from '@/stores/user'
import { useSessionLogsStore } from '@/stores/sessionLogs'

export function useError () {
	const errorStore = useErrorStore()
	const { notifyError } = useSteward()
	const userStore = useUserStore()
	const sessionLogsStore = useSessionLogsStore()

	// Initialize repository for CN-Errors list
	const cnErrorsRepo = new ResultsItemRepository(
		config.lists.cnErrorsList.listUrl,
		config.lists.cnErrorsList.listName
	)

	function getEnvironmentInfo () {
		try {
			return {
				userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
				platform: typeof navigator !== 'undefined' ? navigator.platform : '',
				language: typeof navigator !== 'undefined' ? navigator.language : '',
				languages: typeof navigator !== 'undefined' ? navigator.languages : [],
				vendor: typeof navigator !== 'undefined' ? navigator.vendor : '',
				online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
				screen: typeof window !== 'undefined' && window.screen ? {
					width: window.screen.width,
					height: window.screen.height,
					pixelRatio: window.devicePixelRatio,
				} : undefined,
				viewport: typeof window !== 'undefined' ? {
					innerWidth: window.innerWidth,
					innerHeight: window.innerHeight,
				} : undefined,
				locationHref: typeof window !== 'undefined' && window.location ? window.location.href : '',
				timezone: Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone || '',
			}
		} catch {
			return {}
		}
	}

	const persistToCnErrors = async (payload) => {
		try {
			await cnErrorsRepo.createListItem(payload)
		} catch (e) {
			// Swallow to avoid cascading failures; console for diagnostics

			dev.error('Failed to persist CN error', e)
		}
	}

	const addError = async (error) => {
		errorStore.errors.push(error)
		const durationMs = 5000
		notifyError(error.message, durationMs)

		// Build enriched payload for CN-Errors
		const nowIso = new Date().toISOString()
		const currentUserId = userStore?.cnCurrentUser?.cnUsersListKey || ''
		const sessionId = sessionLogsStore?.currentSession?.sessionLogsSessionId || ''

		const baseError = error?.defaultError || error?.error || null
		const errorMessage = error?.message || baseError?.message || 'Unknown error'
		const errorStack = baseError?.stack || null
		const errorName = baseError?.name || null

		const environment = getEnvironmentInfo()

		const messagePayload = {
			message: errorMessage,
			id: error?.id || undefined,
			occuredAt: error?.occuredAt ? new Date(error.occuredAt).toISOString() : nowIso,
			sessionId,
		}

		const savePayload = {
			cnErrorsErrorMessage: JSON.stringify(messagePayload, null, 2),
			cnErrorsUserId: String(currentUserId || ''),
			cnErrorsTimeStamp: nowIso,
			cnErrorsLocation: String(error?.location || ''),
			cnErrorsEnvironment: JSON.stringify(environment),
			cnErrorsExtra: JSON.stringify(error?.extra || error?.details || undefined),
			cnErrorsName: String(errorName || ''),
			cnErrorsStack: String(errorStack || ''),
		}

		// Fire-and-forget persistence
		persistToCnErrors(savePayload)
	}

	const clearErrors = () => {
		errorStore.errors = []
	}

	return {
		errors: errorStore.errors,
		addError,
		clearErrors,
	}
}
