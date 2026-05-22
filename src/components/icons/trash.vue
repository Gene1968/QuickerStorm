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
		default: 'none'
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
	<!-- Replace SVG example below with svg content-->
	<!-- Change existing svg property values to props above-->
	<!-- Do NOT change main svg color you want displayed. Instead, change it's value to 'currentColor'-->

	<!-- <svg 
		:width="props.width" 
		:height="props.height" 
		:viewBox="props.viewBox" 
		fill="#000" 
		xmlns="http://www.w3.org/2000/svg">
			<path 
				:stroke="props.stroke"
				:stroke-width="props.strokeWidth"
				fill-rule="evenodd" 
				clip-rule="evenodd" 
				d="M3.5 2.25V3H1.25C0.835786 3 0.5 3.33579 0.5 3.75C0.5 4.16421 0.835786 4.5 1.25 4.5H1.55L2.36493 12.6493C2.44161 13.4161 3.08685 14 3.85748 14H9.14252C9.91315 14 10.5584 13.4161 10.6351 12.6493L11.45 4.5H11.75C12.1642 4.5 12.5 4.16421 12.5 3.75C12.5 3.33579 12.1642 3 11.75 3H9.5V2.25C9.5 1.00736 8.49264 0 7.25 0H5.75C4.50736 0 3.5 1.00736 3.5 2.25ZM5.75 1.5C5.33579 1.5 5 1.83579 5 2.25V3H8V2.25C8 1.83579 7.66421 1.5 7.25 1.5H5.75ZM4.55044 5.00094C4.96413 4.98025 5.31627 5.29885 5.33696 5.71255L5.61195 11.2125C5.63264 11.6262 5.31404 11.9784 4.90034 11.9991C4.48665 12.0197 4.13451 11.7011 4.11383 11.2875L3.83883 5.78745C3.81814 5.37376 4.13674 5.02162 4.55044 5.00094ZM8.45034 5.00094C8.86404 5.02162 9.18264 5.37376 9.16195 5.78745L8.88696 11.2875C8.86627 11.7011 8.51413 12.0197 8.10044 11.9991C7.68674 11.9784 7.36814 11.6262 7.38883 11.2125L7.66383 5.71255C7.68451 5.29885 8.03665 4.98025 8.45034 5.00094Z" 
				fill="currentColor"/>
	</svg> -->
	<svg 
		:width="props.width" 
		:height="props.height" 
		:viewBox="props.viewBox" 
		fill="none" 
		xmlns="http://www.w3.org/2000/svg">
			<path 
				fill-rule="evenodd" 
				clip-rule="evenodd" 
				d="M3 2.25V3H0.75C0.335786 3 0 3.33579 0 3.75C0 4.16421 0.335786 4.5 0.75 4.5H1.05L1.86493 12.6493C1.94161 13.4161 2.58685 14 3.35748 14H8.64252C9.41315 14 10.0584 13.4161 10.1351 12.6493L10.95 4.5H11.25C11.6642 4.5 12 4.16421 12 3.75C12 3.33579 11.6642 3 11.25 3H9V2.25C9 1.00736 7.99264 0 6.75 0H5.25C4.00736 0 3 1.00736 3 2.25ZM5.25 1.5C4.83579 1.5 4.5 1.83579 4.5 2.25V3H7.5V2.25C7.5 1.83579 7.16421 1.5 6.75 1.5H5.25ZM4.05044 5.00094C4.46413 4.98025 4.81627 5.29885 4.83696 5.71255L5.11195 11.2125C5.13264 11.6262 4.81404 11.9784 4.40034 11.9991C3.98665 12.0197 3.63451 11.7011 3.61383 11.2875L3.33883 5.78745C3.31814 5.37376 3.63674 5.02162 4.05044 5.00094ZM7.95034 5.00094C8.36404 5.02162 8.68264 5.37376 8.66195 5.78745L8.38696 11.2875C8.36627 11.7011 8.01413 12.0197 7.60044 11.9991C7.18674 11.9784 6.86814 11.6262 6.88883 11.2125L7.16383 5.71255C7.18451 5.29885 7.53665 4.98025 7.95034 5.00094Z" 
				fill="currentColor"/>
</svg>

	



</template>
