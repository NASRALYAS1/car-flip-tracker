import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/requireAuth";
import {
  createDistribution,
  deleteLatestDistribution,
  distributionOverview,
  lifetimeRealizedProfit,
  listDistributions,
} from "../lib/distributions";

// mounted at /api/distributions -- the partners taking their profit. See
// src/lib/distributions.ts for how "since the last distribution" is measured.
export const distributionsRoutes = new Hono<AppEnv>();
distributionsRoutes.use("*", requireAuth);

distributionsRoutes.get("/", async (c) => {
  const lifetime = await lifetimeRealizedProfit(c.env.DB);
  const [overview, distributions] = await Promise.all([
    distributionOverview(c.env.DB, lifetime),
    listDistributions(c.env.DB),
  ]);
  return c.json({ ...overview, distributions });
});

distributionsRoutes.post("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>();

  const expected = Number(body.expected_undistributed_usd_cents);
  if (!Number.isFinite(expected)) {
    return c.json({ error: "المبلغ المعروض بالصفحة مطلوب للتأكيد" }, 400);
  }

  const date =
    typeof body.distribution_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.distribution_date)
      ? body.distribution_date
      : new Date().toISOString().slice(0, 10);
  const notes =
    typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 500) : null;

  const result = await createDistribution(c.env.DB, {
    expected_undistributed_usd_cents: Math.round(expected),
    distribution_date: date,
    notes,
    recorded_by: c.get("userId"),
  });
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result, 201);
});

distributionsRoutes.delete("/:id", async (c) => {
  const result = await deleteLatestDistribution(c.env.DB, Number(c.req.param("id")));
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ ok: true });
});
