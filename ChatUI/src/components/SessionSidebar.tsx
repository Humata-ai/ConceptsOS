"use client";
import { Session } from "@/lib/types";
import { IconPlus, IconRefresh } from "./Icons";
import Image from "next/image";

function timeAgo(t: number): string {
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(t).toLocaleDateString();
}

export function SessionSidebar({
  sessions,
  currentId,
  onSelect,
  onNew,
  onRefresh,
  search,
  onSearch,
  open,
  onCloseMobile,
}: {
  sessions: Session[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRefresh: () => void;
  search: string;
  onSearch: (s: string) => void;
  open: boolean;
  onCloseMobile: () => void;
}) {
  const filtered = sessions
    .filter(s => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      if (s.title.toLowerCase().includes(q)) return true;
      return s.messages.some(m => m.content.toLowerCase().includes(q));
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <>
      <div className={"sidebar" + (open ? " open" : "")} id="sidebar">
        <div className="sidebar-header">
          <div className="mode-toggle">
            <span className="mode-link active" title="Chat">
              <Image src="/icons/tau-192.png" alt="τ" width={20} height={20} className="tau-icon" />
            </span>
          </div>
          <input
            type="text"
            className="sidebar-search-input"
            placeholder="Search..."
            value={search}
            onChange={e => onSearch(e.target.value)}
            autoComplete="off"
          />
          <div className="sidebar-actions">
            <button className="icon-btn" title="New session" onClick={onNew}><IconPlus /></button>
            <button className="icon-btn" title="Refresh" onClick={onRefresh}><IconRefresh /></button>
          </div>
        </div>
        <div className="session-list">
          {filtered.length === 0 && (
            <div className="session-loading">No sessions yet. Click + to start.</div>
          )}
          {filtered.map(s => (
            <div
              key={s.id}
              className={"session-item" + (s.id === currentId ? " active" : "")}
              onClick={() => { onSelect(s.id); onCloseMobile(); }}
            >
              <div className="session-title">{s.title || "Untitled"}</div>
              <div className="session-meta">
                <span>{timeAgo(s.updatedAt)}</span>
                <span>·</span>
                <span>{s.messages.length} msg</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div
        className={"sidebar-overlay" + (open ? " visible" : "")}
        onClick={onCloseMobile}
      />
    </>
  );
}
