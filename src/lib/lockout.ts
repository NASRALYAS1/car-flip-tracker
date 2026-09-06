import { verifyPassword } from "./auth";

// Basic brute-force protection, shared by every place that asks for an
// account password. The counter lives on the user row, so a lockout earned
// at the login screen also applies here and vice versa — otherwise an
// endpoint that checks the password without touching the counter becomes a
// free oracle for guessing it, which is exactly what /admin/reset would have
// been: a stolen session could sit there trying passwords all day without
// ever tripping the login lockout.
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

export type LockoutRow = {
  id: number;
  password_hash: string;
  failed_login_attempts: number;
  locked_until: string | null;
};

export type PasswordCheck =
  | { ok: true }
  | { ok: false; error: string; status: 401 };

export async function checkPasswordWithLockout(
  db: D1Database,
  user: LockoutRow,
  password: string
): Promise<PasswordCheck> {
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return {
      ok: false,
      status: 401,
      error: `الحساب مقفل مؤقتاً بسبب محاولات خاطئة، حاول بعد ${LOCKOUT_MINUTES} دقيقة`,
    };
  }

  if (!(await verifyPassword(password, user.password_hash))) {
    const attempts = user.failed_login_attempts + 1;
    const lockedUntil =
      attempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
        : null;
    await db
      .prepare(`UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?`)
      .bind(attempts, lockedUntil, user.id)
      .run();
    return { ok: false, status: 401, error: "كلمة المرور غير صحيحة" };
  }

  await db
    .prepare(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?`)
    .bind(user.id)
    .run();
  return { ok: true };
}
