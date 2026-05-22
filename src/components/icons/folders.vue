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
		default: '0 0 21 21'
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
			xmlns="http://www.w3.org/2000/svg" 
			fill-rule="evenodd" 
			clip-rule="evenodd" 
			d="M6.68073 0.730102C5.60654 0.499919 4.54777 1.17924 4.30934 2.25163L3.80945 4.49998H2.5C1.39543 4.49998 0.5 5.39541 0.5 6.49998V18.5C0.5 19.6045 1.39543 20.5 2.5 20.5H18.5C19.6046 20.5 20.5 19.6045 20.5 18.5V10.5C20.5 9.67793 20.004 8.97171 19.295 8.66423L20.147 5.82563C20.4828 4.70696 19.7926 3.53979 18.6505 3.29506L6.68073 0.730102ZM17.2562 8.49998L18.2315 5.25067L6.26167 2.68571L5.85828 4.49998H7.94575C8.63533 4.49998 9.27627 4.85522 9.64175 5.43998L11.5542 8.49998H17.2562ZM2.5 6.49998H7.94575L10.152 10.03C10.3347 10.3224 10.6552 10.5 11 10.5H18.5V18.5H2.5V6.49998Z" 
			fill="currentColor"/>
	</svg>

</template>
