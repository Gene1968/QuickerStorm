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
		default: '0 0 18 18'
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
			d="M11.17 2L16 6.83V16H2V2H11.17ZM11.17 0H2C0.9 0 0 0.9 0 2V16C0 17.1 0.9 18 2 18H16C17.1 18 18 17.1 18 16V6.83C18 6.3 17.79 5.79 17.41 5.42L12.58 0.59C12.21 0.21 11.7 0 11.17 0ZM4 12H14V14H4V12ZM4 8H14V10H4V8ZM4 4H11V6H4V4Z" 
			fill="currentColor"/>
	</svg>

</template>
