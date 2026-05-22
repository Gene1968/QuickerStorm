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
		default: '0 0 22 22'
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
	<path d="M10.4194 14.1694L16.25 20C17.2855 21.0355 18.9645 21.0355 20 20C21.0355 18.9645 21.0355 17.2855 20 16.25L14.1233 10.3733M10.4194 14.1694L12.9155 11.1383C13.2315 10.7546 13.6542 10.5132 14.1233 10.3733M10.4194 14.1694L5.76432 19.8219C5.28037 20.4096 4.55897 20.75 3.79768 20.75C2.39064 20.75 1.25 19.6094 1.25 18.2023C1.25 17.441 1.59044 16.7196 2.1781 16.2357L9.01462 10.6056M14.1233 10.3733C14.6727 10.2094 15.2858 10.1848 15.8659 10.2338C15.9925 10.2445 16.1206 10.25 16.25 10.25C18.7353 10.25 20.75 8.23528 20.75 5.75C20.75 5.08973 20.6078 4.46268 20.3523 3.89779L17.0762 7.17397C15.9605 6.91785 15.0823 6.03963 14.8262 4.92397L18.1024 1.64774C17.5375 1.39223 16.9103 1.25 16.25 1.25C13.7647 1.25 11.75 3.26472 11.75 5.75C11.75 5.87938 11.7555 6.00749 11.7662 6.13411C11.8571 7.20956 11.6948 8.39841 10.8617 9.08452L10.7596 9.16858M9.01462 10.6056L4.90901 6.5H3.5L1.25 2.75L2.75 1.25L6.5 3.5V4.90901L10.7596 9.16858M9.01462 10.6056L10.7596 9.16858M17.375 17.375L14.75 14.75M3.86723 18.125H3.87473V18.1325H3.86723V18.125Z" 
		:stroke="'currentColor'" 
		:stroke-width="props.strokeWidth" 
		:stroke-linecap="props.strokeLinecap" 
		:stroke-linejoin="props.strokeLinejoin"
	/>
	</svg>
</template>

