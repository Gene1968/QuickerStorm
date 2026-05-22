<script setup>
import { onMounted, computed, ref } from "vue";
import { getIcon } from '@/composables/iconChoices'
import { useUserStore } from "@/stores/userStore";
import { useAuthStore } from "@/stores/AuthStore";
// import { useRequestsStore } from "@/stores/requestsStore";
import { useRouter } from 'vue-router'
import { MessageSquare as ChatBubbleLeftRightIcon } from '@lucide/vue'
import { config } from '@/config/configuration.js'

const router = useRouter()

const userStore = useUserStore();
const user = computed(() => userStore.user);
// const requestsStore = useRequestsStore();
const authStore = useAuthStore();
const authUser = computed(() => authStore.authUser);
const userPrincipalName = computed(() => userStore.userPrincipalName);

// just for getting the user name while testing locally
const userName = computed(() => {
	if (userPrincipalName.value) {
		let first = userPrincipalName.value.split('@')[0];
		first = first.substring(0, first.indexOf('.'));
		let last = userPrincipalName.value.split('.')[1];
		last = last.substring(0, last.indexOf('@'));
		return first + ' ' + last;
	}
	return '';
});

onMounted(async () => {
	if (!user.value) {
		let userFetched = await userStore.fetchUser();
		if (userFetched) {
			//console.log("userFetched", user.value)
		}
	}
	if (!authUser.value) {
		let fetched = await authStore.fetchAuthList();
		if (fetched) {
			await authStore.checkUserRole(user.value.UserPrincipalName)
			//console.log("fetched", fetched)
			// authUser.value = fetched.find(x => x.Email === user.value.UserPrincipalName);
		}
	}
	//console.log("authUser", authUser.value)
});

const navTo = (path) => {
	router.push(path)
}

const showManageAccess = ref(false)
const toggleManageAccess = () => {
	showManageAccess.value = !showManageAccess.value
}
</script>


<template>
	<nav class="header-container mb-0 py-0 pe-8 flex justify-between items-center font-montserrat">
		<button @click="navTo('/')" class="hover:bg-neutral-80 h-full inline-flex items-center gap-3 py-1 px-8">
			<ChatBubbleLeftRightIcon class="w-[3rem] text-primary-60" />
			<h1 class="text-2xl text-[#B8D6EA] text-nowrap font-bold"> QuickerStorm <span class="text-[#FBC230] font-medium italic"> &#8212; your virtual Worlds on Web! </span><!----><!----></h1>
		</button>
		<div class="flex items-center gap-4">
			<!-- <div v-if="role === 'APDP Manager' || role === 'Career Field Manager'"> -->
			<!-- <div >
				<button @click="toManageAccess" class="realtive group text-neutral-70 px-4 py-1 rounded-md flex items-center gap-2">
					<div class="flex items-center gap-2 manage-access">
						<component class="h-[0.9375rem] w-[0.9375rem] " :is="getIcon('gear')" />
						<span class="font-semibold text-sm">
							Manage Access
						</span>
					</div>
				</button>
			</div> -->
		</div>
		<div class="relative flex items-center text-neutral-40 font-semibold capitalize pr-4">
			<!-- <span class="">{{ authRole }}</span> -->
			<div @click="toggleManageAccess" class="flex gap-2 cursor-pointer hover:bg-neutral-80 items-center ml-2 px-2 py-1 rounded-md">
				<span v-if="user" class="">{{ userName }}</span>
				<component class="h-[0.9375rem] w-[0.9375rem]" :is="getIcon('user')" />
			</div>
			<!-- <button>
				<component class="h-[0.9375rem] w-[0.9375rem] " :is="getIcon('bell')" />
			</button> -->
			<div @mouseleave="toggleManageAccess" v-if="showManageAccess" class="z-50 absolute top-[110%] right-[1.25rem] p-2 bg-white rounded-md shadow-lg shadow-neutral-50 flex flex-col gap-4">

				<button v-if="authUser?.IsAdmin" @click="navTo('/manage-access')" class="hover:bg-primary-20 realtive group text-neutral-70 px-4 py-1 rounded-md flex items-center gap-2">
					<component class="h-[0.9375rem] w-[0.9375rem] " :is="getIcon('users')" />
					<span class="font-semibold text-sm text-nowrap">
						Manage Access
					</span>
				</button>
				<a v-if="config.formsAndGuidesUrl" :href="config.formsAndGuidesUrl" target="_blank" rel="noopener noreferrer" class="hover:bg-primary-20 hover:text-primary-70 realtive w-full group text-neutral-70 px-4 py-1 rounded-md flex items-center gap-2">
					<component class="h-[0.9375rem] w-[0.9375rem]" :is="getIcon('book')" />
					<span class="font-semibold text-sm text-nowrap">
						Forms & Guides
					</span>
				</a>
				<!-- <button @click="navTo('/metrics')" class="hover:bg-primary-20 realtive w-full group text-neutral-70 px-4 py-1 rounded-md flex items-center gap-2">
					<component class="h-[0.9375rem] w-[0.9375rem] " :is="getIcon('metrics')" />
					<span class="font-semibold text-sm text-nowrap">
						Metrics
					</span>
				</button> -->
				<a href="https://www.my.af.mil/gcss-af/USAF/ep/browse.do?programId=t0ECF2BB8471D4726014736796A1701CC&channelPageId=s6925EC1348B50FB5E044080020E329A9" target="_blank" class="hover:bg-primary-20 hover:text-primary-70 realtive w-full group text-neutral-70 px-4 py-1 rounded-md flex items-center gap-2">
					<component class="h-[0.9375rem] w-[0.9375rem] " :is="getIcon('question')" />
					<span class="font-semibold text-sm text-nowrap">
						Help
					</span>
				</a>
				<!-- <button @click="navTo('/feedback')" class="hover:bg-primary-20 hover:text-primary-70 realtive w-full group text-neutral-70 px-4 py-1 rounded-md flex items-center gap-2">
					<component class="h-[0.9375rem] w-[0.9375rem] " :is="getIcon('commentSolid')" />
					<span class="font-semibold text-sm text-nowrap">
						Give Feedback
					</span>
				</button> -->
			</div>
		</div>

	</nav>
</template>


<style scoped>
.header-container {
	 background: linear-gradient( 30deg, #082E5C, #1B4F98 );
}

.manage-access {
	@apply relative
}

.manage-access::after {
	@apply content-[''] absolute bottom-[-0.3125rem] left-[50%] w-[0px] h-[0.125rem] bg-neutral-70 transition-all duration-300 ease-in-out
}

.manage-access:hover::after {
	@apply w-full left-0
}

</style>

