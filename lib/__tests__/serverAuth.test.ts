import { beforeAll, describe, expect, it } from "vitest";

// Pure crypto helpers only — the blob-backed readUser/writeUser need the
// store and are exercised end-to-end in the browser instead.
beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-not-for-production";
});

describe("server auth helpers", () => {
  it("hashes and verifies passwords (scrypt, salted)", async () => {
    const { hashPassword, verifyPassword } = await import("../server/auth");
    const { salt, passwordHash } = hashPassword("correct horse battery");
    expect(verifyPassword("correct horse battery", salt, passwordHash)).toBe(true);
    expect(verifyPassword("wrong password", salt, passwordHash)).toBe(false);
    // Same password, fresh salt -> different hash (no rainbow-table reuse).
    expect(hashPassword("correct horse battery").passwordHash).not.toBe(passwordHash);
  });

  it("signs and verifies session tokens; tampering breaks them", async () => {
    const { signSession, verifySession } = await import("../server/auth");
    const token = signSession("Vatsal", "ws-123");
    const payload = verifySession(token)!;
    expect(payload.u).toBe("vatsal"); // normalized
    expect(payload.ws).toBe("ws-123");
    expect(payload.exp).toBeGreaterThan(Date.now());

    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "vatsal", ws: "someone-elses-ws", exp: Date.now() + 1e9 })).toString("base64url");
    expect(verifySession(`${forged}.${sig}`)).toBeNull(); // signature no longer matches
    expect(verifySession(`${body}.AAAA${sig.slice(4)}`)).toBeNull();
    expect(verifySession("garbage")).toBeNull();
  });

  it("reset codes: correct code within expiry passes, wrong/expired fail", async () => {
    const { newResetCode, verifyResetCode } = await import("../server/auth");
    const user = { username: "u", email: "e@x.com", salt: "", passwordHash: "", workspaceId: "w", createdAt: 0 };
    const { code, codeHash, expiresAt } = newResetCode();
    expect(code).toMatch(/^\d{8}$/);
    const withReset = { ...user, reset: { codeHash, expiresAt } };
    expect(verifyResetCode(withReset, code)).toBe(true);
    expect(verifyResetCode(withReset, "00000000")).toBe(false);
    expect(verifyResetCode({ ...user, reset: { codeHash, expiresAt: Date.now() - 1 } }, code)).toBe(false);
    expect(verifyResetCode(user, code)).toBe(false); // no pending reset
  });
});
