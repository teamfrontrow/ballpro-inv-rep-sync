"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { History, LoaderCircle, RefreshCw } from "lucide-react";

import { apiJson, EmptyState, formatDate, formatDuration, StatusBadge, useToast } from "@/components/ui";

export type Run = {
  id: number; kind: string; trigger: string; status: string; dry_run: boolean;
  products_total: number; products_written: number; products_unchanged: number; products_skipped: number; products_failed: number;
  error_summary: string | null; requested_at: string; started_at: string | null; completed_at: string | null;
  attempts?: number; last_error?: string | null;
};

export function RunsControl({ limit = 100, compact = false }: { limit?: number; compact?: boolean }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const load = useCallback(async (quiet = false) => {
    try {
      const data = await apiJson<{ runs: Run[] }>(`/api/runs?limit=${limit}`);
      setRuns(data.runs);
    } catch (error) { if (!quiet) toast(error instanceof Error ? error.message : "Unable to load runs", "error"); }
    finally { setLoading(false); }
  }, [limit, toast]);

  useEffect(() => {
    load();
    const timer = setInterval(() => load(true), 3000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading && runs.length === 0) return <div className="card"><div className="empty-state"><LoaderCircle className="spinner muted" size={22} /><div className="empty-desc">Loading sync runs</div></div></div>;
  if (runs.length === 0) return <div className="card"><EmptyState icon={<History size={19} />} title="No sync runs yet" description="Start a dry run to validate mappings and payloads before writing to Shopify." /></div>;

  return (
    <div className="card">
      {!compact ? <div className="card-header"><div><h2 className="section-title">Run history</h2><p className="section-desc">Automatically refreshes while the control plane is open.</p></div><button className="icon-btn" title="Refresh run history" aria-label="Refresh run history" onClick={() => load()}><RefreshCw size={16} /></button></div> : null}
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Run</th><th>Status</th><th>Scope</th><th>Results</th><th>Requested</th><th>Duration</th></tr></thead><tbody>
        {runs.map((run) => <tr key={run.id}>
          <td><Link className="table-link mono" href={`/runs/${run.id}`}>#{run.id}</Link><div className="muted" style={{ fontSize: 11 }}>{run.dry_run ? "Dry run" : "Live write"}</div></td>
          <td><StatusBadge status={run.status} />{run.attempts && run.attempts > 1 ? <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>{run.attempts} attempts</div> : null}</td>
          <td><div>{run.kind.replaceAll("_", " ")}</div><div className="muted" style={{ fontSize: 11 }}>{run.trigger}</div></td>
          <td style={{ minWidth: 200 }}>
            {run.products_total > 0 ? <><div className="row-wrap" style={{ gap: 7 }}><span style={{ color: "var(--success)" }}>{run.products_written} written</span><span className="muted">{run.products_unchanged} unchanged</span></div><div className="muted" style={{ fontSize: 11 }}>{run.products_skipped} skipped · {run.products_failed} failed · {run.products_total} total</div></> : <span className="muted">Awaiting products</span>}
          </td>
          <td><div>{formatDate(run.requested_at)}</div></td>
          <td>{formatDuration(run.started_at, run.completed_at)}</td>
        </tr>)}
      </tbody></table></div>
    </div>
  );
}
