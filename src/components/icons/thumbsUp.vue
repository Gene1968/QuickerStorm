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
		default: '0 0 18 16'
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
			d="M0 7.25C0 6.55964 0.559644 6 1.25 6C1.94036 6 2.5 6.55964 2.5 7.25V14.75C2.5 15.4404 1.94036 16 1.25 16C0.559644 16 0 15.4404 0 14.75V7.25Z"
			fill="currentColor"/>
		<path
			d="M10 2V0.700158C10 0.432433 10.1397 0.174062 10.3949 0.093156C10.5858 0.0326444 10.7891 0 11 0C12.1046 0 13 0.895431 13 2C13 2.99504 12.8183 3.94764 12.4864 4.82646C12.2823 5.36683 12.6524 6 13.23 6H15.75C16.9926 6 18.0111 7.00957 17.8962 8.24689C17.7031 10.3266 17.2447 12.3294 16.555 14.2209C16.1534 15.3225 15.0723 16 13.8998 16H10.7082C10.2425 16 9.78313 15.8916 9.36656 15.6833L6.63344 14.3167C6.21687 14.1084 5.75753 14 5.2918 14H4V7H4.9632C5.64763 7 6.22105 6.51748 6.57541 5.93193C7.06387 5.1248 7.82963 4.50423 8.74061 4.20229C9.17339 4.05884 9.59422 3.81595 9.75248 3.38836C9.91256 2.95587 10 2.48815 10 2Z"
			fill="currentColor"/>
</svg>

</template>
