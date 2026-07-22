"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, LoaderCircle, RefreshCw } from "lucide-react";

import { apiJson, EmptyState, formatDate, formatDuration, PageHeader, StatusBadge, useToast } from "@/components/ui";
import type { Run } from "@/components/runs-control";

type RunItem = {
  id: number; status: string; payload_hash: string | null; error: string | null; shopify_metafield_gid: string | null;
  shopify_title: string; shopify_handle: string; shopify_vendor: string; shopify_product_gid: string;
};

export function RunDetail({ id }: { id: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [items, setItems] = useState<RunItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const toast = useToast();
  const load = useCallback(async (quiet = false) => {
    try {
      const data = await apiJson<{ run: Run; items: RunItem[] }>(`/api/runs/${id}`);
      setRun(data.run); setItems(data.items);
    } catch (error) { if (!quiet) toast(error instanceof Error ? error.message : "Unable to load run", "error"); }
    finally { setLoading(false); }
  }, [id, toast]);
  useEffect(() => {
    load();
    const timer = setInterval(() => { if (!run || run.status === "queued" || run.status === "running") load(true); }, 2500);
    return () => clearInterval(timer);
  }, [load, run]);

  if (loading || !run) return <div className="empty-state"><LoaderCircle className="spinner muted" size={24} /><div className="empty-desc">Loading run #{id}</div></div>;
  const processed = run.products_written + run.products_unchanged + run.products_skipped + run.products_failed;
  const percent = run.products_total ? Math.min(100, Math.round((processed / run.products_total) * 100)) : run.status === "completed" ? 100 : 0;

  // Result-type filter. Products with no matching RepSpark brand (e.g. Shopify-
  // only vendors like Ball Pro) land in "skipped" every run, so let the admin
  // narrow the (often long) list to the statuses they care about.
  const STATUS_ORDER = ["written", "unchanged", "skipped", "failed"] as const;
  const counts = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});
  const shown = statusFilter === "all" ? items : items.filter((item) => item.status === statusFilter);

  return (
    <div className="stack">
      <PageHeader title={`Sync run #${run.id}`} description={`${run.dry_run ? "Dry run" : "Live write"} · ${run.kind.replaceAll("_", " ")} · requested ${formatDate(run.requested_at)}`} actions={<><Link className="btn" href="/runs"><ArrowLeft size={15} />All runs</Link><button className="icon-btn" onClick={() => load()} title="Refresh run" aria-label="Refresh run"><RefreshCw size={16} /></button></>} />
      <div className="card">
        <div className="card-header"><div className="row"><StatusBadge status={run.status} /><span className="secondary">Triggered by {run.trigger}</span></div><span className="mono muted">{formatDuration(run.started_at, run.completed_at)}</span></div>
        <div className="card-body"><div className="spread" style={{ marginBottom: 7 }}><span className="secondary">Processing progress</span><span className="mono muted">{processed} / {run.products_total}</span></div><div className="progress-track"><div className="progress-fill" style={{ width: `${percent}%` }} /></div></div>
        <div className="detail-grid">
          <div className="detail-cell"><div className="detail-label">Written</div><div className="detail-value" style={{ color: "var(--success)" }}>{run.products_written.toLocaleString()}</div></div>
          <div className="detail-cell"><div className="detail-label">Unchanged</div><div className="detail-value">{run.products_unchanged.toLocaleString()}</div></div>
          <div className="detail-cell"><div className="detail-label">Skipped / failed</div><div className="detail-value" style={{ color: run.products_failed ? "var(--danger)" : undefined }}>{run.products_skipped.toLocaleString()} / {run.products_failed.toLocaleString()}</div></div>
        </div>
      </div>
      {run.error_summary || run.last_error ? <div className="error-box">{run.error_summary || run.last_error}</div> : null}
      <div className="card">
        <div className="card-header"><div><h2 className="section-title">Product results</h2><p className="section-desc">One row per reconciled Shopify product.</p></div><span className="badge">{statusFilter === "all" ? `${items.length} items` : `${shown.length} of ${items.length}`}</span></div>
        {items.length > 0 && (
          <div className="card-body row" style={{ gap: 6, flexWrap: "wrap", paddingTop: 0 }}>
            <button className={`btn btn-sm ${statusFilter === "all" ? "btn-primary" : ""}`} onClick={() => setStatusFilter("all")}>All {items.length}</button>
            {STATUS_ORDER.filter((status) => counts[status]).map((status) => (
              <button key={status} className={`btn btn-sm ${statusFilter === status ? "btn-primary" : ""}`} onClick={() => setStatusFilter(status)}>
                {status.charAt(0).toUpperCase() + status.slice(1)} {counts[status]}
              </button>
            ))}
          </div>
        )}
        {items.length === 0 ? <EmptyState title={run.status === "queued" ? "Waiting for worker" : "No product results"} description={run.status === "queued" ? "The queued job will populate results after a worker claims it." : "This run did not produce item-level records."} />
        : shown.length === 0 ? <EmptyState title="No matching items" description={`No ${statusFilter} results in this run.`} />
        : <div className="table-wrap"><table className="data-table"><thead><tr><th>Product</th><th>Status</th><th>Payload hash</th><th>Shopify metafield</th><th>Error</th></tr></thead><tbody>{shown.map((item) => <tr key={item.id}>
          <td><div style={{ fontWeight: 650 }}>{item.shopify_title}</div><div className="muted" style={{ fontSize: 11 }}>{item.shopify_vendor} <span className="mono">/{item.shopify_handle}</span></div></td>
          <td><StatusBadge status={item.status} /></td>
          <td className="mono muted">{item.payload_hash ? `${item.payload_hash.slice(0, 12)}…` : "None"}</td>
          <td className="mono muted">{item.shopify_metafield_gid ? item.shopify_metafield_gid.split("/").at(-1) : "None"}</td>
          <td style={{ color: item.error ? "var(--danger)" : "var(--muted)", maxWidth: 320 }}>{item.error || "None"}</td>
        </tr>)}</tbody></table></div>}
      </div>
    </div>
  );
}
