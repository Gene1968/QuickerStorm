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
        default: '0 0 14 14'
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
        :fill="props.fill" 
        xmlns="http://www.w3.org/2000/svg">
         <path 
            fill-rule="evenodd" 
            clip-rule="evenodd" 
            d="M0.46967 0.46967C0.762563 0.176777 1.23744 0.176777 1.53033 0.46967L7 5.93934L12.4697 0.469671C12.7626 0.176777 13.2374 0.176778 13.5303 0.469671C13.8232 0.762564 13.8232 1.23744 13.5303 1.53033L8.06066 7L13.5303 12.4697C13.8232 12.7626 13.8232 13.2374 13.5303 13.5303C13.2374 13.8232 12.7626 13.8232 12.4697 13.5303L7 8.06066L1.53033 13.5303C1.23744 13.8232 0.762563 13.8232 0.46967 13.5303C0.176777 13.2374 0.176777 12.7626 0.46967 12.4697L5.93934 7L0.46967 1.53033C0.176777 1.23744 0.176777 0.762563 0.46967 0.46967Z" 
            fill="currentColor"/>
    </svg>


</template>
