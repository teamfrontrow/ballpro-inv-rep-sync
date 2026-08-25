import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectorQuery: vi.fn(),
  transaction: vi.fn(),
  transactionQuery: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  connectorDb: () => ({ query: mocks.connectorQuery }),
  transaction: mocks.transaction,
}));

import { PATCH } from "./route";
import { GET } from "../route";

function patchRequest(body: unknown): NextRequest {
  return new NextRequest("https://connector.example/api/brands/42", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const updatedBrand = {
  id: "42",
  brand_slug: "columbia",
  brand_name: "Columbia",
  shopify_vendor: "Columbia",
  enabled: true,
  max_display_cap: null,
  max_source_age_days: 9,
  show_future_inventory: true,
  updated_at: "2026-08-25T12:00:00.000Z",
};

describe("brands API max source age", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (client: { query: typeof mocks.transactionQuery }) => unknown) => (
      callback({ query: mocks.transactionQuery })
    ));
  });

  it("maps a valid per-brand age into the update query and response", async () => {
    mocks.transactionQuery
      .mockResolvedValueOnce({ rows: [updatedBrand] })
      .mockResolvedValueOnce({ rows: [{ shopify_vendor: "Columbia" }] });

    const response = await PATCH(patchRequest({ maxSourceAgeDays: 9 }), {
      params: Promise.resolve({ id: "42" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      brand: { ...updatedBrand, shopify_vendors: ["Columbia"] },
    });
    expect(mocks.transactionQuery).toHaveBeenCalledTimes(2);
    const [sql, values] = mocks.transactionQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("max_source_age_days = $2");
    expect(sql).toContain("max_source_age_days, show_future_inventory");
    expect(values).toEqual([42, 9]);
  });

  it("accepts zero and null so an operator can set a strict gate or restore the default", async () => {
    mocks.transactionQuery
      .mockResolvedValueOnce({ rows: [{ ...updatedBrand, max_source_age_days: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const zeroResponse = await PATCH(patchRequest({ maxSourceAgeDays: 0 }), {
      params: Promise.resolve({ id: "42" }),
    });
    expect(zeroResponse.status).toBe(200);
    expect((mocks.transactionQuery.mock.calls[0] as [string, unknown[]])[1]).toEqual([42, 0]);

    mocks.transactionQuery.mockReset();
    mocks.transactionQuery
      .mockResolvedValueOnce({ rows: [updatedBrand] })
      .mockResolvedValueOnce({ rows: [] });
    const nullResponse = await PATCH(patchRequest({ maxSourceAgeDays: null }), {
      params: Promise.resolve({ id: "42" }),
    });
    expect(nullResponse.status).toBe(200);
    expect((mocks.transactionQuery.mock.calls[0] as [string, unknown[]])[1]).toEqual([42, null]);
  });

  it.each([
    { body: { maxSourceAgeDays: -1 }, message: "Number must be greater than or equal to 0" },
    { body: { maxSourceAgeDays: 1.5 }, message: "Expected integer, received float" },
    { body: {}, message: "No changes supplied" },
  ])("rejects invalid update %#", async ({ body, message }) => {
    const response = await PATCH(patchRequest(body), {
      params: Promise.resolve({ id: "42" }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(message);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("includes max_source_age_days in the brands list projection", async () => {
    mocks.connectorQuery.mockResolvedValueOnce({ rows: [{ ...updatedBrand, shopify_vendors: ["Columbia"] }] });

    const response = await GET();

    expect(response.status).toBe(200);
    expect((await response.json()).brands).toEqual([{ ...updatedBrand, shopify_vendors: ["Columbia"] }]);
    expect(mocks.connectorQuery).toHaveBeenCalledOnce();
    expect((mocks.connectorQuery.mock.calls[0] as [string])[0]).toContain("b.max_display_cap, b.max_source_age_days");
  });
});
