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

settingsRoutes.patch("/", async (c) => {
  const body = await c.req.json<Record<string, string>>();
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
