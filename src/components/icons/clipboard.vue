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
        default: '0 0 18 22'
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
            d="M12.6657 2.88789C12.3991 1.94272 11.5305 1.25 10.5 1.25H7.5C6.46954 1.25 5.60087 1.94272 5.33426 2.88789M12.6657 2.88789C12.7206 3.0825 12.75 3.28782 12.75 3.5V3.5C12.75 3.91421 12.4142 4.25 12 4.25H6C5.58579 4.25 5.25 3.91421 5.25 3.5V3.5C5.25 3.28782 5.27937 3.0825 5.33426 2.88789M12.6657 2.88789C13.3119 2.93668 13.9545 2.99828 14.5933 3.07241C15.6939 3.20014 16.5 4.149 16.5 5.25699V18.5C16.5 19.7426 15.4926 20.75 14.25 20.75H3.75C2.50736 20.75 1.5 19.7426 1.5 18.5V5.25699C1.5 4.149 2.30608 3.20014 3.40668 3.07241C4.04547 2.99828 4.68808 2.93668 5.33426 2.88789" 
            stroke="currentColor" 
            :stroke-width="props.strokeWidth" 
            :stroke-linecap="props.strokeLinecap" 
            :stroke-linejoin="props.strokeLinejoin"/>
    </svg>
</template>



    