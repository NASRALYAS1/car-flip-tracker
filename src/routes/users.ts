import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/requireAuth";
import { hashPassword } from "../lib/auth";

// mounted at /api/users — partner (user) management. Any logged-in partner
// can manage the others: this app has no separate "admin" role, by design
// (see README) — it's a small trusted-partner team, not a public product.
export const usersRoutes = new Hono<AppEnv>();
usersRoutes.use("*", requireAuth);

type UserRow = {
  id: number;
  username: string;
  display_name: string;
  profit_split_pct: number;
  is_active: number;
};

usersRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, username, display_name, profit_split_pct, is_active FROM users ORDER BY id`
  ).all<UserRow>();
  return c.json(results ?? []);
});

usersRoutes.post("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
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

  let userId: number;
  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO users (username, password_hash, display_name, profit_split_pct, is_active)
       VALUES (?, ?, ?, 0, 1)`
    )
      .bind(username, passwordHash, displayName)
      .run();
    userId = result.meta.last_row_id as number;
  } catch {
    return c.json({ error: "اسم المستخدم مستخدم من قبل" }, 409);
  }

  const user = await c.env.DB.prepare(
    `SELECT id, username, display_name, profit_split_pct, is_active FROM users WHERE id = ?`
  )
    .bind(userId)
    .first();
  return c.json(user, 201);
});

// must be registered before "/:id" so it isn't swallowed by the param route
usersRoutes.patch("/splits", async (c) => {
  const body = await c.req.json<{ splits?: Record<string, number> }>();
  const splits = body.splits;
  if (!splits || typeof splits !== "object") {
    return c.json({ error: "توزيع النسب مطلوب" }, 400);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id FROM users WHERE is_active = 1`
  ).all<{ id: number }>();
  const activeIds = (results ?? []).map((r) => r.id).sort((a, b) => a - b);
  const givenIds = Object.keys(splits)
    .map(Number)
    .sort((a, b) => a - b);

  if (
    activeIds.length !== givenIds.length ||
    !activeIds.every((id, i) => id === givenIds[i])
  ) {
    return c.json({ error: "لازم تحدد نسبة لكل شريك فعّال، لا أكثر ولا أقل" }, 400);
  }

  const total = Object.values(splits).reduce((s, v) => s + Number(v), 0);
  if (Math.abs(total - 100) > 0.5) {
    return c.json({ error: `مجموع النسب لازم يكون 100% (الحالي: ${total.toFixed(1)}%)` }, 400);
  }

  for (const [idStr, pct] of Object.entries(splits)) {
    await c.env.DB.prepare(`UPDATE users SET profit_split_pct = ? WHERE id = ?`)
      .bind(Number(pct), Number(idStr))
      .run();
  }

  const { results: updated } = await c.env.DB.prepare(
    `SELECT id, username, display_name, profit_split_pct, is_active FROM users ORDER BY id`
  ).all<UserRow>();
  return c.json(updated ?? []);
});

usersRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<Record<string, unknown>>();

  const sets: string[] = [];
  const values: unknown[] = [];

  if (typeof body.display_name === "string") {
    const v = body.display_name.trim();
    if (!v) return c.json({ error: "الاسم مطلوب" }, 400);
    sets.push("display_name = ?");
    values.push(v);
  }
  if (typeof body.username === "string") {
    const v = body.username.trim();
    if (!v) return c.json({ error: "اسم المستخدم مطلوب" }, 400);
    sets.push("username = ?");
    values.push(v);
  }
  if (typeof body.password === "string" && body.password) {
    if (body.password.length < 6) {
      return c.json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" }, 400);
    }
    sets.push("password_hash = ?");
    values.push(await hashPassword(body.password));
  }

  if (sets.length === 0) return c.json({ error: "لا يوجد شي للتعديل" }, 400);

  values.push(id);
  try {
    await c.env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();
  } catch {
    return c.json({ error: "اسم المستخدم مستخدم من قبل" }, 409);
  }

  const user = await c.env.DB.prepare(
    `SELECT id, username, display_name, profit_split_pct, is_active FROM users WHERE id = ?`
  )
    .bind(id)
    .first();
  if (!user) return c.json({ error: "الشريك غير موجود" }, 404);
  return c.json(user);
});

usersRoutes.post("/:id/deactivate", async (c) => {
  const id = Number(c.req.param("id"));

  const activeCountRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM users WHERE is_active = 1`
  ).first<{ count: number }>();
  const target = await c.env.DB.prepare(`SELECT is_active FROM users WHERE id = ?`)
    .bind(id)
    .first<{ is_active: number }>();

  if (!target) return c.json({ error: "الشريك غير موجود" }, 404);
  if (target.is_active && (activeCountRow?.count ?? 0) <= 1) {
    return c.json({ error: "لازم يبقى شريك واحد فعّال على الأقل" }, 400);
  }

  await c.env.DB.prepare(`UPDATE users SET is_active = 0 WHERE id = ?`).bind(id).run();
  await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id).run();
  return c.json({ ok: true });
});

usersRoutes.post("/:id/reactivate", async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare(`UPDATE users SET is_active = 1 WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});
