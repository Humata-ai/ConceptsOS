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

// URL of the embedded AI Agent (AgentChat) webview.
//
// PROD build (`react-scripts build`, baked into AgentChat/public/):
//   Single Next.js standalone on :3000 serves DesktopUI at / and
//   AgentChat at /chat. Same-origin.
//
// DEV build (`react-scripts start` inside the vm-dev pod):
//   DesktopUI CRA is on :3000, AgentChat `next dev` is on :3050. The wg
//   gateway uses tailscale-style magic-port DNAT (any TCP port on the
//   gateway IP → same port on the pod's ClusterIP), so the phone can
//   reach AgentChat at `<current-host>:3050/chat`. We build that URL from
//   window.location so a single build works regardless of which gateway
//   IP the client got.
const isDev = process.env.NODE_ENV === "development";
export const AI_AGENT_URL = isDev
	? `${window.location.protocol}//${window.location.hostname}:3050/chat`
	: "/chat";