// Server-only auth helpers for the traditional sign-in (username + password).
// Simple but sound: scrypt password hashes, HMAC-signed session tokens, one
// user record per account stored as a private blob. No auth provider, no
// cookies, no session table — the token itself proves who you are.
//
//   users/<sha256(usernameLower)>.json  -> UserRecord
//   ws2/<workspaceId>/library.json      -> that account's project library
//
// The workspaceId is random and independent of the password, so password
// changes/resets never move data.

import { get, put } from "@vercel/blob";
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

export interface UserRecord {
  username: string; // as typed at registration (display)
  email: string;
  salt: string;
  passwordHash: string;
  workspaceId: string;
  createdAt: number;
  /** Pending password reset, when requested. */
  reset?: { codeHash: string; expiresAt: number };
}

const SESSION_DAYS = 90;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not configured");
  return s;
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function userPath(username: string): string {
  const h = createHash("sha256").update(`rfc-user:${normalizeUsername(username)}`).digest("hex");
  return `users/${h}.json`;
}

export function workspacePath(workspaceId: string): string {
  return `ws2/${workspaceId}/library.json`;
}

// ---- passwords --------------------------------------------------------------

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")): { salt: string; passwordHash: string } {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, passwordHash: hash };
}

export function verifyPassword(password: string, salt: string, passwordHash: string): boolean {
  const candidate = scryptSync(password, salt, 64);
  const stored = Buffer.from(passwordHash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

// ---- session tokens ---------------------------------------------------------

interface SessionPayload {
  u: string; // username (normalized)
  ws: string; // workspaceId
  exp: number;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export function signSession(username: string, workspaceId: string): string {
  const payload: SessionPayload = {
    u: normalizeUsername(username),
    ws: workspaceId,
    exp: Date.now() + SESSION_DAYS * 24 * 3600 * 1000,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySession(token: string | null | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (!payload.u || !payload.ws || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionFrom(req: Request): SessionPayload | null {
  const auth = req.headers.get("authorization");
  return verifySession(auth?.startsWith("Bearer ") ? auth.slice(7) : null);
}

// ---- user records (blob-backed) ---------------------------------------------

export async function readUser(username: string): Promise<UserRecord | null> {
  const res = await get(userPath(username), { access: "private", useCache: false });
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  return JSON.parse(await new Response(res.stream).text()) as UserRecord;
}

export async function writeUser(user: UserRecord): Promise<void> {
  await put(userPath(user.username), JSON.stringify(user), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 0,
  });
}

// ---- password reset ---------------------------------------------------------

export function newResetCode(): { code: string; codeHash: string; expiresAt: number } {
  const code = randomBytes(4).readUInt32BE(0).toString().padStart(8, "0").slice(-8);
  return {
    code,
    codeHash: createHash("sha256").update(code).digest("hex"),
    expiresAt: Date.now() + 30 * 60 * 1000,
  };
}

export function verifyResetCode(user: UserRecord, code: string): boolean {
  if (!user.reset || user.reset.expiresAt < Date.now()) return false;
  const given = createHash("sha256").update(code.trim()).digest();
  const stored = Buffer.from(user.reset.codeHash, "hex");
  return given.length === stored.length && timingSafeEqual(given, stored);
}

/** Send the reset code via Resend when RESEND_API_KEY is configured.
 * Returns false when email isn't set up (caller reports that to the user). */
export async function sendResetEmail(to: string, username: string, code: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const from = process.env.RESET_EMAIL_FROM ?? "RFC Estimator <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      subject: "RFC Estimator password reset",
      text: `Hi ${username},\n\nYour password reset code is: ${code}\n\nIt expires in 30 minutes. Enter it on the sign-in panel ("Forgot password?") together with your new password.\n\nIf you didn't request this, you can ignore this email.`,
    }),
  });
  return res.ok;
}

export { randomUUID };
