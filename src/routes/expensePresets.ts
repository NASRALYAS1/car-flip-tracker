import { Hono } from "hono";
import type { AppEnv, Currency } from "../types";
import { requireAuth } from "../middleware/requireAuth";

export const expensePresetsRoutes = new Hono<AppEnv>();
expensePresetsRoutes.use("*", requireAuth);

expensePresetsRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM expense_presets ORDER BY sort_order, id`
  ).all();
  return c.json(results ?? []);
});

expensePresetsRoutes.post("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const description = String(body.description ?? "").trim();
  const amount = Number(body.default_amount);
  const currency = body.default_currency as Currency;

  if (!description) return c.json({ error: "الوصف مطلوب" }, 400);
  if (!Number.isFinite(amount) || amount <= 0) {
    return c.json({ error: "المبلغ الافتراضي مطلوب" }, 400);
  }
  if (currency !== "USD" && currency !== "IQD") {
    return c.json({ error: "العملة يجب أن تكون USD أو IQD" }, 400);
  }

  const maxOrder = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(sort_order), 0) AS m FROM expense_presets`
  ).first<{ m: number }>();

  const result = await c.env.DB.prepare(
    `INSERT INTO expense_presets (description, default_amount, default_currency, sort_order)
     VALUES (?, ?, ?, ?)`
  )
    .bind(description, Math.round(amount), currency, (maxOrder?.m ?? 0) + 1)
    .run();

  const preset = await c.env.DB.prepare(`SELECT * FROM expense_presets WHERE id = ?`)
    .bind(result.meta.last_row_id)
    .first();
  return c.json(preset, 201);
});

expensePresetsRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<Record<string, unknown>>();

  const sets: string[] = [];
  const values: unknown[] = [];

  if (typeof body.description === "string") {
    const v = body.description.trim();
    if (!v) return c.json({ error: "الوصف مطلوب" }, 400);
    sets.push("description = ?");
    values.push(v);
  }
  if (body.default_amount !== undefined) {
    const amount = Number(body.default_amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return c.json({ error: "المبلغ الافتراضي غير صحيح" }, 400);
    }
    sets.push("default_amount = ?");
    values.push(Math.round(amount));
  }
  if (body.default_currency !== undefined) {
    if (body.default_currency !== "USD" && body.default_currency !== "IQD") {
      return c.json({ error: "العملة يجب أن تكون USD أو IQD" }, 400);
    }
    sets.push("default_currency = ?");
    values.push(body.default_currency);
  }

  if (sets.length === 0) return c.json({ error: "لا يوجد شي للتعديل" }, 400);

  values.push(id);
  await c.env.DB.prepare(`UPDATE expense_presets SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const preset = await c.env.DB.prepare(`SELECT * FROM expense_presets WHERE id = ?`)
    .bind(id)
    .first();
  if (!preset) return c.json({ error: "القالب غير موجود" }, 404);
  return c.json(preset);
});

expensePresetsRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare(`DELETE FROM expense_presets WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});
