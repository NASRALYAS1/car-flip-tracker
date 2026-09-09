const BACKUP_PREFIX = "backups/";
const MAX_BACKUPS = 90;
const BACKUP_TABLES = [
  "cars",
  "expenses",
  "sales",
  "installment_payments",
  "trades",
  "partner_loans",
  "people_debts",
  "car_photos",
  "settings",
] as const;

// A restore empties these tables and refills them, and the rows point at each
// other: a car points at the trade it was acquired through, a sale and an
// expense and a photo each point at their car, a payment at its sale. So the
// two halves of a restore need opposite orders — clear children before their
// parents, then insert parents before their children. Doing it one table at a
// time (delete cars, refill cars, delete trades, refill trades) inserts a car
// whose trade hasn't come back yet, and the foreign key rejects the whole
// batch. That failed for any business that had ever recorded a trade, which
// in a car-trading app is most of them.
const DELETE_ORDER = [
  "installment_payments",
  "sales",
  "expenses",
  "car_photos",
  "cars",
  "trades",
  "partner_loans",
  "people_debts",
  "settings",
] as const;

const INSERT_ORDER = [
  "settings",
  "trades",
  "cars",
  "expenses",
  "sales",
  "installment_payments",
  "car_photos",
  "partner_loans",
  "people_debts",
] as const;

async function allRows<T = unknown>(db: D1Database, table: string): Promise<T[]> {
  const { results } = await db.prepare(`SELECT * FROM ${table}`).all<T>();
  return results ?? [];
}

export async function runBackup(
  db: D1Database,
  bucket: R2Bucket,
  label?: string
): Promise<string> {
  const exportedAt = new Date().toISOString();

  const snapshot: Record<string, unknown> = { exported_at: exportedAt };
  for (const table of BACKUP_TABLES) {
    snapshot[table] = await allRows(db, table);
  }

  // The label goes after the timestamp, never before it: both listBackups
  // and pruneOldBackups order these keys as plain strings and rely on the
  // ISO timestamp leading, so a prefix would silently break both.
  const suffix = label ? `-${label.replace(/[^a-z0-9-]/gi, "")}` : "";
  const key = `${BACKUP_PREFIX}${exportedAt.replace(/[:.]/g, "-")}${suffix}.json`;
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
// Every backup taken before the private personal_debts list became the shared
// people_debts one holds the old table under the old name — and the check
// below requires every current table to be present, so without this each of
// those snapshots would be rejected as corrupt. That would have quietly
// destroyed the ability to restore anything from before the rename, which is
// the one thing backups exist for. Translated on read rather than rewritten
// in storage, so the files on disk stay exactly as they were taken.
function upgradeOldSnapshot(snapshot: Record<string, unknown>): void {
  upgradePersonalDebts(snapshot);
  upgradeCarNames(snapshot);
}

function upgradePersonalDebts(snapshot: Record<string, unknown>): void {
  if (Array.isArray(snapshot.people_debts) || !Array.isArray(snapshot.personal_debts)) return;

  snapshot.people_debts = (snapshot.personal_debts as Record<string, unknown>[]).map((row) => {
    const { owner_user_id, direction, ...rest } = row;
    return {
      ...rest,
      recorded_by: owner_user_id ?? null,
      direction: direction === "i_owe_them" ? "we_owe_them" : "they_owe_us",
    };
  });
  delete snapshot.personal_debts;
}

// Rows are inserted by their own keys, so a snapshot taken while cars still
// had separate make/model columns would try to write a column that no longer
// exists and fail the whole restore. Joined back into the single name exactly
// as the migration did, so a restored car reads the same as a migrated one.
function upgradeCarNames(snapshot: Record<string, unknown>): void {
  if (!Array.isArray(snapshot.cars)) return;

  snapshot.cars = (snapshot.cars as Record<string, unknown>[]).map((row) => {
    if (!("make" in row) && !("model" in row)) return row;
    const { make, model, ...rest } = row;
    return {
      ...rest,
      name: rest.name ?? [make, model].filter(Boolean).join(" ").trim(),
    };
  });
}

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
  upgradeOldSnapshot(snapshot);

  if (!BACKUP_TABLES.every((t) => Array.isArray(snapshot[t]))) {
    throw new Error("ملف النسخة الاحتياطية غير صالح");
  }

  // Restoring wipes everything currently recorded and replaces it with the
  // snapshot — which is exactly as destructive as a reset, and until now had
  // none of a reset's safety net. Picking yesterday's backup by mistake threw
  // away today's work with nothing to go back to. So the current state is
  // snapshotted first, the same way resetBusinessData does it, and shows up
  // in the restore list as the newest entry if the restore was the mistake.
  await runBackup(db, bucket, "before-restore");

  const statements = [];
  for (const table of DELETE_ORDER) {
    statements.push(db.prepare(`DELETE FROM ${table}`));
  }
  // A car_photos row is only half a photo: the bytes live in R2, and a reset
  // deletes those permanently. Restoring the row anyway produces a car page
  // full of thumbnails that will never load, with no way to tell a broken
  // one from a slow one. Rows whose object is actually gone are dropped, so
  // what comes back is what can genuinely be shown.
  const restorablePhotos: Record<string, unknown>[] = [];
  for (const row of (snapshot.car_photos as Record<string, unknown>[]) ?? []) {
    const r2Key = row.r2_key;
    if (typeof r2Key !== "string") continue;
    const head = await bucket.head(r2Key).catch(() => null);
    if (head) restorablePhotos.push(row);
  }
  snapshot.car_photos = restorablePhotos;

  for (const table of INSERT_ORDER) {
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
