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
        default: '0 0 18 18'
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
    xmlns="http://www.w3.org/2000/svg">
        <path d="M16 0H2C0.9 0 0 0.9 0 2V16C0 17.1 0.9 18 2 18H16C17.1 18 18 17.1 18 16V2C18 0.9 17.1 0 16 0ZM16 16H2V2H16V16ZM14.99 6L13.58 4.58L6.99 11.17L4.41 8.6L2.99 10.01L6.99 14L14.99 6Z" 
        fill="currentColor"/>
    </svg>

</template>
