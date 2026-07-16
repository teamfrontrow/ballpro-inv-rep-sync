export const MATCH_STATUSES = ["auto", "manual", "partial", "unmatched", "ignored"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const SYNC_KINDS = ["one_time", "scheduled", "manual_single"] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];

export const SYNC_STATUSES = ["queued", "running", "completed", "failed"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const SYNC_ITEM_STATUSES = ["written", "unchanged", "skipped", "failed"] as const;
export type SyncItemStatus = (typeof SYNC_ITEM_STATUSES)[number];

export interface InventoryFutureQuantity {
  date: string;
  qty: number;
  capped?: true;
}

export interface InventorySize {
  size: string;
  current: number;
  capped?: true;
  future?: InventoryFutureQuantity[];
}

export interface InventoryColor {
  color: string;
  color_code?: string;
  sizes: InventorySize[];
}

export interface InventoryPayload {
  schema: 1;
  styles: string[];
  brand: string;
  synced_at: string;
  cap: number | null;
  size_order: string[];
  dates: string[];
  colors: InventoryColor[];
}

export interface RunSyncInput {
  kind: SyncKind;
  brandIds?: number[];
  productGids?: string[];
  dryRun?: boolean;
}
