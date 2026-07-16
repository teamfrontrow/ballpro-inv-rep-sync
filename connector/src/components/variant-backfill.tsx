"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, Plus, Search } from "lucide-react";

import { apiJson, EmptyState, useToast } from "@/components/ui";
import type { VariantBackfillPreview } from "@/lib/variants";

type Mapping = {
  id: string;
  shopify_product_gid: string;
  shopify_handle: string;
  shopify_title: string;
  shopify_vendor: string;
  brand_name: string | null;
  styles: string[];
};

export function VariantBackfill() {
  const [query, setQuery] = useState("");
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [productGid, setProductGid] = useState("");
  const [preview, setPreview] = useState<VariantBackfillPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loadingMappings, setLoadingMappings] = useState(true);
  const [working, setWorking] = useState<"preview" | "apply" | null>(null);
  const toast = useToast();

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      setLoadingMappings(true);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        const data = await apiJson<{ mappings: Mapping[] }>(`/api/variants?${params}`);
        setMappings(data.mappings);
      } catch (error) {
        toast(error instanceof Error ? error.message : "Unable to load mapped products", "error");
      } finally {
        setLoadingMappings(false);
      }
    }, query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [query, toast]);

  function selectMapping(gid: string) {
    setProductGid(gid);
    setPreview(null);
    setConfirmed(false);
  }

  async function previewProduct() {
    setWorking("preview");
    setPreview(null);
    setConfirmed(false);
    try {
      const data = await apiJson<{ preview: VariantBackfillPreview }>("/api/variants/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productGid }),
      });
      setPreview(data.preview);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to preview additions", "error");
    } finally {
      setWorking(null);
    }
  }

  async function applyAdditions() {
    if (!preview || !confirmed) return;
    setWorking("apply");
    try {
      const result = await apiJson<{ created: number }>("/api/variants/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productGid: preview.product.gid, signature: preview.signature, confirmed: true }),
      });
      toast(`${result.created} variant${result.created === 1 ? "" : "s"} added`);
      setPreview(null);
      setConfirmed(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Unable to apply additions", "error");
      setConfirmed(false);
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="stack">
      <section className="card card-pad stack">
        <div className="form-grid">
          <div>
            <label className="label" htmlFor="variant-product-search">Product mapping search</label>
            <div className="search-wrap"><Search size={15} /><input id="variant-product-search" className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, handle, vendor, GID, or style" /></div>
          </div>
          <div>
            <label className="label" htmlFor="variant-product">Mapped Shopify product</label>
            <select id="variant-product" className="select" value={productGid} disabled={loadingMappings} onChange={(event) => selectMapping(event.target.value)}>
              <option value="">{loadingMappings ? "Loading mapped products..." : "Select one product"}</option>
              {mappings.map((mapping) => <option key={mapping.id} value={mapping.shopify_product_gid}>{mapping.shopify_title} - {mapping.shopify_vendor} - {mapping.styles.join(", ")}</option>)}
            </select>
          </div>
        </div>
        <div className="spread">
          <p className="field-help mono" style={{ margin: 0, overflowWrap: "anywhere" }}>{productGid || "No Shopify product selected"}</p>
          <button className="btn btn-primary" disabled={!productGid || working !== null} onClick={previewProduct}>{working === "preview" ? <LoaderCircle className="spinner" size={15} /> : <Search size={15} />}Preview</button>
        </div>
      </section>

      {!preview ? <section className="card"><EmptyState title="No active preview" description="Select one mapped product and preview the additive variant diff before applying." /></section> : <>
        <section className="stats-grid">
          <div className="card stat-card"><div className="stat-icon"><CheckCircle2 size={18} /></div><div><div className="stat-value">{preview.existingCount}</div><div className="stat-label">Existing</div></div><div className="stat-sub">Preserved unchanged</div></div>
          <div className="card stat-card"><div className="stat-icon"><Plus size={18} /></div><div><div className="stat-value">{preview.additions.length}</div><div className="stat-label">Additions</div></div><div className="stat-sub">Color and Size pairs</div></div>
          <div className="card stat-card"><div className="stat-icon"><AlertTriangle size={18} /></div><div><div className="stat-value">{preview.warnings.length + preview.blockingReasons.length}</div><div className="stat-label">Warnings</div></div><div className="stat-sub">{preview.canApply ? "Review before applying" : "Write blocked"}</div></div>
          <div className="card stat-card"><div className="stat-icon"><Search size={18} /></div><div><div className="stat-value">{preview.source.rowCount}</div><div className="stat-label">Source rows</div></div><div className="stat-sub">Mapped RepSpark styles only</div></div>
        </section>

        <section className="card">
          <div className="card-header"><div><h2 className="section-title">{preview.product.title}</h2><p className="section-desc">{preview.product.vendor} /{preview.product.handle} | Options: {preview.product.options.join(", ")}</p></div><span className={`badge ${preview.canApply ? "badge-good" : "badge-bad"}`}>{preview.canApply ? "Ready" : "Blocked"}</span></div>
          {(preview.blockingReasons.length > 0 || preview.warnings.length > 0) ? <div className="card-body stack">
            {preview.blockingReasons.map((reason) => <div className="error-box" key={reason}><AlertTriangle size={15} style={{ marginRight: 7, verticalAlign: "text-bottom" }} />{reason}</div>)}
            {preview.warnings.map((warning) => <div key={warning} style={{ padding: "11px 13px", border: "1px solid var(--border)", borderRadius: 7, background: "var(--warning-soft)", color: "var(--warning)", fontSize: 12.5 }}>{warning}</div>)}
          </div> : null}
          <div className="table-wrap">
            <table className="data-table"><thead><tr><th>Color</th><th>Size</th><th>SKU</th><th>Inventory behavior</th></tr></thead><tbody>
              {preview.additions.map((addition, index) => {
                const options = Object.fromEntries(addition.optionValues.map((option) => [option.optionName.toLowerCase(), option.name]));
                return <tr key={`${options.color}-${options.size}-${index}`}><td>{options.color}</td><td>{options.size}</td><td className="mono">{addition.sku || <span className="muted">Blank</span>}</td><td><span className="badge">Untracked / Continue</span></td></tr>;
              })}
              {preview.additions.length === 0 ? <tr><td colSpan={4} className="muted" style={{ textAlign: "center" }}>No missing source-backed combinations.</td></tr> : null}
            </tbody></table>
          </div>
          <div className="card-body stack" style={{ borderTop: "1px solid var(--border)" }}>
            <label className="row" style={{ alignItems: "flex-start", cursor: preview.canApply ? "pointer" : "not-allowed" }}>
              <input type="checkbox" checked={confirmed} disabled={!preview.canApply || working !== null} onChange={(event) => setConfirmed(event.target.checked)} style={{ marginTop: 3 }} />
              <span>I confirm this exact one-product preview. Only the listed variants will be added; existing variants, options, and media remain unchanged.</span>
            </label>
            <div><button className="btn btn-primary" disabled={!preview.canApply || !confirmed || working !== null} onClick={applyAdditions}>{working === "apply" ? <LoaderCircle className="spinner" size={15} /> : <Plus size={15} />}Apply additions</button></div>
          </div>
        </section>
      </>}
    </div>
  );
}

