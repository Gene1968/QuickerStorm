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
        default: '0 0 228 159'
    }

})
</script>

<template>
    <svg :width="props.width" :height="props.height" :viewBox="props.viewBox" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="228" height="159" fill="white"/>
        <path d="M128.902 91.1221L136.952 103.912H147.415L137.816 88.4525C134.785 89.2425 131.823 90.1142 128.902 91.1221Z" fill="#1F63B7"/>
        <path d="M111 82.5C107.388 84.3863 101.5 88.5 97.5 92L113.31 66.3597L118.164 74.0826C121.099 73.0338 124.047 72.0804 127.023 71.2495L116.889 55H109.648C109.648 55 80.0823 103.83 80 103.912H96.5C104.5 95.5 108 92.8941 115 88C122 83.1059 133 79 139.5 80C139.5 80 129.19 73 111 82.5Z" fill="#1F63B7"/>
    </svg>

</template>
