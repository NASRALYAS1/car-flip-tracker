import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/requireAuth";
import { parseMoneyField } from "../lib/money";

export const debtsRoutes = new Hono<AppEnv>();
debtsRoutes.use("*", requireAuth);

debtsRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT pl.*, lu.display_name AS lender_name, bu.display_name AS borrower_name
     FROM partner_loans pl
     JOIN users lu ON lu.id = pl.lender_user_id
     JOIN users bu ON bu.id = pl.borrower_user_id
     ORDER BY pl.entry_date DESC, pl.id DESC`
  ).all();

  const entries = results ?? [];

  // net balance keyed by "lender->borrower" usd cents
  const balances = new Map<string, number>();
  for (const row of entries as Record<string, unknown>[]) {
    const lender = row.lender_user_id as number;
    const borrower = row.borrower_user_id as number;
    const amount = row.amount_usd_cents as number;
    const sign = row.entry_type === "loan" ? 1 : -1;

    const key = lender < borrower ? `${lender}:${borrower}` : `${borrower}:${lender}`;
    const directional = lender < borrower ? sign * amount : -sign * amount;
    balances.set(key, (balances.get(key) ?? 0) + directional);
  }

  const netBalances = Array.from(balances.entries()).map(([key, netUsdCents]) => {
    const [a, b] = key.split(":").map(Number);
    return { user_a: a, user_b: b, net_usd_cents: netUsdCents };
  });

  return c.json({ entries, net_balances: netBalances });
});

debtsRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const entry = await c.env.DB.prepare(
    `SELECT pl.*, lu.display_name AS lender_name, bu.display_name AS borrower_name,
            ru.display_name AS recorded_by_name
     FROM partner_loans pl
     JOIN users lu ON lu.id = pl.lender_user_id
     JOIN users bu ON bu.id = pl.borrower_user_id
     JOIN users ru ON ru.id = pl.recorded_by
     WHERE pl.id = ?`
  )
    .bind(id)
    .first();
  if (!entry) return c.json({ error: "القيد غير موجود" }, 404);
  return c.json(entry);
});

debtsRoutes.post("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();

  if (!body.lender_user_id || !body.borrower_user_id || !body.entry_date || !body.entry_type) {
    return c.json({ error: "بيانات السلفة/التسديد ناقصة" }, 400);
  }
  if (body.entry_type !== "loan" && body.entry_type !== "repayment") {
    return c.json({ error: "entry_type يجب أن يكون loan أو repayment" }, 400);
  }

  let amount;
  try {
    amount = parseMoneyField(body, "amount");
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO partner_loans (
       lender_user_id, borrower_user_id, entry_type, amount_amount, amount_currency,
       amount_exchange_rate, amount_usd_cents, entry_date, notes, recorded_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      Number(body.lender_user_id),
      Number(body.borrower_user_id),
      body.entry_type,
      amount.amount,
      amount.currency,
      amount.exchangeRate,
      amount.usdCents,
      body.entry_date,
      body.notes ?? null,
      c.get("userId")
    )
    .run();

  const entry = await c.env.DB.prepare(`SELECT * FROM partner_loans WHERE id = ?`)
    .bind(result.meta.last_row_id)
    .first();

  return c.json(entry, 201);
});

debtsRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare(`DELETE FROM partner_loans WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});
