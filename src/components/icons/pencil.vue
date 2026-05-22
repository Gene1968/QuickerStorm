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
		default: '0 0 12 13'
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
			fill-rule="evenodd" 
			clip-rule="evenodd" 
			d="M9.01258 1.01256C9.696 0.329146 10.804 0.329146 11.4875 1.01256C12.1709 1.69598 12.1709 2.80402 11.4875 3.48744L4.22604 10.7489C3.97066 11.0042 3.66748 11.2068 3.33382 11.345L1.28702 12.1928C1.00676 12.3088 0.684173 12.2447 0.46968 12.0302C0.255187 11.8157 0.191026 11.4931 0.307118 11.2128L1.15488 9.16628C1.29308 8.83265 1.49563 8.52952 1.75098 8.27417L9.01258 1.01256Z" 
			fill="currentColor"/>
</svg>


</template>
