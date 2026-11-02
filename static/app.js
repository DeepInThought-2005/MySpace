// Study planner front end. Talks to src/worker.js:
//   GET  /api/events   cached Moodle events + sync status + done keys
//   POST /api/refresh  fetch Moodle now
//   GET/POST/PUT/DELETE /api/tasks      user recurring tasks
//   GET/POST/PUT/DELETE /api/schedules  user schedule blocks (start/end time)
//   POST /api/done     toggle done for a Moodle uid or "<taskId>@<YYYY-MM-DD>"
//
// Two sections share one calendar: "tasks" (Moodle deadlines + tasks) and
// "schedule" (schedule blocks, week view, drag to create).

const POLL_MS = 60 * 1000; // re-read the server cache; the server itself hits Moodle every 10 min

const state = {
  events: [],
  tasks: [],
  schedules: [],
  mode: loadPref("mode", "tasks"),
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
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

function atTime(day, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const base = parseYmd(day);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m);
}

function scheduleInstances(from, to) {
  const list = [];
  for (const sched of state.schedules) {
    for (const day of occurrences(sched, from, to)) {
      list.push({ key: `${sched.id}@${day}`, sched, day, start: atTime(day, sched.startTime), end: atTime(day, sched.endTime) });
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
async function loadSchedules() {
  state.schedules = await api("/api/schedules");
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

const boxColors = (color) => ({ backgroundColor: color + "2e", borderColor: color + "8c", textColor: "var(--text)" });

function calendarSource(info, success) {
  const out = [];
  if (state.mode === "schedule") {
    for (const inst of scheduleInstances(info.start, info.end)) {
      out.push({
        id: inst.key,
        title: inst.sched.title,
        start: inst.start,
        end: inst.end,
        display: "block",
        ...boxColors(inst.sched.color || "#7c5cff"),
        classNames: ["box", "kind-schedule"],
        extendedProps: { source: "schedule", ref: inst, location: inst.sched.location || "" },
      });
    }
    return success(out);
  }
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
      ...boxColors(color),
      classNames: ["box", "kind-task", inst.done ? "is-done" : ""],
      extendedProps: { source: "task", ref: inst },
    });
  }
  success(out);
}

const narrow = window.matchMedia("(max-width: 760px)").matches;

// View + toolbar per section.
const MODE_VIEWS = {
  tasks: {
    view: narrow ? "listWeek" : "dayGridMonth",
    toolbar: narrow
      ? { left: "prev,next", center: "title", right: "listWeek,dayGridMonth" }
      : { left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,listMonth" },
  },
  schedule: {
    view: narrow ? "timeGridDay" : "timeGridWeek",
    toolbar: narrow
      ? { left: "prev,next", center: "title", right: "timeGridDay,listWeek" }
      : { left: "prev,next today", center: "title", right: "timeGridDay,timeGridWeek,dayGridMonth" },
  },
};

function onDateClick(info) {
  const date = info.dateStr.slice(0, 10);
  if (state.mode !== "schedule") return openItemDialog("task", null, { date });
  if (info.allDay) return openItemDialog("schedule", null, { date });
  const start = info.date;
  const end = new Date(start.getTime() + 60 * 60000);
  openItemDialog("schedule", null, { date, startTime: hhmm(start), endTime: end.getDate() === start.getDate() ? hhmm(end) : "23:59" });
}

function onSelect(info) {
  calendar.unselect();
  const date = ymd(info.start);
  if (info.allDay) return openItemDialog("schedule", null, { date });
  const sameDay = ymd(new Date(info.end.getTime() - 1)) === date;
  openItemDialog("schedule", null, { date, startTime: hhmm(info.start), endTime: sameDay && hhmm(info.end) !== "00:00" ? hhmm(info.end) : "23:59" });
}

function initCalendar() {
  calendar = new FullCalendar.Calendar(document.getElementById("calendar"), {
    initialView: MODE_VIEWS[state.mode].view,
    headerToolbar: MODE_VIEWS[state.mode].toolbar,
    selectable: state.mode === "schedule",
    selectMirror: true,
    // Drag-to-create stays within one day.
    selectAllow: (sel) => sel.allDay || ymd(sel.start) === ymd(new Date(sel.end.getTime() - 1)),
    select: onSelect,
    scrollTime: "08:00:00",
    allDaySlot: true,
    firstDay: 1,
    height: "100%",
    nowIndicator: true,
    dayMaxEvents: 4,
    // Moodle deadlines are points in time; don't let a 23:59 deadline spill into the next day.
    defaultTimedEventDuration: "00:01",
    buttonText: { today: "Today", month: "Month", week: "Week", day: "Day", list: "List" },
    eventTimeFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
    slotLabelFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
    dayHeaderFormat: narrow ? { weekday: "short" } : { weekday: "short", day: "numeric" },
    events: calendarSource,
    eventClick: (info) => openEventDialog(info.event),
    dateClick: onDateClick,
  });
  calendar.render();
}

function setMode(mode) {
  state.mode = mode;
  savePref("mode", mode);
  document.body.dataset.mode = mode;
  for (const b of document.querySelectorAll(".mode-switch [data-mode]")) {
    b.setAttribute("aria-selected", String(b.dataset.mode === mode));
  }
  document.getElementById("add-btn").textContent = mode === "schedule" ? "+ Schedule" : "+ Task";
  if (calendar) {
    calendar.setOption("selectable", mode === "schedule");
    calendar.setOption("headerToolbar", MODE_VIEWS[mode].toolbar);
    calendar.changeView(MODE_VIEWS[mode].view);
    calendar.refetchEvents();
  }
}

// ------------------------------------------------------------ sidebar

function renderSync() {
  const el = document.getElementById("sync-status");
  const s = state.sync;
  el.classList.toggle("err", !!s.error);
  if (s.error) {
    el.textContent = `Sync failed (${relTime(s.lastSync)} last OK)`;
    el.title = s.error;
    return;
  }
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
// "Every week · Mo We · 14:00" — works for tasks and schedules.
function describeItem(t) {
  if (t.freq === "once") {
    const s = `Once · ${parseYmd(t.startDate).toLocaleDateString()}`;
    return t.startTime ? `${s} · ${t.startTime}–${t.endTime}` : s;
  }
  let s = t.interval > 1 ? `Every ${t.interval} ${FREQ_TEXT[t.freq]}s` : `Every ${FREQ_TEXT[t.freq]}`;
  if (t.freq === "weekly") {
    const days = (t.byDay && t.byDay.length ? t.byDay : [parseYmd(t.startDate).getDay()]);
    s += " · " + [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => DAY_NAMES[d]).join(" ");
  }
  if (t.startTime) s += ` · ${t.startTime}–${t.endTime}`;
  else if (t.time) s += ` · ${t.time}`;
  return s;
}

function renderItemList(ulId, items, emptyHtml) {
  const ul = document.getElementById(ulId);
  if (!items.length) {
    ul.innerHTML = `<li class="empty">${emptyHtml}</li>`;
    return;
  }
  ul.innerHTML = items.map((t) => `
    <li><button type="button" data-id="${esc(t.id)}">
      <span class="dot" style="background:${esc(t.color || "#7c5cff")}"></span>
      <div><div class="u-title">${esc(t.title)}</div><div class="u-sub">${esc(describeItem(t))}${t.location ? " · " + esc(t.location) : ""}</div></div>
    </button></li>`).join("");
}

function renderTasks() {
  renderItemList("tasks", state.tasks, "No tasks yet. Use <b>+ Task</b> or click a day.");
}
function renderSchedules() {
  const sorted = [...state.schedules].sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
  renderItemList("schedules", sorted, "Nothing scheduled yet. Use <b>+ Schedule</b> or drag in the week view.");
}

function renderAll() {
  renderSync();
  renderCourses();
  renderTasks();
  renderSchedules();
  if (calendar) calendar.refetchEvents();
}

// ------------------------------------------------------------ dialogs

const taskDialog = document.getElementById("task-dialog");
const taskForm = document.getElementById("task-form");
let editing = { kind: "task", id: null };
const COLLECTION = { task: "tasks", schedule: "schedules" };

function syncFreqFields() {
  const freq = taskForm.freq.value;
  document.getElementById("weekdays").hidden = freq !== "weekly";
  taskForm.querySelector(".interval-field").hidden = freq === "once";
  taskForm.endDate.closest("label").hidden = freq === "once";
  document.getElementById("interval-unit").textContent = `${FREQ_TEXT[freq]}(s)`;
}

// kind: "task" | "schedule". item: existing one to edit, or null with
// prefill { date, startTime, endTime } for a new one.
function openItemDialog(kind, item, prefill = {}) {
  editing = { kind, id: item ? item.id : null };
  const isSchedule = kind === "schedule";
  taskForm.reset();
  taskForm.dataset.kind = kind;
  document.getElementById("task-dialog-title").textContent =
    `${item ? "Edit" : "New"} ${isSchedule ? "schedule" : "task"}`;
  taskForm.title.placeholder = isSchedule ? "e.g. Analysis II lecture" : "e.g. Review lecture notes";
  document.getElementById("task-delete").hidden = !item;
  document.getElementById("task-error").hidden = true;
  taskForm.startTime.required = taskForm.endTime.required = isSchedule;
  const t = item || {
    freq: isSchedule ? "once" : "weekly", interval: 1, startDate: prefill.date || ymd(new Date()),
    durationMin: 60, color: isSchedule ? "#4b7bec" : "#7c5cff",
    startTime: prefill.startTime || "09:00", endTime: prefill.endTime || "10:00",
  };
  taskForm.title.value = t.title || "";
  taskForm.freq.value = t.freq;
  taskForm.interval.value = t.interval || 1;
  taskForm.startDate.value = t.startDate;
  taskForm.endDate.value = t.endDate || "";
  taskForm.time.value = t.time || "";
  taskForm.durationMin.value = t.durationMin || 60;
  taskForm.startTime.value = t.startTime || "";
  taskForm.endTime.value = t.endTime || "";
  taskForm.location.value = t.location || "";
  taskForm.color.value = t.color || "#7c5cff";
  taskForm.notes.value = t.notes || "";
  const days = item ? (t.byDay || []) : [parseYmd(t.startDate).getDay()];
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
    color: f.color.value,
    notes: f.notes.value.trim(),
  };
  if (editing.kind === "schedule") {
    Object.assign(body, { startTime: f.startTime.value, endTime: f.endTime.value, location: f.location.value.trim() });
  } else {
    Object.assign(body, { time: f.time.value || null, durationMin: Number(f.durationMin.value) || 60 });
  }
  const path = `/api/${COLLECTION[editing.kind]}`;
  try {
    if (body.endDate && body.endDate < body.startDate) throw new Error("End date is before the start date.");
    if (body.endTime && body.endTime <= body.startTime) throw new Error("End time must be after the start time.");
    if (editing.id) await api(`${path}/${editing.id}`, { method: "PUT", body });
    else await api(path, { method: "POST", body });
    taskDialog.close();
    await (editing.kind === "schedule" ? loadSchedules() : loadTasks());
  } catch (err) {
    const el = document.getElementById("task-error");
    el.textContent = err.message;
    el.hidden = false;
  }
});

document.getElementById("task-delete").addEventListener("click", async () => {
  if (!editing.id || !confirm(`Delete this ${editing.kind} and all its repeats?`)) return;
  await api(`/api/${COLLECTION[editing.kind]}/${editing.id}`, { method: "DELETE" });
  taskDialog.close();
  await (editing.kind === "schedule" ? loadSchedules() : loadTasks());
});

const eventDialog = document.getElementById("event-dialog");
let openEventKey = null;
let openEventItem = null; // { kind, item } when the event is editable

function openEventDialog(fcEvent) {
  const { source, ref } = fcEvent.extendedProps;
  const course = document.getElementById("ev-course");
  const desc = document.getElementById("ev-desc");
  document.getElementById("ev-title").textContent = fcEvent.title;
  document.getElementById("ev-when").textContent =
    fmtWhen(fcEvent.start, fcEvent.allDay) + (fcEvent.end && !fcEvent.allDay ? ` – ${fcEvent.end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : "");
  if (source === "moodle") {
    openEventKey = ref.uid;
    openEventItem = null;
    course.textContent = courseLabel(ref.course);
    course.style.color = courseColor(ref.course);
    desc.textContent = ref.description || "";
  } else if (source === "schedule") {
    openEventKey = null;
    openEventItem = { kind: "schedule", item: ref.sched };
    course.textContent = "Schedule · " + describeItem(ref.sched) + (ref.sched.location ? " · " + ref.sched.location : "");
    course.style.color = ref.sched.color;
    desc.textContent = ref.sched.notes || "";
  } else {
    openEventKey = ref.key;
    openEventItem = { kind: "task", item: ref.task };
    course.textContent = "My task · " + describeItem(ref.task);
    course.style.color = ref.task.color;
    desc.textContent = ref.task.notes || "";
  }
  document.getElementById("ev-done-row").hidden = !openEventKey;
  document.getElementById("ev-done").checked = !!openEventKey && state.done.has(openEventKey);
  document.getElementById("ev-edit").hidden = !openEventItem;
  eventDialog.showModal();
}

document.getElementById("ev-done").addEventListener("change", (e) => setDone(openEventKey, e.target.checked));
document.getElementById("ev-close").addEventListener("click", () => eventDialog.close());
document.getElementById("ev-edit").addEventListener("click", () => {
  eventDialog.close();
  openItemDialog(openEventItem.kind, openEventItem.item);
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
document.getElementById("add-btn").addEventListener("click", () =>
  openItemDialog(state.mode === "schedule" ? "schedule" : "task", null));
document.querySelector(".mode-switch").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mode]");
  if (b && b.dataset.mode !== state.mode) setMode(b.dataset.mode);
});

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
  const btn = e.target.closest("[data-id]");
  if (btn) openItemDialog("task", state.tasks.find((t) => t.id === btn.dataset.id));
});
document.getElementById("schedules").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-id]");
  if (btn) openItemDialog("schedule", state.schedules.find((t) => t.id === btn.dataset.id));
});
const showOpens = document.getElementById("show-opens");
showOpens.checked = state.showOpens;
showOpens.addEventListener("change", () => {
  state.showOpens = showOpens.checked;
  savePref("showOpens", state.showOpens);
  renderAll();
});

if (!MODE_VIEWS[state.mode]) state.mode = "tasks";
setMode(state.mode);
initCalendar();
Promise.all([loadEvents(), loadTasks(), loadSchedules()]).catch((err) => {
  state.sync = { error: err.message };
  renderSync();
});
setInterval(() => loadEvents().catch(() => {}), POLL_MS);
setInterval(renderSync, 30 * 1000);
