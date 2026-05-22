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
		default: '0 0 26 28'
	}

})
</script>

<template>
	<!-- Replace SVG example below with svg content-->
	<!-- Change existing svg property values to props above-->
	<!-- Do NOT change main svg color you want displayed. Instead, change it's value to 'currentColor'-->

	<svg 
		:width="props.width" 
		:height="props.height" 
		:viewBox="props.viewBox" 
		fill="none" 
		xmlns="http://www.w3.org/2000/svg">
		<path 
			d="M1.75 9H24.25L16.75 1.5M24.25 19H1.75L9.25 26.5" 
			stroke="currentColor" 
			:stroke-width="props.strokeWidth" 
			:stroke-linecap="props.strokeLinecap" 
			:stroke-linejoin="props.strokeLinejoin"/>
	</svg>

</template>
