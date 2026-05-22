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
		default: '0 0 16 18'
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
			d="M10.3812 13.2348C11.96 13.0475 13.4824 12.6763 14.9264 12.1432C13.7291 10.8142 13.0003 9.0547 13.0003 7.125V6.54099C13.0004 6.52734 13.0005 6.51368 13.0005 6.5C13.0005 3.73858 10.7619 1.5 8.00049 1.5C5.23906 1.5 3.00049 3.73858 3.00049 6.5L3.00032 7.125C3.00032 9.0547 2.27155 10.8142 1.07422 12.1432C2.51832 12.6763 4.04085 13.0475 5.61977 13.2348M10.3812 13.2348C9.60047 13.3274 8.80596 13.375 8.00032 13.375C7.1948 13.375 6.40039 13.3274 5.61977 13.2348M10.3812 13.2348C10.4587 13.4759 10.5005 13.7331 10.5005 14C10.5005 15.3807 9.3812 16.5 8.00049 16.5C6.61978 16.5 5.50049 15.3807 5.50049 14C5.50049 13.7331 5.54231 13.476 5.61977 13.2348"
			stroke="currentColor"
			:stroke-width="props.strokeWidth"
			:stroke-linecap="props.strokeLinecap"
			:stroke-linejoin="props.strokeLinejoin"/>
</svg>

</template>
