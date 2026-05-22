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
		default: '0 0 14 9'
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
	xmlns="http://www.w3.org/2000/svg">
		<path 
		fill-rule="evenodd" 
		clip-rule="evenodd" 
		d="M0.292893 0.337327C-0.0976311 0.727851 -0.0976312 1.36102 0.292893 1.75154L6.29289 7.75154C6.68342 8.14207 7.31658 8.14207 7.70711 7.75154L13.7071 1.75154C14.0976 1.36102 14.0976 0.727852 13.7071 0.337327C13.3166 -0.0531969 12.6834 -0.0531969 12.2929 0.337327L7 5.63022L1.70711 0.337327C1.31658 -0.0531974 0.683418 -0.0531975 0.292893 0.337327Z" 
		fill="currentColor"/>
	</svg>

</template>
