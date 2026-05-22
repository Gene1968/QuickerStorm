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
		default: '0 0 21 21'
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
		d="M1.47804 0.904793C1.2133 0.827888 0.92771 0.902422 0.734318 1.09889C0.540925 1.29536 0.470908 1.58209 0.551983 1.84558L2.98426 9.75049H11.5C11.9142 9.75049 12.25 10.0863 12.25 10.5005C12.25 10.9147 11.9142 11.2505 11.5 11.2505H2.98427L0.552074 19.1551C0.470999 19.4186 0.541017 19.7054 0.734412 19.9018C0.927807 20.0983 1.2134 20.1728 1.47814 20.0959C8.17673 18.1499 14.3974 15.0819 19.9233 11.1092C20.1193 10.9683 20.2355 10.7416 20.2355 10.5002C20.2355 10.2588 20.1193 10.0322 19.9233 9.89128C14.3974 5.91866 8.17665 2.8507 1.47804 0.904793Z" 
		fill="url(#paint0_linear_2594_1102)"/>
		<defs>
		<linearGradient id="paint0_linear_2594_1102" x1="10.3771" y1="0.875" x2="10.3771" y2="20.1257" gradientUnits="userSpaceOnUse">
			<stop stop-color="#2CAEBA"/>
			<stop offset="1" stop-color="#1F74D6"/>
		</linearGradient>
		</defs>
</svg>

</template>
