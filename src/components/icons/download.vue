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
		default: '0 0 12 12'
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
		d="M6.75 0.75C6.75 0.335787 6.41421 0 6 0C5.58579 0 5.25 0.335786 5.25 0.75L5.25 6.43934L3.03033 4.21967C2.73744 3.92678 2.26256 3.92678 1.96967 4.21967C1.67678 4.51256 1.67678 4.98744 1.96967 5.28033L5.46967 8.78033C5.76256 9.07322 6.23744 9.07322 6.53033 8.78033L10.0303 5.28033C10.3232 4.98744 10.3232 4.51256 10.0303 4.21967C9.73744 3.92678 9.26256 3.92678 8.96967 4.21967L6.75 6.43934L6.75 0.75Z"
		fill="currentColor"/>
	<path
		d="M1.5 7.75C1.5 7.33579 1.16421 7 0.75 7C0.335786 7 0 7.33579 0 7.75V9.25C0 10.7688 1.23122 12 2.75 12H9.25C10.7688 12 12 10.7688 12 9.25V7.75C12 7.33579 11.6642 7 11.25 7C10.8358 7 10.5 7.33579 10.5 7.75V9.25C10.5 9.94036 9.94036 10.5 9.25 10.5H2.75C2.05964 10.5 1.5 9.94036 1.5 9.25V7.75Z"
		fill="currentColor"/>
</svg>


</template>
