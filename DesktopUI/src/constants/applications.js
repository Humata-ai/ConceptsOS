export const APPS = {
	TERMINAL: "terminal",
	SETTINGS: "settings",
	MEDIA_VIEWER: "media-viewer",
	TEXT_EDITOR: "text-editor",
	FILE_EXPLORER: "file-explorer",
	AI_AGENT: "ai-agent"
};

export const APP_NAMES = {
	TERMINAL: "Commands",
	SETTINGS: "Settings",
	MEDIA_VIEWER: "Photos",
	TEXT_EDITOR: "Notes",
	FILE_EXPLORER: "Files",
	AI_AGENT: "AI Agent"
};

// URL of the embedded AI Agent (AgentChat) webview. Same-origin: a
// single Next.js server serves DesktopUI at / and AgentChat at /chat.
export const AI_AGENT_URL = "/chat";