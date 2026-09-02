import { Hono } from "hono";
import type { AppEnv } from "../types";
import {
  hashPassword,
  newSessionToken,
  sessionCookieHeader,
  sessionExpiryIso,
  generateRecoveryCode,
  normalizeRecoveryCode,
} from "../lib/auth";

// mounted at /api/setup — unauthenticated by design, but every write is
// guarded by "only when the users table is empty" so it can't be used
// once a business has been set up.
export const setupRoutes = new Hono<AppEnv>();

async function needsSetup(db: D1Database): Promise<boolean> {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM users`).first<{ count: number }>();
  return (row?.count ?? 0) === 0;
}

setupRoutes.get("/status", async (c) => {
  return c.json({ needs_setup: await needsSetup(c.env.DB) });
});

setupRoutes.post("/init", async (c) => {
  if (!(await needsSetup(c.env.DB))) {
    return c.json({ error: "التطبيق مُعد مسبقاً" }, 400);
  }

  const body = await c.req.json<Record<string, unknown>>();
  const businessName = String(body.business_name ?? "").trim();
  const displayName = String(body.display_name ?? "").trim();
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");

  if (!displayName || !username || !password) {
    return c.json({ error: "الاسم واسم المستخدم وكلمة المرور مطلوبة" }, 400);
  }
  if (password.length < 6) {
    return c.json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" }, 400);
  }

  const passwordHash = await hashPassword(password);
  const recoveryCode = generateRecoveryCode();
  const recoveryCodeHash = await hashPassword(normalizeRecoveryCode(recoveryCode));

  let userId: number;
  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO users (username, password_hash, display_name, profit_split_pct, is_active, recovery_code_hash)
       VALUES (?, ?, ?, 100, 1, ?)`
    )
      .bind(username, passwordHash, displayName, recoveryCodeHash)
      .run();
    userId = result.meta.last_row_id as number;
  } catch {
    return c.json({ error: "اسم المستخدم مستخدم من قبل" }, 409);
  }

  if (businessName) {
    await c.env.DB.prepare(
      `INSERT INTO settings (key, value) VALUES ('business_name', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
      .bind(businessName)
      .run();
  }

  const token = newSessionToken();
  await c.env.DB.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`)
    .bind(token, userId, sessionExpiryIso())
    .run();

  const secure = new URL(c.req.url).protocol === "https:";
  c.header("Set-Cookie", sessionCookieHeader(token, secure));
  return c.json({ id: userId, display_name: displayName, recovery_code: recoveryCode }, 201);
});
