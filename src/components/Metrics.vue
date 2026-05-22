<script setup>
import { ref, computed, onMounted } from 'vue';
import { useModalAudio } from '@/composables/useModalAudio.js'
useModalAudio()
import ListApi from "@/api/ListApi";
import { config, listSiteUrl } from "@/config/configuration";
import { getOrgs } from '@/composables/orgs';
import { getFunctionalAreas } from '@/composables/functionalAreas';

const props = defineProps({
	metrics: {
		type: Object,
		required: true
	}
});

const orgs = ref(getOrgs())
const functionalAreas = ref(getFunctionalAreas())

const fetchingMetrics = ref(false)
const requestsData = ref([])

const totalRequests = computed(() => requestsData.value.length)
const requestsCompleted = computed(() => requestsData.value.filter(request => request.Status === 'Completed').length)
const adjudicationRequests = computed(() => requestsData.value.filter(request => request.RequestType === 'Adjudication').length)
const verificationRequests = computed(() => requestsData.value.filter(request => request.RequestType === 'Verification').length)
const fulfillmentRequests = computed(() => requestsData.value.filter(request => request.RequestType === 'Fulfillment').length)
const pendingRequests = computed(() => requestsData.value.filter(request => request.Status !== "Completed").length)

const averageCompletionTime = computed(() => {
	const completedRequests = requestsData.value.filter(request => request.Status === 'Completed')
	//console.log("Completed Requests: ", completedRequests)
	let totalTime = 0
		completedRequests.forEach(request => {
		let time = (new Date(request.CompletedDate) - new Date(request.SubmissionDate)) / (1000 * 60 * 60 * 24) // Convert milliseconds to days

		//console.log("Truncated Time in days: ", time)
		totalTime += time
	});
	let averageTime = Math.floor((totalTime / completedRequests.length) * 10) / 10 // tuncate to 1 decimal place
	return averageTime
})

const averageTimeInFlowNotCompleted = computed(() => {
	const notCompletedRequests = requestsData.value.filter(request => request.Status !== "Completed")
	//console.log("Not Completed Requests: ", notCompletedRequests)
	let totalTime = 0
		notCompletedRequests.forEach(request => {
		let time = (new Date() - new Date(request.SubmissionDate)) / (1000 * 60 * 60 * 24) // Convert milliseconds to days

		//console.log("Truncated Time in days: ", time)
		totalTime += time
	});
	let averageTime = Math.floor((totalTime / notCompletedRequests.length) * 10) / 10 // tuncate to 1 decimal place
	return averageTime
})

const baseMetrics = computed(() => {
	let baseMetrics = {
		TotalRequests: {
			value: totalRequests.value,
			label: "Total Requests"
		},
		RequestsCompleted: {
			value: requestsCompleted.value,
			label: "Requests Completed"
		},
		AdjudicationRequests: {
			value: adjudicationRequests.value,
			label: "Adjudication Requests"
		},
		VerificationRequests: {
			value: verificationRequests.value,
			label: "Verification Requests"
		},
		FulfillmentRequests: {
			value: fulfillmentRequests.value,
			label: "Fulfillment Requests"
		},
		PendingRequests: {
			value: pendingRequests.value,
			label: "Pending Requests"
		},
		AverageCompletionTime: {
			value: averageCompletionTime.value,
			label: "Average Completion Time"
		},
		AverageTimeInFlowNotCompleted: {
			value: averageTimeInFlowNotCompleted.value,
			label: "Average Time in Flow Not Completed"
		}
	}
	return baseMetrics
})

const UTMMetrics = computed(() => {
	let UTMMetrics = []
	//console.log("Orgs: ", orgs.value)
	orgs.value.forEach(org => {
		UTMMetrics.push({
			Org: {
				value: org,
				label: "Org"
			},
			Submissions: {
				value: requestsData.value.filter(request => request.Org2L === org).length,
				label: "Submissions"
			},
			CurrentlyInBox: {
				value: requestsData.value.filter(request => request.Org2L === org && request.With === 'UTM').length,
				label: "Pending UTM"
			},
			Returns: {
				value: requestsData.value.filter(request => request.Org2L === org && request.Corrections > 0).length,
				label: "Returns"
			},
			AverageTimeInBox: {
				value: calcAverageTimeWith('UTM',org),
				label: "Avg Time in Box"
			},
		})
	})

	//console.log("UTMMetrics: ", UTMMetrics)
	return UTMMetrics
})

const CFMMetrics = computed(() => {
	let CFMMetrics = []
	functionalAreas.value.forEach(functionalArea => {
		CFMMetrics.push({
			FunctionalArea: {
				value: functionalArea,
				label: "Functional Area"
			},
			CurrentlyInBox: {
				value: requestsData.value.filter(request => request.FunctionalArea === functionalArea && request.With === 'CFM').length,
				label: "Pending CFM"
			},
			AverageTimeInBox: {
				value: calcAverageTimeWith('CFM', null, functionalArea),
				label: "Avg Time in Box"
			},
			AdjudicationRequests: {
				value: requestsData.value.filter(request => request.FunctionalArea === functionalArea && request.RequestType === 'Adjudication').length,
				label: "Adjudication Requests"
			},
			VerificationRequests: {
				value: requestsData.value.filter(request => request.FunctionalArea === functionalArea && request.RequestType === 'Verification').length,
				label: "Verification Requests"
			},
			FulfillmentRequests: {
				value: requestsData.value.filter(request => request.FunctionalArea === functionalArea && request.RequestType === 'Fulfillment').length,
				label: "Fulfillment Requests"
			}
		})
	})
	//console.log("CFMMetrics: ", CFMMetrics)
	return CFMMetrics
})

const calcAverageTimeWith = (role, org, functionalArea) => {
	let requests = []
	if (functionalArea) {
		requests = requestsData.value.filter(request => request.FunctionalArea === functionalArea)
	} else if (org) {
		requests = requestsData.value.filter(request => request.Org2L === org)
	} else {
		return 0
	}

	let totalTime = 0
	let averageTime = 0
	requests.forEach(request => {
		if (request.With === role) { // account for current time not added to DaysWithUTM
			totalTime += (new Date() - new Date(request.DateAssigned)) / (1000 * 60 * 60 * 24) // Convert milliseconds to days
		}
		totalTime += request.DaysWithUTM
	})
	//console.log("Total Time: ", totalTime)
	//console.log("Request length: ", requests.length)
	if (requests.length > 0) {
		averageTime = Math.floor((totalTime / requests.length) * 10) / 10 // tuncate to 1 decimal place
	}
	return averageTime
}

onMounted(() => {
	fetchAllMetrics()
})

const fetchAllMetrics = async () => {
	fetchingMetrics.value = true
	await fetchTotalRequests()
	fetchingMetrics.value = false
}

const fetchTotalRequests = async () => {
		let query = {
			$select: "ID, Status, Corrections, DateAssigned, With, RequestType, SubmissionDate, CompletedDate, Org2L, FunctionalArea, DaysWithUTM, DaysWithAPDP, DaysWithCFM, DaysWithExternal"
		}
		const response = await ListApi(listSiteUrl('requests'), config.lists.requests.listName).getAll(query)
		requestsData.value = response.d.results
}



const largestValue = computed(() => {
	let largest = 0
	Object.values(props.metrics).forEach(value => {
		if (value > largest) largest = value
	})
	return largest
})

const showMetrics = ref(false)

const toggleShowMetrics = () => {
	showMetrics.value = !showMetrics.value
}

const removeWhitespace = (str) => {
	return str.replace(/\s/g, '')
}
</script>

<template>
	<div class="relative max-h-[calc(100vh-13.75rem)] overflow-y-auto flex flex-col gap-4">
		<div class="flex justify-end mb-4">
			<button @click="toggleShowMetrics" class="primary-button">Graph</button>
		</div>
		<div class="flex  gap-4">
			<div class="flex flex-col">
				<h3 class="text-lg w-fit font-semibold bg-neutral-90 text-white p-2 rounded-t-lg">Base Metrics</h3>
				<div class="flex flex-col gap-4 w-fit bg-white h-fit p-4 rounded-lg rounded-tl-none">
					<div v-for="key in Object.keys(baseMetrics)" :key="key" class="metrics-row">
						<div class="metrics-label flex-1 mr-4">
							{{ baseMetrics[key].label }}
						</div>
						<div class="metrics-value w-fit">
							{{ baseMetrics[key].value }}
						</div>
					</div>
				</div>
			</div>
			<TransitionGroup v-show="showMetrics" name="matrix" tag="ul" class="max-w-[25rem] h-[25rem] bg-neutral-10 rounded-2xl p-4 grid grid-cols-8 gap-1" :class="'grid grid-cols-' + Object.keys(props.metrics).length">
				<li v-for="key in Object.keys(props.metrics)" :key="removeWhitespace(key)" class="group h-full flex items-end relative">
					<div :style="{ height: (props.metrics[key] / largestValue * 100) + '%' }" class="realtive rounded-md bg-neutral-50 w-full flex justify-center items-center min-h-[0.625rem] rounded-t-lg">
						<span v-if="props.metrics[key] > 0">{{ props.metrics[key] }}</span>
						<div class="absolute flex flex-col items-center rounded-md w-fit invisible group-hover:visible bottom-[50%] left-[50%] translate-x-[-50%] translate-y-[50%] min-w-[6.25rem] text-nowrap z-10 text-xs text-black p-2 bg-white drop-shadow-lg">
							<span>{{ key }}</span>
							<span>{{ props.metrics[key] }}</span>
						</div>
					</div>
				</li>
			</TransitionGroup>

			<!-- UTMMetrics Table -->
			<div class="">
				<h3 class="text-lg w-fit font-semibold bg-neutral-90 text-white p-2 rounded-t-lg">UTM Metrics</h3>
				<table v-if="UTMMetrics && UTMMetrics.length > 0" class="w-full">
					<!-- Table Title -->
					<thead>
						<tr class="text-right">
							<th
							v-for="key in Object.keys(UTMMetrics[0])"
							:key="key"
							class="table-header">
								<span>
									{{ UTMMetrics[0][key].label }}
								</span>
							</th>
						</tr>
						<tr class="!rounded-none">
							<td colspan="100%" class="!rounded-none border-t !m-0 !p-0 border-neutral-40"></td>
						</tr>
					</thead>
					<tbody>
						<tr v-for="org in UTMMetrics" :key="org + '2l'" class="data-row">
							<td  v-for="key in Object.keys(org)" :key="key">
								{{ org[key].value }}
							</td>
						</tr>
					</tbody>
				</table>
			</div>
			<!-- CFMMetrics Table -->
			<div class="">
				<h3 class="text-lg w-fit font-semibold bg-neutral-90 text-white p-2 rounded-t-lg">CFM Metrics</h3>
				<table v-if="CFMMetrics && CFMMetrics.length > 0" class="w-full text-nowrap">
					<thead>
						<tr class="text-right">
							<th
								v-for="key in Object.keys(CFMMetrics[0])"
								:key="key"
								class="table-header">
									{{ CFMMetrics[0][key].label }}
							</th>
						</tr>
						<tr class="!rounded-none">
							<td colspan="100%" class="!rounded-none border-t !m-0 !p-0 border-neutral-40"></td>
						</tr>
					</thead>
					<tbody>
						<tr v-for="org in CFMMetrics" :key="org + '2l'" class="data-row">
							<td v-for="key in Object.keys(org)" :key="key">
								{{ org[key].value }}
							</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	</div>
</template>

<style scoped>
.metrics-row {
	@apply flex p-1 pl-3 text-nowrap rounded-lg items-center  bg-neutral-20;
}

.metrics-value {
	@apply p-1 bg-neutral-20 rounded-lg w-[2.5rem] h-[2.5rem] flex items-center justify-center;
}

table {
	border-collapse: separate;
	border-spacing: 0 0.5rem; /* 0 for columns, 0.5rem for rows */
	@apply p-4 bg-white rounded-lg rounded-tl-none
}

.table-header {
	@apply text-sm font-semibold text-neutral-70;
}

th, td {
	@apply p-2;
}

th:not(:last-child) {
	@apply p-2;
}

/* th:first-child, td:first-child {
	@apply max-w-[6.5625rem];
} */

th:first-child {
	@apply text-left p-0;
}

td:not(:first-child) {
	@apply text-right px-2;
}

td:first-child {
	@apply text-left pr-2 rounded-l-lg bg-neutral-40;
}

td:last-child {
	@apply  rounded-r-lg;
}

.data-row {
	@apply bg-neutral-20 overflow-hidden;
}
</style>
