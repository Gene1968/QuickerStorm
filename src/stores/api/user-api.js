import { defineStore } from 'pinia'
import UserApi from '../../api/UserApi.js'

export const useUserApiStore = defineStore('userApi', {
	state: () => ({
		userApi: new UserApi(import.meta.env.VITE_APP_USERS_URL),
	}),
})

