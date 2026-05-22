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
		default: '0 0 14 12'
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
			d="M0 6.74067C0 7.72338 0.713436 8.56548 1.68911 8.68285C2.45355 8.7748 3.22402 8.84715 4 8.89939V11.25C4 11.5533 4.18273 11.8268 4.46299 11.9429C4.74324 12.059 5.06583 11.9948 5.28033 11.7803L7.7905 9.27016C7.97217 9.08849 8.21682 8.98422 8.47361 8.97576C9.76764 8.93316 11.0475 8.83467 12.311 8.68265C13.2866 8.56525 14 7.72316 14 6.74048V2.25947C14 1.27678 13.2866 0.43469 12.3109 0.317301C10.5698 0.107804 8.79728 0 6.99962 0C5.20224 0 3.43002 0.107772 1.68909 0.317206C0.713426 0.434579 0 1.27668 0 2.25938V6.74067ZM4.5 4.5C4.5 5.05228 4.05228 5.5 3.5 5.5C2.94772 5.5 2.5 5.05228 2.5 4.5C2.5 3.94772 2.94772 3.5 3.5 3.5C4.05228 3.5 4.5 3.94772 4.5 4.5ZM7 5.5C7.55228 5.5 8 5.05228 8 4.5C8 3.94772 7.55228 3.5 7 3.5C6.44772 3.5 6 3.94772 6 4.5C6 5.05228 6.44772 5.5 7 5.5ZM10.5 5.5C11.0523 5.5 11.5 5.05228 11.5 4.5C11.5 3.94772 11.0523 3.5 10.5 3.5C9.94771 3.5 9.5 3.94772 9.5 4.5C9.5 5.05228 9.94771 5.5 10.5 5.5Z" 
			fill="currentColor"/>
</svg>
</template>
