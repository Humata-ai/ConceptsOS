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

// URL of the embedded AI Agent (AgentChat) webview. Same-origin: the
// container's reverse proxy serves DesktopUI at / and proxies /agent/*
// to the AgentChat Next.js server on localhost:3050.
export const AI_AGENT_URL = "/agent/";