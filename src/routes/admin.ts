import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/requireAuth";
import { runBackup } from "../lib/backup";
import { checkOverdueInstallments } from "../lib/reminders";

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use("*", requireAuth);

adminRoutes.post("/backup-now", async (c) => {
  const key = await runBackup(c.env.DB, c.env.STORAGE);
  return c.json({ ok: true, key });
});

adminRoutes.post("/check-reminders-now", async (c) => {
  const overdueCount = await checkOverdueInstallments(c.env, c.env.DB);
  return c.json({ ok: true, overdue_count: overdueCount });
});
