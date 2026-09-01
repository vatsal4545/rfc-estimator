// Auth endpoints, one route with an action switch to keep the surface small:
//   POST /api/auth {action:"register", username, email, password}
//   POST /api/auth {action:"login", username, password}
//   POST /api/auth {action:"change-password", current, next}   (Bearer token)
//   POST /api/auth {action:"reset-request", username}
//   POST /api/auth {action:"reset", username, code, newPassword}
// All responses: {token?, username?, message?} or {error}.

import {
  hashPassword,
  newResetCode,
  normalizeUsername,
  randomUUID,
  readUser,
  sendResetEmail,
  sessionFrom,
  signSession,
  verifyPassword,
  verifyResetCode,
  writeUser,
} from "@/lib/server/auth";

export const runtime = "nodejs";

const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(req: Request) {
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return bad("invalid JSON");
  }
  const action = body.action ?? "";

  try {
    if (action === "register") {
      const username = (body.username ?? "").trim();
      const email = (body.email ?? "").trim();
      const password = body.password ?? "";
      if (normalizeUsername(username).length < 3) return bad("username must be at least 3 characters");
      if (!/^[a-z0-9._-]+$/i.test(username)) return bad("username: letters, numbers, . _ - only");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("enter a valid email (used for password reset)");
      if (password.length < 8) return bad("password must be at least 8 characters");
      if (await readUser(username)) return bad("that username is taken", 409);
      const { salt, passwordHash } = hashPassword(password);
      const user = { username, email, salt, passwordHash, workspaceId: randomUUID(), createdAt: Date.now() };
      await writeUser(user);
      return Response.json({ token: signSession(username, user.workspaceId), username });
    }

    if (action === "login") {
      const user = await readUser(body.username ?? "");
      if (!user || !verifyPassword(body.password ?? "", user.salt, user.passwordHash)) {
        return bad("wrong username or password", 401);
      }
      return Response.json({ token: signSession(user.username, user.workspaceId), username: user.username });
    }

    if (action === "change-password") {
      const session = sessionFrom(req);
      if (!session) return bad("sign in first", 401);
      const user = await readUser(session.u);
      if (!user) return bad("account not found", 404);
      if (!verifyPassword(body.current ?? "", user.salt, user.passwordHash)) return bad("current password is wrong", 401);
      if ((body.next ?? "").length < 8) return bad("new password must be at least 8 characters");
      await writeUser({ ...user, ...hashPassword(body.next), reset: undefined });
      return Response.json({ message: "password changed" });
    }

    if (action === "reset-request") {
      const user = await readUser(body.username ?? "");
      // Same reply whether or not the account exists — don't leak usernames.
      const generic = { message: "If that account exists, a reset code was sent to its email." };
      if (!user) return Response.json(generic);
      const { code, codeHash, expiresAt } = newResetCode();
      await writeUser({ ...user, reset: { codeHash, expiresAt } });
      const sent = await sendResetEmail(user.email, user.username, code);
      if (!sent) {
        return Response.json({
          message:
            "Email isn't configured on this deployment yet (RESEND_API_KEY missing) — ask the admin to set it up, or use Change password while signed in.",
        });
      }
      return Response.json(generic);
    }

    if (action === "reset") {
      const user = await readUser(body.username ?? "");
      if (!user || !verifyResetCode(user, body.code ?? "")) return bad("invalid or expired reset code", 401);
      if ((body.newPassword ?? "").length < 8) return bad("new password must be at least 8 characters");
      await writeUser({ ...user, ...hashPassword(body.newPassword), reset: undefined });
      return Response.json({ token: signSession(user.username, user.workspaceId), username: user.username });
    }

    return bad(`unknown action "${action}"`);
  } catch (err) {
    return bad(`auth failed: ${(err as Error).message}`, 502);
  }
}
