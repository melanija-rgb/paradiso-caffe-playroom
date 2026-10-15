import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const UNCONFIGURED_MESSAGE = "Prijava trenutno nije podešena.";

export { UNCONFIGURED_MESSAGE };

function readEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value : "";
}

export function isAdminPasswordConfigured() {
  return readEnv("ADMIN_PASSWORD").trim().length > 0;
}

export function getSigningSecret() {
  const explicit = readEnv("ADMIN_SECRET");
  if (explicit.trim()) return explicit;
  const password = readEnv("ADMIN_PASSWORD");
  if (!password.trim()) return null;
  return createHash("sha256")
    .update(`paradiso-admin-v1::${password}`)
    .digest("hex");
}

// Hash both sides so the comparison is fixed-length and constant-time.
export function passwordsMatch(submitted, expected) {
  const left = createHash("sha256")
    .update(String(submitted ?? ""), "utf8")
    .digest();
  const right = createHash("sha256")
    .update(String(expected ?? ""), "utf8")
    .digest();
  return timingSafeEqual(left, right);
}

export function signAdminToken({ ttlMs = TOKEN_TTL_MS, now = Date.now() } = {}) {
  const secret = getSigningSecret();
  if (!secret || !isAdminPasswordConfigured()) return null;
  const payload = { sub: "admin", iat: now, exp: now + ttlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyAdminToken(token) {
  if (!isAdminPasswordConfigured()) return false;
  const secret = getSigningSecret();
  if (!secret || typeof token !== "string") return false;

  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return false;

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let actual;
  try {
    actual = Buffer.from(sig, "base64url");
  } catch {
    return false;
  }
  const expected = createHmac("sha256", secret).update(body).digest();
  if (actual.length !== expected.length) return false;
  if (!timingSafeEqual(actual, expected)) return false;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  if (!payload || payload.sub !== "admin" || typeof payload.exp !== "number") {
    return false;
  }
  return payload.exp > Date.now();
}
