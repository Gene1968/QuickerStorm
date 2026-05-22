import { createRouter, createWebHashHistory } from 'vue-router'
import { useSessionStore } from '@/stores/sessionStore'

const router = createRouter({
	history: createWebHashHistory(import.meta.env.BASE_URL),
	routes: [
		{ path: '/', redirect: '/landing' },
		{
			path: '/landing',
			name: 'Landing',
			component: () => import('@/views/LandingView.vue'),
		},
		{
			path: '/world',
			name: 'World',
			component: () => import('@/views/WorldView.vue'),
			beforeEnter: () => {
				const session = useSessionStore()
				if (!session.connected) return '/landing'
			},
		},
		{ path: '/:pathMatch(.*)*', redirect: '/landing' },
	],
})

export default router
