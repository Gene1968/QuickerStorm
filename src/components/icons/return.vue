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
		default: '0 0 19 16'
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
				d="M7.29252 0.232144C7.57852 0.531768 7.56748 1.00651 7.26786 1.29252L3.12192 5.25H13.125C16.0935 5.25 18.5 7.65647 18.5 10.625C18.5 13.5935 16.0935 16 13.125 16H10.25C9.83579 16 9.5 15.6642 9.5 15.25C9.5 14.8358 9.83579 14.5 10.25 14.5H13.125C15.2651 14.5 17 12.7651 17 10.625C17 8.4849 15.2651 6.75 13.125 6.75H3.12192L7.26786 10.7075C7.56748 10.9935 7.57852 11.4682 7.29252 11.7679C7.00651 12.0675 6.53177 12.0785 6.23214 11.7925L0.732143 6.54252C0.583883 6.401 0.5 6.20496 0.5 6C0.5 5.79504 0.583883 5.59901 0.732143 5.45748L6.23214 0.207485C6.53177 -0.0785198 7.00651 -0.0674792 7.29252 0.232144Z" 
				fill="currentColor"/>
	</svg>

</template>
