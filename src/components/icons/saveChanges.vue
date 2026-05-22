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
		default: '0 0 12 14'
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
			d="M9.98628 2H10C11.1046 2 12 2.89543 12 4V10C12 10.9319 11.3626 11.715 10.5 11.937V9.41421C10.5 8.75117 10.2366 8.11529 9.76778 7.64645L6.35356 4.23223C5.88472 3.76339 5.24884 3.5 4.5858 3.5H2.06302C2.28504 2.63739 3.06809 2 4.00001 2H4.01374C4.1381 0.875012 5.09187 0 6.25001 0H7.75001C8.90815 0 9.86192 0.875013 9.98628 2ZM8.50001 3V2.25C8.50001 1.83579 8.16422 1.5 7.75001 1.5H6.25001C5.8358 1.5 5.50001 1.83579 5.50001 2.25V3H8.50001Z" 
			fill="currentColor"/>
		<path 
			d="M1 5C0.447715 5 0 5.44771 0 6V13C0 13.5523 0.447716 14 1 14H8C8.55228 14 9 13.5523 9 13V9.41421C9 9.149 8.89464 8.89464 8.70711 8.70711L5.29289 5.29289C5.10536 5.10536 4.851 5 4.58579 5H1Z" 
			fill="currentColor"/>
	</svg>

</template>
