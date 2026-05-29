import './utils/devGlobal.js'
import './index.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router/index.js'

if (typeof __BUILD_TIME__ !== 'undefined') {// on local, I think this is more like when the dev server was started:
	console.log(
		`%cquickerSTORM %cbuild ${__BUILD_TIME__}`,
		'color:#00b4d8;font-weight:700',
		'color:#7ab8d0',
	)
}

const app = createApp(App)

app.use(createPinia())
app.use(router)

// v-click-outside: close dropdowns when clicking outside their element
app.directive('click-outside', {
	mounted(el, binding) {
		el._clickOutside = (e) => { if (!el.contains(e.target)) binding.value(e) }
		document.addEventListener('click', el._clickOutside, true)
	},
	unmounted(el) {
		document.removeEventListener('click', el._clickOutside, true)
	},
})

app.mount('#app')
