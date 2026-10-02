// Meal Prep nightly reminders.
// Deploy in the dashboard (Edge Functions > Deploy a new function > Via Editor), name it "meal-reminders",
// and turn OFF JWT verification for it; this code checks its own secrets instead.
// Secrets (Edge Functions > Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com), CRON_SECRET.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT")!,
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// <plan-logic> (plain JS so the tests can run it; keep in sync with tonightLines() in index.html)
function dayIndex(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
function mod(n, m) { return ((n % m) + m) % m; }
function tonightMessage(planStart, todayLocal) {
  const diff = dayIndex(planStart, todayLocal);
  if (diff < -1) return null;
  if (diff === -1) {
    return { title: "Tonight's move", body: "Tomorrow is Week A, Day 1. Load the gym and retail bins after prep." };
  }
  const c = mod(diff, 14);
  const w = c < 7 ? "A" : "B";
  const d = (c % 7) + 1;
  const nd = d === 7 ? 1 : d + 1;
  const nw = d === 7 ? (w === "A" ? "B" : "A") : w;
  const parts = [];
  if (d === 7) {
    parts.push(`Tomorrow is Week ${nw}, Day 1. Its food is in the fridge after prep; load the bins.`);
  } else if (nd >= 4) {
    parts.push(`Move Week ${nw}, Day ${nd} food and sauce cups from the freezer to the fridge, then load tomorrow's bins.`);
  } else {
    parts.push(`Week ${nw}, Day ${nd} food is in the fridge. Load tomorrow's bins.`);
  }
  if (w === "A" && d === 5) parts.push("Also move the Week B chicken to the fridge.");
  if (d === 6) parts.push(`Tomorrow is prep day. Check the ${w === "A" ? "quick stop" : "big trip"} list.`);
  return { title: "Tonight's move", body: parts.join(" ") };
}
function localNow(tz, now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}
function isDue(remindAt, lastSentOn, local) {
  const [h, m] = String(remindAt).split(":").map(Number);
  const target = h * 60 + m;
  // Send once per local day, in the first hour after the chosen time (cron runs every 15 minutes).
  return lastSentOn !== local.date && local.minutes >= target && local.minutes < target + 60;
}
// </plan-logic>

type Sub = {
  id: string; user_id: string; endpoint: string; p256dh: string; auth: string;
  remind_at: string; tz: string; plan_start: string; last_sent_on: string | null;
};

async function send(sub: Sub, payload: { title: string; body: string; tag?: string }) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 4, urgency: "normal" },
    );
    return "sent";
  } catch (err) {
    const code = (err as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) {
      await admin.from("push_subscriptions").delete().eq("id", sub.id);
      return "expired";
    }
    console.error("push failed", code, (err as Error).message);
    return "error";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.json().catch(() => ({}));

  // Test from the app: the signed-in user's own device(s) only.
  if (body.mode === "test") {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return json({ error: "Not signed in" }, 401);
    let q = admin.from("push_subscriptions").select("*").eq("user_id", data.user.id);
    if (body.endpoint) q = q.eq("endpoint", body.endpoint);
    const { data: subs, error: qErr } = await q;
    if (qErr) return json({ error: qErr.message }, 500);
    const results = [];
    for (const s of (subs ?? []) as Sub[]) {
      const local = localNow(s.tz, new Date());
      const msg = tonightMessage(s.plan_start, local.date) ??
        { title: "Tonight's move", body: "Reminders are working. The plan hasn't started yet." };
      results.push(await send(s, { ...msg, title: "Test: " + msg.title, tag: "test" }));
    }
    return json({ sent: results.length, results });
  }

  // Scheduled run from pg_cron.
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const { data: subs, error } = await admin.from("push_subscriptions").select("*");
  if (error) return json({ error: error.message }, 500);

  const now = new Date();
  let sent = 0;
  for (const s of (subs ?? []) as Sub[]) {
    let local;
    try { local = localNow(s.tz, now); } catch { local = localNow("America/Los_Angeles", now); }
    if (!isDue(s.remind_at, s.last_sent_on, local)) continue;
    const msg = tonightMessage(s.plan_start, local.date);
    // Mark as handled for today either way, so a failing device isn't retried every 15 minutes.
    await admin.from("push_subscriptions").update({ last_sent_on: local.date }).eq("id", s.id);
    if (!msg) continue;
    if ((await send(s, msg)) === "sent") sent++;
  }
  return json({ checked: subs?.length ?? 0, sent });
});
