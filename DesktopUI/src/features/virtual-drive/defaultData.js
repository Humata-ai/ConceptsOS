import { APPS } from "../../constants/applications.js";
import { WALLPAPERS } from "../../constants/desktop.js";
import AppsManager from "../applications/applications.js";
import { VirtualRoot } from "./virtualRoot.js";

/**
 * Loads default data on the virtual root
 * @param {VirtualRoot} virtualRoot 
 */
export function loadDefaultData(virtualRoot) {
	virtualRoot.createFolder("bin", (folder) => {
		folder.createFiles([
			{ name: "echo" },
			{ name: "cd" },
			{ name: "ls" },
			{ name: "clear" },
		]);
	});

	virtualRoot.createFolder("dev", (folder) => {
		folder.createFiles([
			{ name: "null" },
			{ name: "zero" },
			{ name: "random" },
		]);
	});

	virtualRoot.createFolder("etc");

	virtualRoot.createFolder("usr", (folder) => {
		folder.createFolders(["bin", "sbin", "lib", "share"]);
	});

	const linkedPaths = {};
		
	virtualRoot.createFolder("home", (folder) => {
		folder.createFolder("user", (folder) => {
			folder.setAlias("~")
				.createFolder(".config", (folder) => {
					folder.createFile("desktop", "xml", (file) => {
						file.setSource("/config/desktop.xml");
					}).createFile("taskbar", "xml", (file) => {
						file.setSource("/config/taskbar.xml");
					}).createFile("applications", "xml", (file) => {
						file.setSource("/config/applications.xml");
					});
				})
				.createFolder("Pictures", (folder) => {
					folder.setIconUrl(AppsManager.getAppIconUrl(APPS.FILE_EXPLORER, "folder-images"));
					folder.createFolder("Wallpapers", (folder) => {
						folder.setProtected(true);
						for (let i = 0; i < WALLPAPERS.length; i++) {
							const source = WALLPAPERS[i];
							folder.createFile(`Wallpaper${i + 1}`, "png", (file) => {
								file.setSource(source);
							});
						}
					});
					linkedPaths.images = folder.path;
				})
				.createFolder("Documents", (folder) => {
					folder.setIconUrl(AppsManager.getAppIconUrl(APPS.FILE_EXPLORER, "folder-text"));
					folder.createFile("welcome", "txt", (file) => {
						file.setContent("Welcome to ConceptsOS.");
					});
					linkedPaths.documents = folder.path;
				})
				.createFolder("Desktop", (folder) => {
					folder.createFolderLink("Pictures", (folderLink) => {
						folderLink.setLinkedPath(linkedPaths.images);
					}).createFolderLink("Documents", (folderLink) => {
						folderLink.setLinkedPath(linkedPaths.documents);
					}).createFile("My Agent", "", (file) => {
						file.setIconUrl(AppsManager.getAppIconUrl(APPS.AI_AGENT));
					});
				});
		});
	});

	virtualRoot.createFolder("lib");
	virtualRoot.createFolder("sbin");
	virtualRoot.createFolder("tmp");
	virtualRoot.createFolder("var");
	virtualRoot.createFolder("boot");

	virtualRoot.createFolder("proc", (folder) => {
		folder.createFiles([
			{ name: "cpuinfo" },
			{ name: "meminfo" },
		]);
	});

	virtualRoot.createFolder("var");
	virtualRoot.createFolder("opt");
	virtualRoot.createFolder("media");
	virtualRoot.createFolder("mnt");
	virtualRoot.createFolder("srv");
}