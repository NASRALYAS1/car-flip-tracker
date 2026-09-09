import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/requireAuth";

export const settingsRoutes = new Hono<AppEnv>();
settingsRoutes.use("*", requireAuth);

settingsRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT key, value FROM settings`).all<{
    key: string;
    value: string;
  }>();
  const settings: Record<string, string> = {};
  for (const row of results ?? []) settings[row.key] = row.value;
  return c.json(settings);
});

// The route wrote whatever keys it was handed, so any signed-in client could
// fill the settings table with arbitrary rows — and every one of them then
// rides along in every nightly backup. These are the only two the app reads.
const WRITABLE_SETTINGS = new Set(["business_name", "last_exchange_rate"]);
const MAX_SETTING_LENGTH = 200;

settingsRoutes.patch("/", async (c) => {
  const body = await c.req.json<Record<string, string>>();

  for (const [key, value] of Object.entries(body)) {
    if (!WRITABLE_SETTINGS.has(key)) {
      return c.json({ error: `إعداد غير معروف: ${key}` }, 400);
    }
    if (String(value).length > MAX_SETTING_LENGTH) {
      return c.json({ error: "القيمة طويلة جداً" }, 400);
    }
  }

  for (const [key, value] of Object.entries(body)) {
    await c.env.DB.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
      .bind(key, String(value))
      .run();
  }
  return c.json({ ok: true });
});
