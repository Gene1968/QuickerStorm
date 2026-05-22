import { ref } from "vue";
import ListApi from "@/api/ListApi";
import { config } from "@/config/configuration";

export function useFileUpload() {
	const filePreview = ref(null);
	const environment = import.meta.env.VITE_APP_ENV
	const allowedFileTypes = [
		"application/pdf",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	];

	const uploadDocument = async (file) => {
		const debugInfo = {
			startTime: new Date().toISOString(),
			file: {
				name: file.name,
				type: file.type,
				size: file.size,
			},
			config: {
				siteUrl: config.siteUrl,
				listUrl: config.lists.docs.listUrl,
				listName: config.lists.docs.listName,
				environment: environment,
			},
			steps: [],
			errors: [],
			response: null,
		};
	
		if (!allowedFileTypes.includes(file.type)) {
			debugInfo.errors.push("File type not allowed");
			return {
				success: false,
				error: "File type not allowed",
				debugInfo: debugInfo
			};
		}
	
		try {
			debugInfo.steps.push({
				step: "File validation passed",
				timestamp: new Date().toISOString()
			});
		
			// Create unique filename to prevent duplicates
			let uniqueFileName = `${Date.now()}_${file.name}`;
			uniqueFileName = uniqueFileName.replaceAll(" ", "");
			const renamedFile = new File([file], uniqueFileName, {
				type: file.type,
			});
		
			debugInfo.steps.push({
				step: "File renamed",
				details: { originalName: file.name, newName: uniqueFileName },
				timestamp: new Date().toISOString()
			});
		
			filePreview.value = await createFilePreview(file);
			if (filePreview.value){
			dev.log("File preview :", filePreview.value)
			}
		
			// Construct server-relative path from listUrl
			const listUrlObj = new URL(config.lists.docs.listUrl);
			const serverRelativePath = listUrlObj.pathname + config.lists.docs.listName;
			// Remove trailing slash if present and ensure it starts with /
			const cleanPath = serverRelativePath.replace(/\/$/, '');
			const folderPath = cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath;
		
			debugInfo.serverRelativePath = folderPath;
			debugInfo.steps.push({
				step: "Server-relative path constructed",
				details: { 
					listUrl: config.lists.docs.listUrl,
					listName: config.lists.docs.listName,
					serverRelativePath: folderPath
				},
				timestamp: new Date().toISOString()
			});
		
			// Construct the API URL for debugging
			const constructedFileUrl = config.lists.docs.listUrl + "_api/web/GetFolderByServerRelativeUrl('" + encodeURIComponent(folderPath) + "')/";
			debugInfo.constructedUrl = constructedFileUrl;
			debugInfo.steps.push({
				step: "API URL constructed",
				details: { url: constructedFileUrl },
				timestamp: new Date().toISOString()
			});
		
			debugInfo.steps.push({
				step: "Calling ListApi.uploadFile",
				details: {
					listUrl: config.lists.docs.listUrl,
					folderName: folderPath
				},
				timestamp: new Date().toISOString()
			});
		
			// Upload to SharePoint document library
			const uploadResponse = await ListApi(
				config.lists.docs.listUrl,
				null,
				folderPath
			).uploadFile(renamedFile);
	
			debugInfo.steps.push({
				step: "Upload response received",
				timestamp: new Date().toISOString()
			});
	
			if (!uploadResponse) {
				debugInfo.errors.push("Upload response was null or undefined");
				throw new Error("Failed to upload file");
			}
	
			debugInfo.response = {
				raw: uploadResponse,
				length: uploadResponse.length
			};
	
			// Parse response and get file URL
			const mediaData = JSON.parse(uploadResponse);
			debugInfo.steps.push({
				step: "Response parsed successfully",
				timestamp: new Date().toISOString()
			});
	
			let fileUrl = mediaData.d.ServerRelativeUrl.toString();
			debugInfo.steps.push({
				step: "File URL extracted",
				details: { originalUrl: fileUrl },
				timestamp: new Date().toISOString()
			});
	
			dev.log("File URL: ", fileUrl)
			dev.log("Env: ", import.meta.env.VITE_APP_ENV)
			// Adjust URL based on environment
			if (import.meta.env.VITE_APP_ENV === "development" || import.meta.env.VITE_APP_ENV === "im") {
				fileUrl = fileUrl.substring(8);
				fileUrl = fileUrl.replaceAll("/avadev/", "");
			} else if (import.meta.env.VITE_APP_ENV === "production" || import.meta.env.VITE_APP_ENV === "stagingprod") {
				fileUrl = fileUrl.substring(29);
				fileUrl = fileUrl.replaceAll("/AcqHub/" + config.lists.docs.listName + "/", "");
			} else {
				fileUrl = fileUrl.replaceAll("/avadev/", "")
			}
	
			debugInfo.steps.push({
				step: "File URL processed",
				details: { processedUrl: fileUrl },
				timestamp: new Date().toISOString()
			});
	
			dev.log("File URL on the way out: ", fileUrl)
	
			debugInfo.endTime = new Date().toISOString();
			debugInfo.success = true;
	
			return {
				success: true,
				fileInfo: {
					link: fileUrl,
					name: file.name,
					type: file.type,
				},
				debugInfo: debugInfo
			};
		} catch (error) {
			debugInfo.errors.push({
				message: error.message,
				stack: error.stack,
				timestamp: new Date().toISOString()
			});
			debugInfo.endTime = new Date().toISOString();
			debugInfo.success = false;
	
			dev.error("Error uploading PDF:", error);
			return {
				success: false,
				error: error.message || "Failed to upload PDF",
				debugInfo: debugInfo
			};
		}
	};

	const deleteDocument = async (linkOrFileName) => {
		try {
			if (!linkOrFileName || typeof linkOrFileName !== 'string') {
				throw new Error("Delete requires a document path or file name");
			}
			// Stored link is e.g. "Career-Navigator/Uploads/1772829289635_Fakeresume.docx"; server file name is the last segment
			const serverFileName = linkOrFileName.includes('/')
				? linkOrFileName.replace(/^.*\//, '')
				: linkOrFileName;
			// Build folder path the same way as upload (full server-relative path)
			const listUrlObj = new URL(config.lists.docs.listUrl);
			const serverRelativePath = listUrlObj.pathname + config.lists.docs.listName;
			const cleanPath = serverRelativePath.replace(/\/$/, '');
			const folderPath = cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath;

			const deleteResponse = await ListApi(
				config.lists.docs.listUrl,
				config.fileUpload,
				folderPath
			).deleteFile(serverFileName);

			if (!deleteResponse) {
				throw new Error("Failed to delete file");
			}

			return {
				success: true,
				message: "File deleted successfully",
			};
		} catch (error) {
			dev.error("Error deleting file:", error);
			return {
				success: false,
				error: error.message || "Failed to delete file",
			};
		}
	};

	const createFilePreview = async (tmpFile) => {
		try {
			let file = await blobToFile(tmpFile, tmpFile.name, tmpFile.type);
			const blobUrl = URL.createObjectURL(file);
			return blobUrl;
		} catch (error) {
			dev.error("Error creating file preview:", error);
			throw error;
		}
	};

	const blobToFile = async (blob, fileName, fileType) => {
		let returnValue = false
		dev.log("Running blobToFile")
		try {
		//	 const type = "application/pdf";
			const file = new File([blob], fileName, {
				type: fileType,
				lastModified: new Date().getTime(),
			});
			dev.log("File: ", file)
			returnValue = file;
		} catch (error) {
			dev.error("Error converting blob to file:", error);
			returnValue = false;
		}
		dev.log("Return Value: ", returnValue)
		return returnValue;
	};

	const convertSPFileUrlToBlob = async (url) => {
		dev.log("Convert to blob env: ", environment)
		dev.log("Config: ", config)
		try {
			let fileName = url
				.replaceAll("/avadev/" + config.lists.docs.listName + "/UserUploadDocs/", "")
				.replaceAll(config.lists.docs.listName + "/UserUploadDocs/", "")
				.replaceAll( config.lists.docs.listName + '/', '')
				.replaceAll("/AcqHub/" + config.lists.docs.listName + "/UserUploadDocs/", "");

			// First get the file metadata
			let listApi = {}
			if (environment === "development" || environment === "im"){
				dev.log("base: ", "/_api/web/GetFolderByServerRelativeUrl('/avadev/" + config.lists.docs.listName + "/UserUploadDocs')/Files")
				listApi = ListApi(
					config.siteUrl,
					{
					listName: config.lists.docs.listName + "/UserUploadDocs",
					baseUrl:
						"/_api/web/GetFolderByServerRelativeUrl('/avadev/" + config.lists.docs.listName + "/UserUploadDocs')/Files",
					},
					config.lists.docs.listName
				);
			} else {
				listApi = ListApi(
					config.siteUrl,
					{
					listName: config.lists.docs.listName + "/UserUploadDocs",
					baseUrl:
						"/_api/web/GetFolderByServerRelativeUrl('/sites/ussf-ssc/atlas/AcqHub/" + config.lists.docs.listName + "/APDPForms/UserUploadDocs')/Files",
					},
					config.lists.docs.listName + "/UserUploadDocs"
				);
			}
			dev.log("File query: ", fileName)
			const query = `Name eq '${fileName}'`;
			dev.log("Query: ", query)
			dev.log("List API: ", listApi.baseUrl)
			const fileInfo = await listApi.getFileItem({
				$filter: query,
				$select: "ServerRelativeUrl",
			});

			if (!fileInfo?.d?.results?.[0]) {
				throw new Error("File not found");
			}

			// Get the server relative URL
			const serverRelativeUrl = fileInfo.d.results[0].ServerRelativeUrl;

			// Construct web viewer URL
			const baseUrl = config.siteUrl.replace(/\/$/, "");
			const viewerUrl = `${baseUrl}/_layouts/15/WopiFrame.aspx?sourcedoc=${encodeURIComponent(
				serverRelativeUrl
			)}&action=interactivepreview&wdFitToWidth=1&wdFitToHeight=1`;

			dev.log("SharePoint Viewer URL:", viewerUrl);
			filePreview.value = viewerUrl;

			return viewerUrl;
		} catch (error) {
			dev.error("Error creating viewer URL:", error);
			throw error;
		}
	};

	const getFormURL = async (url) => {
		try {
			let fileName = url
				// .replaceAll("/avadev/APDPDocs/APDPForms/", "")
				// .replaceAll("APDPDocs/APDPForms/", "")
		// .replaceAll('APDPDocs/', '')
				// .replaceAll("/AcqHub/APDPDocs/APDPForms/", "");

			// First get the file metadata
		dev.log("File name: ", url)
		let listApi = {}
		if (environment === "development" || environment === "im"){
		listApi = ListApi(
			config.siteUrl,
			{
			listName: config.lists.docs.listName + "/APDPForms",
			baseUrl:
				"/_api/web/GetFolderByServerRelativeUrl('/avadev/" + config.lists.docs.listName + "/APDPForms')/Files",
			},
			config.lists.docs.listName
		);
		} else {
		listApi = ListApi(
			config.siteUrl,
			{
			listName: config.lists.docs.listName + "/APDPForms",
			baseUrl:
				"/_api/web/GetFolderByServerRelativeUrl('/" + config.lists.docs.listName + "/APDPForms')/Files",
			},
			config.lists.docs.listName
		);
		}
		dev.log("File query: ", fileName)
			const query = `Name eq '${fileName}'`;
		try {
		const fileInfo = await listApi.getFileItem({
			$filter: query,
			$select: "ServerRelativeUrl",
			$value: true
		}, config.siteUrl.substring(0, config.siteUrl.length - 1), url);
		dev.log("File info: ", fileInfo)
		return fileInfo

		} catch (error) {
		dev.error("Error fetching file content:", error);
		throw error;
		}

		} catch (error) {
			dev.error("Error fetching file content:", error);
			throw error;
		}
	};

	const getUserFormURL = async (url) => {
		let returnValue = false
		try {
			let fileName = url
				// .replaceAll("/avadev/APDPDocs/APDPForms/", "")
				// .replaceAll("APDPDocs/APDPForms/", "")
				// .replaceAll('APDPDocs/', '')
				// .replaceAll("/AcqHub/APDPDocs/APDPForms/", "");

			// First get the file metadata
			dev.log("File name: ", url)
			let listApi = {}
			if (environment === "development" || environment === "im"){
				dev.log("Env: ", environment)
				dev.log("List name: ", config.lists.docs.listName + "/UserUploadDocs")
				listApi = ListApi(
					config.siteUrl,
					{
					listName: config.lists.docs.listName + "/UserUploadDocs",
					baseUrl:
						"/_api/web/GetFolderByServerRelativeUrl('/avadev/" + config.lists.docs.listName + "/UserUploadDocs')/Files",
					},
					config.lists.docs.listName + "/UserUploadDocs"
				);
			} else {
				listApi = ListApi(
					config.siteUrl,
					{
					listName: config.lists.docs.listName + "/UserUploadDocs",
					baseUrl:
						"/_api/web/GetFolderByServerRelativeUrl('/" + config.lists.docs.listName + "/UserUploadDocs')/Files",
					},
					config.lists.docs.listName + "/UserUploadDocs"
				);
			}
		dev.log("File query: ", fileName)
			const query = `Name eq '${fileName}'`;
			try {
			const fileInfo = await listApi.getUserFileItem({
				$filter: query,
				$select: "ServerRelativeUrl",
				$value: true
			}, config.siteUrl.substring(0, config.siteUrl.length - 1), url);
			dev.log("File info: ", fileInfo)
			 returnValue = fileInfo

			} catch (error) {
			dev.error("Error fetching file content:", error);
			returnValue = false;
		}

		} catch (error) {
			dev.error("Error fetching file content:", error);
			returnValue = false;
		}
		dev.log("Return Value: ", returnValue)
		return returnValue;
	};

	return {
		filePreview,
		uploadDocument,
		createFilePreview,
		convertSPFileUrlToBlob,
		deleteDocument,
		getFormURL,
		getUserFormURL,
		blobToFile
	};
}
