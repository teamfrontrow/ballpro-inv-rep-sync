"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";

import { apiJson, useToast } from "@/components/ui";

type IgnoredVendor = { shopify_vendor: string; note: string | null; product_count: number; created_at: string };

export function IgnoredVendorsControl() {
  const [vendors, setVendors] = useState<IgnoredVendor[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const data = await apiJson<{ vendors: IgnoredVendor[] }>("/api/ignored-vendors");
      setVendors(data.vendors);
    } catch (error) { toast(error instanceof Error ? error.message : "Unable to load ignored vendors", "error"); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    const vendor = input.trim();
    if (!vendor) return;
    setBusy("__add");
    try {
      await apiJson("/api/ignored-vendors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendor }) });
      setInput("");
      toast(`Ignoring Shopify vendor "${vendor}"`);
      await load();
    } catch (error) { toast(error instanceof Error ? error.message : "Unable to add vendor", "error"); }
    finally { setBusy(null); }
  }

  async function remove(vendor: string) {
    setBusy(vendor);
    try {
      await apiJson("/api/ignored-vendors", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendor }) });
      toast(`No longer ignoring "${vendor}"`);
      await load();
    } catch (error) { toast(error instanceof Error ? error.message : "Unable to remove vendor", "error"); }
    finally { setBusy(null); }
  }

  return (
    <div className="card">
      <div className="card-header"><div><h2 className="section-title">Ignored Shopify vendors</h2><p className="section-desc">Products from these Shopify vendors are never synced and are excluded from run results. Use for house / Shopify-only vendors (e.g. Ball Pro) that have no RepSpark brand.</p></div>{!loading && <span className="badge">{vendors.length}</span>}</div>
      <div className="card-body stack">
        <div className="row" style={{ gap: 8 }}>
          <input className="input" placeholder="Exact Shopify vendor name (e.g. Ball Pro)" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") add(); }} />
          <button className="btn btn-primary" onClick={add} disabled={busy === "__add" || !input.trim()}>{busy === "__add" ? <LoaderCircle className="spinner" size={15} /> : <Plus size={15} />}Ignore vendor</button>
        </div>
        <p className="field-help">Match is exact and case-sensitive; it must equal the Shopify Vendor value shown in run results. Takes effect on the next sync.</p>
        {loading ? <div className="empty-state"><LoaderCircle className="spinner muted" size={20} /><div className="empty-desc">Loading</div></div>
        : vendors.length === 0 ? <div className="secondary">No ignored vendors. All Shopify vendors are eligible for matching.</div>
        : <div className="table-wrap"><table className="data-table"><thead><tr><th>Vendor</th><th>Products</th><th></th></tr></thead><tbody>
          {vendors.map((vendor) => <tr key={vendor.shopify_vendor}>
            <td style={{ fontWeight: 650 }}>{vendor.shopify_vendor}</td>
            <td className="mono muted">{vendor.product_count.toLocaleString()}</td>
            <td style={{ textAlign: "right" }}><button className="icon-btn" title={`Stop ignoring ${vendor.shopify_vendor}`} aria-label={`Stop ignoring ${vendor.shopify_vendor}`} disabled={busy === vendor.shopify_vendor} onClick={() => remove(vendor.shopify_vendor)}>{busy === vendor.shopify_vendor ? <LoaderCircle className="spinner" size={15} /> : <Trash2 size={15} />}</button></td>
          </tr>)}
        </tbody></table></div>}
      </div>
    </div>
  );
}
