// Break Free — the reminder + community-stats logic, used by send-push.mjs.
// Logs only counts and short random device codes — never tokens or personal data.

const DAY_MS = 864e5;
const ACTIVE_WINDOW_MS = 30 * DAY_MS;
const CHUNK = 100;
const BAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

// "checkin" = the day's last reminder (asks how the day went); "boost" = earlier reminders.
// Hebrew is written so it reads correctly for both men and women.
const TEXT = {
  en: {
    checkin: { title: "Break Free", body: "Did you get through today without giving in? Tap to check in." },
    boost: { title: "Break Free 💚", body: "Keep going — you have a good reason for doing this. Tap to read it." },
  },
  he: {
    checkin: { title: "Break Free", body: "הצלחת לעבור את היום בלי להישבר? לחיצה כאן כדי לסמן." },
    boost: { title: "Break Free 💚", body: "ממשיכים חזק — יש לך סיבה טובה לעשות את זה. לחיצה כאן כדי לקרוא אותה." },
  },
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

// The user's reminder times, sorted. Older app versions sent a single `reminderTime`.
export function reminderTimes(u) {
  const list = Array.isArray(u.reminderTimes) && u.reminderTimes.length ? u.reminderTimes : [u.reminderTime];
  return [...new Set(list.filter((x) => /^\d{2}:\d{2}$/.test(x || "")))].sort();
}

// Which reminder (if any) to send now. Returns { push, kind, reason, localDate, slots }.
// `slots` are the reminder times this send covers; they get marked as done for today.
export function pushDecision(u, now) {
  if (!u.notify || !u.fcmToken) return { push: false, reason: "reminders off" };
  const times = reminderTimes(u);
  if (!times.length) return { push: false, reason: "no reminder time" };
  const { date, time } = localParts(now, u.tz);
  if (u.lastCheckinDate === date) return { push: false, reason: "already checked in today", localDate: date };
  const sent = { ...(u.lastPushes || {}) };
  const checkinAt = times[times.length - 1];
  if (!sent[checkinAt] && u.lastPushDate) sent[checkinAt] = u.lastPushDate; // older single-reminder records
  const due = times.filter((tm) => time >= tm && sent[tm] !== date);
  if (!due.length) {
    const passed = times.some((tm) => time >= tm);
    return { push: false, reason: passed ? "already pushed today" : "not time yet", localDate: date };
  }
  // If the job ran late and several are due at once, send one message: the daily question wins.
  const kind = due.includes(checkinAt) ? "checkin" : "boost";
  return { push: true, kind, reason: kind === "checkin" ? "daily question due" : "boost due", localDate: date, slots: due };
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

export function buildMessage(u, appUrl, kind = "checkin") {
  const txt = (TEXT[u.lang] || TEXT.en)[kind] || TEXT.en.checkin;
  const base = appUrl.endsWith("/") ? appUrl : appUrl + "/";
  return {
    token: u.fcmToken,
    notification: { title: txt.title, body: txt.body },
    webpush: {
      fcmOptions: { link: base + (kind === "checkin" ? "#checkin" : "#why") },
      notification: { icon: base + "icons/icon-192.png", tag: "breakfree-" + kind, lang: u.lang === "he" ? "he" : "en", dir: u.lang === "he" ? "rtl" : "ltr" },
    },
    data: { type: kind },
  };
}

export function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/* ---------- one run ---------- */

// opts: { db, messaging, now, appUrl, testDevice?, log? }
export async function runDailyPush(opts) {
  const { db, messaging, now, appUrl } = opts;
  const log = opts.log || console.log;
  const snap = await db.collection("users").get();
  const users = snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
  const code = (u) => "…" + u.id.slice(-6); // short, random device code shown in the app's Profile

  // Troubleshooting: send one test notification to a single device, right now.
  const testDevice = (opts.testDevice || "").trim();
  if (testDevice) {
    if (testDevice.length < 6) throw new Error("TEST_DEVICE must be the 6-character device code from Profile.");
    const matches = users.filter((u) => u.id.endsWith(testDevice));
    if (!matches.length) { log(`test: no device with code ${testDevice}`); return; }
    for (const u of matches) {
      if (!u.fcmToken) { log(`test ${code(u)}: this device has no notification sign-up (notify=${!!u.notify})`); continue; }
      try {
        const id = await messaging.send(buildMessage(u, appUrl, "checkin"));
        log(`test ${code(u)}: accepted by Firebase (message ${id.split("/").pop()}), lang=${u.lang}, reminders=${reminderTimes(u).join(",")}`);
      } catch (e) {
        log(`test ${code(u)}: FAILED ${e.code || ""} ${e.message || e}`);
      }
    }
    return;
  }

  log("devices: " + users.map((u) => `${code(u)}${u.notify && u.fcmToken ? " (reminders on)" : ""}`).join(", "));
  const due = [];
  for (const u of users) {
    const d = pushDecision(u, now);
    if (d.push) due.push({ u, d });
  }

  let sent = 0, failed = 0, invalid = 0;
  for (const group of chunks(due, CHUNK)) {
    const results = await Promise.allSettled(group.map(({ u, d }) => messaging.send(buildMessage(u, appUrl, d.kind))));
    await Promise.allSettled(results.map((r, i) => {
      const { u, d } = group[i];
      if (r.status === "fulfilled") {
        sent++;
        log(`sent ${d.kind} to ${code(u)}`);
        // remember which of today's reminders went out (older days are dropped)
        const lastPushes = Object.fromEntries(Object.entries(u.lastPushes || {}).filter(([, day]) => day === d.localDate));
        d.slots.forEach((tm) => { lastPushes[tm] = d.localDate; });
        const update = { lastPushes };
        if (d.kind === "checkin") update.lastPushDate = d.localDate;
        return u.ref.update(update);
      }
      const errCode = r.reason && r.reason.code;
      log(`failed ${d.kind} to ${code(u)}: ${errCode || (r.reason && r.reason.message) || "unknown"}`);
      if (BAD_TOKEN_CODES.has(errCode)) { invalid++; return u.ref.update({ fcmToken: null, notify: false }); }
      failed++;
      return null;
    }));
  }

  const summary = computeSummary(users, now);
  await db.collection("stats").doc("summary").set(summary);

  log(`users: ${users.length}, due: ${due.length}, sent: ${sent}, invalid tokens cleared: ${invalid}, other failures: ${failed}`);
  log(`summary: ${summary.users} active users, ${summary.checkedInToday} checked in today`);
}
