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
		default: '0 0 16 14'
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
			d="M1.75 0C0.783502 0 0 0.783501 0 1.75V5.01091C0.50515 4.6875 1.10568 4.5 1.75 4.5H14.25C14.8943 4.5 15.4949 4.6875 16 5.01091V3.75C16 2.7835 15.2165 2 14.25 2H9.41421C9.34791 2 9.28432 1.97366 9.23744 1.92678L7.82322 0.512563C7.49503 0.184374 7.04992 0 6.58579 0H1.75Z" 
			fill="currentColor"/>
		<path 
			d="M1.75 6C0.783502 6 0 6.7835 0 7.75V12.25C0 13.2165 0.783501 14 1.75 14H14.25C15.2165 14 16 13.2165 16 12.25V7.75C16 6.7835 15.2165 6 14.25 6H1.75Z" 
			fill="currentColor"/>
	</svg>


</template>
