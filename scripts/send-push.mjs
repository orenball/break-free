// Break Free — command-line runner for the reminder job.
// Runs from GitHub Actions (.github/workflows/daily-push.yml), started every 5 minutes by cron-job.org.
//   node send-push.mjs                                            real run (needs FIREBASE_SERVICE_ACCOUNT and APP_URL)
//   node send-push.mjs --dry-run [--now=2026-10-19T18:30:00Z]   test the logic on fixtures/users.sample.json
//   TEST_DEVICE=<code from Profile>                               send one test notification to that device

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { localParts, reminderTimes, pushDecision, computeSummary, buildMessage, runDailyPush } from "./push-core.js";

export { localParts, reminderTimes, pushDecision, computeSummary, buildMessage };

async function dryRun(now) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const users = JSON.parse(await readFile(path.join(here, "fixtures/users.sample.json"), "utf8"));
  console.log(`Dry run at ${new Date(now).toISOString()} with ${users.length} fixture users\n`);
  for (const u of users) {
    const d = pushDecision(u, now);
    const local = localParts(now, u.tz);
    console.log(`${d.push ? "PUSH" : "skip"}  ${u._label.padEnd(40)} local ${local.date} ${local.time}  reminders ${reminderTimes(u).join(",") || "-"}  → ${d.reason}`);
    if (d.push) console.log(`      "${buildMessage(u, "https://example.github.io/break-free/", d.kind).notification.body}"`);
  }
  console.log("\nstats/summary would be:");
  console.log(JSON.stringify(computeSummary(users, now), null, 2));
}

async function realRun(now) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const appUrl = process.env.APP_URL;
  if (!raw && process.env.GITHUB_ACTIONS) {
    console.log("FIREBASE_SERVICE_ACCOUNT secret not added yet — skipping this run (see README, step 3).");
    return;
  }
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set. Add it as a GitHub Actions secret (see README).");
  if (!appUrl) throw new Error("APP_URL is not set. Add it as a GitHub Actions variable, e.g. https://<user>.github.io/break-free/");
  let account;
  try { account = JSON.parse(raw); } catch { throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON. Paste the whole downloaded key file."); }

  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getMessaging } = await import("firebase-admin/messaging");
  initializeApp({ credential: cert(account) });
  const db = getFirestore();
  const messaging = getMessaging();

  await runDailyPush({ db, messaging, now, appUrl, testDevice: process.env.TEST_DEVICE });
}

const args = process.argv.slice(2);
const nowArg = args.find((a) => a.startsWith("--now="));
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const dry = args.includes("--dry-run");
  const now = nowArg ? Date.parse(nowArg.slice(6)) : (dry ? Date.parse("2026-10-19T18:30:00Z") : Date.now());
  (dry ? dryRun(now) : realRun(now)).catch((e) => { console.error(e.message || e); process.exit(1); });
}
