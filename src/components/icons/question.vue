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
		default: '0 0 16 16'
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
			d="M16 8C16 12.4183 12.4183 16 8 16C3.58172 16 0 12.4183 0 8C0 3.58172 3.58172 0 8 0C12.4183 0 16 3.58172 16 8ZM6.93934 4.93931C6.64645 5.23221 6.17157 5.23221 5.87868 4.93931C5.58579 4.64642 5.58579 4.17155 5.87868 3.87865C7.05025 2.70708 8.94975 2.70708 10.1213 3.87865C11.2929 5.05023 11.2929 6.94972 10.1213 8.12129C9.72884 8.51378 9.25285 8.77563 8.75 8.90508V9.24997C8.75 9.66418 8.41421 9.99997 8 9.99997C7.58579 9.99997 7.25 9.66418 7.25 9.24997V8.74997C7.25 8.02968 7.81995 7.57826 8.33134 7.46322C8.59823 7.40318 8.8516 7.26969 9.06066 7.06063C9.64645 6.47485 9.64645 5.5251 9.06066 4.93931C8.47487 4.35353 7.52513 4.35353 6.93934 4.93931ZM8 13C8.55228 13 9 12.5523 9 12C9 11.4477 8.55228 11 8 11C7.44771 11 7 11.4477 7 12C7 12.5523 7.44771 13 8 13Z"
			fill="currentColor"/>
</svg>
</template>
