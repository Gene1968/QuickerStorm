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
		default: '0 0 17 19'
	}

})
</script>

<template>
	<!-- Replace SVG example below with svg content-->
	<!-- Change existing svg property values to props above-->
	<!-- Do NOT change main svg color you want displayed. Instead, change it's value to 'currentColor'-->

	<svg 
		:width="props.width" 
		:height="props.height" 
		:viewBox="props.viewBox" 
		fill="none" 
		xmlns="http://www.w3.org/2000/svg">
			<path 
				fill-rule="evenodd" 
				clip-rule="evenodd" 
				d="M13.75 18.25L3.25 18.25C1.80025 18.25 0.625 17.0748 0.625 15.625V3.375C0.625 1.92525 1.80025 0.75 3.25 0.75H8.5H11.7599C12.548 0.75 13.2945 1.10414 13.793 1.7146L15.7831 4.15149C16.1659 4.6202 16.375 5.20675 16.375 5.8119V9.5V15.625C16.375 17.0747 15.1997 18.25 13.75 18.25ZM13.75 16.5C14.2332 16.5 14.625 16.1083 14.625 15.625L14.625 9.5V5.8119C14.625 5.61018 14.5553 5.41466 14.4277 5.25843L12.4376 2.82153C12.3233 2.68164 12.17 2.58212 12 2.53359V5.125C12 5.60825 11.6082 6 11.125 6H5C4.51675 6 4.125 5.60825 4.125 5.125V2.5H3.25C2.76675 2.5 2.375 2.89175 2.375 3.375L2.375 15.625C2.375 16.1083 2.76675 16.5 3.25 16.5L13.75 16.5ZM5.875 2.5L8.5 2.5L10.25 2.5V4.25H5.875V2.5ZM12.875 10.375C12.875 9.89175 12.4832 9.5 12 9.5L5 9.5C4.51675 9.5 4.125 9.89175 4.125 10.375L4.125 13.875C4.125 14.3583 4.51675 14.75 5 14.75H12C12.4832 14.75 12.875 14.3583 12.875 13.875V10.375ZM11.125 11.25V13H5.875L5.875 11.25L11.125 11.25Z" 
				fill="currentColor"/>
	</svg>


</template>
