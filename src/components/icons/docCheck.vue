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
		default: '0 0 14 16'
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
	<path fill-rule="evenodd" clip-rule="evenodd" 
		d="M0 1.5C0 0.671573 0.671573 0 1.5 0H8.37868C8.7765 0 9.15804 0.158035 9.43934 0.43934L13.5607 4.56066C13.842 4.84197 14 5.2235 14 5.62132V14.5C14 15.3284 13.3284 16 12.5 16H1.5C0.671573 16 0 15.3284 0 14.5V1.5ZM10.8566 7.19113C11.1002 6.85614 11.0261 6.38708 10.6911 6.14345C10.3561 5.89982 9.88708 5.97388 9.64345 6.30887L6.15969 11.099L4.28033 9.21967C3.98744 8.92678 3.51256 8.92678 3.21967 9.21967C2.92678 9.51256 2.92678 9.98744 3.21967 10.2803L5.71967 12.7803C5.87477 12.9354 6.08999 13.0149 6.30867 12.9977C6.52734 12.9805 6.72754 12.8685 6.85655 12.6911L10.8566 7.19113Z" 
		fill="currentColor"/>
	</svg>

</template>
