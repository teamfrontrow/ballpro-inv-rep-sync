"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Beaker, LoaderCircle, Play, RotateCw } from "lucide-react";

import { apiJson, StatusBadge, useToast } from "@/components/ui";

type RunStatus = "queued" | "running" | "completed" | "failed";
type Run = {
  id: number; status: RunStatus; products_total: number; products_written: number;
  products_unchanged: number; products_skipped: number; products_failed: number; error_summary: string | null;
};

export function SyncLauncher({ brandIds, productGids, compact = false }: { brandIds?: number[]; productGids?: string[]; compact?: boolean }) {
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useToast();

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function poll(runId: number) {
    try {
      const data = await apiJson<{ run: Run }>(`/api/runs/${runId}`);
      setRun(data.run);
      if (data.run.status === "queued" || data.run.status === "running") {
        timer.current = setTimeout(() => poll(runId), 2500);
      } else {
        setBusy(false);
        toast(data.run.status === "completed" ? `Sync run #${runId} completed` : `Sync run #${runId} failed`, data.run.status === "completed" ? "success" : "error");
      }
    } catch (error) {
      setBusy(false);
      toast(error instanceof Error ? error.message : "Unable to poll sync", "error");
    }
  }

  async function start(dryRun: boolean) {
    setBusy(true);
    setRun(null);
    try {
      const data = await apiJson<{ runId: number }>("/api/runs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun, brandIds, productGids }),
      });
      setRun({ id: data.runId, status: "queued", products_total: 0, products_written: 0, products_unchanged: 0, products_skipped: 0, products_failed: 0, error_summary: null });
      toast(`${dryRun ? "Dry run" : "Sync"} #${data.runId} queued`);
      poll(data.runId);
    } catch (error) {
      setBusy(false);
      toast(error instanceof Error ? error.message : "Unable to start sync", "error");
    }
  }

  return (
    <div className={compact ? "row-wrap" : "sync-panel"}>
      <div className="row-wrap">
        <button className="btn" onClick={() => start(true)} disabled={busy}><Beaker size={15} />Dry run</button>
        <button className="btn btn-primary" onClick={() => start(false)} disabled={busy}>{busy ? <LoaderCircle className="spinner" size={15} /> : <Play size={15} />}Run sync</button>
      </div>
      {run ? (
        <div className={compact ? "row-wrap" : "sync-status"}>
          <div className="spread">
            <div className="row"><StatusBadge status={run.status} /><Link className="table-link mono" href={`/runs/${run.id}`}>Run #{run.id}</Link></div>
            {(run.status === "queued" || run.status === "running") ? <RotateCw className="spinner muted" size={14} /> : null}
          </div>
          {!compact && run.products_total > 0 ? <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>{run.products_written} written, {run.products_unchanged} unchanged, {run.products_skipped} skipped, {run.products_failed} failed</div> : null}
          {!compact && run.error_summary ? <div className="error-box" style={{ marginTop: 10 }}>{run.error_summary}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
