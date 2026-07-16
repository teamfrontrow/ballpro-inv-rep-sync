import Link from "next/link";
import { Activity, Building2, CircleAlert, GitMerge } from "lucide-react";

import { RunsControl } from "@/components/runs-control";
import { SyncLauncher } from "@/components/sync-launcher";
import { PageHeader } from "@/components/ui";
import { connectorDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [brandResult, mappingResult, runResult] = await Promise.all([
    connectorDb().query<{ total: number; enabled: number }>("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE enabled)::int AS enabled FROM brands"),
    connectorDb().query<{ total: number; ready: number; review: number }>("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE match_status IN ('auto', 'manual'))::int AS ready, COUNT(*) FILTER (WHERE match_status IN ('partial', 'unmatched'))::int AS review FROM product_mappings"),
    connectorDb().query<{ active: number; failed: number }>("SELECT COUNT(*) FILTER (WHERE status IN ('queued', 'running'))::int AS active, COUNT(*) FILTER (WHERE status = 'failed' AND requested_at > now() - interval '24 hours')::int AS failed FROM sync_runs"),
  ]);
  const brands = brandResult.rows[0] ?? { total: 0, enabled: 0 };
  const mappings = mappingResult.rows[0] ?? { total: 0, ready: 0, review: 0 };
  const runs = runResult.rows[0] ?? { active: 0, failed: 0 };
  const readiness = mappings.total ? Math.round((mappings.ready / mappings.total) * 100) : 0;

  return (
    <div className="stack">
      <PageHeader title="Inventory connector" description="Monitor catalog readiness and control RepSpark inventory writes to Shopify." actions={<SyncLauncher compact />} />
      <div className="stats-grid">
        <Link href="/brands" className="card stat-card"><div className="stat-icon"><Building2 size={18} /></div><div><div className="stat-value">{brands.enabled}</div><div className="stat-label">Enabled brands</div></div><div className="stat-sub">{brands.total} discovered brands</div></Link>
        <Link href="/mappings" className="card stat-card"><div className="stat-icon"><GitMerge size={18} /></div><div><div className="stat-value">{readiness}%</div><div className="stat-label">Mapping ready</div></div><div className="stat-sub">{mappings.ready} of {mappings.total} products</div></Link>
        <Link href="/mappings" className="card stat-card"><div className="stat-icon" style={{ color: "var(--warning)", background: "var(--warning-soft)" }}><CircleAlert size={18} /></div><div><div className="stat-value">{mappings.review}</div><div className="stat-label">Need review</div></div><div className="stat-sub">Partial or unmatched products</div></Link>
        <Link href="/runs" className="card stat-card"><div className="stat-icon" style={{ color: runs.failed ? "var(--danger)" : "var(--success)", background: runs.failed ? "var(--danger-soft)" : "var(--success-soft)" }}><Activity size={18} /></div><div><div className="stat-value">{runs.active}</div><div className="stat-label">Active runs</div></div><div className="stat-sub">{runs.failed} failed in the last 24 hours</div></Link>
      </div>
      <div className="two-column">
        <div><RunsControl limit={8} compact /></div>
        <div className="card card-pad sync-panel"><div><h2 className="section-title">Operator checklist</h2><p className="section-desc">Use the control plane in this order before a live write.</p></div><div className="stack" style={{ gap: 12 }}><div><span className="badge badge-accent">1</span><span className="secondary" style={{ marginLeft: 9 }}>Enable and cap ready brands</span></div><div><span className="badge badge-accent">2</span><span className="secondary" style={{ marginLeft: 9 }}>Reconcile partial product styles</span></div><div><span className="badge badge-accent">3</span><span className="secondary" style={{ marginLeft: 9 }}>Run dry sync and inspect results</span></div><div><span className="badge badge-accent">4</span><span className="secondary" style={{ marginLeft: 9 }}>Queue the live Shopify write</span></div></div><div className="row-wrap"><Link className="btn" href="/brands">Review brands</Link><Link className="btn" href="/mappings">Review mappings</Link></div></div>
      </div>
    </div>
  );
}
