<script setup>
import { ref, computed } from 'vue';
import { useUserStore } from '@/stores/userStore';
import {
	Home as HomeIcon,
	Users as UserGroupIcon,
	TrendingUp as ArrowTrendingUpIcon,
	BookOpen as BookOpenIcon,
} from '@lucide/vue';

const userStore = useUserStore();

/** Tabs align with future profile areas (community, career, education). */
const activeSection = ref('Home');

const displayName = computed(() => {
	const u = userStore.user;
	if (u?.Title) return u.Title;
	const upn = userStore.getUserPrincipalName;
	if (upn) return upn.replace(/@.*$/, '');
	return 'there';
});

const handleFilterChange = (filter) => {
	activeSection.value = filter;
};
</script>

<template>
	<div class="user-home">
		<section
			class="mb-8 rounded-xl border border-slate-200/80 bg-white/80 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/60"
		>
			<p class="text-sm text-slate-500 dark:text-slate-400">Profile</p>
			<h1 class="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
				Welcome, {{ displayName }}
			</h1>
			<p class="mt-2 max-w-2xl text-slate-600 dark:text-slate-400">
				This is your home space. The sections below are placeholders for a future profile experience
				(community, career, education).
			</p>
		</section>

		<div
			class="text-slate-600 dark:text-slate-400 mb-6 flex w-fit flex-wrap overflow-hidden rounded-md bg-slate-100 dark:bg-slate-900"
		>
			<button
				type="button"
				class="relative flex min-w-[9.375rem] items-center gap-2 px-4 py-2 hover:dark:bg-slate-700"
				:class="{ 'top-bar text-slate-900 dark:text-slate-100 dark:bg-slate-700': activeSection === 'Home' }"
				@click="handleFilterChange('Home')"
			>
				<HomeIcon class="h-5 w-5" />
				<span>Home</span>
			</button>
			<button
				type="button"
				class="relative flex min-w-[9.375rem] items-center gap-2 px-4 py-2 hover:dark:bg-slate-700"
				:class="{
					'top-bar text-slate-900 dark:text-slate-100 dark:bg-slate-700': activeSection === 'CommUnity',
				}"
				@click="handleFilterChange('CommUnity')"
			>
				<UserGroupIcon class="h-5 w-5" />
				<span>CommUnity</span>
			</button>
			<button
				type="button"
				class="relative flex min-w-[9.375rem] items-center gap-2 px-4 py-2 hover:dark:bg-slate-700"
				:class="{ 'top-bar text-slate-900 dark:text-slate-100 dark:bg-slate-700': activeSection === 'Career' }"
				@click="handleFilterChange('Career')"
			>
				<ArrowTrendingUpIcon class="h-5 w-5" />
				<span>Career Planning</span>
			</button>
			<button
				type="button"
				class="relative flex min-w-[9.375rem] items-center gap-2 px-4 py-2 hover:dark:bg-slate-700"
				:class="{
					'top-bar text-slate-900 dark:text-slate-100 dark:bg-slate-700': activeSection === 'Education',
				}"
				@click="handleFilterChange('Education')"
			>
				<BookOpenIcon class="h-5 w-5" />
				<span>Education</span>
			</button>
		</div>

		<div
			class="min-h-[15rem] rounded-lg border border-dashed border-slate-300/80 p-6 dark:border-slate-600"
		>
			<div v-show="activeSection === 'Home'">
				<h2 class="text-lg font-medium text-slate-900 dark:text-slate-100">Home</h2>
				<p class="mt-2 text-slate-600 dark:text-slate-400">
					Overview and shortcuts will appear here as the profile grows.
				</p>
			</div>
			<div v-show="activeSection === 'CommUnity'">
				<h2 class="text-lg font-medium text-slate-900 dark:text-slate-100">CommUnity</h2>
				<p class="mt-2 text-slate-600 dark:text-slate-400">
					Community connections and groups will be surfaced here.
				</p>
			</div>
			<div v-show="activeSection === 'Career'">
				<h2 class="text-lg font-medium text-slate-900 dark:text-slate-100">Career planning</h2>
				<p class="mt-2 text-slate-600 dark:text-slate-400">
					Career tools and goals can live in this section later.
				</p>
			</div>
			<div v-show="activeSection === 'Education'">
				<h2 class="text-lg font-medium text-slate-900 dark:text-slate-100">Education</h2>
				<p class="mt-2 text-slate-600 dark:text-slate-400">
					Training and education content will appear here when integrated.
				</p>
			</div>
		</div>
	</div>
</template>

<style scoped>
.top-bar {
	@apply bg-white dark:bg-slate-700/85;
}
.top-bar:after {
	@apply content-[''] absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary-80 to-primary-90/20;
}
</style>
