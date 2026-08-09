"use client";
import { useEffect, useRef, useState } from "react";
import { MODELS } from "@/lib/types";
import { IconChevron } from "./Icons";

export function ModelDropdown({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const current = MODELS.find(m => m.id === value) ?? MODELS[0];
  const list = MODELS.filter(m => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return m.label.toLowerCase().includes(s) || m.provider.toLowerCase().includes(s);
  });

  return (
    <div className="model-dropdown" ref={ref}>
      <button className="model-dropdown-btn" onClick={() => setOpen(o => !o)}>
        <span className="model-dropdown-label">{current.label}</span>
        <IconChevron />
      </button>
      {open && (
        <div className="model-dropdown-menu">
          <input
            className="model-dropdown-search"
            placeholder="Filter models…"
            value={q}
            onChange={e => setQ(e.target.value)}
            autoFocus
          />
          {list.map(m => (
            <div
              key={m.id}
              className={"model-dropdown-item" + (m.id === value ? " active" : "")}
              onClick={() => { onChange(m.id); setOpen(false); setQ(""); }}
            >
              <span className="model-dropdown-item-label">{m.label}</span>
              <span className="model-dropdown-item-provider">{m.provider}</span>
            </div>
          ))}
          {list.length === 0 && (
            <div className="model-dropdown-empty">No match</div>
          )}
        </div>
      )}
    </div>
  );
}
