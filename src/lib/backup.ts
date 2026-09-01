const BACKUP_PREFIX = "backups/";
const MAX_BACKUPS = 30;

async function allRows<T = unknown>(db: D1Database, table: string): Promise<T[]> {
  const { results } = await db.prepare(`SELECT * FROM ${table}`).all<T>();
  return results ?? [];
}

export async function runBackup(db: D1Database, bucket: R2Bucket): Promise<string> {
  const exportedAt = new Date().toISOString();

  const snapshot = {
    exported_at: exportedAt,
    cars: await allRows(db, "cars"),
    expenses: await allRows(db, "expenses"),
    sales: await allRows(db, "sales"),
    installment_payments: await allRows(db, "installment_payments"),
    trades: await allRows(db, "trades"),
    partner_loans: await allRows(db, "partner_loans"),
    car_photos: await allRows(db, "car_photos"),
    settings: await allRows(db, "settings"),
  };

  const key = `${BACKUP_PREFIX}${exportedAt.replace(/[:.]/g, "-")}.json`;
  await bucket.put(key, JSON.stringify(snapshot, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });

  await pruneOldBackups(bucket);

  return key;
}

async function pruneOldBackups(bucket: R2Bucket): Promise<void> {
  const listing = await bucket.list({ prefix: BACKUP_PREFIX });
  const keys = listing.objects.map((o) => o.key).sort(); // ISO timestamps sort chronologically
  if (keys.length <= MAX_BACKUPS) return;

  const toDelete = keys.slice(0, keys.length - MAX_BACKUPS);
  for (const key of toDelete) {
    await bucket.delete(key);
  }
}
