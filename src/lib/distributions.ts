import { computeProfit } from "./profit";

// ---------------------------------------------------------------------------
// Partners taking their profit
// ---------------------------------------------------------------------------
//
// Every few sales the partners sit down and share out what has been made.
// Each of those is recorded as a distribution holding the business's realized
// profit at that moment, so "profit since the last distribution" is always
// today's total minus the latest one -- including profit that has accrued on
// installment sales since, as payments came in.
//
// What a partner has taken is read from those records and never recomputed.
// That is what stops the dashboard rewriting history: changing the split or
// deactivating a partner only affects profit that hasn't been shared out yet.

export type PartnerSplit = {
  user_id: number;
  display_name: string;
  split_pct: number;
};

export type PartnerShare = PartnerSplit & { share_usd_cents: number };

/**
 * Realized profit of the whole business from its first sale until now. Every
 * sold car counts; an installment sale counts the share of its profit already
 * earned from money received.
 */
export async function lifetimeRealizedProfit(db: D1Database): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT c.purchase_price_usd_cents,
              (SELECT COALESCE(SUM(amount_usd_cents), 0) FROM expenses WHERE car_id = c.id) AS total_expenses_usd_cents,
              s.sale_type, s.sale_price_usd_cents, s.discount_usd_cents, s.down_payment_usd_cents,
              (SELECT COALESCE(SUM(amount_usd_cents), 0) FROM installment_payments WHERE sale_id = s.id) AS installments_paid_usd_cents
       FROM cars c
       JOIN sales s ON s.car_id = c.id`
    )
    .all<{
      purchase_price_usd_cents: number;
      total_expenses_usd_cents: number;
      sale_type: string;
      sale_price_usd_cents: number;
      discount_usd_cents: number | null;
      down_payment_usd_cents: number | null;
      installments_paid_usd_cents: number;
    }>();

  return (results ?? []).reduce(
    (sum, r) =>
      sum +
      computeProfit({
        sale_type: r.sale_type,
        sale_price_usd_cents: r.sale_price_usd_cents,
        discount_usd_cents: r.discount_usd_cents || 0,
        down_payment_usd_cents: r.down_payment_usd_cents || 0,
        purchase_price_usd_cents: r.purchase_price_usd_cents,
        total_expenses_usd_cents: r.total_expenses_usd_cents,
        installments_paid_usd_cents: r.installments_paid_usd_cents,
      }).realized_profit_usd_cents,
    0
  );
}

export async function activePartners(db: D1Database): Promise<PartnerSplit[]> {
  const { results } = await db
    .prepare(
      `SELECT id AS user_id, display_name, profit_split_pct AS split_pct
       FROM users WHERE is_active = 1 ORDER BY id`
    )
    .all<PartnerSplit>();
  return results ?? [];
}

/**
 * Splits an amount by the partners' percentages. Normalised against whatever
 * the percentages actually add up to rather than assuming exactly 100, and the
 * last partner takes the rounding remainder, so the shares always add up to the
 * amount exactly -- never a cent more or less.
 */
export function splitAmong(amount: number, partners: PartnerSplit[]): PartnerShare[] {
  const totalPct = partners.reduce((s, p) => s + p.split_pct, 0);
  let allocated = 0;
  return partners.map((p, i) => {
    let share: number;
    if (i === partners.length - 1) share = amount - allocated;
    else if (totalPct > 0) share = Math.round((amount * p.split_pct) / totalPct);
    else share = Math.round(amount / partners.length);
    allocated += share;
    return { ...p, share_usd_cents: share };
  });
}

export type DistributionRow = {
  id: number;
  previous_distribution_id: number;
  distribution_date: string;
  lifetime_profit_usd_cents: number;
  distributed_usd_cents: number;
  notes: string | null;
  recorded_by: number | null;
  created_at: string;
};

// Only the latest distribution can ever be deleted, so the highest id is always
// the end of the chain.
export async function latestDistribution(db: D1Database): Promise<DistributionRow | null> {
  return db.prepare(`SELECT * FROM profit_distributions ORDER BY id DESC LIMIT 1`).first<DistributionRow>();
}

export type PartnerLedger = {
  user_id: number;
  display_name: string;
  is_active: boolean;
  split_pct: number | null;
  received_usd_cents: number;
  pending_share_usd_cents: number;
};

export type DistributionOverview = {
  lifetime_profit_usd_cents: number;
  undistributed_usd_cents: number;
  last_distribution: null | { id: number; distribution_date: string; distributed_usd_cents: number };
  partners: PartnerLedger[];
};

/**
 * Where the partnership stands right now: profit made since it was last shared
 * out, each active partner's cut of that at today's percentages, and what each
 * partner -- including a former one -- has already taken.
 */
export async function distributionOverview(
  db: D1Database,
  lifetimeProfit: number
): Promise<DistributionOverview> {
  const [latest, users, received] = await Promise.all([
    latestDistribution(db),
    db
      .prepare(`SELECT id, display_name, profit_split_pct, is_active FROM users ORDER BY id`)
      .all<{ id: number; display_name: string; profit_split_pct: number; is_active: number }>(),
    db
      .prepare(
        `SELECT user_id, SUM(share_usd_cents) AS total
         FROM profit_distribution_shares WHERE user_id IS NOT NULL GROUP BY user_id`
      )
      .all<{ user_id: number; total: number }>(),
  ]);

  // Can be negative: a late expense or an edited sale after a distribution
  // means more was shared out than was really made, and the next one is smaller.
  const undistributed = lifetimeProfit - (latest?.lifetime_profit_usd_cents ?? 0);

  const allUsers = users.results ?? [];
  const active = allUsers
    .filter((u) => u.is_active)
    .map((u) => ({ user_id: u.id, display_name: u.display_name, split_pct: u.profit_split_pct }));
  const pendingById = new Map(splitAmong(undistributed, active).map((s) => [s.user_id, s.share_usd_cents]));
  const receivedById = new Map((received.results ?? []).map((r) => [r.user_id, r.total]));

  const partners = allUsers
    .filter((u) => u.is_active || (receivedById.get(u.id) ?? 0) !== 0)
    .map((u) => ({
      user_id: u.id,
      display_name: u.display_name,
      is_active: !!u.is_active,
      split_pct: u.is_active ? u.profit_split_pct : null,
      received_usd_cents: receivedById.get(u.id) ?? 0,
      pending_share_usd_cents: pendingById.get(u.id) ?? 0,
    }));

  return {
    lifetime_profit_usd_cents: lifetimeProfit,
    undistributed_usd_cents: undistributed,
    last_distribution: latest
      ? {
          id: latest.id,
          distribution_date: latest.distribution_date,
          distributed_usd_cents: latest.distributed_usd_cents,
        }
      : null,
    partners,
  };
}

export type DistributionWithShares = DistributionRow & {
  recorded_by_name: string | null;
  shares: Array<{ user_id: number | null; display_name: string; split_pct: number; share_usd_cents: number }>;
};

export async function listDistributions(db: D1Database): Promise<DistributionWithShares[]> {
  const [dists, shares] = await Promise.all([
    db
      .prepare(
        `SELECT d.*, u.display_name AS recorded_by_name
         FROM profit_distributions d LEFT JOIN users u ON u.id = d.recorded_by
         ORDER BY d.id DESC`
      )
      .all<DistributionRow & { recorded_by_name: string | null }>(),
    db
      .prepare(
        `SELECT distribution_id, user_id, display_name, split_pct, share_usd_cents
         FROM profit_distribution_shares ORDER BY distribution_id DESC, id`
      )
      .all<{
        distribution_id: number;
        user_id: number | null;
        display_name: string;
        split_pct: number;
        share_usd_cents: number;
      }>(),
  ]);

  const byDistribution = new Map<number, DistributionWithShares["shares"]>();
  for (const s of shares.results ?? []) {
    const list = byDistribution.get(s.distribution_id) ?? [];
    list.push({
      user_id: s.user_id,
      display_name: s.display_name,
      split_pct: s.split_pct,
      share_usd_cents: s.share_usd_cents,
    });
    byDistribution.set(s.distribution_id, list);
  }

  return (dists.results ?? []).map((d) => ({ ...d, shares: byDistribution.get(d.id) ?? [] }));
}

export type CreateDistributionResult =
  | { ok: true; distribution_id: number; distributed_usd_cents: number; shares: PartnerShare[] }
  | { ok: false; status: 400 | 409; error: string };

export async function createDistribution(
  db: D1Database,
  input: {
    expected_undistributed_usd_cents: number;
    distribution_date: string;
    notes: string | null;
    recorded_by: number;
  }
): Promise<CreateDistributionResult> {
  const [lifetime, latest, partners] = await Promise.all([
    lifetimeRealizedProfit(db),
    latestDistribution(db),
    activePartners(db),
  ]);
  const undistributed = lifetime - (latest?.lifetime_profit_usd_cents ?? 0);

  // The amount the partners confirmed on screen has to be the amount paid out.
  // If an installment landed or an expense was recorded between opening the
  // dashboard and pressing the button, stop and show the new figure rather than
  // quietly distributing a different number than the one they agreed to.
  if (input.expected_undistributed_usd_cents !== undistributed) {
    return {
      ok: false,
      status: 409,
      error: "الأرقام تغيّرت من فتحت الصفحة — حدّثها وتأكد من المبلغ قبل التوزيع",
    };
  }
  if (undistributed <= 0) return { ok: false, status: 400, error: "ما فيه ربح جديد للتوزيع" };
  if (!partners.length) return { ok: false, status: 400, error: "ما فيه شركاء فعّالين" };

  const shares = splitAmong(undistributed, partners);
  const previousId = latest?.id ?? 0;

  // One transaction. The shares find their distribution through
  // previous_distribution_id, which is UNIQUE, rather than last_insert_rowid()
  // (which each share insert would change) or MAX(id).
  const statements = [
    db
      .prepare(
        `INSERT INTO profit_distributions (
           previous_distribution_id, distribution_date, lifetime_profit_usd_cents,
           distributed_usd_cents, notes, recorded_by
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(previousId, input.distribution_date, lifetime, undistributed, input.notes, input.recorded_by),
    ...shares.map((s) =>
      db
        .prepare(
          `INSERT INTO profit_distribution_shares (distribution_id, user_id, display_name, split_pct, share_usd_cents)
           SELECT id, ?, ?, ?, ? FROM profit_distributions WHERE previous_distribution_id = ?`
        )
        .bind(s.user_id, s.display_name, s.split_pct, s.share_usd_cents, previousId)
    ),
  ];

  try {
    await db.batch(statements);
  } catch (e) {
    // Another partner distributed from the same starting point a moment
    // earlier. The batch is one transaction, so nothing from this attempt
    // was written.
    if (/UNIQUE/i.test(String((e as Error)?.message ?? e))) {
      return { ok: false, status: 409, error: "شريك ثاني وزّع الأرباح هسه — حدّث الصفحة" };
    }
    throw e;
  }

  const created = await db
    .prepare(`SELECT id FROM profit_distributions WHERE previous_distribution_id = ?`)
    .bind(previousId)
    .first<{ id: number }>();

  return { ok: true, distribution_id: created?.id ?? 0, distributed_usd_cents: undistributed, shares };
}

export async function deleteLatestDistribution(
  db: D1Database,
  id: number
): Promise<{ ok: true } | { ok: false; status: 400 | 404; error: string }> {
  const target = await db.prepare(`SELECT id FROM profit_distributions WHERE id = ?`).bind(id).first<{ id: number }>();
  if (!target) return { ok: false, status: 404, error: "التوزيع غير موجود" };

  // Only the latest can go. Each distribution is measured from the one before
  // it, so removing one from the middle would leave the next one describing a
  // starting point that no longer exists.
  const successor = await db
    .prepare(`SELECT id FROM profit_distributions WHERE previous_distribution_id = ?`)
    .bind(id)
    .first<{ id: number }>();
  if (successor) return { ok: false, status: 400, error: "بس آخر توزيع ينحذف" };

  await db.batch([
    db.prepare(`DELETE FROM profit_distribution_shares WHERE distribution_id = ?`).bind(id),
    db.prepare(`DELETE FROM profit_distributions WHERE id = ?`).bind(id),
  ]);
  return { ok: true };
}
