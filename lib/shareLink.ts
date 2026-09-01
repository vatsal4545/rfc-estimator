// Share-by-link: the whole project rides in the URL fragment, gzip-compressed
// and base64url-encoded (#p=...). No backend — anyone opening the link gets
// the project imported into their own browser library as an editable copy.
// The fragment never reaches the server (it stays client-side by design), and
// a ~50 KB project compresses to a ~10-15 KB fragment, well inside what
// browsers accept.

import type { Project } from "./calc/types";

export const SHARE_HASH_PREFIX = "#p=";

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Encode a project as a URL fragment value ("#p=" + return value). */
export async function encodeProjectForShare(project: Project): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(project));
  const gz = await pipe(json, new CompressionStream("gzip"));
  return bytesToBase64Url(gz);
}

/** Decode "#p=..." (pass the full location.hash). Returns null when the hash
 * isn't a share link; throws on a corrupt one. */
export async function decodeSharedProject(hash: string): Promise<Project | null> {
  if (!hash.startsWith(SHARE_HASH_PREFIX)) return null;
  const gz = base64UrlToBytes(hash.slice(SHARE_HASH_PREFIX.length));
  const json = await pipe(gz, new DecompressionStream("gzip"));
  return JSON.parse(new TextDecoder().decode(json)) as Project;
}

/** Build the full shareable URL for the current page. */
export async function buildShareUrl(project: Project): Promise<string> {
  const data = await encodeProjectForShare(project);
  const base = `${location.origin}${location.pathname}`;
  return `${base}${SHARE_HASH_PREFIX}${data}`;
}
