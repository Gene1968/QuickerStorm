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
        default: '0 0 18 19'
    }

})
</script>

<template>
    <!-- <svg 
        :width="props.width" 
        :height="props.height" 
        :viewBox="props.viewBox"
        xmlns="http://www.w3.org/2000/svg">
        <path 
            class="add-icon" 
            fill-rule="evenodd" 
            clip-rule="evenodd" 
            d="M15.5 20.4214L3.5 20.4214C1.84315 20.4214 0.500002 19.0782 0.5 17.4214V3.42139C0.5 1.76453 1.84315 0.421387 3.5 0.421387H9.5H13H15.5C17.1568 0.421387 18.5 1.76453 18.5 3.42138L18.5 6.42139V10.4214V17.4214C18.5 19.0782 17.1569 20.4214 15.5 20.4214ZM15.5 18.4214C16.0523 18.4214 16.5 17.9737 16.5 17.4214V10.4214V6.42139L16.5 3.42138C16.5 2.8691 16.0523 2.42139 15.5 2.42139L13 2.42139L9.5 2.42139L3.5 2.42139C2.94771 2.42139 2.5 2.8691 2.5 3.42139L2.5 17.4214C2.5 17.9737 2.94772 18.4214 3.5 18.4214L15.5 18.4214ZM6.00001 10.9214C6.00001 10.3691 6.44772 9.92139 7.00001 9.92139H8.50001V8.42139C8.5 7.8691 8.94772 7.42139 9.5 7.42139C10.0523 7.42139 10.5 7.8691 10.5 8.42139V9.92139H12C12.5523 9.92139 13 10.3691 13 10.9214C13 11.4737 12.5523 11.9214 12 11.9214H10.5V13.4214C10.5 13.9737 10.0523 14.4214 9.50001 14.4214C8.94772 14.4214 8.50001 13.9737 8.50001 13.4214V11.9214H7.00001C6.44772 11.9214 6.00001 11.4737 6.00001 10.9214Z" 
            fill="currentColor"/>
    </svg> -->

    <svg 
        :width="props.width" 
        :height="props.height" 
        :viewBox="props.viewBox" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg">
    <path 
        d="M9 1.5V16.5M16.5 9L1.5 9" 
        stroke="currentColor" 
        :stroke-width="props.strokeWidth" 
        :stroke-linecap="props.strokeLinecap" 
        :stroke-linejoin="props.strokeLinejoin"/>
</svg>

</template>
