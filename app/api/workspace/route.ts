// Cloud workspace API — the server side of cross-device sync, backed by the
// Vercel Blob store "rfc-projects" (private). One blob per workspace holds
// the whole library (compacted project bodies + tombstones + price catalog).
//
// Auth is capability-style: the client sends its sync passphrase in
// x-workspace-key; the SHA-256 of it becomes the blob path. No key, no data —
// and the key itself is never stored server-side. Anyone with the passphrase
// is "in the workspace" (that's the sharing model, like a private link).

import { sessionFrom, workspacePath } from "@/lib/server/auth";
import { get, put } from "@vercel/blob";
import { createHash } from "node:crypto";

export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024; // whole-library payload cap (~1000 compact projects)

/** Signed-in accounts resolve to ws2/<workspaceId>; the original passphrase
 * header keeps working (ws/<sha256>) so pre-account workspaces don't strand. */
function libraryPath(req: Request): string | null {
  const session = sessionFrom(req);
  if (session) return workspacePath(session.ws);
  const k = req.headers.get("x-workspace-key")?.trim();
  if (k && k.length >= 6) {
    const h = createHash("sha256").update(`rfc-estimator:${k}`).digest("hex");
    return `ws/${h}/library.json`;
  }
  return null;
}

export async function GET(req: Request) {
  const path = libraryPath(req);
  if (!path) return Response.json({ error: "sign in required" }, { status: 401 });
  try {
    const res = await get(path, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) {
      // New workspace — nothing synced yet.
      return Response.json(null);
    }
    return new Response(res.stream, { headers: { "content-type": "application/json" } });
  } catch (err) {
    return Response.json({ error: `blob read failed: ${(err as Error).message}` }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  const path = libraryPath(req);
  if (!path) return Response.json({ error: "sign in required" }, { status: 401 });
  const body = await req.text();
  if (body.length > MAX_BYTES) return Response.json({ error: "library too large" }, { status: 413 });
  try {
    JSON.parse(body);
  } catch {
    return Response.json({ error: "payload is not JSON" }, { status: 400 });
  }
  try {
    await put(path, body, {
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/json",
      cacheControlMaxAge: 0,
    });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: `blob write failed: ${(err as Error).message}` }, { status: 502 });
  }
}
