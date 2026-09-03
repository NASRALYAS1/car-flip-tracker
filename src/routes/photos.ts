import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/requireAuth";
import { randomHex } from "../lib/auth";

// mounted at /api/cars/:id/photos
export const photoUploadRoutes = new Hono<AppEnv>();
photoUploadRoutes.use("*", requireAuth);

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

photoUploadRoutes.post("/", async (c) => {
  const carId = Number(c.req.param("id"));
  const body = await c.req.parseBody();
  const file = body["photo"];

  if (!(file instanceof File)) {
    return c.json({ error: "الرجاء إرفاق صورة" }, 400);
  }
  if (file.size > MAX_BYTES) {
    return c.json({ error: "حجم الصورة كبير جداً (الحد الأقصى 10 ميغابايت)" }, 400);
  }
  // Checked without a `file.type &&` guard on purpose: that short-circuit
  // let an upload declaring no type at all skip the allowlist entirely.
  if (!ALLOWED_TYPES.has(file.type)) {
    return c.json({ error: "نوع الملف غير مدعوم" }, 400);
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const key = `photos/${carId}/${randomHex(16)}.${ext}`;

  // Store the type we resolved from our own allowlist rather than echoing
  // back whatever the client declared, so nothing can be served later under
  // a content type we never approved.
  await c.env.STORAGE.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  const result = await c.env.DB.prepare(
    `INSERT INTO car_photos (car_id, r2_key, uploaded_by) VALUES (?, ?, ?)`
  )
    .bind(carId, key, c.get("userId"))
    .run();

  const photo = await c.env.DB.prepare(`SELECT * FROM car_photos WHERE id = ?`)
    .bind(result.meta.last_row_id)
    .first();

  return c.json(photo, 201);
});

// standalone: /api/photos/:id
export const photoItemRoutes = new Hono<AppEnv>();
photoItemRoutes.use("*", requireAuth);

photoItemRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const photo = await c.env.DB.prepare(`SELECT r2_key FROM car_photos WHERE id = ?`)
    .bind(id)
    .first<{ r2_key: string }>();
  if (!photo) return c.notFound();

  const object = await c.env.STORAGE.get(photo.r2_key);
  if (!object) return c.notFound();

  // Only ever serve a type from the allowlist, and tell the browser not to
  // sniff past it -- otherwise a file stored under an unexpected type could
  // be re-interpreted as HTML and run as script on this origin.
  const storedType = object.httpMetadata?.contentType ?? "";
  const safeType = ALLOWED_TYPES.has(storedType) ? storedType : "application/octet-stream";

  return new Response(object.body, {
    headers: {
      "Content-Type": safeType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=86400",
    },
  });
});

photoItemRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const photo = await c.env.DB.prepare(`SELECT r2_key FROM car_photos WHERE id = ?`)
    .bind(id)
    .first<{ r2_key: string }>();
  if (!photo) return c.json({ error: "الصورة غير موجودة" }, 404);

  await c.env.STORAGE.delete(photo.r2_key);
  await c.env.DB.prepare(`DELETE FROM car_photos WHERE id = ?`).bind(id).run();

  return c.json({ ok: true });
});
