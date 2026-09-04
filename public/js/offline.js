// Offline queue, deliberately scoped to personal debts only.
//
// Everything else in this app is shared between partners, and queueing those
// writes offline would let two people change the same sale from two phones
// and sync contradictory versions — two copies of one payment, a payment
// landing on a deal someone else already settled. There's no safe automatic
// answer to that, so shared writes stay online-only.
//
// Personal debts are the one exception: they're private to a single partner,
// so nobody else can be editing the same row. Single writer, no conflicts.
const Offline = {
  KEY: "personal_debts_outbox",

  isOffline() {
    return !navigator.onLine;
  },

  read() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY)) || [];
    } catch {
      return [];
    }
  },

  write(queue) {
    localStorage.setItem(this.KEY, JSON.stringify(queue));
  },

  pendingCount() {
    return this.read().length;
  },

  // The server computes usd_cents on save; offline we need it locally so the
  // pending row shows a real amount instead of a blank.
  usdCentsFor(payload) {
    if (payload.amount_currency === "IQD" && payload.amount_exchange_rate) {
      return Math.round((payload.amount_amount / 100 / payload.amount_exchange_rate) * 100);
    }
    return payload.amount_amount;
  },

  queueCreate(payload) {
    const queue = this.read();
    const tempId = `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    queue.push({ op: "create", tempId, payload });
    this.write(queue);
    return tempId;
  },

  // Editing something that hasn't reached the server yet just amends the
  // queued create — that way nothing ever has to map a temporary id onto a
  // real one during sync.
  queuePatch(id, patch) {
    const queue = this.read();
    const pendingCreate = queue.find((e) => e.op === "create" && e.tempId === id);
    if (pendingCreate) {
      Object.assign(pendingCreate.payload, patch);
    } else {
      queue.push({ op: "patch", serverId: id, payload: patch });
    }
    this.write(queue);
  },

  queueDelete(id) {
    let queue = this.read();
    const pendingIndex = queue.findIndex((e) => e.op === "create" && e.tempId === id);
    if (pendingIndex >= 0) {
      queue.splice(pendingIndex, 1); // never synced — just drop it
    } else {
      queue = queue.filter((e) => !(e.op === "patch" && e.serverId === id));
      queue.push({ op: "delete", serverId: id });
    }
    this.write(queue);
  },

  // Lays the queued changes over the (possibly stale) server list so the
  // screen shows what the partner actually believes is true.
  applyTo(serverList) {
    let list = (serverList || []).map((d) => ({ ...d }));
    for (const entry of this.read()) {
      if (entry.op === "create") {
        list.unshift({
          ...entry.payload,
          id: entry.tempId,
          amount_usd_cents: this.usdCentsFor(entry.payload),
          is_settled: entry.payload.is_settled ? 1 : 0,
          _pending: true,
        });
      } else if (entry.op === "patch") {
        const target = list.find((d) => String(d.id) === String(entry.serverId));
        if (target) {
          Object.assign(target, entry.payload);
          target._pending = true;
        }
      } else if (entry.op === "delete") {
        list = list.filter((d) => String(d.id) !== String(entry.serverId));
      }
    }
    return list;
  },

  syncing: false,

  async flush() {
    if (this.syncing || this.isOffline()) return { synced: 0, failed: 0 };
    const queue = this.read();
    if (!queue.length) return { synced: 0, failed: 0 };

    this.syncing = true;
    let synced = 0;
    let failed = 0;
    const remaining = [];

    try {
      for (const entry of queue) {
        try {
          if (entry.op === "create") await api.post("/personal-debts", entry.payload);
          else if (entry.op === "patch") await api.patch(`/personal-debts/${entry.serverId}`, entry.payload);
          else if (entry.op === "delete") await api.del(`/personal-debts/${entry.serverId}`);
          synced++;
        } catch (err) {
          // A 4xx is the server refusing this specific change (bad data, or
          // a row deleted elsewhere). Replaying it forever would wedge the
          // queue behind it, so it's dropped. Anything else — no connection,
          // a server hiccup — is kept and retried next time.
          if (err && err.status >= 400 && err.status < 500 && !err.isOffline) {
            failed++;
          } else {
            remaining.push(entry);
          }
        }
      }
    } finally {
      this.write(remaining);
      this.syncing = false;
    }

    return { synced, failed };
  },
};
