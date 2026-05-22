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
		default: '0 0 16 16'
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
				d="M3.96461 2.90395L13.096 12.0354C13.9755 10.9265 14.5 9.525 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C6.475 1.5 5.07353 2.02446 3.96461 2.90395ZM12.0354 13.096L2.90395 3.96461C2.02446 5.07353 1.5 6.475 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5C9.525 14.5 10.9265 13.9755 12.0354 13.096ZM2.34315 2.34315C3.79004 0.896252 5.79107 0 8 0C12.4183 0 16 3.58172 16 8C16 10.2089 15.1037 12.21 13.6569 13.6569C12.21 15.1037 10.2089 16 8 16C3.58172 16 0 12.4183 0 8C0 5.79107 0.896252 3.79004 2.34315 2.34315Z" 
				fill="currentColor"/>
	</svg>

</template>
