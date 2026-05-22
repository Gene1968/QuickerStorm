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
<svg
	:width="props.width"
	:height="props.height"
	:viewBox="props.viewBox"
	fill="none"
	xmlns="http://www.w3.org/2000/svg">
		<path
			d="M8.75 13.8195C9.95792 12.9871 11.4212 12.5 13 12.5C13.7103 12.5 14.3964 12.5985 15.0459 12.7822C15.272 12.8462 15.515 12.8005 15.7024 12.6587C15.8899 12.5169 16 12.2955 16 12.0605V1.06055C16 0.724948 15.7771 0.430197 15.4541 0.33886C14.6731 0.117962 13.8497 0 13 0C11.4636 0 10.016 0.385492 8.75 1.06487V13.8195Z"
			fill="currentColor"/>
		<path
			d="M7.25 1.06487C5.98396 0.385492 4.5364 0 3 0C2.15029 0 1.32689 0.117962 0.54588 0.33886C0.222948 0.430197 0 0.724948 0 1.06055V12.0605C0 12.2955 0.11014 12.5169 0.297557 12.6587C0.484973 12.8005 0.727998 12.8462 0.95412 12.7822C1.60361 12.5985 2.28967 12.5 3 12.5C4.57884 12.5 6.04208 12.9871 7.25 13.8195V1.06487Z"
			fill="currentColor"/>
</svg>

</template>
