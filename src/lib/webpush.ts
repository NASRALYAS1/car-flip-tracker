import {
  buildPushPayload,
  type PushMessage,
  type PushSubscription,
  type VapidKeys,
} from "@block65/webcrypto-web-push";
import type { Bindings } from "../types";

export type PushSubscriptionRow = {
  id: number;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function sendPushToSubscription(
  env: Bindings,
  sub: PushSubscriptionRow,
  title: string,
  body: string
): Promise<{ ok: boolean; status: number; expired: boolean }> {
  const vapid: VapidKeys = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };

  const subscription: PushSubscription = {
    endpoint: sub.endpoint,
    expirationTime: null,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };

  const message: PushMessage = {
    data: JSON.stringify({ title, body }),
    options: { ttl: 60 * 60 * 24 },
  };

  const payload = await buildPushPayload(message, subscription, vapid);
  const res = await fetch(subscription.endpoint, payload);

  // 404/410 mean the subscription is gone and should be removed
  const expired = res.status === 404 || res.status === 410;
  return { ok: res.ok, status: res.status, expired };
}

export async function notifyAllPartners(
  env: Bindings,
  db: D1Database,
  title: string,
  body: string
): Promise<void> {
  const { results } = await db
    .prepare(`SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions`)
    .all<PushSubscriptionRow>();

  for (const sub of results ?? []) {
    try {
      const result = await sendPushToSubscription(env, sub, title, body);
      if (result.expired) {
        await db.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).bind(sub.id).run();
      }
    } catch {
      // one failed subscription shouldn't block the rest
    }
  }
}
