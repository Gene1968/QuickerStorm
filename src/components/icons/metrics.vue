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
			d="M10 7.00076C9.44772 7.00076 9 6.55305 9 6.00076V1.00076C9 0.44848 9.45028 -0.00673816 9.99703 0.0712295C13.0651 0.508742 15.492 2.93565 15.9295 6.00373C16.0075 6.55049 15.5523 7.00076 15 7.00076H10Z"
			fill="currentColor"/>
		<path
			d="M6.00297 2.07123C6.54972 1.99326 7 2.44848 7 3.00076V8.00076C7 8.55305 7.44772 9.00076 8 9.00076H13C13.5523 9.00076 14.0075 9.45104 13.9295 9.9978C13.4456 13.3915 10.5275 16.0008 7 16.0008C3.13401 16.0008 0 12.8668 0 9.00076C0 5.47326 2.60923 2.55518 6.00297 2.07123Z"
			fill="currentColor"/>
</svg>

</template>
