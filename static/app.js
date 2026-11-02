// Study planner front end. Talks to server.py:
//   GET  /api/events   cached Moodle events + sync status + done keys
//   POST /api/refresh  fetch Moodle now
//   GET/POST/PUT/DELETE /api/tasks  user recurring tasks
//   POST /api/done     toggle done for a Moodle uid or "<taskId>@<YYYY-MM-DD>"

const POLL_MS = 60 * 1000; // re-read the server cache; the server itself hits Moodle every 10 min

const state = {
  events: [],
  tasks: [],
  done: new Set(),
  courseNames: {},
  sync: {},
  hiddenCourses: loadPref("hiddenCourses", []),
  showOpens: loadPref("showOpens", false),
};

const COURSE_COLORS = ["#2f6fde", "#d9480f", "#2b8a3e", "#ae3ec9", "#0b7285", "#c2255c", "#5f3dc4", "#e67700"];
const DAY_MS = 86400000;

// ------------------------------------------------------------ helpers

function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem("planner." + key);
    return v === null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem("planner." + key, JSON.stringify(value)); } catch { /* ignore */ }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401 && path !== "/api/login") {
    await requireLogin();
    return api(path, options);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// One shared login prompt, however many requests hit 401 at once.
let loginPromise = null;
function requireLogin() {
  if (loginPromise) return loginPromise;
  const dlg = document.getElementById("login-dialog");
  const form = document.getElementById("login-form");
  const err = document.getElementById("login-error");
  loginPromise = new Promise((resolve) => {
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      err.hidden = true;
      try {
        await api("/api/login", { method: "POST", body: { password: form.password.value } });
        form.reset();
        dlg.close();
        loginPromise = null;
        resolve();
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
      }
    };
  });
  dlg.addEventListener("cancel", (e) => e.preventDefault()); // Esc can't dismiss it
  if (!dlg.open) dlg.showModal();
  form.password.focus();
  return loginPromise;
}

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function parseYmd(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function courseColor(course) {
  if (!course) return "#868e96";
  let h = 0;
  for (const ch of course) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COURSE_COLORS[h % COURSE_COLORS.length];
}
// "252-0057-00L 2026W" -> "252-0057-00L"
const courseCode = (c) => (c || "Other").replace(/\s+\d{4}[WS]$/, "");
// Course title from the ETH catalogue when the server found one, else the code.
const courseLabel = (c) => state.courseNames[c] || courseCode(c);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmtWhen(date, allDay) {
  const opts = { weekday: "short", day: "numeric", month: "short" };
  if (!allDay) Object.assign(opts, { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleString(undefined, opts);
}
function relTime(iso) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} h ago`;
}

// ------------------------------------------------------------ recurrence

// Monday-based week index, used to honour "every N weeks".
function weekIndex(d) {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return Math.round(monday.getTime() / (7 * DAY_MS));
}
function monthIndex(d) { return d.getFullYear() * 12 + d.getMonth(); }

// All occurrence dates (YYYY-MM-DD) of a task inside [from, to).
function occurrences(task, from, to) {
  const start = parseYmd(task.startDate);
  const end = task.endDate ? parseYmd(task.endDate) : null;
  const out = [];
  if (task.freq === "once") {
    if (start >= from && start < to) out.push(task.startDate);
    return out;
  }
  const byDay = task.byDay && task.byDay.length ? task.byDay : [start.getDay()];
  const interval = task.interval || 1;
  let d = new Date(Math.max(start, from));
  d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  for (; d < to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    if (end && d > end) break;
    let hit = false;
    if (task.freq === "daily") {
      hit = Math.round((d - start) / DAY_MS) % interval === 0;
    } else if (task.freq === "weekly") {
      hit = byDay.includes(d.getDay()) && (weekIndex(d) - weekIndex(start)) % interval === 0;
    } else if (task.freq === "monthly") {
      hit = d.getDate() === start.getDate() && (monthIndex(d) - monthIndex(start)) % interval === 0;
    }
    if (hit) out.push(ymd(d));
  }
  return out;
}

function taskInstances(from, to) {
  const list = [];
  for (const task of state.tasks) {
    for (const day of occurrences(task, from, to)) {
      const key = `${task.id}@${day}`;
      let start, end, allDay = !task.time;
      if (allDay) {
        start = parseYmd(day);
      } else {
        const [h, m] = task.time.split(":").map(Number);
        const base = parseYmd(day);
        start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m);
        end = new Date(start.getTime() + (task.durationMin || 60) * 60000);
      }
      list.push({ key, task, day, start, end, allDay, done: state.done.has(key) });
    }
  }
  return list;
}

// ------------------------------------------------------------ data

function visibleMoodle() {
  return state.events.filter((e) =>
    !state.hiddenCourses.includes(e.course || "") && (state.showOpens || e.kind !== "opens"));
}

async function loadEvents() {
  const data = await api("/api/events");
  applyEvents(data);
}
function applyEvents(data) {
  state.events = data.events || [];
  state.done = new Set(data.done || []);
  state.courseNames = data.courses || {};
  state.sync = data;
  renderAll();
}
async function loadTasks() {
  state.tasks = await api("/api/tasks");
  renderAll();
}

async function refreshNow() {
  const btn = document.getElementById("refresh-btn");
  btn.classList.add("busy");
  btn.disabled = true;
  try {
    applyEvents(await api("/api/refresh", { method: "POST" }));
  } catch (err) {
    state.sync = { ...state.sync, error: err.message };
    renderSync();
  } finally {
    btn.classList.remove("busy");
    btn.disabled = false;
  }
}

async function setDone(key, done) {
  done ? state.done.add(key) : state.done.delete(key);
  renderAll();
  try { await api("/api/done", { method: "POST", body: { key, done } }); }
  catch (err) { alert("Could not save: " + err.message); loadEvents(); }
}

// ------------------------------------------------------------ calendar

let calendar;

function calendarSource(info, success) {
  const out = [];
  for (const e of visibleMoodle()) {
    const done = state.done.has(e.uid);
    const color = courseColor(e.course);
    out.push({
      id: e.uid,
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: !!e.allDay,
      display: "block",
      backgroundColor: e.kind === "opens" ? "transparent" : color + "2e",
      borderColor: color + "8c",
      textColor: "var(--text)",
      classNames: ["box", `kind-${e.kind}`, done ? "is-done" : ""],
      extendedProps: { source: "moodle", ref: e },
    });
  }
  for (const inst of taskInstances(info.start, info.end)) {
    const color = inst.task.color || "#7c5cff";
    out.push({
      id: inst.key,
      title: inst.task.title,
      start: inst.start,
      end: inst.end,
      allDay: inst.allDay,
      // Always a box (never the month view's dot style), tinted with the task colour.
      display: "block",
      backgroundColor: color + "2e",
      borderColor: color + "8c",
      textColor: "var(--text)",
      classNames: ["box", "kind-task", inst.done ? "is-done" : ""],
      extendedProps: { source: "task", ref: inst },
    });
  }
  success(out);
}

function initCalendar() {
  const narrow = window.matchMedia("(max-width: 760px)").matches;
  calendar = new FullCalendar.Calendar(document.getElementById("calendar"), {
    initialView: narrow ? "listWeek" : "dayGridMonth",
    firstDay: 1,
    height: "100%",
    nowIndicator: true,
    dayMaxEvents: 4,
    // Moodle deadlines are points in time; don't let a 23:59 deadline spill into the next day.
    defaultTimedEventDuration: "00:01",
    headerToolbar: narrow
      ? { left: "prev,next", center: "title", right: "listWeek,dayGridMonth" }
      : { left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,listMonth" },
    buttonText: { today: "Today", month: "Month", week: "Week", list: "List" },
    eventTimeFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
    events: calendarSource,
    eventClick: (info) => openEventDialog(info.event),
    dateClick: (info) => openTaskDialog(null, info.dateStr.slice(0, 10)),
  });
  calendar.render();
}

// ------------------------------------------------------------ sidebar

function renderSync() {
  const el = document.getElementById("sync-status");
  const s = state.sync;
  if (s.error) {
    el.className = "sync-status err";
    el.textContent = `Sync failed (${relTime(s.lastSync)} last OK)`;
    el.title = s.error;
    return;
  }
  el.className = "sync-status";
  el.title = s.lastSync ? new Date(s.lastSync).toLocaleString() : "";
  let text = `Moodle synced ${relTime(s.lastSync)}`;
  if (s.lastAttempt && s.refreshSeconds) {
    const next = Math.max(0, Math.ceil((new Date(s.lastAttempt).getTime() + s.refreshSeconds * 1000 - Date.now()) / 60000));
    text += ` · next in ${next} min`;
  }
  el.textContent = text;
}

function renderCourses() {
  const courses = [...new Set(state.events.map((e) => e.course || ""))]
    .sort((a, b) => courseLabel(a).localeCompare(courseLabel(b)));
  const ul = document.getElementById("courses");
  if (!courses.length) {
    ul.innerHTML = `<li class="empty">No Moodle events yet.</li>`;
    return;
  }
  ul.innerHTML = courses.map((c) => `
    <li><label title="${esc(courseCode(c))}"><input type="checkbox" data-course="${esc(c)}" ${state.hiddenCourses.includes(c) ? "" : "checked"}>
      <span class="dot" style="background:${courseColor(c)}"></span>${esc(courseLabel(c))}</label></li>`).join("");
}

const FREQ_TEXT = { once: "Once", daily: "day", weekly: "week", monthly: "month" };
const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
function describeTask(t) {
  if (t.freq === "once") return `Once · ${parseYmd(t.startDate).toLocaleDateString()}`;
  let s = t.interval > 1 ? `Every ${t.interval} ${FREQ_TEXT[t.freq]}s` : `Every ${FREQ_TEXT[t.freq]}`;
  if (t.freq === "weekly") {
    const days = (t.byDay && t.byDay.length ? t.byDay : [parseYmd(t.startDate).getDay()]);
    s += " · " + [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => DAY_NAMES[d]).join(" ");
  }
  if (t.time) s += ` · ${t.time}`;
  return s;
}

function renderTasks() {
  const ul = document.getElementById("tasks");
  if (!state.tasks.length) {
    ul.innerHTML = `<li class="empty">No tasks yet. Use <b>+ Task</b> or click a day.</li>`;
    return;
  }
  ul.innerHTML = state.tasks.map((t) => `
    <li><button type="button" data-task="${esc(t.id)}">
      <span class="dot" style="background:${esc(t.color || "#7c5cff")}"></span>
      <div><div class="u-title">${esc(t.title)}</div><div class="u-sub">${esc(describeTask(t))}</div></div>
    </button></li>`).join("");
}

function renderAll() {
  renderSync();
  renderCourses();
  renderTasks();
  if (calendar) calendar.refetchEvents();
}

// ------------------------------------------------------------ dialogs

const taskDialog = document.getElementById("task-dialog");
const taskForm = document.getElementById("task-form");
let editingTaskId = null;

function syncFreqFields() {
  const freq = taskForm.freq.value;
  document.getElementById("weekdays").hidden = freq !== "weekly";
  taskForm.querySelector(".interval-field").hidden = freq === "once";
  taskForm.endDate.closest("label").hidden = freq === "once";
  document.getElementById("interval-unit").textContent = `${FREQ_TEXT[freq]}(s)`;
}

function openTaskDialog(task, dateStr) {
  editingTaskId = task ? task.id : null;
  taskForm.reset();
  document.getElementById("task-dialog-title").textContent = task ? "Edit task" : "New task";
  document.getElementById("task-delete").hidden = !task;
  document.getElementById("task-error").hidden = true;
  const t = task || { freq: "weekly", interval: 1, startDate: dateStr || ymd(new Date()), durationMin: 60, color: "#7c5cff" };
  taskForm.title.value = t.title || "";
  taskForm.freq.value = t.freq;
  taskForm.interval.value = t.interval || 1;
  taskForm.startDate.value = t.startDate;
  taskForm.endDate.value = t.endDate || "";
  taskForm.time.value = t.time || "";
  taskForm.durationMin.value = t.durationMin || 60;
  taskForm.color.value = t.color || "#7c5cff";
  taskForm.notes.value = t.notes || "";
  const days = task ? (t.byDay || []) : [parseYmd(t.startDate).getDay()];
  for (const cb of taskForm.querySelectorAll("[name=byDay]")) cb.checked = days.includes(Number(cb.value));
  syncFreqFields();
  taskDialog.showModal();
  taskForm.title.focus();
}

taskForm.freq.addEventListener("change", syncFreqFields);
document.getElementById("task-cancel").addEventListener("click", () => taskDialog.close());

taskForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = taskForm;
  const body = {
    title: f.title.value.trim(),
    freq: f.freq.value,
    interval: Number(f.interval.value) || 1,
    byDay: [...f.querySelectorAll("[name=byDay]:checked")].map((cb) => Number(cb.value)),
    startDate: f.startDate.value,
    endDate: f.freq.value === "once" ? null : (f.endDate.value || null),
    time: f.time.value || null,
    durationMin: Number(f.durationMin.value) || 60,
    color: f.color.value,
    notes: f.notes.value.trim(),
  };
  try {
    if (body.endDate && body.endDate < body.startDate) throw new Error("End date is before the start date.");
    if (editingTaskId) await api(`/api/tasks/${editingTaskId}`, { method: "PUT", body });
    else await api("/api/tasks", { method: "POST", body });
    taskDialog.close();
    await loadTasks();
  } catch (err) {
    const el = document.getElementById("task-error");
    el.textContent = err.message;
    el.hidden = false;
  }
});

document.getElementById("task-delete").addEventListener("click", async () => {
  if (!editingTaskId || !confirm("Delete this task and all its repeats?")) return;
  await api(`/api/tasks/${editingTaskId}`, { method: "DELETE" });
  taskDialog.close();
  await loadTasks();
});

const eventDialog = document.getElementById("event-dialog");
let openEventKey = null;
let openEventTask = null;

function openEventDialog(fcEvent) {
  const { source, ref } = fcEvent.extendedProps;
  const course = document.getElementById("ev-course");
  const desc = document.getElementById("ev-desc");
  document.getElementById("ev-title").textContent = fcEvent.title;
  document.getElementById("ev-when").textContent =
    fmtWhen(fcEvent.start, fcEvent.allDay) + (fcEvent.end && !fcEvent.allDay ? ` – ${fcEvent.end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : "");
  if (source === "moodle") {
    openEventKey = ref.uid;
    openEventTask = null;
    course.textContent = courseLabel(ref.course);
    course.style.color = courseColor(ref.course);
    desc.textContent = ref.description || "";
  } else {
    openEventKey = ref.key;
    openEventTask = ref.task;
    course.textContent = "My task · " + describeTask(ref.task);
    course.style.color = ref.task.color;
    desc.textContent = ref.task.notes || "";
  }
  document.getElementById("ev-done").checked = state.done.has(openEventKey);
  document.getElementById("ev-edit").hidden = !openEventTask;
  eventDialog.showModal();
}

document.getElementById("ev-done").addEventListener("change", (e) => setDone(openEventKey, e.target.checked));
document.getElementById("ev-close").addEventListener("click", () => eventDialog.close());
document.getElementById("ev-edit").addEventListener("click", () => {
  eventDialog.close();
  openTaskDialog(openEventTask);
});
for (const dlg of [taskDialog, eventDialog]) {
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // click on backdrop
}

// ------------------------------------------------------------ wiring

document.getElementById("refresh-btn").addEventListener("click", refreshNow);
document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  location.reload();
});
document.getElementById("add-task-btn").addEventListener("click", () => openTaskDialog(null));

document.getElementById("courses").addEventListener("change", (e) => {
  const c = e.target.dataset.course;
  if (c === undefined) return;
  state.hiddenCourses = e.target.checked
    ? state.hiddenCourses.filter((x) => x !== c)
    : [...state.hiddenCourses, c];
  savePref("hiddenCourses", state.hiddenCourses);
  renderAll();
});
document.getElementById("tasks").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-task]");
  if (btn) openTaskDialog(state.tasks.find((t) => t.id === btn.dataset.task));
});
const showOpens = document.getElementById("show-opens");
showOpens.checked = state.showOpens;
showOpens.addEventListener("change", () => {
  state.showOpens = showOpens.checked;
  savePref("showOpens", state.showOpens);
  renderAll();
});

initCalendar();
Promise.all([loadEvents(), loadTasks()]).catch((err) => {
  state.sync = { error: err.message };
  renderSync();
});
setInterval(() => loadEvents().catch(() => {}), POLL_MS);
setInterval(renderSync, 30 * 1000);
