import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
	history: createWebHashHistory(import.meta.env.BASE_URL),
	routes: [
		{
			path: '/',
			redirect: '/setup',
		},
		{
			path: '/setup',
			name: 'Setup',
			component: () => import('@/views/SetupView.vue'),
		},
		{
			path: '/office',
			name: 'Office',
			component: () => import('@/views/OfficeView.vue'),
		},
		{
			// Catch-all → office
			path: '/:pathMatch(.*)*',
			redirect: '/office',
		},
	],
})

export default router
