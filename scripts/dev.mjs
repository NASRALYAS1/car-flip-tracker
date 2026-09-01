// Thin wrapper around `wrangler dev` that disables Wrangler's telemetry
// call — in sandboxed/offline dev environments that network call can hang
// wrangler's startup indefinitely. See WRANGLER_SEND_METRICS in
// telemetry.md. Cross-platform (avoids shell-specific `VAR=val cmd` syntax).
import { spawn } from "node:child_process";

const child = spawn("wrangler", ["dev"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
});

child.on("exit", (code) => process.exit(code ?? 0));
