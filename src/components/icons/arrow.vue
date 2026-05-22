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
        default: '0 0 15 12'
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
        <path 
            fill-rule="evenodd" 
            clip-rule="evenodd" 
            d="M0.5 6C0.5 5.58579 0.835786 5.25 1.25 5.25L11.8879 5.25L7.73017 1.29062C7.43159 1.00353 7.42228 0.528746 7.70937 0.230167C7.99647 -0.0684112 8.47125 -0.077721 8.76983 0.209374L14.2698 5.45937C14.4169 5.60078 14.5 5.79599 14.5 6C14.5 6.20401 14.4169 6.39922 14.2698 6.54062L8.76983 11.7906C8.47125 12.0777 7.99647 12.0684 7.70938 11.7698C7.42228 11.4713 7.43159 10.9965 7.73017 10.7094L11.8879 6.75L1.25 6.75C0.835786 6.75 0.5 6.41421 0.5 6Z" 
            fill="currentColor"/>
    </svg>

</template>
