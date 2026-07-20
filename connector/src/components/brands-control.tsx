"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Save, Search } from "lucide-react";

import { SyncLauncher } from "@/components/sync-launcher";
import { apiJson, EmptyState, useToast } from "@/components/ui";

type Brand = {
  id: string; brand_slug: string; brand_name: string; shopify_vendor: string; enabled: boolean;
  max_display_cap: number | null; show_future_inventory: boolean;
  product_count: number; ready_count: number; unmatched_count: number;
};

export function BrandsControl() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [caps, setCaps] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const data = await apiJson<{ brands: Brand[] }>("/api/brands");
      setBrands(data.brands);
      setCaps(Object.fromEntries(data.brands.map((brand) => [brand.id, brand.max_display_cap === null ? "" : String(brand.max_display_cap)])));
    } catch (error) { toast(error instanceof Error ? error.message : "Unable to load brands", "error"); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  async function update(id: string, changes: { enabled?: boolean; maxDisplayCap?: number | null; showFutureInventory?: boolean }) {
    setSaving(id);
    try {
      const data = await apiJson<{ brand: Partial<Brand> }>(`/api/brands/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes),
      });
      setBrands((current) => current.map((brand) => brand.id === id ? { ...brand, ...data.brand } : brand));
      toast("Brand controls saved");
    } catch (error) { toast(error instanceof Error ? error.message : "Unable to save brand", "error"); }
    finally { setSaving(null); }
  }

  const visible = brands.filter((brand) => `${brand.brand_name} ${brand.shopify_vendor} ${brand.brand_slug}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="stack">
      <div className="spread">
        <div className="search-wrap"><Search size={15} /><input className="input" placeholder="Search brands or Shopify vendors" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <span className="badge badge-accent">{brands.filter((brand) => brand.enabled).length} enabled</span>
      </div>
      <div className="card">
        {loading ? <div className="empty-state"><LoaderCircle className="spinner muted" size={22} /><div className="empty-desc">Loading brands</div></div>
        : visible.length === 0 ? <EmptyState title="No brands found" description="Change the search term or populate brands through catalog discovery." />
        : <div className="table-wrap"><table className="data-table"><thead><tr><th>Brand</th><th>Coverage</th><th>Display cap</th><th>Future dates</th><th>Enabled</th><th>Actions</th></tr></thead><tbody>
          {visible.map((brand) => {
            const readyPercent = brand.product_count ? Math.round((brand.ready_count / brand.product_count) * 100) : 0;
            return <tr key={brand.id}>
              <td><div style={{ fontWeight: 650 }}>{brand.brand_name}</div><div className="muted" style={{ fontSize: 11.5 }}>{brand.shopify_vendor} <span className="mono">/{brand.brand_slug}</span></div></td>
              <td style={{ minWidth: 170 }}><div className="spread" style={{ marginBottom: 5 }}><span className="muted" style={{ fontSize: 11 }}>{brand.ready_count}/{brand.product_count} ready</span><span className="mono muted">{readyPercent}%</span></div><div className="progress-track"><div className="progress-fill" style={{ width: `${readyPercent}%` }} /></div>{brand.unmatched_count > 0 ? <div style={{ color: "var(--warning)", fontSize: 11, marginTop: 4 }}>{brand.unmatched_count} need review</div> : null}</td>
              <td style={{ width: 170 }}><div className="row"><input className="input" style={{ minWidth: 90 }} type="number" min="0" placeholder="Default" value={caps[brand.id] ?? ""} onChange={(event) => setCaps((current) => ({ ...current, [brand.id]: event.target.value }))} /><button className="icon-btn" title="Save display cap" aria-label={`Save cap for ${brand.brand_name}`} disabled={saving === brand.id} onClick={() => update(brand.id, { maxDisplayCap: caps[brand.id] === "" ? null : Math.max(0, Number.parseInt(caps[brand.id], 10) || 0) })}>{saving === brand.id ? <LoaderCircle className="spinner" size={15} /> : <Save size={15} />}</button></div><div className="field-help">Blank uses global default</div></td>
              <td><button className={`toggle ${brand.show_future_inventory ? "on" : ""}`} role="switch" aria-checked={brand.show_future_inventory} aria-label={`${brand.show_future_inventory ? "Hide" : "Show"} future restock dates for ${brand.brand_name}`} disabled={saving === brand.id} onClick={() => update(brand.id, { showFutureInventory: !brand.show_future_inventory })} /><div className="field-help">Off = ATS only</div></td>
              <td><button className={`toggle ${brand.enabled ? "on" : ""}`} role="switch" aria-checked={brand.enabled} aria-label={`${brand.enabled ? "Disable" : "Enable"} ${brand.brand_name}`} disabled={saving === brand.id} onClick={() => update(brand.id, { enabled: !brand.enabled })} /></td>
              <td><SyncLauncher brandIds={[Number(brand.id)]} compact /></td>
            </tr>;
          })}
        </tbody></table></div>}
      </div>
    </div>
  );
}
