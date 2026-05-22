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
		default: '0 0 28 28'
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
		fill="currentColor" 
		xmlns="http://www.w3.org/2000/svg">
		<path 
			d="M1.50012 4C1.50012 2.61929 2.61945 1.5 4.00022 1.5C5.38098 1.5 6.50031 2.61929 6.50031 4C6.50031 5.38071 5.38098 6.5 4.00022 6.5C2.61945 6.5 1.50012 5.38071 1.50012 4Z" 
			:stroke="props.stroke"			
			fill="currentColor"	 
			:stroke-width="props.strokeWidth"/>
		<path 
			d="M1.50012 14C1.50012 12.6193 2.61945 11.5 4.00022 11.5C5.38098 11.5 6.50031 12.6193 6.50031 14C6.50031 15.3807 5.38098 16.5 4.00022 16.5C2.61945 16.5 1.50012 15.3807 1.50012 14Z" 
			:stroke="props.stroke"			
			fill="currentColor" 
			:stroke-width="props.strokeWidth"/>
		<path 
			d="M11.5005 11.8125C11.5005 11.6399 11.6404 11.5 11.813 11.5H26.1886C26.3612 11.5 26.5011 11.6399 26.5011 11.8125V16.1875C26.5011 16.3601 26.3612 16.5 26.1886 16.5H11.813C11.6404 16.5 11.5005 16.3601 11.5005 16.1875V11.8125Z" 
			:stroke="props.stroke"			
			fill="currentColor" 
			:stroke-width="props.strokeWidth"/>
		<path 
			d="M11.5005 1.8125C11.5005 1.63991 11.6404 1.5 11.813 1.5H26.1886C26.3612 1.5 26.5011 1.63991 26.5011 1.8125V6.1875C26.5011 6.36009 26.3612 6.5 26.1886 6.5H11.813C11.6404 6.5 11.5005 6.36009 11.5005 6.1875V1.8125Z" 
			:stroke="props.stroke"			
			fill="currentColor" 
			:stroke-width="props.strokeWidth"/>
		<path 
			d="M11.5005 21.8125C11.5005 21.6399 11.6404 21.5 11.813 21.5H26.1886C26.3612 21.5 26.5011 21.6399 26.5011 21.8125V26.1875C26.5011 26.3601 26.3612 26.5 26.1886 26.5H11.813C11.6404 26.5 11.5005 26.3601 11.5005 26.1875V21.8125Z" 
			:stroke="props.stroke"			
			fill="currentColor" 
			:stroke-width="props.strokeWidth"/>
		<path 
			d="M1.50012 24C1.50012 22.6193 2.61945 21.5 4.00022 21.5C5.38098 21.5 6.50031 22.6193 6.50031 24C6.50031 25.3807 5.38098 26.5 4.00022 26.5C2.61945 26.5 1.50012 25.3807 1.50012 24Z" 
			:stroke="props.stroke"			
			fill="currentColor" 
			:stroke-width="props.strokeWidth"/>
	</svg>
</template>
