import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/requireAuth";
import { runBackup, listBackups, restoreFromBackup } from "../lib/backup";
import { checkOverdueInstallments } from "../lib/reminders";

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use("*", requireAuth);

adminRoutes.post("/backup-now", async (c) => {
  const key = await runBackup(c.env.DB, c.env.STORAGE);
  return c.json({ ok: true, key });
});

adminRoutes.get("/backups", async (c) => {
  const backups = await listBackups(c.env.STORAGE);
  return c.json(backups);
});

// Break-glass: wipes and replaces the car/financial tables with a past
// backup's snapshot. Never touches partner accounts — see restoreFromBackup.
adminRoutes.post("/restore", async (c) => {
  const body = await c.req.json<{ key?: string }>();
  const key = body.key;
  if (!key) return c.json({ error: "مسار النسخة الاحتياطية مطلوب" }, 400);

  try {
    await restoreFromBackup(c.env.DB, c.env.STORAGE, key);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  return c.json({ ok: true });
});

adminRoutes.post("/check-reminders-now", async (c) => {
  const overdueCount = await checkOverdueInstallments(c.env, c.env.DB);
  return c.json({ ok: true, overdue_count: overdueCount });
});
