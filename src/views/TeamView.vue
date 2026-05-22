<script setup>
import { ref, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import TeamManagement from '@/components/team/TeamManagement.vue';
import IncomingRequests from '@/components/knowledge/supervisor/IncomingRequests.vue';
import TeamDashboard from '@/components/team/TeamDashboard.vue';
import { PieChart as ChartPieIcon, Users as UserGroupIcon, MessageSquare as ChatBubbleLeftRightIcon } from '@lucide/vue';
const HeroIconsMicro = { ChartPieIcon, UserGroupIcon, ChatBubbleLeftRightIcon };
import { useGridRevealCorners } from '@/composables/useGridRevealCorners.js';

const rootRef = ref(null);
useGridRevealCorners(rootRef);

const route = useRoute();
const activeTab = ref('Dashboard');

const _tabs = [
	{
		label: 'Dashboard',
		icon: HeroIconsMicro.ChartPieIcon,
	},
	{
		label: 'Team Members',
		icon: HeroIconsMicro.UserGroupIcon,
	},
	{
		label: 'Requests',
		icon: HeroIconsMicro.ChatBubbleLeftRightIcon,
	},
]

// Map query parameter to tab label
const tabMap = {
	'dashboard': 'Dashboard',
	'team-members': 'Team Members',
	'requests': 'Requests'
};

// Set active tab from query parameter on mount or when route changes
onMounted(() => {
	if (route.query.tab && tabMap[route.query.tab]) {
		activeTab.value = tabMap[route.query.tab];
	}
});

// Watch for route query changes
watch(() => route.query.tab, (newTab) => {
	if (newTab && tabMap[newTab]) {
		activeTab.value = tabMap[newTab];
	}
});

</script>
<template>
	<div ref="rootRef" class="grid-reveal-corners p-8 max-w-screen-2xl">
		<!-- <div class="sticky top-[88px] self-start text-slate-600 dark:text-slate-400">
			<div class="flex mb-2">
				<button 
					v-for="tab in tabs" 
					:key="tab" 
					class="border-b-2 px-4 py-1 border-neutral-40"
					:class="{ '!border-primary-60 !text-primary-60': activeTab === tab.label }" 
					@click="activeTab = tab.label">
					<component :is="tab.icon" class="w-4 h-4 inline" />
					<span class="text-sm font-bold pl-2">{{ tab.label }}</span>
				</button>
			</div>
		</div> -->
		<TeamDashboard v-if="activeTab === 'Dashboard'" class="grid-reveal-corners" />
		<div v-if="activeTab === 'Team Members'" class="grid-reveal-corners">
			<TeamManagement/>
		</div>
		<IncomingRequests v-if="activeTab === 'Requests'" class="grid-reveal-corners" />
	</div>
</template>

<style scoped></style>
