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
		default: '0 0 22 12'
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
			d="M1 10H21V12H1V10ZM2.15 5.95L3 4.47L3.85 5.95L5.15 5.2L4.3 3.72H6V2.22H4.3L5.15 0.75L3.85 0L3 1.47L2.15 0L0.85 0.75L1.7 2.22H0V3.72H1.7L0.85 5.2L2.15 5.95ZM8.85 5.2L10.15 5.95L11 4.47L11.85 5.95L13.15 5.2L12.3 3.72H14V2.22H12.3L13.15 0.75L11.85 0L11 1.47L10.15 0L8.85 0.75L9.7 2.22H8V3.72H9.7L8.85 5.2ZM22 2.22H20.3L21.15 0.75L19.85 0L19 1.47L18.15 0L16.85 0.75L17.7 2.22H16V3.72H17.7L16.85 5.2L18.15 5.95L19 4.47L19.85 5.95L21.15 5.2L20.3 3.72H22V2.22Z" 
			fill="currentColor"/>
	</svg>

</template>
