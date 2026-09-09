import type { Context, Next } from "hono";
import type { AppEnv } from "../types";
import { readSessionCookie } from "../lib/auth";

export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const token = readSessionCookie(c.req.header("Cookie") ?? null);
  if (!token) {
    return c.json({ error: "غير مصرح" }, 401);
  }

  // expires_at is stored as a JS ISO string ("2026-10-06T22:00:00.000Z")
  // while datetime('now') returns "2026-10-06 22:00:00". Compared as raw
  // strings those differ at position 10 — 'T' sorts above ' ' — so a session
  // expiring today read as valid no matter how long ago it lapsed. datetime()
  // normalises both sides, and covers sessions already issued in ISO form.
  const row = await c.env.DB.prepare(
    `SELECT s.user_id as userId, u.display_name as userName
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND datetime(s.expires_at) > datetime('now') AND u.is_active = 1`
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
