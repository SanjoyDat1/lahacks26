import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const SALT = "brian-google-oauth-v1";

export type GoogleTokenPayload = {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  email?: string;
};

function keyFromSecret(secret: string) {
  return scryptSync(secret, SALT, 32);
}

export function encryptGooglePayload(payload: GoogleTokenPayload, secret: string): string {
  const key = keyFromSecret(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptGooglePayload(b64: string, secret: string): GoogleTokenPayload | null {
  try {
    const buf = Buffer.from(b64, "base64url");
    if (buf.length < 28) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const key = keyFromSecret(secret);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return JSON.parse(json) as GoogleTokenPayload;
  } catch {
    return null;
  }
}
