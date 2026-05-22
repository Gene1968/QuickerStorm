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
		default: '0 0 14 13'
	}

})
</script>

<template>
	<svg 
		:width="props.width" 
		:height="props.height" 
		:viewBox="props.viewBox" 
		:fill="props.fill" 
		xmlns="http://www.w3.org/2000/svg">
			<path 
				d="M3.34654 9.6334L4.35597 7.10984C4.51692 6.70747 4.75792 6.34199 5.06436 6.03555L10.5997 0.500565C11.2625 -0.162177 12.337 -0.162175 12.9997 0.500567C13.6624 1.16331 13.6624 2.23782 12.9997 2.90057L7.46436 8.43555C7.15792 8.74199 6.79244 8.98299 6.39007 9.14394L3.86649 10.1534C3.53997 10.284 3.21593 9.95993 3.34654 9.6334Z" 
				fill="currentColor"/>
			<path 
				d="M1.8001 3.09999C1.8001 2.54771 2.24781 2.09999 2.8001 2.09999H7.0001C7.33147 2.09999 7.6001 1.83136 7.6001 1.49999C7.6001 1.16862 7.33147 0.899994 7.0001 0.899994H2.8001C1.58507 0.899994 0.600098 1.88497 0.600098 3.09999V10.7C0.600098 11.915 1.58507 12.9 2.8001 12.9H10.4001C11.6151 12.9 12.6001 11.915 12.6001 10.7V6.49999C12.6001 6.16862 12.3315 5.89999 12.0001 5.89999C11.6687 5.89999 11.4001 6.16862 11.4001 6.49999V10.7C11.4001 11.2523 10.9524 11.7 10.4001 11.7H2.8001C2.24781 11.7 1.8001 11.2523 1.8001 10.7V3.09999Z" 
				fill="currentColor"/>
	</svg>

</template>
