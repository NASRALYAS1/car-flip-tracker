// Emergency/recovery helper only. Normally partners are created and
// managed entirely inside the app (first-run setup wizard, then
// Settings -> Partners) — this script exists for the one case the app
// can't self-serve: the last remaining partner forgot their password and
// there's nobody else logged in who can reset it for them.
//
// Hashes a password the same way the app does (PBKDF2-SHA256, 210,000
// iterations) and prints a ready-to-run SQL command, so a real password
// never has to go through chat or get committed to a file.
//
// Usage (to create an account):
//   node scripts/create-user.mjs <username> <display_name>
//   (you'll be prompted for the password on stdin, hidden)
//
// To reset an existing partner's password instead, run the same command
// and use the printed hash in an UPDATE instead of an INSERT:
//   UPDATE users SET password_hash = '<hash>' WHERE username = '<username>';

import { pbkdf2Sync, randomBytes } from "node:crypto";
import { createInterface } from "node:readline";

const ITERATIONS = 210_000;

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, Buffer.from(salt, "hex"), ITERATIONS, 32, "sha256").toString(
    "hex"
  );
  return `${salt}:${hash}`;
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    // simple hidden input: mute echo while typing
    const stdin = process.stdin;
    process.stdout.write(question);
    let input = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (char) => {
      char = char.toString();
      if (char === "\n" || char === "\r" || char === "") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        rl.close();
        resolve(input);
      } else if (char === "") {
        process.exit(1);
      } else if (char === "") {
        input = input.slice(0, -1);
      } else {
        input += char;
      }
    };
    stdin.on("data", onData);
  });
}

const [username, displayName] = process.argv.slice(2);
if (!username || !displayName) {
  console.error("Usage: node scripts/create-user.mjs <username> <display_name>");
  process.exit(1);
}

const password = await promptHidden(`Password for ${username}: `);
if (!password) {
  console.error("Password cannot be empty");
  process.exit(1);
}

const hash = hashPassword(password);
const escapedUsername = username.replace(/'/g, "''");
const escapedDisplay = displayName.replace(/'/g, "''");

console.log("\nRun this against your D1 database (add --remote for production):\n");
console.log(
  `wrangler d1 execute car-flip-tracker-db --local --command "INSERT INTO users (username, password_hash, display_name) VALUES ('${escapedUsername}', '${hash}', '${escapedDisplay}');"`
);
