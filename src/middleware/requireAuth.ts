import type { Context, Next } from "hono";
import type { AppEnv } from "../types";
import { readSessionCookie } from "../lib/auth";

export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const token = readSessionCookie(c.req.header("Cookie") ?? null);
  if (!token) {
    return c.json({ error: "غير مصرح" }, 401);
  }

  const row = await c.env.DB.prepare(
    `SELECT s.user_id as userId, u.display_name as userName
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now') AND u.is_active = 1`
  )
    .bind(token)
    .first<{ userId: number; userName: string }>();

  if (!row) {
    return c.json({ error: "الجلسة منتهية" }, 401);
  }

  c.set("userId", row.userId);
  c.set("userName", row.userName);
  await next();
}
