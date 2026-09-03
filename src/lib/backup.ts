const BACKUP_PREFIX = "backups/";
const MAX_BACKUPS = 90;
const BACKUP_TABLES = [
  "cars",
  "expenses",
  "sales",
  "installment_payments",
  "trades",
  "partner_loans",
  "personal_debts",
  "car_photos",
  "settings",
] as const;

async function allRows<T = unknown>(db: D1Database, table: string): Promise<T[]> {
  const { results } = await db.prepare(`SELECT * FROM ${table}`).all<T>();
  return results ?? [];
}

export async function runBackup(db: D1Database, bucket: R2Bucket): Promise<string> {
  const exportedAt = new Date().toISOString();

  const snapshot: Record<string, unknown> = { exported_at: exportedAt };
  for (const table of BACKUP_TABLES) {
    snapshot[table] = await allRows(db, table);
  }

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

export type BackupInfo = { key: string; uploaded_at: string };

export async function listBackups(bucket: R2Bucket): Promise<BackupInfo[]> {
  const listing = await bucket.list({ prefix: BACKUP_PREFIX });
  return listing.objects
    .map((o) => ({ key: o.key, uploaded_at: o.uploaded.toISOString() }))
    .sort((a, b) => b.key.localeCompare(a.key)); // newest first (ISO timestamps in the key)
}

// Wipes and replaces every table a backup snapshot covers with that
// snapshot's rows — deliberately NEVER touches users/sessions/
// push_subscriptions, which live outside the backup on purpose, so a
// restore can never change who has access to the app or log anyone out,
// only roll back the car/financial records. Inserts each row using its own
// snapshot-time columns (not today's schema) so restoring an older backup
// taken before a later migration added a column still works — the DB just
// fills that column with its own default.
export async function restoreFromBackup(db: D1Database, bucket: R2Bucket, key: string): Promise<void> {
  if (!key.startsWith(BACKUP_PREFIX)) throw new Error("مسار النسخة الاحتياطية غير صالح");

  const object = await bucket.get(key);
  if (!object) throw new Error("النسخة الاحتياطية غير موجودة");

  let snapshot: Record<string, unknown>;
  try {
    snapshot = JSON.parse(await object.text());
  } catch {
    throw new Error("ملف النسخة الاحتياطية تالف");
  }
  if (!BACKUP_TABLES.every((t) => Array.isArray(snapshot[t]))) {
    throw new Error("ملف النسخة الاحتياطية غير صالح");
  }

  const statements = [];
  for (const table of BACKUP_TABLES) {
    statements.push(db.prepare(`DELETE FROM ${table}`));
    for (const row of snapshot[table] as Record<string, unknown>[]) {
      // Column names come from a JSON file and get interpolated into SQL
      // (they can't be bound as parameters), so they're validated as plain
      // identifiers first. Today only our own backup job writes these files,
      // but that's an assumption about the storage bucket, not a guarantee
      // from this code -- and it would stop holding the day a backup can be
      // uploaded or imported from anywhere else.
      const columns = Object.keys(row).filter((col) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(col));
      if (!columns.length) continue;
      const placeholders = columns.map(() => "?").join(", ");
      statements.push(
        db
          .prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`)
          .bind(...columns.map((c) => row[c]))
      );
    }
  }

  await db.batch(statements);
}
