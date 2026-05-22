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
			d="M0 6.74053C0 7.72321 0.713407 8.56531 1.68906 8.6827C2.5937 8.79154 3.50678 8.87294 4.42746 8.92602C4.78969 8.94691 5.11506 9.15718 5.27733 9.4817L6.32918 11.5854C6.45622 11.8395 6.71592 12 7 12C7.28408 12 7.54378 11.8395 7.67082 11.5854L8.72265 9.48175C8.88492 9.15722 9.2103 8.94695 9.57254 8.92607C10.4932 8.873 11.4063 8.79162 12.3109 8.6828C13.2866 8.56542 14 7.72332 14 6.74062V2.25938C14 1.27668 13.2866 0.434576 12.3109 0.317204C10.57 0.107771 8.79777 0 7.00039 0C5.20273 0 3.43025 0.107805 1.68906 0.317303C0.713406 0.434692 0 1.27679 0 2.25947V6.74053ZM3 3.25C3 2.83579 3.33579 2.5 3.75 2.5H10.25C10.6642 2.5 11 2.83579 11 3.25C11 3.66421 10.6642 4 10.25 4H3.75C3.33579 4 3 3.66421 3 3.25ZM3.75 5C3.33579 5 3 5.33579 3 5.75C3 6.16421 3.33579 6.5 3.75 6.5H6.25C6.66421 6.5 7 6.16421 7 5.75C7 5.33579 6.66421 5 6.25 5H3.75Z" 
			fill="currentColor"/>
	</svg>

	
</template>



