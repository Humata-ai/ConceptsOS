import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import styles from "./WebView.module.css";

/**
 * @param {Object} props
 * @param {String} props.source
 */
export const WebView = forwardRef(({ source, focus, ...props }, ref) => {
	const [hovered, setHovered] = useState(false);
	const iframeRef = useRef(null);

	// Merge the forwarded ref with our own so we can postMessage into the
	// embedded document (keyboard bridge below) regardless of whether a
	// parent also wants the ref.
	const setRefs = useCallback((node) => {
		iframeRef.current = node;
		if (typeof ref === "function") ref(node);
		else if (ref) ref.current = node;
	}, [ref]);

	useEffect(() => {
		window.focus();

		const onBlur = (event) => {
			if (hovered) {
				focus?.(event);
			}
		};

		window.addEventListener("blur", onBlur);

		return () => {
			window.removeEventListener("blur", onBlur);
		};
	}, [hovered]);

	// iOS keyboard bridge. Inside an iframe, `visualViewport` does NOT resize
	// when the software keyboard opens — only the top-level document's does.
	// So the embedded app (e.g. AgentChat) can't lift its composer on its own.
	// We measure the keyboard overlap here (top document) and forward it into
	// the iframe so it can resize its content above the keyboard.
	useEffect(() => {
		const vv = window.visualViewport;
		if (!vv) return;

		const postKeyboard = () => {
			const frame = iframeRef.current;
			if (!frame || !frame.contentWindow) return;
			// Top edge of the keyboard, in the top document's layout-viewport
			// coordinates (we pin page scroll to 0 below).
			const keyboardTop = vv.offsetTop + vv.height;
			// The iframe usually does NOT reach the screen bottom (e.g. the
			// desktop taskbar sits below a maximized window). Measure how much
			// of THIS iframe the keyboard actually covers, not the whole screen —
			// otherwise the embedded app lifts its composer too far and leaves a
			// gap between the keyboard and the input.
			const frameBottom = frame.getBoundingClientRect().bottom;
			const height = Math.max(0, frameBottom - keyboardTop);
			try {
				frame.contentWindow.postMessage({ type: "ios-keyboard", height }, "*");
			} catch { /* cross-origin can still postMessage with "*" */ }
			// The keyboard can nudge WKWebView into scrolling the whole desktop
			// (revealing the taskbar). Pin the top document back to the origin.
			if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
		};

		vv.addEventListener("resize", postKeyboard);
		vv.addEventListener("scroll", postKeyboard);
		window.addEventListener("scroll", postKeyboard);
		// Re-send on focus changes so a freshly-loaded iframe gets the state.
		document.addEventListener("focusin", postKeyboard);
		postKeyboard();

		return () => {
			vv.removeEventListener("resize", postKeyboard);
			vv.removeEventListener("scroll", postKeyboard);
			window.removeEventListener("scroll", postKeyboard);
			document.removeEventListener("focusin", postKeyboard);
		};
	}, []);

	const onMouseOver = () => {
		setHovered(true);
	};

	const onMouseOut = () => {
		window.focus();
		setHovered(false);
	};

	return (
		<div className={styles.Container} onMouseOver={onMouseOver} onMouseOut={onMouseOut}>
			<iframe
				ref={setRefs}
				src={source}
				title={props.title ?? "Web view"}
				className={styles["Web-view"]}
				referrerPolicy="no-referrer"
				sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-presentation allow-same-origin allow-scripts"
				{...props}
			/>
		</div>
		
	);
});