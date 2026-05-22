<script setup>
import { ref, onMounted } from 'vue';
import { useUserStore } from '../stores/userStore.js';

const model = defineModel();

const props = defineProps({
	placeholder: {
		type: String,
		required: true,
	},
	hideLabel: {
		type: Boolean,
		required: false,
		default: false,
	},
	hideRoleLabel: {
		type: Boolean
	},
	preLoadList: {
		type: Array,
		required: false,
	},
});

const noUTM = ref(false);
const enterNameManually = ref(false);
const toggleManualEntry = () => {
	manualName.value = '';
	manualEmail.value = '';
	manualUser.value = {
		Title: '',
		Email: '',
	};
	enterNameManually.value = !enterNameManually.value;
};

defineEmits(['userSelected']);

const userStore = useUserStore();
const query = ref('');
const options = ref(props.preLoadList ? props.preLoadList : []);
const showDropdown = ref(false);
const manualName = ref('');
const manualEmail = ref('');
const manualUser = ref({
	Title: '',
	Email: '',
})

const onInput = async () => {
	//console.log("Query: ", query.value)
	if (query.value.length > 2) {
		//console.log("Searching for user...")
		let result = await searchForUser(query.value.charAt(0).toUpperCase() + query.value.slice(1));
		if (result) {
			//console.log("Result: ", result)
		}

		showDropdown.value = true;
	} else {
		showDropdown.value = false;
		model.value = null;
	}
	// if (!query.value) {
	// 	showDropdown.value = false;
	// }
};

onMounted(() => {
	setTimeout(() => {
		if (props.preLoadList) {
			prefillOptions();
		}
	}, 100)

})


const prefillOptions = (response) => {
	options.value = []

	if (props.preLoadList) {
		//console.log("Preload List: ", props.preLoadList)
		props.preLoadList.forEach((curr) => {
			options.value.push({
				value: {
					Title: curr.Title,
					Email: curr.Email,
					Role: curr.Role,
			},
				label: {
					Title: curr.Title,
					Email: curr.Email,
					Role: curr.Role,
					Org2L: curr.Org2L
				}
			})
		})
	}
	if (response?.length > 0) {
		response.forEach((curr) => {
			options.value.push({
					value: {
					Title: curr.Title,
					Email: curr.Email,
					Role: 'Other'
				},
				label: {
					Title: curr.Title,
					Email: curr.Email,
					Role: 'Other'
				}
			})
		})
	}
}

const searchForUser = async (payload) => {
	const response = await userStore.searchForUser(payload);
	if (response) {
		//console.log("Response: ", response)
		prefillOptions(response);
		// options.value = response.map((curr) => ({
		// 	value: {
		// 		Title: curr.Title,
		// 		Email: curr.Email,
		// 		Id: curr.Id,
		// 	},
		// 	label: `${curr.Title} - ${curr.Email}`,
		// }));
	}
};

const selectUser = (user) => {
	showDropdown.value = false
	model.value = user
	query.value = user.Title;
};

// watch(manualUser.value, (newVal) => {
// 	if (manualUser.value.Email) {
// 		emit('userSelected', manualUser.value);
// 	}
// });

const getNameFromEmail = (email) => {
	let name = email.split('@')[0];
	// the name will be the first and last name separated by a period
	let nameParts = name.split('.');
	let firstName = nameParts[0];
	let lastName = nameParts[1];
	name = firstName.charAt(0).toUpperCase() + firstName.slice(1) + ' ' + lastName.charAt(0).toUpperCase() + lastName.slice(1);
	//console.log("Name from email: ", name)
	return name;
}

const setManualUserEmail = () => {
	//console.log("Setting manual user email: ", manualEmail.value)
	if (manualEmail.value) {
		let name = getNameFromEmail(manualEmail.value);
		//console.log("Name from email: ", name)
		model.value = {
			Title: name,
			Email: manualEmail.value
		};
	}
	//console.log("Manual User: ", model.value)
};
</script>

<template>
	<div class="relative">
		<div v-if="!enterNameManually" class="w-full">
			<div v-if="!props.hideLabel" class="text-muted text-sm">
				<span>
					Please use the format 'Last-Name First-Name' to search the GAL or
				</span>
				<button @click="toggleManualEntry" class="toggle-manual-entry text-sm text-primary">
					{{ enterNameManually ? 'Select From the GAL' : 'Enter Manually' }}
				</button>
			</div>
			<div class="relative" @mouseover="showDropdown = true" @mouseleave="showDropdown = false">
				<input type="text" class="form-control" v-model="query" @input="onInput" :placeholder="placeholder" />
				<div class="dropdown w-full min-w-fit absolute top-[100%] left-0 right-0" v-if="options.length && showDropdown">
					<ul v-if="options?.length > 0" @mouseleave="showDropdown = false" class="dropdown-menu show shadow">
						<div v-if="noUTM" class="text-xs text-neutral-70 flex items-center justify-between w-full">
							<span>{{ props.preLoadList }}</span>
							<span>No UTM assigned to this organization</span>
							<button @click="assignUTM" class="primary-button">Assign UTM</button>
						</div>
						<li role="button" v-for="(option, index) in options" :key="option.value.Id? option.value.Id : option.value.Email + 'id'"  class=" group relative flex flex-col">

							<div v-if="index === 0 || options[index - 1].value.Role !== option.value.Role" class="text-xs text-neutral-70">
								<span v-if="option.label.Org2L" class="pr-1">{{ option.label.Org2L? option.label.Org2L : '' }}</span>
								<span v-if="!props.hideRoleLabel">{{ option.label.Role }}</span>
							</div>
							<div @click="selectUser(option.value)" class="flex items-center gap-2 dropdown-item">
								<span class="uppercase font-light  truncate pl-6 ">{{ option.label.Title }}</span>
								<span v-if="!option.label.Role" class="pr-2">{{ option.label.Email }}</span>
							</div>
						</li>
					</ul>
				</div>
			</div>
		</div>
		<div v-if="enterNameManually" class="flex flex-col justify-start">
			<button @click="toggleManualEntry" class="toggle-manual-entry p-0 text-sm text-primary">
				Select From the GAL
			</button>
			<input id="manualEmail" type="text" class="form-control" :placeholder="'Email'" v-model="manualEmail" @change="setManualUserEmail">
		</div>
	</div>
</template>

<style scoped>
.dropdown-menu {
	@apply p-4 rounded-lg drop-shadow-lg bg-white;
}
.dropdown-item {
	@apply hover:bg-neutral-30 p-1 px-2 rounded-md ;
}
.toggle-manual-entry-container {
	@apply flex justify-end;
}
.toggle-manual-entry {
	@apply w-fit;
}
</style>
