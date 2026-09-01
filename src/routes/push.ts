import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/requireAuth";

export const pushRoutes = new Hono<AppEnv>();

pushRoutes.get("/vapid-public-key", async (c) => {
  return c.json({ key: c.env.VAPID_PUBLIC_KEY ?? "" });
});

pushRoutes.post("/subscribe", requireAuth, async (c) => {
  const body = await c.req.json<{
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  }>();

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return c.json({ error: "بيانات الاشتراك ناقصة" }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id,
       p256dh = excluded.p256dh, auth = excluded.auth`
  )
    .bind(c.get("userId"), body.endpoint, body.keys.p256dh, body.keys.auth)
    .run();

  return c.json({ ok: true });
});

pushRoutes.delete("/subscribe", requireAuth, async (c) => {
  const body = await c.req.json<{ endpoint?: string }>();
  if (!body.endpoint) return c.json({ error: "endpoint مطلوب" }, 400);

  await c.env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`)
    .bind(body.endpoint)
    .run();

  return c.json({ ok: true });
});
