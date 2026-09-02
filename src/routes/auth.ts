import { Hono } from "hono";
import type { AppEnv } from "../types";
import {
  verifyPassword,
  hashPassword,
  newSessionToken,
  sessionCookieHeader,
  clearSessionCookieHeader,
  sessionExpiryIso,
  readSessionCookie,
  generateRecoveryCode,
  normalizeRecoveryCode,
} from "../lib/auth";
import { requireAuth } from "../middleware/requireAuth";

export const authRoutes = new Hono<AppEnv>();

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";

  if (!username || !password) {
    return c.json({ error: "الرجاء إدخال اسم المستخدم وكلمة المرور" }, 400);
  }

  const user = await c.env.DB.prepare(
    `SELECT id, password_hash, display_name, is_active, failed_login_attempts, locked_until
     FROM users WHERE username = ?`
  )
    .bind(username)
    .first<{
      id: number;
      password_hash: string;
      display_name: string;
      is_active: number;
      failed_login_attempts: number;
      locked_until: string | null;
    }>();

  // same generic error whether the username doesn't exist or the account is
  // locked/wrong password, so login can't be used to enumerate usernames
  const genericError = () => c.json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" }, 401);

  if (!user) return genericError();

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return c.json(
      { error: `الحساب مقفل مؤقتاً بسبب محاولات دخول خاطئة، حاول بعد ${LOCKOUT_MINUTES} دقيقة` },
      401
    );
  }

  if (!(await verifyPassword(password, user.password_hash)) || !user.is_active) {
    const attempts = user.failed_login_attempts + 1;
    const lockedUntil =
      attempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
        : null;
    await c.env.DB.prepare(
      `UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?`
    )
      .bind(attempts, lockedUntil, user.id)
      .run();
    return genericError();
  }

  await c.env.DB.prepare(
    `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?`
  )
    .bind(user.id)
    .run();

  const token = newSessionToken();
  await c.env.DB.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`
  )
    .bind(token, user.id, sessionExpiryIso())
    .run();

  const secure = new URL(c.req.url).protocol === "https:";
  c.header("Set-Cookie", sessionCookieHeader(token, secure));
  return c.json({ id: user.id, display_name: user.display_name });
});

// Recovers access using the one-time code shown when the account was
// created — reachable even when every partner is locked out, since it
// doesn't need anyone else to already be logged in. Shares the same
// failed-attempt lockout as /login (both are "prove you're this account"
// boundaries), and always issues a fresh recovery code afterward since the
// old one is spent (single-use, like the setup/partner-creation code).
authRoutes.post("/recover", async (c) => {
  const body = await c.req.json<{ username?: string; recovery_code?: string; new_password?: string }>();
  const username = (body.username ?? "").trim();
  const recoveryCode = normalizeRecoveryCode(body.recovery_code ?? "");
  const newPassword = body.new_password ?? "";

  if (!username || !recoveryCode || !newPassword) {
    return c.json({ error: "الرجاء تعبئة كل الحقول" }, 400);
  }
  if (newPassword.length < 6) {
    return c.json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" }, 400);
  }

  const user = await c.env.DB.prepare(
    `SELECT id, recovery_code_hash, failed_login_attempts, locked_until
     FROM users WHERE username = ?`
  )
    .bind(username)
    .first<{
      id: number;
      recovery_code_hash: string | null;
      failed_login_attempts: number;
      locked_until: string | null;
    }>();

  const genericError = () => c.json({ error: "اسم المستخدم أو رمز الاسترجاع غير صحيح" }, 401);
  if (!user) return genericError();

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return c.json(
      { error: `الحساب مقفل مؤقتاً بسبب محاولات خاطئة، حاول بعد ${LOCKOUT_MINUTES} دقيقة` },
      401
    );
  }

  if (!user.recovery_code_hash) {
    return c.json(
      { error: "ما فيه رمز استرجاع مسجل لهذا الحساب — اطلب من شريك آخر يغيّر كلمة مرورك من صفحة الشركاء" },
      400
    );
  }

  if (!(await verifyPassword(recoveryCode, user.recovery_code_hash))) {
    const attempts = user.failed_login_attempts + 1;
    const lockedUntil =
      attempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
        : null;
    await c.env.DB.prepare(
      `UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?`
    )
      .bind(attempts, lockedUntil, user.id)
      .run();
    return genericError();
  }

  const newPasswordHash = await hashPassword(newPassword);
  const newRecoveryCode = generateRecoveryCode();
  const newRecoveryCodeHash = await hashPassword(normalizeRecoveryCode(newRecoveryCode));
  await c.env.DB.prepare(
    `UPDATE users SET password_hash = ?, recovery_code_hash = ?,
       failed_login_attempts = 0, locked_until = NULL WHERE id = ?`
  )
    .bind(newPasswordHash, newRecoveryCodeHash, user.id)
    .run();

  return c.json({ ok: true, new_recovery_code: newRecoveryCode });
});

authRoutes.post("/logout", async (c) => {
  const token = readSessionCookie(c.req.header("Cookie") ?? null);
  if (token) {
    await c.env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
  }
  const secure = new URL(c.req.url).protocol === "https:";
  c.header("Set-Cookie", clearSessionCookieHeader(secure));
  return c.json({ ok: true });
});

authRoutes.get("/me", requireAuth, async (c) => {
  return c.json({ id: c.get("userId"), display_name: c.get("userName") });
});
