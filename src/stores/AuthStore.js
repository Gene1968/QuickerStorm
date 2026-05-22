import { ref } from "vue";
import { defineStore } from "pinia";
import { config, listSiteUrl } from "../config/configuration.js";
import ListApi from "../api/ListApi.js";


// thinking about changing persmissions to clean things up a bit. Working example here.
// the benefit of this approach would be reusability of the most of this system for other
// routing / approval processes.  The roles could be defined in a file and swapped out easily.
const _roles = {
	utm: [
		"view:requests",
		"view:comments",
		"create:comments",
		"create:requests",
		"edit:requests"
	],
	apdpManager: [
		"view:comments",
		"view:requests",
		"create:comments",
		"edit:requestsValidation",
		"edit:certifications",
		"close:requests"
	],
	careerFieldManager: [
		"view:requests",
		"view:comments",
		"create:comments",
		"edit:requestsValidation",
		"edit:certifications"
	]
}

export const useAuthStore = defineStore("AuthStore", () => {

	const authList = ref([]);
	const authUser = ref();

	const fetchAuthList = async () => {
		let query = {
			$select: "Email, Role, IsAdmin, Org2L, Location, FunctionalArea, Title, ID"
		}
		const response = await ListApi(listSiteUrl('auth'), config.lists.auth.listName).getAll(query)
		if (response.d.results) {
			response.d.results.forEach(item => {
				if (item.AuthExpiration) {
					item.AuthExpiration = item.AuthExpiration.substring(0, 10)
				}
			})
			response.d.results.sort((a, b) => {
				if (a.Role === 'UTM') return -1;
				if (b.Role === 'UTM') return 1;
				if (a.Role === 'APDP Manager') return -1;
				if (b.Role === 'APDP Manager') return 1;
				return 0; // Keep the order unchanged for other roles
			})
			authList.value = response.d.results
		} else {
			authList.value = []
		}
		return authList.value
	}

	const fetchUserRole = async (email) => {
		let query = {
			$filter: `Email eq '${email}'`
		}
		const response = await ListApi(listSiteUrl('auth'), config.lists.auth.listName).getAll(query)
		if (response.d.results) {
			return response.d.results[0].Role
		} else {
			return null
		}
	}

	const updateAuthUser = async (payload) => {
		const response = await ListApi(listSiteUrl('auth'), config.lists.auth.listName).updateListItem(payload, payload.ID)
		if (response) {
			authList.value = await fetchAuthList()
			return response
		} else {
			return null
		}
	}

	const createAuthUser = async (payload) => {
		const response = await ListApi(listSiteUrl('auth'), config.lists.auth.listName).createListItem(payload)
		if (response) {
			authList.value = await fetchAuthList()
			return response
		} else {
			return null
		}
	}

	const deleteAuthUser = async (ID) => {
		const response = await ListApi(listSiteUrl('auth'), config.lists.auth.listName).deleteListItem(ID)
		if (response) {

			authList.value = await fetchAuthList()
			return response
		} else {
			return null
		}
	}

	const checkUserRole = async (email) => {
		//console.log("Checking user: ", email)
		// let authUser = null
		if (authList.value.length > 0) {
			authUser.value = authList.value.find(item => item.Email === email)
		}
		return authUser
	}

	const getUTM = async(org2L) => {
		let utm = authList.value.filter(item => item.Role === 'UTM' && item.Org2L === org2L)
		utm = simplifyRoleData(utm)
		return utm
	}

	const getCFM = async(careerField) => {
		if (!authList.value) {
			await fetchAuthList()
		}
		let cfm = authList.value.filter(item => item.Role === 'Career Field Manager' && item.FunctionalArea === careerField)
		cfm = simplifyRoleData(cfm)
		return cfm
	}

	const getAPDPManager = async() => {
		let apdpManager = authList.value.filter(item => item.Role === 'APDP Manager')
		apdpManager = simplifyRoleData(apdpManager)
		return apdpManager
	}

	const simplifyRoleData = (roleData) => {
		let simplifiedData = []
		roleData.forEach(item => {
			simplifiedData.push(item.Email)
		})
		return simplifiedData
	}

	return {
		authList,
		authUser,
		fetchAuthList,
		fetchUserRole,
		updateAuthUser,
		createAuthUser,
		deleteAuthUser,
		checkUserRole,
		getCFM,
		getAPDPManager,
		getUTM
	};
});
