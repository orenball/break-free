// Break Free — daily check-in push + community stats.
// Runs every 15 minutes from GitHub Actions (.github/workflows/daily-push.yml).
//
//   node send-push.mjs              real run (needs FIREBASE_SERVICE_ACCOUNT and APP_URL)
//   node send-push.mjs --dry-run    uses fixtures/users.sample.json, sends and writes nothing
//   node send-push.mjs --dry-run --now=2026-10-19T18:30:00Z
//
// Logs only counts — never tokens, ids or personal data.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DAY_MS = 864e5;
const ACTIVE_WINDOW_MS = 30 * DAY_MS;
const CHUNK = 100;
const BAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

const TEXT = {
  en: { title: "Break Free", body: "Did you get through today without giving in? Tap to check in." },
  // written so it reads correctly for both men and women
  he: { title: "Break Free", body: "הצלחת לעבור את היום בלי להישבר? לחיצה כאן כדי לסמן." },
};

/* ---------- pure logic (exercised by --dry-run) ---------- */

// The user's local date ("YYYY-MM-DD") and time ("HH:MM") at `now` in time zone `tz`.
export function localParts(now, tz) {
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
  } catch {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
  }
  const p = Object.fromEntries(fmt.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// Why a user should or shouldn't get today's push. Returns { push, reason, localDate }.
export function pushDecision(u, now) {
  if (!u.notify || !u.fcmToken) return { push: false, reason: "reminders off" };
  if (!/^\d{2}:\d{2}$/.test(u.reminderTime || "")) return { push: false, reason: "no reminder time" };
  const { date, time } = localParts(now, u.tz);
  if (time < u.reminderTime) return { push: false, reason: "not time yet", localDate: date };
  if (u.lastPushDate === date) return { push: false, reason: "already pushed today", localDate: date };
  if (u.lastCheckinDate === date) return { push: false, reason: "already checked in today", localDate: date };
  return { push: true, reason: "due", localDate: date };
}

// Anonymous community totals — aggregates only.
export function computeSummary(users, now) {
  const active = users.filter((u) => typeof u.updatedAt === "number" && now - u.updatedAt <= ACTIVE_WINDOW_MS);
  const byHabit = {};
  let streakSum = 0, streakCount = 0, longest = 0, checkedInToday = 0;
  for (const u of active) {
    // Newer app versions send one entry per habit in `streaks`; older ones a single habit.
    const streaks = Array.isArray(u.streaks) && u.streaks.length
      ? u.streaks
      : [{ habit: u.habit, streakStart: u.streakStart, bestMs: u.bestMs }];
    for (const s of streaks) {
      const habit = typeof s.habit === "string" && s.habit ? s.habit : "other";
      byHabit[habit] = (byHabit[habit] || 0) + 1;
      const ok = typeof s.streakStart === "number" && s.streakStart <= now;
      const streak = ok ? now - s.streakStart : 0;
      if (ok) { streakSum += streak; streakCount++; }
      longest = Math.max(longest, streak, typeof s.bestMs === "number" ? s.bestMs : 0);
    }
    if (u.lastCheckinDate && u.lastCheckinDate === localParts(now, u.tz).date) checkedInToday++;
  }
  return {
    users: active.length,
    checkedInToday,
    byHabit,
    avgStreakDays: streakCount ? Math.round((streakSum / streakCount / DAY_MS) * 10) / 10 : 0,
    longestStreakDays: Math.floor(longest / DAY_MS),
    totalCleanDays: Math.floor(streakSum / DAY_MS),
    updatedAt: now,
  };
}

export function buildMessage(u, appUrl) {
  const txt = TEXT[u.lang] || TEXT.en;
  const base = appUrl.endsWith("/") ? appUrl : appUrl + "/";
  return {
    token: u.fcmToken,
    notification: { title: txt.title, body: txt.body },
    webpush: {
      fcmOptions: { link: base + "#checkin" },
      notification: { icon: base + "icons/icon-192.png", tag: "breakfree-daily", lang: u.lang === "he" ? "he" : "en", dir: u.lang === "he" ? "rtl" : "ltr" },
    },
    data: { type: "checkin" },
  };
}

function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/* ---------- runs ---------- */

async function dryRun(now) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const users = JSON.parse(await readFile(path.join(here, "fixtures/users.sample.json"), "utf8"));
  console.log(`Dry run at ${new Date(now).toISOString()} with ${users.length} fixture users\n`);
  for (const u of users) {
    const d = pushDecision(u, now);
    const local = localParts(now, u.tz);
    console.log(`${d.push ? "PUSH" : "skip"}  ${u._label.padEnd(36)} local ${local.date} ${local.time}  reminder ${u.reminderTime || "-"}  → ${d.reason}`);
    if (d.push) console.log(`      "${buildMessage(u, "https://example.github.io/break-free/").notification.body}"`);
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

  const snap = await db.collection("users").get();
  const users = snap.docs.map((d) => ({ ref: d.ref, ...d.data() }));

  const due = [];
  for (const u of users) {
    const d = pushDecision(u, now);
    if (d.push) due.push({ u, localDate: d.localDate });
  }

  let sent = 0, failed = 0, invalid = 0;
  for (const group of chunks(due, CHUNK)) {
    const results = await Promise.allSettled(group.map(({ u }) => messaging.send(buildMessage(u, appUrl))));
    await Promise.allSettled(results.map((r, i) => {
      const { u, localDate } = group[i];
      if (r.status === "fulfilled") { sent++; return u.ref.update({ lastPushDate: localDate }); }
      const code = r.reason && r.reason.code;
      if (BAD_TOKEN_CODES.has(code)) { invalid++; return u.ref.update({ fcmToken: null, notify: false }); }
      failed++;
      return null;
    }));
  }

  const summary = computeSummary(users, now);
  await db.collection("stats").doc("summary").set(summary);

  console.log(`users: ${users.length}, due: ${due.length}, sent: ${sent}, invalid tokens cleared: ${invalid}, other failures: ${failed}`);
  console.log(`summary: ${summary.users} active users, ${summary.checkedInToday} checked in today`);
}

const args = process.argv.slice(2);
const nowArg = args.find((a) => a.startsWith("--now="));
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const dry = args.includes("--dry-run");
  const now = nowArg ? Date.parse(nowArg.slice(6)) : (dry ? Date.parse("2026-10-19T18:30:00Z") : Date.now());
  (dry ? dryRun(now) : realRun(now)).catch((e) => { console.error(e.message || e); process.exit(1); });
}
