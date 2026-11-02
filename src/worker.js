// My Space on Cloudflare Workers.
//
// Serves the My Space front end (./static) behind a password, and provides the
// API that the local server.py used to provide:
//   GET/PUT        /api/state                    shared app state (spaces, schedule, study tasks, progress, theme…)
//   GET            /api/assignments[?refresh=1]  Moodle deadlines (archive of every deadline seen)
//   GET/POST       /api/assignment-files         list / upload your files for an assignment
//   GET            /api/assignment-files/<id>    download one file
//   GET/PUT/DELETE /api/background-image         custom background photo
//   POST           /api/login, /api/logout
//
// A cron trigger refreshes the Moodle archive every 10 minutes.
//
// KV namespace PLANNER:
//   shared_state        { initialized, revision, spaces, personalTasks, studyTasks, progress, … }
//   moodle_assignments  [ assignment ]       every Moodle deadline seen (the feed only covers a window)
//   courses             { category: name }   course titles looked up in the ETH course catalogue
//   sync                { lastSync, lastAttempt, error }
//   file_index          [ file metadata ]
//   file:<id>           uploaded file bytes
//   background_image    background photo bytes (metadata: { type })
//
// Secrets (wrangler secret put …): MOODLE_ICS_URL, APP_PASSWORD

const COOKIE = "planner_session";
const SESSION_DAYS = 60;
const MAX_UPLOAD = 20_000_000;
const MAX_STATE = 8_000_000;
const MOODLE_HOST = "moodle-app2.let.ethz.ch";

// ---------------------------------------------------------------- KV helpers

async function getJson(env, key, fallback) {
  const v = await env.PLANNER.get(key, "json");
  return v ?? fallback;
}
const putJson = (env, key, value) => env.PLANNER.put(key, JSON.stringify(value));

class BadRequest extends Error {}

// ---------------------------------------------------------------- dates & URLs

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// "2026-11-02" -> days since epoch, or null when not a real date.
function dayNumber(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  return new Date(t).toISOString().slice(0, 10) === value ? t / 86400000 : null;
}

function safeWebUrl(value) {
  try {
    const url = new URL(String(value).trim());
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? String(value).trim() : null;
  } catch {
    return null;
  }
}

// Offset (ms) of a time zone from UTC at a given instant.
function zoneOffset(utcMs, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - utcMs;
}

// Wall-clock time in a zone -> UTC milliseconds.
function zonedToUtc(y, mo, d, h, mi, s, timeZone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let utc = guess - zoneOffset(guess, timeZone);
  utc = guess - zoneOffset(utc, timeZone); // second pass settles DST transitions
  return utc;
}

const isoUtc = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

// ---------------------------------------------------------------- iCal → assignments

function unfold(text) {
  const lines = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  }
  return lines;
}

const unescapeIcs = (value) => String(value).replace(/\\([nN,;\\])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));

// DTSTART params + value -> [due, allDay]; due is "YYYY-MM-DD" or a UTC ISO string.
function parseDue(key, value) {
  if (key.includes("VALUE=DATE") || /^\d{8}$/.test(value)) {
    return [`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`, true];
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/);
  if (!m) throw new Error(`Unrecognised date ${value}`);
  const [, y, mo, d, h, mi, s = "0", z] = m;
  if (z) return [isoUtc(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), false];
  const zone = (key.match(/TZID=([^;:]+)/) || [])[1] || "Europe/Zurich";
  return [isoUtc(zonedToUtc(+y, +mo, +d, +h, +mi, +s, zone)), false];
}

function moodleEventUrl(uid, due, allDay) {
  const m = String(uid).match(/^(\d+)@moodle-app2\.let\.ethz\.ch$/);
  if (!m) return null;
  let ms;
  if (allDay) {
    const [y, mo, d] = due.split("-").map(Number);
    ms = zonedToUtc(y, mo, d, 0, 0, 0, "Europe/Zurich");
  } else {
    ms = Date.parse(due);
  }
  return `https://${MOODLE_HOST}/calendar/view.php?view=day&time=${Math.floor(ms / 1000)}#event_${m[1]}`;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", eacute: "é", egrave: "è" };

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

// HTML description -> { text, links } (links from <a href> and <img src>).
function readHtml(html) {
  const cleaned = html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "");
  const links = [];
  for (const m of cleaned.matchAll(/<(a|img)\b[^>]*?\b(href|src)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const tag = m[1].toLowerCase();
    const attr = m[2].toLowerCase();
    if ((tag === "a" && attr === "href") || (tag === "img" && attr === "src")) links.push(decodeEntities(m[4] ?? m[5] ?? m[6] ?? ""));
  }
  const text = decodeEntities(cleaned
    .replace(/<(p|div|br|li)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|li)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, ""));
  return { text, links };
}

const URL_IN_TEXT = /https:\/\/[^\s<>"\]]+/g;

function assignmentDetails(event) {
  let description = unescapeIcs(event.DESCRIPTION || "").trim();
  let links = [];
  if (/<[a-zA-Z][^>]*>/.test(description)) {
    const read = readHtml(description);
    links = read.links;
    description = read.text.replace(/\n{3,}/g, "\n\n").trim();
  }
  const candidates = [...(event._attachments || [])];
  for (const url of [...links, ...(description.match(URL_IN_TEXT) || [])]) {
    if (!safeWebUrl(url)) continue;
    const path = new URL(url).pathname.toLowerCase();
    if (path.includes("/pluginfile.php/") || /\.(pdf|png|jpe?g|gif|webp|zip|docx?|pptx?|xlsx?|txt)$/.test(path)) candidates.push(["ATTACH", url]);
  }
  const attachments = [];
  const seen = new Set();
  for (const [key, value] of candidates) {
    if (/VALUE=BINARY|ENCODING=BASE64/i.test(key)) continue;
    const url = safeWebUrl(unescapeIcs(value));
    if (!url || seen.has(url)) continue;
    seen.add(url);
    let name = new URL(url).pathname.split("/").pop();
    try { name = decodeURIComponent(name); } catch { /* keep the raw name */ }
    const mime = key.match(/(?:^|;)FMTTYPE=([^;]+)/i);
    attachments.push({ name: name || "Attachment", url, type: mime ? mime[1].replace(/"/g, "") : "" });
  }
  return { description, attachments };
}

// Prefer a provided assignment URL; a calendar export may omit module links.
function assignmentSubmission(event, fallbackUrl) {
  const raw = unescapeIcs(event.DESCRIPTION || "");
  const links = [unescapeIcs(event.URL || ""), ...readHtml(raw).links, ...(raw.match(URL_IN_TEXT) || [])];
  for (const value of links) {
    const url = safeWebUrl(value);
    if (!url) continue;
    const parts = new URL(url);
    if (parts.host === MOODLE_HOST && parts.pathname === "/mod/assign/view.php"
        && parts.searchParams.getAll("id").some((id) => /^\d+$/.test(id))) {
      return { url, direct: true };
    }
  }
  // Moodle assignment deadlines are labelled "is due"/"fällig"; quizzes close.
  const title = unescapeIcs(event.SUMMARY || "");
  if (fallbackUrl && /\bis due\b|\bfällig\b/i.test(title) && !/\bquiz\b/i.test(title)) return { url: fallbackUrl, direct: false };
  return null;
}

// Feed text -> assignments with `course` still set to the raw Moodle category.
function parseCalendar(text) {
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("The Moodle response was not a calendar.");
  const events = [];
  let event = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") {
      event = {};
    } else if (line === "END:VEVENT" && event) {
      const title = unescapeIcs(event.SUMMARY || "").trim();
      const dueKey = Object.keys(event).find((k) => k.startsWith("DTSTART"));
      if (/\bis due\b|\bfällig\b|\bcloses\b|\bdeadline\b/i.test(title) && dueKey) {
        const [due, allDay] = parseDue(dueKey, event[dueKey]);
        const category = unescapeIcs(event.CATEGORIES || "").trim();
        const uid = event.UID || title + due;
        const fallback = moodleEventUrl(uid, due, allDay);
        events.push({
          id: uid, title, course: category, due, allDay,
          url: safeWebUrl(unescapeIcs(event.URL || "")) || fallback,
          submission: assignmentSubmission(event, fallback),
          ...assignmentDetails(event),
        });
      }
      event = null;
    } else if (event && line.includes(":")) {
      const i = line.indexOf(":");
      const key = line.slice(0, i);
      const value = line.slice(i + 1);
      const name = key.split(";")[0];
      if (name === "ATTACH") (event._attachments ||= []).push([key, value]);
      else event[key.startsWith("DTSTART") ? key : name] = value;
    }
  }
  return events;
}

// ---------------------------------------------------------------- course names

// Moodle category "252-0057-00L 2026W" -> "Theoretical Computer Science", via the
// public ETH course catalogue (VVZ). Returns null when it can't be found.
async function lookupCourseName(category) {
  const m = category.match(/^(\d{3}-\d{4}-\d{2}[A-Z]?)\s+(\d{4}[WS])$/);
  if (!m) return null;
  const url = "https://www.vvz.ethz.ch/Vorlesungsverzeichnis/sucheLehrangebot.view"
    + `?lang=en&search=on&seite=0&semkez=${m[2]}&lerneinheitscode=${encodeURIComponent(m[1])}`;
  const resp = await fetch(url, { headers: { "User-Agent": "MySpace/1.0" } });
  if (!resp.ok) return null;
  const title = (await resp.text()).match(/lerneinheit\.view\?[^"]*"[^>]*>([\s\S]*?)<\/a>/);
  return title ? decodeEntities(title[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() || null : null;
}

async function resolveCourseNames(env, categories) {
  const names = await getJson(env, "courses", {});
  let changed = false;
  for (const c of categories) {
    if (!c || c in names) continue;
    try {
      const name = await lookupCourseName(c);
      if (name) { names[c] = name; changed = true; }
    } catch { /* catalogue unreachable: try again on the next sync */ }
  }
  if (changed) await putJson(env, "courses", names);
  return names;
}

// ---------------------------------------------------------------- Moodle sync

function feedUrl(env) {
  const url = env.MOODLE_ICS_URL;
  if (!url) throw new Error("MOODLE_ICS_URL secret is not set.");
  const parts = new URL(url);
  if (parts.protocol !== "https:" || parts.host !== MOODLE_HOST || parts.pathname !== "/calendar/export_execute.php"
      || !parts.searchParams.get("authtoken")) {
    throw new Error("Invalid Moodle feed configuration.");
  }
  return url;
}

const byDue = (a, b) => (a.due || "").localeCompare(b.due || "")
  || (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase())
  || (a.id || "").localeCompare(b.id || "");

async function syncMoodle(env) {
  const sync = await getJson(env, "sync", {});
  sync.lastAttempt = new Date().toISOString();
  try {
    const resp = await fetch(feedUrl(env), {
      redirect: "manual",
      headers: { "User-Agent": "MySpace/1.0", Accept: "text/calendar" },
    });
    if (!resp.ok) throw new Error(`Moodle answered HTTP ${resp.status}`);
    const text = await resp.text();
    if (text.length > 2_000_000) throw new Error("The Moodle calendar is too large.");
    const fresh = parseCalendar(text.replace(/^﻿/, ""));
    const names = await resolveCourseNames(env, new Set(fresh.map((e) => e.course)));
    for (const e of fresh) e.course = names[e.course] || e.course;

    const archive = await getJson(env, "moodle_assignments", []);
    const byId = new Map(archive.filter((e) => e && typeof e.id === "string").map((e) => [e.id, e]));
    for (const e of fresh) byId.set(e.id, e);
    const merged = [...byId.values()].sort(byDue);
    if (JSON.stringify(merged) !== JSON.stringify(archive)) await putJson(env, "moodle_assignments", merged);
    sync.lastSync = sync.lastAttempt;
    sync.error = null;
  } catch (err) {
    sync.error = `${err.name}: ${err.message}`;
  }
  await putJson(env, "sync", sync);
  return sync;
}

// ---------------------------------------------------------------- shared state validation

const ID_RE = /^[a-zA-Z0-9-]{1,64}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const isStr = (v) => typeof v === "string";
const keysWithin = (obj, allowed) => Object.keys(obj).every((k) => allowed.includes(k));

// Weekly recurrence: exceptions (and done dates) must fall on the schedule's own weekday within range.
function validWeeklyDates(first, last, dates, max = 600) {
  if (!Array.isArray(dates) || dates.length > max || new Set(dates).size !== dates.length) return false;
  return dates.every((d) => {
    const n = dayNumber(d);
    return n !== null && n >= first && n <= last && (n - first) % 7 === 0;
  });
}

function validPersonalTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length > 500) return false;
  const ids = new Set();
  for (const t of tasks) {
    if (!t || typeof t !== "object" || Array.isArray(t)) return false;
    if (!["id", "title", "date", "start", "end"].every((k) => k in t)) return false;
    if (!keysWithin(t, ["id", "title", "date", "start", "end", "description", "recurrence", "color", "showInMonth", "completedDates"])) return false;
    if (![t.id, t.title, t.date, t.start, t.end].every(isStr)) return false;
    if (!ID_RE.test(t.id) || ids.has(t.id) || !t.title.trim() || t.title.length > 100) return false;
    if ("description" in t && (!isStr(t.description) || t.description.length > 1000)) return false;
    if ("color" in t && (!isStr(t.color) || !COLOR_RE.test(t.color))) return false;
    if ("showInMonth" in t && typeof t.showInMonth !== "boolean") return false;
    ids.add(t.id);
    const first = dayNumber(t.date);
    if (first === null || !TIME_RE.test(t.start) || !TIME_RE.test(t.end) || t.start >= t.end) return false;
    if (!("recurrence" in t)) {
      if ("completedDates" in t && (!Array.isArray(t.completedDates) || t.completedDates.some((d) => d !== t.date))) return false;
      continue;
    }
    const r = t.recurrence;
    if (!r || typeof r !== "object" || Object.keys(r).sort().join() !== "exceptions,frequency,until" || r.frequency !== "weekly") return false;
    const last = dayNumber(r.until);
    if (last === null || last < first || last - first > 3660) return false;
    if (!validWeeklyDates(first, last, r.exceptions)) return false;
    if ("completedDates" in t && !validWeeklyDates(first, last, t.completedDates)) return false;
  }
  return true;
}

function validStudyCourses(courses) {
  return Array.isArray(courses) && courses.length <= 300
    && courses.every((c) => isStr(c) && c.trim() && c.length <= 100)
    && new Set(courses.map((c) => c.toLowerCase())).size === courses.length;
}

function validHomeTodos(items) {
  if (!Array.isArray(items) || items.length > 500) return false;
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object" || Object.keys(item).sort().join() !== "done,id,title") return false;
    if (!isStr(item.id) || !ID_RE.test(item.id) || ids.has(item.id)) return false;
    if (!isStr(item.title) || !item.title.trim() || item.title.length > 120 || typeof item.done !== "boolean") return false;
    ids.add(item.id);
  }
  return true;
}

function validStudyTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length > 500) return false;
  const ids = new Set();
  for (const t of tasks) {
    if (!t || typeof t !== "object" || Array.isArray(t)) return false;
    if (!["id", "title", "course", "date", "time"].every((k) => k in t)) return false;
    if (!keysWithin(t, ["id", "title", "course", "date", "time", "description", "recurrence"])) return false;
    if (![t.id, t.title, t.course, t.date, t.time].every(isStr)) return false;
    if (!ID_RE.test(t.id) || ids.has(t.id) || !t.title.trim() || t.title.length > 120 || !t.course.trim() || t.course.length > 100) return false;
    if ("description" in t && (!isStr(t.description) || t.description.length > 1000)) return false;
    ids.add(t.id);
    const first = dayNumber(t.date);
    if (first === null || !TIME_RE.test(t.time)) return false;
    if (!("recurrence" in t)) continue;
    const r = t.recurrence;
    if (!r || typeof r !== "object" || r.frequency !== "weekly" || !("until" in r) || !keysWithin(r, ["frequency", "until", "exceptions"])) return false;
    const last = dayNumber(r.until);
    if (last === null || last < first || last - first > 3660) return false;
    if (!validWeeklyDates(first, last, r.exceptions ?? [])) return false;
  }
  return true;
}

const STATE_TYPES = {
  spaces: "array", trash: "array", progress: "object", background: "object", theme: "string",
  personalTasks: "array", personalRepeatUntil: "string", personalSavedColors: "array",
  studyCourses: "array", studyTasks: "array", homeTodos: "array",
};
const typeOf = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

function validateStateUpdate(incoming) {
  if (typeOf(incoming) !== "object" || !Object.keys(incoming).length) throw new BadRequest("Invalid shared state");
  for (const [k, v] of Object.entries(incoming)) {
    if (STATE_TYPES[k] !== typeOf(v)) throw new BadRequest(`Invalid shared state field ${k}`);
  }
  if ("theme" in incoming && !["day", "night"].includes(incoming.theme)) throw new BadRequest("Invalid theme");
  if ("personalTasks" in incoming && !validPersonalTasks(incoming.personalTasks)) throw new BadRequest("Invalid personal tasks");
  if ("studyCourses" in incoming && !validStudyCourses(incoming.studyCourses)) throw new BadRequest("Invalid study courses");
  if ("studyTasks" in incoming && !validStudyTasks(incoming.studyTasks)) throw new BadRequest("Invalid study tasks");
  if ("homeTodos" in incoming && !validHomeTodos(incoming.homeTodos)) throw new BadRequest("Invalid to-do list");
  if (incoming.personalRepeatUntil && dayNumber(incoming.personalRepeatUntil) === null) throw new BadRequest("Invalid repeat end date");
  const colors = incoming.personalSavedColors || [];
  if (colors.length > 1000 || colors.some((c) => !isStr(c) || !COLOR_RE.test(c))) throw new BadRequest("Invalid saved colors");
}

async function updateState(env, incoming) {
  validateStateUpdate(incoming);
  const state = await getJson(env, "shared_state", {});
  if (!Object.keys(state).length && !["spaces", "trash", "progress", "background"].every((k) => k in incoming)) {
    throw new BadRequest("The first save must include spaces, trash, progress and background.");
  }
  if (incoming.personalSavedColors) {
    incoming.personalSavedColors = [...new Set(incoming.personalSavedColors.map((c) => c.toLowerCase()))];
  }
  const revision = (state.revision || 0) + 1;
  Object.assign(state, incoming, { initialized: true, revision });
  await putJson(env, "shared_state", state);
  return revision;
}

// ---------------------------------------------------------------- uploads

const ascii = (bytes, from, to) => String.fromCharCode(...bytes.slice(from, to));

function sniffType(bytes, name) {
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  if (bytes[0] === 0x89 && ascii(bytes, 1, 8) === "PNG\r\n\x1a\n") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (/\.(txt|md|csv|json|py|js|c|cpp|tex)$/i.test(name)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return "text/plain; charset=utf-8";
    } catch { /* not UTF-8 text */ }
  }
  return "application/octet-stream";
}

function backgroundTypeOk(type, bytes) {
  return (type === "image/png" && bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG")
    || (type === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8)
    || (type === "image/webp" && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP");
}

async function readBody(request, limit) {
  const tooBig = () => Object.assign(new BadRequest("Choose a non-empty file under 20 MB."), { status: 413 });
  if (Number(request.headers.get("Content-Length") || 0) > limit) throw tooBig();
  const body = new Uint8Array(await request.arrayBuffer());
  if (!body.length || body.length > limit) throw tooBig();
  return body;
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
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
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

const LOGIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>My Space</title>
<style>
:root{font-family:'DM Sans',-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:#303036;color-scheme:light dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;box-sizing:border-box;
background:radial-gradient(circle at 12% 18%,#f5d9cc 0,transparent 34%),radial-gradient(circle at 83% 75%,#d9d6ed 0,transparent 38%),#f4efe9}
form{width:min(340px,100%);padding:30px;border-radius:24px;background:rgba(255,255,255,.75);box-shadow:0 20px 55px rgba(65,53,58,.1);backdrop-filter:blur(12px)}
h1{margin:0 0 4px;font-size:24px;letter-spacing:-.05em}h1 span{color:#e29680}p{margin:0 0 22px;color:#7a7076;font-size:13px}
label{display:block;margin-bottom:6px;font-size:13px;font-weight:600}
input{box-sizing:border-box;width:100%;padding:11px 13px;border:1px solid #e4d9d6;border-radius:12px;background:#fff;font:inherit;color:inherit}
input:focus{outline:3px solid #806cc044;border-color:#806cc0}
button{margin-top:16px;width:100%;padding:11px;border:0;border-radius:999px;background:#303039;color:#fff;font:inherit;font-weight:700;cursor:pointer}
.err{min-height:18px;margin:10px 0 0;color:#b4505a;font-size:13px}
@media (prefers-color-scheme:dark){:root{color:#eae5e2}body{background:#191b22}form{background:rgba(34,35,45,.88)}
input{background:#30313d;border-color:#514653}p{color:#b8b1bb}button{background:#dfbeb4;color:#27232b}}
</style></head>
<body><form id="f"><h1>my space<span>.</span></h1><p>Enter your password to continue.</p>
<label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Log in</button><p class="err" id="e" role="alert"></p></form>
<script>
document.getElementById('f').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const e = document.getElementById('e'); e.textContent = '';
  const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: document.getElementById('pw').value }) }).catch(() => null);
  if (r && r.ok) location.reload(); else e.textContent = r && r.status === 401 ? 'Wrong password.' : 'Could not log in. Try again.';
});
</script></body></html>`;

// ---------------------------------------------------------------- HTTP

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "SAMEORIGIN",
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS, ...headers },
  });
}

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/login" && method === "POST") {
    if (!env.APP_PASSWORD) return json({ error: "APP_PASSWORD secret is not set on the server." }, 500);
    const { password } = await request.json().catch(() => ({}));
    if (typeof password !== "string" || !timingSafeEqual(password, env.APP_PASSWORD)) return json({ error: "Wrong password" }, 401);
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(await sessionToken(env), SESSION_DAYS * 86400, request) });
  }
  if (path === "/api/logout" && method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0, request) });
  }

  if (!(await isAuthed(request, env))) return json({ error: "Not logged in" }, 401);

  // Writes must come from this site (the cookie is SameSite=Strict too).
  const origin = request.headers.get("Origin");
  if (method !== "GET" && method !== "HEAD" && origin && origin !== url.origin) return json({ error: "Forbidden" }, 403);

  // --- shared state
  if (path === "/api/state" && method === "GET") {
    return json(await getJson(env, "shared_state", { initialized: false, revision: 0 }));
  }
  if (path === "/api/state" && method === "PUT") {
    const raw = await request.text();
    if (!raw || raw.length > MAX_STATE) return json({ error: "Invalid size" }, 413);
    return json({ revision: await updateState(env, JSON.parse(raw)) });
  }

  // --- Moodle deadlines
  if (path === "/api/assignments" && method === "GET") {
    let assignments = await getJson(env, "moodle_assignments", null);
    if (url.searchParams.get("refresh") === "1" || assignments === null) {
      const sync = await syncMoodle(env);
      assignments = await getJson(env, "moodle_assignments", null);
      if (sync.error && assignments === null) {
        return json({ error: "Moodle deadlines are unavailable. Check the feed configuration." }, 502);
      }
    }
    return json({ assignments: assignments || [] });
  }

  // --- your files per assignment
  if (path === "/api/assignment-files" && method === "GET") {
    const assignment = url.searchParams.get("assignment") || "";
    const index = await getJson(env, "file_index", []);
    return json({ files: index.filter((f) => f.assignment === assignment) });
  }
  if (path === "/api/assignment-files" && method === "POST") {
    const assignment = url.searchParams.get("assignment") || "";
    let name = (url.searchParams.get("name") || "").replace(/\\/g, "/").split("/").pop();
    name = [...name].filter((ch) => ch >= " " && ch !== "\u007f").join("").trim().slice(0, 200);
    if (!assignment || assignment.length > 512 || !name) return json({ error: "An assignment and filename are required." }, 400);
    const body = await readBody(request, MAX_UPLOAD);
    const id = crypto.randomUUID().replace(/-/g, "");
    const file = { id, assignment, name, size: body.length, type: sniffType(body, name), url: `/api/assignment-files/${id}` };
    await env.PLANNER.put(`file:${id}`, body);
    const index = await getJson(env, "file_index", []);
    index.push(file);
    await putJson(env, "file_index", index);
    return json(file, 201);
  }
  const fileMatch = path.match(/^\/api\/assignment-files\/([0-9a-f]{32})$/);
  if (fileMatch && method === "GET") {
    const index = await getJson(env, "file_index", []);
    const file = index.find((f) => f.id === fileMatch[1]);
    const bytes = file && await env.PLANNER.get(`file:${file.id}`, "arrayBuffer");
    if (!bytes) return json({ error: "not found" }, 404);
    return new Response(bytes, {
      headers: {
        "Content-Type": file.type,
        "Content-Security-Policy": "default-src 'none'",
        "Cache-Control": "no-store",
        "Content-Disposition": file.type === "application/octet-stream" ? "attachment" : "inline",
        ...SECURITY_HEADERS,
      },
    });
  }

  // --- background photo
  if (path === "/api/background-image") {
    if (method === "GET") {
      const { value, metadata } = await env.PLANNER.getWithMetadata("background_image", "arrayBuffer");
      if (!value) return json({ error: "not found" }, 404);
      return new Response(value, { headers: { "Content-Type": metadata?.type || "image/jpeg", "Cache-Control": "no-store", ...SECURITY_HEADERS } });
    }
    if (method === "PUT") {
      const type = request.headers.get("Content-Type");
      const body = await readBody(request, MAX_UPLOAD);
      if (!backgroundTypeOk(type, body)) return json({ error: "Choose a JPG, PNG or WebP image." }, 400);
      await env.PLANNER.put("background_image", body, { metadata: { type } });
      return json({ saved: true });
    }
    if (method === "DELETE") {
      await env.PLANNER.delete("background_image");
      return json({ deleted: true });
    }
  }

  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        const badInput = err instanceof BadRequest || err instanceof SyntaxError;
        return json({ error: err.message }, err.status || (badInput ? 400 : 500));
      }
    }
    // Everything else (the app and its files) needs a login too.
    if (!(await isAuthed(request, env))) {
      return new Response(LOGIN_PAGE, {
        status: 401,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS },
      });
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env) {
    await syncMoodle(env);
  },
};
