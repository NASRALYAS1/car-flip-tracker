import { runBackup } from "./backup";

// Everything the business itself records. Ordered so a delete never leaves a
// row pointing at a parent that's already gone: payments before their sale,
// sales/expenses/photos before their car, cars before the trades they link
// back to.
const RESET_TABLES = [
  "installment_payments",
  "sales",
  "expenses",
  "car_photos",
  "cars",
  "trades",
  "partner_loans",
  "people_debts",
] as const;

// Deliberately NOT touched, and worth being explicit about because the whole
// point of this operation is that it's irreversible: users (accounts,
// passwords, recovery codes, profit splits), sessions (so nobody is logged
// out mid-reset), push_subscriptions, settings (business name, partner
// names, split, exchange rate) and expense_presets. Those are the setup a
// business did once, not the records it accumulated while testing.

export type ResetCounts = Record<string, number>;

export type ResetResult = {
  deleted: ResetCounts;
  photos_deleted: number;
  backups_deleted: number;
  safety_backup_key: string;
};

// R2 lists at most 1000 keys per call, and a business that's been testing
// for a while can easily exceed that in photos alone — so every prefix walk
// here follows the cursor instead of assuming one page is all of it.
async function listAllKeys(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const listing = await bucket.list({ prefix, cursor });
    for (const object of listing.objects) keys.push(object.key);
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
  return keys;
}

/**
 * Clears every business record so a real business can start on an empty app
 * after a testing period, without disturbing the accounts or the setup.
 *
 * One backup is taken first and kept. The old backups go — otherwise the
 * restore screen would keep offering months of test data to a live business,
 * which is a trap waiting to be sprung by whoever opens that screen a year
 * from now. But leaving no way back from a destructive action is worse than
 * the clutter of a single snapshot, so the pre-reset state stays available.
 */
export async function resetBusinessData(
  db: D1Database,
  bucket: R2Bucket
): Promise<ResetResult> {
  const safetyBackupKey = await runBackup(db, bucket, "before-reset");

  const deleted: ResetCounts = {};
  for (const table of RESET_TABLES) {
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
    deleted[table] = row?.n ?? 0;
  }

  await db.batch(RESET_TABLES.map((table) => db.prepare(`DELETE FROM ${table}`)));

  const photoKeys = await listAllKeys(bucket, "photos/");
  for (const key of photoKeys) {
    await bucket.delete(key).catch(() => {
      // A photo that's already missing shouldn't abort the reset — its
      // database row is gone either way.
    });
  }

  const backupKeys = (await listAllKeys(bucket, "backups/")).filter((k) => k !== safetyBackupKey);
  for (const key of backupKeys) {
    await bucket.delete(key).catch(() => {});
  }

  return {
    deleted,
    photos_deleted: photoKeys.length,
    backups_deleted: backupKeys.length,
    safety_backup_key: safetyBackupKey,
  };
}
