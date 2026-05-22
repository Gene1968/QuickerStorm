
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
		default: '0 0 17 15'
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
				d="M0 5.80583V12.5065C0 13.8848 1.1311 15 2.52068 15H10.0479C11.4394 15 12.5741 13.8848 12.5741 12.5065V5.80583C12.5741 4.42773 11.4393 3.31068 10.0479 3.31068H2.52068C1.1311 3.31068 0 4.42773 0 5.80583ZM1.68292 5.80583C1.68292 5.34707 2.05864 4.97176 2.52031 4.97176H10.0475C10.5059 4.97176 10.8927 5.34707 10.8927 5.80583V12.5065C10.8927 12.9581 10.5059 13.3371 10.0475 13.3371H2.52068C2.05864 13.3371 1.68329 12.9581 1.68329 12.5065L1.68292 5.80583Z" 
				fill="currentColor"/>
			<path 
				d="M15.192 9.18488V2.48613C15.1916 2.26547 15.1029 2.05394 14.9451 1.89792C14.7874 1.74189 14.5736 1.65409 14.3505 1.65377H6.82516C6.60341 1.65376 6.39067 1.74053 6.23337 1.89513C6.07607 2.04973 5.98698 2.2596 5.98555 2.47894H4.30078C4.30448 1.10608 5.43557 0 6.82528 0H14.3506C15.7422 0 16.8751 1.10791 16.8751 2.48613V9.18488C16.8751 10.5558 15.7422 11.6802 14.3506 11.6802H13.4125V10.0154H14.3511C14.5739 10.0154 14.7875 9.92787 14.9452 9.77216C15.1028 9.61646 15.1916 9.40525 15.192 9.18488Z" 
				fill="currentColor"/>
	</svg>
</template>
