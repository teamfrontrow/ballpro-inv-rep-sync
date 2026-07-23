"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";

import { apiJson, formatDate, useToast } from "@/components/ui";
import type { InventoryColor, InventoryPayload } from "@/lib/domain";

type MappingHit = { id: string; shopify_title: string; shopify_vendor: string; shopify_handle: string; brand_name: string | null };

type VerifyResult = {
  product: { mappingId: number; shopifyProductGid: string; shopifyTitle: string; shopifyHandle: string; shopifyVendor: string; brandName: string | null; brandEnabled: boolean; lastSyncedAt: string | null };
  styles: string[];
  cap: number | null;
  verdict: "in_sync" | "out_of_date" | "missing_in_shopify" | "tombstoned" | "no_source_data";
  expected: InventoryPayload | null;
  actual: InventoryPayload | null;
  actualUpdatedAt: string | null;
  sourceIssues: string[];
};

const VERDICTS: Record<VerifyResult["verdict"], { label: string; cls: string }> = {
  in_sync: { label: "In sync", cls: "badge-good" },
  out_of_date: { label: "Out of date — Shopify differs from RepSpark", cls: "badge-warn" },
  missing_in_shopify: { label: "Not in Shopify yet — needs a sync", cls: "badge-warn" },
  tombstoned: { label: "Tombstoned (marked unavailable in Shopify)", cls: "badge-warn" },
  no_source_data: { label: "No publishable RepSpark data", cls: "" },
};

type Cell = { current: number; capped: boolean; future: Map<string, number> };
// Flatten a payload to color -> size -> cell for cross-comparison.
function flatten(payload: InventoryPayload | null): Map<string, Map<string, Cell>> {
  const out = new Map<string, Map<string, Cell>>();
  if (!payload) return out;
  for (const color of payload.colors as InventoryColor[]) {
    const sizes = new Map<string, Cell>();
    for (const size of color.sizes) {
      const future = new Map<string, number>();
      for (const f of size.future ?? []) future.set(f.date, f.qty);
      sizes.set(size.size, { current: size.current, capped: !!size.capped, future });
    }
    out.set(color.color, sizes);
  }
  return out;
}

function fmtCell(cell: Cell | undefined): string {
  if (!cell) return "—";
  return `${cell.current}${cell.capped ? "+" : ""}`;
}

export function VerifyControl() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MappingHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (term: string) => {
    if (!term.trim()) { setHits([]); return; }
    setSearching(true);
    try {
      const data = await apiJson<{ mappings: MappingHit[] }>(`/api/mappings?q=${encodeURIComponent(term)}&limit=20`);
      setHits(data.mappings);
    } catch (error) { toast(error instanceof Error ? error.message : "Search failed", "error"); }
    finally { setSearching(false); }
  }, [toast]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(query), 300);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query, search]);

  async function inspect(id: string) {
    setLoading(true);
    setResult(null);
    try {
      const data = await apiJson<{ result: VerifyResult }>(`/api/verify?mappingId=${id}`);
      setResult(data.result);
      setHits([]);
    } catch (error) { toast(error instanceof Error ? error.message : "Verification failed", "error"); }
    finally { setLoading(false); }
  }

  const expected = flatten(result?.expected ?? null);
  const actual = flatten(result?.actual ?? null);
  const colorNames = [...new Set([...expected.keys(), ...actual.keys()])].sort();

  return (
    <div className="stack">
      <div className="card">
        <div className="card-header"><div><h2 className="section-title">Find a product</h2><p className="section-desc">Search by Shopify title, handle, vendor, or SKU, then pick a product to compare RepSpark against Shopify.</p></div></div>
        <div className="card-body stack">
          <div className="search-wrap"><Search size={15} /><input className="input" placeholder="Search products…" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />{searching && <LoaderCircle className="spinner muted" size={15} />}</div>
          {hits.length > 0 && (
            <div className="table-wrap"><table className="data-table"><tbody>
              {hits.map((hit) => (
                <tr key={hit.id} style={{ cursor: "pointer" }} onClick={() => inspect(hit.id)}>
                  <td><div style={{ fontWeight: 650 }}>{hit.shopify_title}</div><div className="muted" style={{ fontSize: 11 }}>{hit.shopify_vendor}{hit.brand_name ? ` · ${hit.brand_name}` : ""} <span className="mono">/{hit.shopify_handle}</span></div></td>
                </tr>
              ))}
            </tbody></table></div>
          )}
        </div>
      </div>

      {loading && <div className="card"><div className="empty-state"><LoaderCircle className="spinner muted" size={22} /><div className="empty-desc">Reading RepSpark and Shopify…</div></div></div>}

      {result && !loading && (
        <div className="card">
          <div className="card-header">
            <div><h2 className="section-title">{result.product.shopifyTitle}</h2><p className="section-desc">{result.product.shopifyVendor}{result.product.brandName ? ` · ${result.product.brandName}` : " · no RepSpark brand"} · styles {result.styles.join(", ") || "none"}{result.cap !== null ? ` · cap ${result.cap}` : ""}</p></div>
            <span className={`badge ${VERDICTS[result.verdict].cls}`}>{VERDICTS[result.verdict].label}</span>
          </div>
          <div className="card-body stack">
            <div className="muted" style={{ fontSize: 12 }}>
              Last synced {result.product.lastSyncedAt ? formatDate(result.product.lastSyncedAt) : "never"} · Shopify metafield updated {result.actualUpdatedAt ? formatDate(result.actualUpdatedAt) : "—"}
              {!result.product.brandEnabled && result.product.brandName ? " · brand disabled" : ""}
            </div>
            {result.sourceIssues.length > 0 && <div className="notice notice-warning">{result.sourceIssues.join(" · ")}</div>}
            <p className="field-help">RepSpark column shows the latest scraped inventory with the brand&apos;s display cap and future rules applied — i.e. exactly what a sync would publish. Highlighted cells differ from Shopify.</p>
            {colorNames.length === 0 ? <div className="secondary">No inventory on either side.</div> : colorNames.map((color) => {
              const eSizes = expected.get(color) ?? new Map<string, Cell>();
              const aSizes = actual.get(color) ?? new Map<string, Cell>();
              const sizeNames = [...new Set([...eSizes.keys(), ...aSizes.keys()])];
              return (
                <div key={color} className="stack" style={{ gap: 6 }}>
                  <div style={{ fontWeight: 650 }}>{color}</div>
                  <div className="table-wrap"><table className="data-table"><thead><tr><th>Size</th><th>RepSpark</th><th>Shopify</th><th>Future (RepSpark → Shopify)</th></tr></thead><tbody>
                    {sizeNames.map((size) => {
                      const e = eSizes.get(size);
                      const a = aSizes.get(size);
                      const currentMismatch = fmtCell(e) !== fmtCell(a);
                      const futureDates = [...new Set([...(e?.future.keys() ?? []), ...(a?.future.keys() ?? [])])].sort();
                      return (
                        <tr key={size}>
                          <td className="mono">{size}</td>
                          <td style={currentMismatch ? { background: "var(--warning-soft, rgba(220,160,0,.12))", fontWeight: 650 } : undefined}>{fmtCell(e)}</td>
                          <td style={currentMismatch ? { background: "var(--warning-soft, rgba(220,160,0,.12))", fontWeight: 650 } : undefined}>{fmtCell(a)}</td>
                          <td className="mono muted" style={{ fontSize: 11 }}>{futureDates.length === 0 ? "—" : futureDates.map((date) => {
                            const ev = e?.future.get(date); const av = a?.future.get(date);
                            const diff = ev !== av;
                            return <span key={date} style={{ marginRight: 10, color: diff ? "var(--warning)" : undefined, fontWeight: diff ? 650 : undefined }}>{date}: {ev ?? "—"}→{av ?? "—"}</span>;
                          })}</td>
                        </tr>
                      );
                    })}
                  </tbody></table></div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
