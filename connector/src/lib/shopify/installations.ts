import type { Pool } from "pg";

import { connectorDb } from "@/lib/db";
import { env, type Env } from "@/lib/env";

import { normalizeShopDomain } from "./constants";
import { decryptAccessToken, encryptAccessToken } from "./crypto";

interface InstallationRow {
  shop_domain: string;
  encrypted_access_token: string;
  granted_scopes: string;
}

export interface ShopifyCredentials {
  shopDomain: string;
  accessToken: string;
  source: "oauth" | "environment";
  grantedScopes?: string;
}

export async function saveOfflineInstallation(
  shopDomain: string,
  accessToken: string,
  grantedScopes: string,
  options: { database?: Pick<Pool, "query">; encryptionKey?: string } = {},
): Promise<void> {
  const key = options.encryptionKey ?? env().TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY is required to store a Shopify OAuth token");
  const database = options.database ?? connectorDb();
  const shop = normalizeShopDomain(shopDomain);
  await database.query(
    `INSERT INTO shopify_installations
       (shop_domain, encrypted_access_token, granted_scopes)
     VALUES ($1, $2, $3)
     ON CONFLICT (shop_domain) DO UPDATE SET
       encrypted_access_token = EXCLUDED.encrypted_access_token,
       granted_scopes = EXCLUDED.granted_scopes,
       updated_at = now()`,
    [shop, encryptAccessToken(accessToken, key), grantedScopes],
  );
}

export async function loadShopifyCredentials(
  options: { database?: Pick<Pool, "query">; config?: Env } = {},
): Promise<ShopifyCredentials> {
  const config = options.config ?? env();
  const shop = normalizeShopDomain(config.SHOPIFY_SHOP_DOMAIN);
  const database = options.database ?? connectorDb();
  const result = await database.query<InstallationRow>(
    `SELECT shop_domain, encrypted_access_token, granted_scopes
       FROM shopify_installations
      WHERE shop_domain = $1`,
    [shop],
  );
  const installation = result.rows[0];
  if (installation) {
    if (!config.TOKEN_ENCRYPTION_KEY) {
      throw new Error("TOKEN_ENCRYPTION_KEY is required to decrypt the Shopify OAuth token");
    }
    return {
      shopDomain: installation.shop_domain,
      accessToken: decryptAccessToken(installation.encrypted_access_token, config.TOKEN_ENCRYPTION_KEY),
      grantedScopes: installation.granted_scopes,
      source: "oauth",
    };
  }
  if (config.SHOPIFY_ADMIN_TOKEN) {
    return { shopDomain: shop, accessToken: config.SHOPIFY_ADMIN_TOKEN, source: "environment" };
  }
  throw new Error(`Shopify is not installed for ${shop} and SHOPIFY_ADMIN_TOKEN is not configured`);
}
