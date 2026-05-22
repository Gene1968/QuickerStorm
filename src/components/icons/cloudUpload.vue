<script setup>
const props = defineProps({
	width: {
		type: String,
		default: '50px'
	},
	height: {
		type: String,
		default: '50px'
	},
	stroke: {
		type: String,
		default: '#0F172A'
	},
	fill: {
		type: String,
		default: 'none'
	},
	strokeWidth: {
		type: String,
		default: '1.5'
	},
	strokeLinecap: {
		type: String,
		default: 'round'
	},
	strokeLinejoin: {
		type: String,
		default: 'round'
	},
	viewBox: {
		type: String,
		default: '0 0 22 18'
	}

})
</script>

<template>
	<svg 
		:width="props.width" 
		:height="props.height" 
		:viewBox="props.viewBox" 
		fill="none" 
		xmlns="http://www.w3.org/2000/svg">
	<path 
		d="M11 13.5L11 6.75M11 6.75L14 9.75M11 6.75L8 9.75M5.75 16.5C3.26472 16.5 1.25 14.4853 1.25 12C1.25 10.0071 2.54555 8.3167 4.3404 7.72519C4.28105 7.4092 4.25 7.08323 4.25 6.75C4.25 3.85051 6.60051 1.5 9.5 1.5C11.9312 1.5 13.9765 3.1526 14.5737 5.39575C14.8654 5.30113 15.1767 5.25 15.5 5.25C17.1569 5.25 18.5 6.59315 18.5 8.25C18.5 8.59814 18.4407 8.93243 18.3316 9.24332C19.7453 9.78046 20.75 11.1479 20.75 12.75C20.75 14.8211 19.0711 16.5 17 16.5H5.75Z" 
		stroke="currentColor" 
		stroke-width="1.5" 
		stroke-linecap="round" 
		stroke-linejoin="round"/>
	</svg>

</template>
