"use client";

import { useCallback, useEffect, useState } from "react";
import { DatabaseZap, Link2, LoaderCircle, RefreshCw, Save } from "lucide-react";

import { apiJson, formatDate, useToast } from "@/components/ui";

type Settings = { default_cap: number | null; future_horizon_days: number; shopify_api_version: string; updated_at: string };
type Connection = {
  connected: boolean;
  verified?: boolean;
  shopDomain?: string;
  shopName?: string;
  grantedScopes?: string;
  source?: "oauth" | "environment";
  updatedAt?: string;
  error?: string;
};
type Readiness = {
  ready: boolean;
  canSync: boolean;
  checkedAt: string;
  globalIssues: Array<{ message: string }>;
  brands: Array<{ brandName: string; sourceEnabled: boolean; ready: boolean; issues: Array<{ message: string }> }>;
  summary: { totalBrands: number; enabledBrands: number; readyEnabledBrands: number };
};

export function SettingsControl() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [defaultCap, setDefaultCap] = useState("");
  const [horizon, setHorizon] = useState("365");
  const [apiVersion, setApiVersion] = useState("");
  const [saving, setSaving] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const toast = useToast();

  const loadConnection = useCallback(async () => {
    try { setConnection(await apiJson<Connection>("/api/shopify/status")); }
    catch { setConnection({ connected: false }); }
  }, []);
  useEffect(() => { loadConnection(); }, [loadConnection]);

  const load = useCallback(async () => {
    try {
      const data = await apiJson<{ settings: Settings }>("/api/settings");
      setSettings(data.settings); setDefaultCap(data.settings.default_cap === null ? "" : String(data.settings.default_cap)); setHorizon(String(data.settings.future_horizon_days)); setApiVersion(data.settings.shopify_api_version);
    } catch (error) { toast(error instanceof Error ? error.message : "Unable to load settings", "error"); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const loadReadiness = useCallback(async () => {
    try {
      const data = await apiJson<{ readiness: Readiness }>("/api/catalog");
      setReadiness(data.readiness);
    } catch (error) { toast(error instanceof Error ? error.message : "Unable to inspect RepSpark", "error"); }
  }, [toast]);
  useEffect(() => { loadReadiness(); }, [loadReadiness]);

  async function save() {
    setSaving(true);
    try {
      const data = await apiJson<{ settings: Settings }>("/api/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultCap: defaultCap === "" ? null : Number.parseInt(defaultCap, 10), futureHorizonDays: Number.parseInt(horizon, 10), shopifyApiVersion: apiVersion }),
      });
      setSettings(data.settings); toast("Connector settings saved");
    } catch (error) { toast(error instanceof Error ? error.message : "Unable to save settings", "error"); }
    finally { setSaving(false); }
  }

  async function ingestCatalog() {
    setCatalogBusy(true);
    try {
      const data = await apiJson<{ report: { productsUpserted: number; stylesUpserted: number } }>("/api/catalog", { method: "POST" });
      toast(`Catalog updated: ${data.report.productsUpserted} products, ${data.report.stylesUpserted} styles`);
      await loadReadiness();
    } catch (error) { toast(error instanceof Error ? error.message : "Catalog discovery failed", "error"); }
    finally { setCatalogBusy(false); }
  }

  if (!settings) return <div className="card" style={{ maxWidth: 700 }}><div className="empty-state"><LoaderCircle className="spinner muted" size={22} /><div className="empty-desc">Loading connector settings</div></div></div>;
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
    <div className="card">
      <div className="card-header">
        <div><h2 className="section-title">Shopify connection</h2><p className="section-desc">Install this custom-distribution app once to store an encrypted offline token for unattended syncs.</p></div>
        {connection && <span className={`badge ${connection.connected ? (connection.verified ? "badge-good" : "badge-warn") : "badge-warn"}`}>{connection.connected ? (connection.verified ? "Connected" : "Token error") : "Not connected"}</span>}
      </div>
      <div className="card-body stack">
        {connection?.connected ? <>
          <div className="secondary">Connected to {connection.shopName ? <><strong>{connection.shopName}</strong> · </> : null}<span className="mono">{connection.shopDomain}</span></div>
          <div className="muted" style={{ fontSize: 12 }}>Scopes: {connection.grantedScopes ?? "—"} · {connection.source === "environment" ? "Admin token" : "OAuth"}{connection.updatedAt ? ` · Connected ${formatDate(connection.updatedAt)}` : ""}</div>
          {connection.verified === false && <div className="notice notice-warning">Stored token failed a live check{connection.error ? `: ${connection.error}` : ""}. Reconnect to refresh it.</div>}
          <div className="row-wrap"><a className="btn" href="/api/shopify/install"><Link2 size={15} />Reconnect</a><button className="btn" onClick={loadConnection}><RefreshCw size={15} />Recheck</button></div>
        </> : <>
          <div className="secondary">Not connected{connection?.shopDomain ? <> to <span className="mono">{connection.shopDomain}</span></> : null}. Install the app to store an offline token.</div>
          <div><a className="btn btn-primary" href="/api/shopify/install"><Link2 size={15} />Connect Shopify store</a></div>
        </>}
      </div>
    </div>
    <div className="card">
      <div className="card-header"><div><h2 className="section-title">Inventory sync defaults</h2><p className="section-desc">Applied by the worker when a brand does not override its own display cap.</p></div><span className="muted" style={{ fontSize: 11 }}>Updated {formatDate(settings.updated_at)}</span></div>
      <div className="card-body stack">
        <div><label className="label" htmlFor="default-cap">Default display cap</label><input id="default-cap" className="input" type="number" min="0" placeholder="No cap" value={defaultCap} onChange={(event) => setDefaultCap(event.target.value)} /><p className="field-help">Maximum quantity exposed per current or future size. Leave blank for uncapped quantities.</p></div>
        <div><label className="label" htmlFor="horizon">Future inventory horizon (days)</label><input id="horizon" className="input" type="number" min="0" max="3650" value={horizon} onChange={(event) => setHorizon(event.target.value)} /><p className="field-help">Future RepSpark availability dates beyond this window are excluded from the Shopify payload.</p></div>
        <div><label className="label" htmlFor="api-version">Shopify API version</label><input id="api-version" className="input mono" placeholder="2026-07" pattern="\d{4}-\d{2}" value={apiVersion} onChange={(event) => setApiVersion(event.target.value)} /><p className="field-help">Use an explicit quarterly Admin API version in YYYY-MM format.</p></div>
        <div><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? <LoaderCircle className="spinner" size={15} /> : <Save size={15} />}Save settings</button></div>
      </div>
    </div>
    <div className="card">
      <div className="card-header"><div><h2 className="section-title">Catalog discovery</h2><p className="section-desc">Read Shopify products and rebuild multi-style mappings from RepSpark without writing inventory.</p></div>{readiness && <span className={`badge ${readiness.ready ? "badge-good" : "badge-warn"}`}>{readiness.ready ? "Source ready" : readiness.canSync ? "Pilot ready" : "Source blocked"}</span>}</div>
      <div className="card-body stack">
        {readiness ? <>
          <div className="secondary">{readiness.summary.readyEnabledBrands} of {readiness.summary.enabledBrands} enabled RepSpark brands are sync-ready ({readiness.summary.totalBrands} total brands).</div>
          {(readiness.globalIssues.length > 0 || readiness.brands.some((brand) => brand.sourceEnabled && !brand.ready)) && <div className="notice notice-warning">{[...readiness.globalIssues.map((issue) => issue.message), ...readiness.brands.filter((brand) => brand.sourceEnabled && !brand.ready).slice(0, 5).map((brand) => `${brand.brandName}: ${brand.issues.map((issue) => issue.message).join(", ")}`)].join(" · ")}</div>}
        </> : <div className="secondary">Inspecting RepSpark readiness...</div>}
        <div className="row-wrap"><button className="btn btn-primary" onClick={ingestCatalog} disabled={catalogBusy}>{catalogBusy ? <LoaderCircle className="spinner" size={15} /> : <DatabaseZap size={15} />}Run catalog discovery</button><button className="btn" onClick={loadReadiness} disabled={catalogBusy}><RefreshCw size={15} />Refresh readiness</button></div>
      </div>
    </div>
    </div>
  );
}
