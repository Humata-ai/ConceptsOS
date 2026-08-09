"use client";
import { themes, ThemeId, applyTheme } from "@/lib/themes";
import { ThinkingLevel } from "@/lib/types";
import { IconClose } from "./Icons";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "low", "medium", "high"];

export function Settings({
  open,
  onClose,
  themeId,
  setThemeId,
  thinking,
  setThinking,
  showThinking,
  setShowThinking,
  autoCompact,
  setAutoCompact,
}: {
  open: boolean;
  onClose: () => void;
  themeId: ThemeId;
  setThemeId: (t: ThemeId) => void;
  thinking: ThinkingLevel;
  setThinking: (t: ThinkingLevel) => void;
  showThinking: boolean;
  setShowThinking: (v: boolean) => void;
  autoCompact: boolean;
  setAutoCompact: (v: boolean) => void;
}) {
  if (!open) return null;
  const cycleThinking = () => {
    const i = THINKING_LEVELS.indexOf(thinking);
    setThinking(THINKING_LEVELS[(i + 1) % THINKING_LEVELS.length]);
  };
  return (
    <>
      <div className="settings-overlay" onClick={onClose} />
      <div className="settings-panel">
        <div className="settings-header">
          <h3>Settings</h3>
          <button className="settings-close" onClick={onClose}><IconClose /></button>
        </div>
        <div className="settings-body">
          <div className="settings-section">
            <div className="settings-section-title">Appearance</div>
            <div className="theme-grid">
              {Object.values(themes).map(t => (
                <div
                  key={t.id}
                  className={"theme-swatch" + (t.id === themeId ? " active" : "")}
                  onClick={() => { setThemeId(t.id); applyTheme(t.id); }}
                >
                  <div className="theme-swatch-preview">
                    {t.colors.map((c, i) => (
                      <div key={i} className="theme-swatch-color" style={{ background: c }} />
                    ))}
                  </div>
                  <div className="theme-swatch-name">{t.name}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Agent</div>
            <div className="settings-row">
              <span className="settings-label">Auto-compaction</span>
              <button
                className={"settings-toggle" + (autoCompact ? " on" : "")}
                onClick={() => setAutoCompact(!autoCompact)}
              />
            </div>
            <div className="settings-row">
              <span className="settings-label">Thinking level</span>
              <button className="settings-value-btn" onClick={cycleThinking}>{thinking}</button>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Display</div>
            <div className="settings-row">
              <span className="settings-label">Show thinking</span>
              <button
                className={"settings-toggle" + (showThinking ? " on" : "")}
                onClick={() => setShowThinking(!showThinking)}
              />
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">About</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.6 }}>
              ChatUI is a Next.js + React re-implementation of{" "}
              <a href="https://github.com/deflating/tau" target="_blank" rel="noreferrer" style={{ color: "var(--accent-text)" }}>Tau</a>.
              Streaming responses come from a mock <code>/api/chat</code> route — swap in your own provider to make it real.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
