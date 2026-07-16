import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));

const schema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  SHOPIFY_SHOP_DOMAIN: z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
  SHOPIFY_CLIENT_ID: z.string().optional(),
  SHOPIFY_CLIENT_SECRET: z.string().optional(),
  SHOPIFY_SCOPES: z.string().default("read_products,write_products"),
  SHOPIFY_API_VERSION: z.string().regex(/^\d{4}-\d{2}$/).default("2026-07"),
  SHOPIFY_ADMIN_TOKEN: z.string().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  CONNECTOR_DATABASE_URL: z.string().url(),
  REPSPARK_DATABASE_URL: optionalUrl,
  ADMIN_USERNAME: z.string().default("admin"),
  ADMIN_PASSWORD: z.string().optional(),
  SYNC_DEFAULT_CAP: z.coerce.number().int().nonnegative().default(500),
  FUTURE_HORIZON_DAYS: z.coerce.number().int().nonnegative().default(365),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}

export function resetEnvForTests(): void {
  cached = undefined;
}
