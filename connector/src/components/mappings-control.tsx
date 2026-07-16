"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, LoaderCircle, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";

import { SyncLauncher } from "@/components/sync-launcher";
import { apiJson, EmptyState, formatDate, StatusBadge, useToast } from "@/components/ui";

type Brand = { id: string; brand_name: string };
type Style = { id?: number; normalized_sku: string; repspark_product_number: string | null; match_status: "auto" | "manual" | "unmatched" | "ignored"; match_source: string };
type Mapping = {
  id: string; shopify_product_gid: string; shopify_handle: string; shopify_vendor: string; shopify_title: string;
  brand_id: string | null; brand_name: string | null; match_status: "auto" | "manual" | "partial" | "unmatched" | "ignored";
  match_source: string; last_synced_at: string | null; styles: Style[];
};

function MappingEditor({ mapping, brands, onSaved }: { mapping: Mapping; brands: Brand[]; onSaved: (mapping: Mapping) => void }) {
  const [brandId, setBrandId] = useState(mapping.brand_id ?? "");
  const [status, setStatus] = useState(mapping.match_status);
  const [source, setSource] = useState(mapping.match_source);
  const [styles, setStyles] = useState<Style[]>(mapping.styles);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  function patchStyle(index: number, changes: Partial<Style>) { setStyles((current) => current.map((style, styleIndex) => styleIndex === index ? { ...style, ...changes } : style)); }
  async function save() {
    setSaving(true);
    try {
      const data = await apiJson<{ mapping: Mapping }>(`/api/mappings/${mapping.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: brandId ? Number(brandId) : null, matchStatus: status, matchSource: source || "control-plane", styles: styles.map((style) => ({ id: style.id, normalizedSku: style.normalized_sku, repsparkProductNumber: style.repspark_product_number || null, matchStatus: style.match_status, matchSource: style.match_source || "control-plane" })) }),
      });
      onSaved({ ...mapping, ...data.mapping, brand_name: brands.find((brand) => brand.id === String(data.mapping.brand_id))?.brand_name ?? null });
      toast("Product mapping reconciled");
    } catch (error) { toast(error instanceof Error ? error.message : "Unable to save mapping", "error"); }
    finally { setSaving(false); }
  }

  return (
    <div className="mapping-styles">
      <div className="form-grid" style={{ marginBottom: 16 }}>
        <div><label className="label">Brand</label><select className="select" value={brandId} onChange={(event) => setBrandId(event.target.value)}><option value="">Unassigned</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.brand_name}</option>)}</select></div>
        <div><label className="label">Product status</label><select className="select" value={status} onChange={(event) => setStatus(event.target.value as Mapping["match_status"])}>{["auto", "manual", "partial", "unmatched", "ignored"].map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
        <div><label className="label">Match source</label><input className="input" value={source} onChange={(event) => setSource(event.target.value)} /></div>
        <div><label className="label">Shopify product GID</label><input className="input mono" value={mapping.shopify_product_gid} disabled /></div>
      </div>
      <div className="spread" style={{ marginBottom: 10 }}><div><h3 className="section-title">RepSpark styles</h3><p className="section-desc">All Shopify style SKUs grouped into this product metafield.</p></div><button className="btn btn-sm" onClick={() => setStyles((current) => [...current, { normalized_sku: "", repspark_product_number: "", match_status: "manual", match_source: "control-plane" }])}><Plus size={14} />Add style</button></div>
      {styles.length === 0 ? <div className="error-box" style={{ marginBottom: 12 }}>No styles are mapped. Add at least one style before marking this product ready.</div> : styles.map((style, index) => <div className="style-row" key={style.id ?? `new-${index}`}>
        <div><label className="label">Normalized Shopify SKU</label><input className="input mono" value={style.normalized_sku} onChange={(event) => patchStyle(index, { normalized_sku: event.target.value.toUpperCase() })} /></div>
        <div><label className="label">RepSpark product number</label><input className="input mono" placeholder="Product number" value={style.repspark_product_number ?? ""} onChange={(event) => patchStyle(index, { repspark_product_number: event.target.value })} /></div>
        <div><label className="label">Style status</label><select className="select" value={style.match_status} onChange={(event) => patchStyle(index, { match_status: event.target.value as Style["match_status"], match_source: event.target.value === "manual" ? "control-plane" : style.match_source })}>{["auto", "manual", "unmatched", "ignored"].map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
        <button className="icon-btn" title="Remove style" aria-label="Remove style" onClick={() => setStyles((current) => current.filter((_, styleIndex) => styleIndex !== index))}><Trash2 size={15} /></button>
      </div>)}
      <div className="row-wrap" style={{ marginTop: 16 }}><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? <LoaderCircle className="spinner" size={15} /> : <Save size={15} />}Save reconciliation</button><SyncLauncher productGids={[mapping.shopify_product_gid]} compact /></div>
    </div>
  );
}

export function MappingsControl() {
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [brandId, setBrandId] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => { apiJson<{ brands: Brand[] }>("/api/brands").then((data) => setBrands(data.brands)).catch((error) => toast(error.message, "error")); }, [toast]);
  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    if (query) params.set("q", query);
    if (status) params.set("status", status);
    if (brandId) params.set("brandId", brandId);
    try {
      const data = await apiJson<{ mappings: Mapping[]; pages: number; total: number }>(`/api/mappings?${params}`);
      setMappings(data.mappings); setPages(data.pages); setTotal(data.total);
    } catch (error) { toast(error instanceof Error ? error.message : "Unable to load mappings", "error"); }
    finally { setLoading(false); }
  }, [brandId, page, query, status, toast]);
  useEffect(() => { const timer = setTimeout(load, query ? 250 : 0); return () => clearTimeout(timer); }, [load, query]);

  function filterChanged(setter: (value: string) => void, value: string) { setter(value); setPage(1); setExpanded(null); }

  return (
    <div className="stack">
      <div className="row-wrap">
        <div className="search-wrap" style={{ flex: "1 1 280px" }}><Search size={15} /><input className="input" placeholder="Search title, handle, vendor, SKU, or style" value={query} onChange={(event) => filterChanged(setQuery, event.target.value)} /></div>
        <select className="select" style={{ width: 170 }} value={status} onChange={(event) => filterChanged(setStatus, event.target.value)}><option value="">All statuses</option>{["auto", "manual", "partial", "unmatched", "ignored"].map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select className="select" style={{ width: 200 }} value={brandId} onChange={(event) => filterChanged(setBrandId, event.target.value)}><option value="">All brands</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.brand_name}</option>)}</select>
        <button className="icon-btn" title="Refresh mappings" aria-label="Refresh mappings" onClick={load}><RefreshCw className={loading ? "spinner" : ""} size={16} /></button>
      </div>
      {loading && mappings.length === 0 ? <div className="card"><div className="empty-state"><LoaderCircle className="spinner muted" size={22} /><div className="empty-desc">Loading mapping groups</div></div></div>
      : mappings.length === 0 ? <div className="card"><EmptyState title="No mappings found" description="Change the filters or run catalog discovery to create product mapping groups." /></div>
      : mappings.map((mapping) => <div className="card mapping-card" key={mapping.id}>
        <div className="mapping-summary">
          <div><div style={{ fontWeight: 680 }}>{mapping.shopify_title}</div><div className="muted" style={{ fontSize: 11.5 }}>{mapping.shopify_vendor} <span className="mono">/{mapping.shopify_handle}</span></div></div>
          <div><div className="secondary" style={{ fontSize: 12 }}>{mapping.brand_name ?? "Unassigned brand"}</div><div className="muted" style={{ fontSize: 11 }}>{mapping.styles.length} style{mapping.styles.length === 1 ? "" : "s"} · {mapping.match_source}</div></div>
          <StatusBadge status={mapping.match_status} />
          <div className="muted" style={{ fontSize: 11 }}>{formatDate(mapping.last_synced_at)}</div>
          <button className="icon-btn" style={{ justifySelf: "end", gridColumn: "-1" }} title={expanded === mapping.id ? "Close mapping editor" : "Edit mapping"} aria-label={expanded === mapping.id ? "Close mapping editor" : "Edit mapping"} onClick={() => setExpanded((current) => current === mapping.id ? null : mapping.id)}>{expanded === mapping.id ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</button>
        </div>
        {expanded === mapping.id ? <MappingEditor mapping={mapping} brands={brands} onSaved={(saved) => { setMappings((current) => current.map((item) => item.id === saved.id ? saved : item)); setExpanded(null); }} /> : null}
      </div>)}
      <div className="pagination"><span className="muted">{total.toLocaleString()} mapping groups</span><div className="row"><button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span className="mono muted">{page} / {pages}</span><button className="btn btn-sm" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
    </div>
  );
}
