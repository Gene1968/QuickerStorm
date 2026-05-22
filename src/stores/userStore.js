/**
 * userStore — current signed-in user (identity only).
 *
 * Identity comes from Supabase Auth (Google OAuth). AuthRepo.getUser() returns
 * a SP-shaped object (Title/Email/UserPrincipalName/Id) so avatarStore and
 * presence code that predates the Supabase cut-over keeps working.
 *
 * This store is intentionally small — avatar/preferences live in avatarStore,
 * presence lives in presenceStore. Only keep identity here.
 */
import { ref, computed } from "vue"
import { defineStore } from "pinia"
import { AuthRepo } from "../api/backend.js"

export const useUserStore = defineStore("UserStore", () => {
	const user = ref(null)
	const userPrincipalName = ref('')

	const getUser = computed(async () => user.value || null)

	const setUserPrincipalName = (newVal) => { userPrincipalName.value = newVal }
	const getUserPrincipalName = computed(() =>
		userPrincipalName.value || null,
	)

	const fetchUser = async () => {
		await AuthRepo.ready()
		const u = AuthRepo.getUser()
		if (u) {
			user.value = u
			userPrincipalName.value = u.UserPrincipalName || u.Email || ''
		}
		return user.value
	}

	const clear = () => {
		user.value = null
		userPrincipalName.value = ''
	}

	return {
		user,
		getUser,
		userPrincipalName,
		fetchUser,
		clear,
		getUserPrincipalName,
		setUserPrincipalName,
	}
})
