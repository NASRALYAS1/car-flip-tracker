import { Hono } from "hono";
import type { AppEnv } from "./types";
import { authRoutes } from "./routes/auth";
import { setupRoutes } from "./routes/setup";
import { pushRoutes } from "./routes/push";
import { carsRoutes } from "./routes/cars";
import { expenseRoutes, expenseItemRoutes } from "./routes/expenses";
import { expensePresetsRoutes } from "./routes/expensePresets";
import { saleRoutes } from "./routes/sales";
import { paymentRoutes, paymentItemRoutes } from "./routes/payments";
import { tradeRoutes } from "./routes/trades";
import { photoUploadRoutes, photoItemRoutes } from "./routes/photos";
import { dashboardRoutes } from "./routes/dashboard";
import { reportsRoutes } from "./routes/reports";
import { debtsRoutes } from "./routes/debts";
import { settingsRoutes } from "./routes/settings";
import { usersRoutes } from "./routes/users";
import { adminRoutes } from "./routes/admin";
import { runBackup } from "./lib/backup";
import { checkOverdueInstallments } from "./lib/reminders";

const app = new Hono<AppEnv>();

const api = new Hono<AppEnv>();
api.route("/setup", setupRoutes);
api.route("/auth", authRoutes);
api.route("/push", pushRoutes);
api.route("/cars", carsRoutes);
api.route("/cars/:id/expenses", expenseRoutes);
api.route("/expenses", expenseItemRoutes);
api.route("/expense-presets", expensePresetsRoutes);
api.route("/cars/:id/sale", saleRoutes);
api.route("/sales/:id/payments", paymentRoutes);
api.route("/payments", paymentItemRoutes);
api.route("/cars/:id", tradeRoutes); // exposes /trade and /chain
api.route("/cars/:id/photos", photoUploadRoutes);
api.route("/photos", photoItemRoutes);
api.route("/dashboard", dashboardRoutes);
api.route("/reports", reportsRoutes);
api.route("/debts", debtsRoutes);
api.route("/settings", settingsRoutes);
api.route("/users", usersRoutes);
api.route("/admin", adminRoutes);

app.route("/api", api);

// static assets (public/) are served automatically by the Workers Static
// Assets binding for any request that doesn't match a route above.
app.get("*", async (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: AppEnv["Bindings"], ctx: ExecutionContext) {
    ctx.waitUntil(runBackup(env.DB, env.STORAGE));
    ctx.waitUntil(checkOverdueInstallments(env, env.DB));
  },
};
