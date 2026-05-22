import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export const useDocsStore = defineStore('docStore', () => {
  const activeDoc = ref(null)
  const docs = ref([])
  const getActiveDoc = computed(() => activeDoc.value)
  const getDocs = computed(() => docs.value)

  const fetchDocs = async ( docList ) => {
	//console.log("Fetching Docs: ", docList)
    docs.value = docList
	if (docList?.length > 0) {
		activeDoc.value = docList[0]
	}
	return activeDoc.value
  }

  const setActiveDoc = (doc) => {
	//console.log("Setting Active Doc: ", doc)
	activeDoc.value = doc
  }

  const setDocs = (docList) => {
	docs.value = docList
  }


  return {
	activeDoc,
	docs,
	getActiveDoc,
	getDocs,
	fetchDocs,
	setActiveDoc,
	setDocs
  }
})
