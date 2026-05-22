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
			d="M0.5 2C0.5 1.17157 1.17157 0.5 2 0.5H6.87868C7.2765 0.5 7.65804 0.658035 7.93934 0.93934L11.0607 4.06066C11.342 4.34197 11.5 4.7235 11.5 5.12132V11C11.5 11.8284 10.8284 12.5 10 12.5H2C1.17157 12.5 0.5 11.8284 0.5 11V2Z" 
			fill="currentColor"/>
	</svg>


</template>
