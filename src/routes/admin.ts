import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/requireAuth";
import { runBackup, listBackups, restoreFromBackup } from "../lib/backup";
import { resetBusinessData } from "../lib/reset";
import { checkPasswordWithLockout } from "../lib/lockout";
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

// Wipes every business record so a real business can open a fresh app after
// a testing period. Guarded twice over, because it is the single most
// destructive thing the app can do and there is no undo beyond the one
// snapshot it takes on the way out: the caller retypes an exact phrase (a
// deliberate act, not a mis-tap) and re-enters their own account password
// (proof it's them and not a borrowed unlocked phone). Both are checked
// here, on the server — the same checks in the browser are a convenience,
// not the gate.
const RESET_CONFIRM_PHRASE = "حذف كل البيانات";

adminRoutes.post("/reset", async (c) => {
  const body = await c.req.json<{ confirm_phrase?: string; password?: string }>();

  const phrase = String(body.confirm_phrase ?? "").trim().replace(/\s+/g, " ");
  if (phrase !== RESET_CONFIRM_PHRASE) {
    return c.json({ error: `اكتب العبارة بالضبط: ${RESET_CONFIRM_PHRASE}` }, 400);
  }

  const password = String(body.password ?? "");
  if (!password) {
    return c.json({ error: "كلمة المرور مطلوبة" }, 400);
  }

  const user = await c.env.DB.prepare(
    `SELECT id, password_hash, failed_login_attempts, locked_until FROM users WHERE id = ?`
  )
    .bind(c.get("userId"))
    .first<{
      id: number;
      password_hash: string;
      failed_login_attempts: number;
      locked_until: string | null;
    }>();
  if (!user) return c.json({ error: "الحساب غير موجود" }, 401);

  // Goes through the shared lockout so repeated guesses here cost the same
  // as they do at the login screen — a session someone walked off with
  // shouldn't get unlimited tries at the password that guards this.
  const check = await checkPasswordWithLockout(c.env.DB, user, password);
  if (!check.ok) return c.json({ error: check.error }, check.status);

  const result = await resetBusinessData(c.env.DB, c.env.STORAGE);
  return c.json({ ok: true, ...result });
});
