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
		default: '0 0 22 22'
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
		d="M12.1903 7.68842C12.6393 7.90291 13.0601 8.19611 13.432 8.56802C15.1893 10.3254 15.1893 13.1746 13.432 14.932L8.93198 19.432C7.17462 21.1893 4.32538 21.1893 2.56802 19.432C0.81066 17.6746 0.81066 14.8254 2.56802 13.068L4.32499 11.311M17.675 10.689L19.432 8.93198C21.1893 7.17462 21.1893 4.32538 19.432 2.56802C17.6746 0.81066 14.8254 0.81066 13.068 2.56802L8.56802 7.06802C6.81066 8.82538 6.81066 11.6746 8.56802 13.432C8.93992 13.8039 9.36073 14.0971 9.80974 14.3116" 
		stroke="currentColor" 
		:stroke-width="props.strokeWidth" 
		:stroke-linecap="props.strokeLinecap" 
		:stroke-linejoin="props.strokeLinejoin"/>
	</svg>

</template>
