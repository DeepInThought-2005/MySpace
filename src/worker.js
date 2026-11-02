// Study planner on Cloudflare Workers.
//
// - Static UI is served from ./static (Workers assets).
// - A cron trigger pulls the Moodle calendar export (iCal) every 10 minutes;
//   POST /api/refresh does the same on demand.
// - Everything is stored in the PLANNER KV namespace:
//     moodle_cache  { uid: event }    every Moodle event seen so far
//     sync          { lastSync, lastAttempt, error }
//     tasks         [ task ]          user recurring tasks
//     state         { done: [key] }   Moodle uids / "<taskId>@<YYYY-MM-DD>" marked done
// - /api/* requires a session cookie obtained with APP_PASSWORD.
//
// Secrets (wrangler secret put …): MOODLE_ICS_URL, APP_PASSWORD

const REFRESH_SECONDS = 10 * 60;
const COOKIE = "planner_session";
const SESSION_DAYS = 60;

// ---------------------------------------------------------------- KV helpers

async function getJson(env, key, fallback) {
  const v = await env.PLANNER.get(key, "json");
  return v ?? fallback;
}
const putJson = (env, key, value) => env.PLANNER.put(key, JSON.stringify(value));

// ---------------------------------------------------------------- iCal

function unfold(text) {
  // RFC 5545: a line starting with a space or tab continues the previous one.
  return text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function unescapeIcs(value) {
  return value.replace(/\\([nN,;\\])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));
}

function parseDt(params, value) {
  value = value.trim();
  if (params.includes("VALUE=DATE") || /^\d{8}$/.test(value)) {
    return [`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`, true];
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return [value, false];
  const [, y, mo, d, h, mi, s, z] = m;
  // Floating / TZID times are passed through as local time.
  return [`${y}-${mo}-${d}T${h}:${mi}:${s}${z}`, false];
}

function classify(summary) {
  const s = summary.toLowerCase();
  if (s.endsWith(" opens") || s.includes("öffnet")) return "opens";
  if (s.endsWith(" closes") || s.includes("is due") || s.includes("fällig")
      || s.includes("abgabe") || s.includes("deadline") || s.includes("due:")) return "due";
  return "event";
}

function parseIcs(text) {
  const events = [];
  let cur = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      if (cur && cur.uid) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const [name, ...paramList] = line.slice(0, colon).split(";");
    const params = paramList.join(";");
    const value = line.slice(colon + 1);
    switch (name) {
      case "UID": cur.uid = value; break;
      case "SUMMARY": cur.title = unescapeIcs(value); break;
      case "DESCRIPTION": cur.description = unescapeIcs(value).trim(); break;
      case "CATEGORIES": cur.course = unescapeIcs(value); break;
      case "DTSTART": [cur.start, cur.allDay] = parseDt(params, value); break;
      case "DTEND": [cur.end] = parseDt(params, value); break;
      case "LAST-MODIFIED": cur.modified = value; break;
    }
  }
  for (const ev of events) {
    ev.title ??= "(untitled)";
    ev.kind = classify(ev.title);
    if (ev.end === ev.start) delete ev.end;
  }
  return events;
}

async function syncMoodle(env) {
  const now = new Date().toISOString();
  const sync = await getJson(env, "sync", {});
  sync.lastAttempt = now;
  try {
    if (!env.MOODLE_ICS_URL) throw new Error("MOODLE_ICS_URL secret is not set.");
    const resp = await fetch(env.MOODLE_ICS_URL, { headers: { "User-Agent": "MySpace-StudyPlanner/1.0" } });
    if (!resp.ok) throw new Error(`Moodle answered HTTP ${resp.status}`);
    const text = await resp.text();
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("Response is not an iCal calendar (check the URL / token).");
    const fresh = parseIcs(text);
    const freshIds = new Set(fresh.map((e) => e.uid));
    const cache = await getJson(env, "moodle_cache", {});
    const before = JSON.stringify(cache);
    // Moodle's "recent & upcoming" export only covers a window, so keep past
    // events we've already seen. Future events missing from the feed were deleted.
    for (const [uid, ev] of Object.entries(cache)) {
      if (!freshIds.has(uid) && (ev.start || "") >= now.slice(0, 10)) delete cache[uid];
    }
    for (const ev of fresh) cache[ev.uid] = ev;
    if (JSON.stringify(cache) !== before) await putJson(env, "moodle_cache", cache);
    sync.lastSync = now;
    sync.error = null;
  } catch (err) {
    sync.error = `${err.name}: ${err.message}`;
  }
  await putJson(env, "sync", sync);
}

async function eventsPayload(env) {
  const [cache, sync, state] = await Promise.all([
    getJson(env, "moodle_cache", {}),
    getJson(env, "sync", {}),
    getJson(env, "state", { done: [] }),
  ]);
  return {
    lastSync: sync.lastSync ?? null,
    lastAttempt: sync.lastAttempt ?? null,
    error: sync.error ?? null,
    refreshSeconds: REFRESH_SECONDS,
    events: Object.values(cache).sort((a, b) => (a.start || "").localeCompare(b.start || "")),
    done: state.done || [],
  };
}

// ---------------------------------------------------------------- tasks

class BadRequest extends Error {}

const TASK_FIELDS = ["title", "notes", "color", "startDate", "endDate", "time",
  "durationMin", "freq", "interval", "byDay"];

function cleanTask(body) {
  const task = {};
  for (const k of TASK_FIELDS) if (k in body) task[k] = body[k];
  if (!String(task.title ?? "").trim()) throw new BadRequest("title is required");
  if (!["once", "daily", "weekly", "monthly"].includes(task.freq)) throw new BadRequest("freq must be once, daily, weekly or monthly");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(task.startDate ?? ""))) throw new BadRequest("startDate must be YYYY-MM-DD");
  task.interval = Math.max(1, parseInt(task.interval, 10) || 1);
  task.durationMin = Math.max(5, parseInt(task.durationMin, 10) || 60);
  task.byDay = (task.byDay || []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return task;
}

// ---------------------------------------------------------------- auth

async function sessionToken(env) {
  // Deterministic per password: changing APP_PASSWORD logs every device out.
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.APP_PASSWORD),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("planner-session-v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

async function isAuthed(request, env) {
  if (!env.APP_PASSWORD) return false;
  const cookie = readCookie(request, COOKIE);
  return !!cookie && timingSafeEqual(cookie, await sessionToken(env));
}

function sessionCookie(value, maxAge, request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

// ---------------------------------------------------------------- HTTP

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

async function handleApi(request, env, path) {
  const method = request.method;

  if (path === "/api/login" && method === "POST") {
    if (!env.APP_PASSWORD) return json({ error: "APP_PASSWORD secret is not set on the server." }, 500);
    const { password } = await request.json().catch(() => ({}));
    if (typeof password !== "string" || !timingSafeEqual(password, env.APP_PASSWORD)) {
      return json({ error: "Wrong password" }, 401);
    }
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(await sessionToken(env), SESSION_DAYS * 86400, request) });
  }
  if (path === "/api/logout" && method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0, request) });
  }

  if (!(await isAuthed(request, env))) return json({ error: "Not logged in" }, 401);

  if (path === "/api/events" && method === "GET") return json(await eventsPayload(env));

  if (path === "/api/refresh" && method === "POST") {
    await syncMoodle(env);
    return json(await eventsPayload(env));
  }

  if (path === "/api/tasks" && method === "GET") return json(await getJson(env, "tasks", []));

  if (path === "/api/tasks" && method === "POST") {
    const task = cleanTask(await request.json());
    task.id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const tasks = await getJson(env, "tasks", []);
    tasks.push(task);
    await putJson(env, "tasks", tasks);
    return json(task, 201);
  }

  const m = path.match(/^\/api\/tasks\/([0-9a-f]+)$/);
  if (m && method === "PUT") {
    const update = cleanTask(await request.json());
    const tasks = await getJson(env, "tasks", []);
    const t = tasks.find((x) => x.id === m[1]);
    if (!t) return json({ error: "not found" }, 404);
    for (const k of TASK_FIELDS) if (!(k in update)) delete t[k];
    Object.assign(t, update);
    await putJson(env, "tasks", tasks);
    return json(t);
  }
  if (m && method === "DELETE") {
    const tasks = await getJson(env, "tasks", []);
    const kept = tasks.filter((x) => x.id !== m[1]);
    await putJson(env, "tasks", kept);
    return json({ ok: kept.length !== tasks.length });
  }

  if (path === "/api/done" && method === "POST") {
    const body = await request.json();
    const key = String(body.key ?? "");
    const state = await getJson(env, "state", { done: [] });
    const keys = new Set(state.done || []);
    body.done ? keys.add(key) : keys.delete(key);
    state.done = [...keys].sort();
    await putJson(env, "state", state);
    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/")) {
      try {
        return await handleApi(request, env, path);
      } catch (err) {
        const badInput = err instanceof BadRequest || err instanceof SyntaxError;
        return json({ error: err.message }, badInput ? 400 : 500);
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env) {
    await syncMoodle(env);
  },
};
