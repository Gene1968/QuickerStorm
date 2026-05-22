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
		<path 
			d="M7 6C8.65685 6 10 4.65685 10 3C10 1.34315 8.65685 0 7 0C5.34315 0 4 1.34315 4 3C4 4.65685 5.34315 6 7 6Z" 
			fill="currentColor"/>
		<path 
			d="M0.465171 12.4935C0.270287 13.0016 0.444349 13.571 0.874199 13.9046C2.56656 15.218 4.69202 16 7.00012 16C9.31057 16 11.438 15.2164 13.1312 13.9006C13.5608 13.5667 13.7345 12.9971 13.5393 12.4892C12.5301 9.86354 9.98419 8 7.00307 8C4.02032 8 1.47329 9.86557 0.465171 12.4935Z" 
			fill="currentColor"/>
	</svg>

</template>
