"use client";
import { useEffect, useState } from "react";
import { IconClose, IconArrowUp } from "./Icons";

// Purely mock file browser — mirrors Tau's right sidebar visually.
// Uses an in-memory synthetic tree so no server access is needed.
interface Node { name: string; type: "dir" | "file"; children?: Node[]; }

const TREE: Node = {
  name: "/", type: "dir", children: [
    { name: "src", type: "dir", children: [
      { name: "app", type: "dir", children: [
        { name: "page.tsx", type: "file" },
        { name: "layout.tsx", type: "file" },
        { name: "style.css", type: "file" },
      ]},
      { name: "components", type: "dir", children: [
        { name: "SessionSidebar.tsx", type: "file" },
        { name: "ModelDropdown.tsx", type: "file" },
        { name: "Settings.tsx", type: "file" },
        { name: "FileBrowser.tsx", type: "file" },
      ]},
      { name: "lib", type: "dir", children: [
        { name: "themes.ts", type: "file" },
        { name: "types.ts", type: "file" },
      ]},
    ]},
    { name: "public", type: "dir", children: [
      { name: "manifest.json", type: "file" },
      { name: "icons", type: "dir", children: [{ name: "tau-192.png", type: "file" }] },
    ]},
    { name: "package.json", type: "file" },
    { name: "README.md", type: "file" },
    { name: "tsconfig.json", type: "file" },
    { name: "next.config.mjs", type: "file" },
  ],
};

function resolve(path: string[]): Node | null {
  let node: Node = TREE;
  for (const seg of path) {
    if (node.type !== "dir" || !node.children) return null;
    const next = node.children.find(c => c.name === seg);
    if (!next) return null;
    node = next;
  }
  return node;
}

export function FileBrowser({ open, onClose, onInsertPath }: {
  open: boolean;
  onClose: () => void;
  onInsertPath: (p: string) => void;
}) {
  const [path, setPath] = useState<string[]>([]);
  useEffect(() => {
    if (!open) setPath([]);
  }, [open]);
  const node = resolve(path) ?? TREE;
  const items = node.type === "dir" ? node.children ?? [] : [];
  const prettyPath = "/" + path.join("/");

  return (
    <div className={"file-sidebar" + (open ? "" : " collapsed")}>
      <div className="file-sidebar-header">
        <span className="file-sidebar-title">Files</span>
        <button className="icon-btn" title="Up" disabled={path.length === 0} onClick={() => setPath(p => p.slice(0, -1))}>
          <IconArrowUp />
        </button>
        <button className="icon-btn" title="Close" onClick={onClose}><IconClose /></button>
      </div>
      <div className="file-sidebar-path" title={prettyPath}>{prettyPath}</div>
      <div className="file-list">
        {items.map(item => (
          <div
            key={item.name}
            className={"file-item " + item.type}
            onClick={() => {
              if (item.type === "dir") setPath(p => [...p, item.name]);
              else onInsertPath([...path, item.name].join("/"));
            }}
          >
            <span className="file-item-icon">{item.type === "dir" ? "📁" : "📄"}</span>
            <span className="file-item-name">{item.name}</span>
          </div>
        ))}
        {items.length === 0 && (
          <div className="file-empty">Empty directory</div>
        )}
      </div>
    </div>
  );
}
