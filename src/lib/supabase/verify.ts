import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Checks a Supabase access token on this server, without a network call to the auth service.
 * Self-hosted Supabase signs tokens with the shared JWT secret (HS256). Returns the user id,
 * or null when the token is missing, forged or expired.
 */
export function verifyAccessToken(token: string | undefined, secret: string): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    if (header.alg !== "HS256") return null;
    const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
    const given = Buffer.from(parts[2], "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
