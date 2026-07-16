"use client";

import { CircleAlert, CircleCheck, Inbox } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

type ToastKind = "success" | "error";
type ToastItem = { id: number; message: string; kind: ToastKind };
type ToastContextValue = { toast: (message: string, kind?: ToastKind) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const toast = useCallback((message: string, kind: ToastKind = "success") => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 4200);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toaster" aria-live="polite">
        {items.map((item) => (
          <div className={`toast ${item.kind}`} key={item.id}>
            {item.kind === "success" ? <CircleCheck size={17} /> : <CircleAlert size={17} />}
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider");
  return value.toast;
}

export async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return (
    <header className="page-header">
      <div><h1 className="page-title">{title}</h1><p className="page-desc">{description}</p></div>
      {actions ? <div className="row-wrap">{actions}</div> : null}
    </header>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const className = status === "completed" || status === "written" || status === "auto" || status === "manual"
    ? "badge-good"
    : status === "running" ? "badge-run"
    : status === "queued" || status === "partial" || status === "skipped" ? "badge-warn"
    : status === "failed" || status === "unmatched" ? "badge-bad"
    : status === "ignored" || status === "unchanged" ? ""
    : "badge-accent";
  return <span className={`badge ${className}`}><span className={`dot ${status === "running" ? "pulse" : ""}`} />{status.replaceAll("_", " ")}</span>;
}

export function EmptyState({ title, description, icon }: { title: string; description: string; icon?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon ?? <Inbox size={19} />}</div>
      <div className="empty-title">{title}</div>
      <div className="empty-desc">{description}</div>
    </div>
  );
}

export function formatDate(value: string | null | undefined, includeTime = true) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function formatDuration(start: string | null, end: string | null) {
  if (!start) return "Not started";
  const milliseconds = new Date(end ?? Date.now()).valueOf() - new Date(start).valueOf();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "Unknown";
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}
