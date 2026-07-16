import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function decodeKey(value: string): Buffer {
  const key = /^[a-fA-F0-9]{64}$/.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes");
  return key;
}

export function encryptAccessToken(token: string, encryptionKey: string): string {
  if (!token) throw new Error("Cannot encrypt an empty Shopify access token");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", decodeKey(encryptionKey), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptAccessToken(payload: string, encryptionKey: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext, extra] = payload.split(":");
  if (version !== VERSION || !encodedIv || !encodedTag || !encodedCiphertext || extra) {
    throw new Error("Unsupported encrypted Shopify access token format");
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      decodeKey(encryptionKey),
      Buffer.from(encodedIv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    throw new Error("Unable to decrypt Shopify access token", { cause: error });
  }
}
