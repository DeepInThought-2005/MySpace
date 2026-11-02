#!/usr/bin/env python3
"""Study planner server.

Fetches the Moodle calendar export (iCal) every 10 minutes, keeps every
event it has ever seen in data/moodle_cache.json, stores user-created
recurring tasks in data/tasks.json, and serves the web UI from ./static.

Standard library only. Run:  python3 server.py   then open http://127.0.0.1:8780
"""

import json
import os
import re
import threading
import time
import urllib.request
import uuid
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(ROOT, "static")
DATA_DIR = os.path.join(ROOT, "data")
CONFIG_PATH = os.path.join(ROOT, "config.json")
CACHE_PATH = os.path.join(DATA_DIR, "moodle_cache.json")
TASKS_PATH = os.path.join(DATA_DIR, "tasks.json")
STATE_PATH = os.path.join(DATA_DIR, "state.json")

REFRESH_SECONDS = 10 * 60
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8780"))

lock = threading.Lock()
sync_status = {"lastSync": None, "lastAttempt": None, "error": None}


# ---------------------------------------------------------------- storage

def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def moodle_url():
    url = os.environ.get("MOODLE_ICS_URL")
    if url:
        return url
    return load_json(CONFIG_PATH, {}).get("moodleIcsUrl")


# ---------------------------------------------------------------- iCal

def unfold(text):
    # RFC 5545: a line starting with a space or tab continues the previous one.
    return re.sub(r"\r?\n[ \t]", "", text).splitlines()


def unescape(value):
    return (value.replace("\\n", "\n").replace("\\N", "\n")
            .replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\"))


def parse_dt(params, value):
    """Return (iso_string, all_day)."""
    value = value.strip()
    if "VALUE=DATE" in params or re.fullmatch(r"\d{8}", value):
        return f"{value[0:4]}-{value[4:6]}-{value[6:8]}", True
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)", value)
    if not m:
        return value, False
    y, mo, d, h, mi, s, z = m.groups()
    # Floating / TZID times are passed through as local time.
    return f"{y}-{mo}-{d}T{h}:{mi}:{s}{'Z' if z else ''}", False


def classify(summary):
    s = summary.lower()
    if s.endswith(" opens") or "öffnet" in s:
        return "opens"
    if (s.endswith(" closes") or "is due" in s or "fällig" in s
            or "abgabe" in s or "deadline" in s or "due:" in s):
        return "due"
    return "event"


def parse_ics(text):
    events = []
    current = None
    for line in unfold(text):
        if line == "BEGIN:VEVENT":
            current = {}
            continue
        if line == "END:VEVENT":
            if current is not None and current.get("uid"):
                events.append(current)
            current = None
            continue
        if current is None or ":" not in line:
            continue
        name_part, value = line.split(":", 1)
        name, *params = name_part.split(";")
        params = ";".join(params)
        if name == "UID":
            current["uid"] = value
        elif name == "SUMMARY":
            current["title"] = unescape(value)
        elif name == "DESCRIPTION":
            current["description"] = unescape(value).strip()
        elif name == "CATEGORIES":
            current["course"] = unescape(value)
        elif name == "DTSTART":
            current["start"], current["allDay"] = parse_dt(params, value)
        elif name == "DTEND":
            current["end"], _ = parse_dt(params, value)
        elif name == "LAST-MODIFIED":
            current["modified"] = value
    for ev in events:
        ev.setdefault("title", "(untitled)")
        ev["kind"] = classify(ev["title"])
        if ev.get("end") == ev.get("start"):
            ev.pop("end", None)
    return events


def sync_moodle():
    """Fetch the feed and merge it into the cache. Returns status dict."""
    now = datetime.now(timezone.utc).isoformat()
    url = moodle_url()
    with lock:
        sync_status["lastAttempt"] = now
    if not url:
        with lock:
            sync_status["error"] = "No Moodle URL configured (see config.example.json)."
        return
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "MySpace-StudyPlanner/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8", errors="replace")
        if "BEGIN:VCALENDAR" not in text:
            raise ValueError("Response is not an iCal calendar (check the URL / token).")
        fresh = parse_ics(text)
        fresh_ids = {e["uid"] for e in fresh}
        with lock:
            cache = load_json(CACHE_PATH, {})
            # Moodle's "recent & upcoming" export only covers a window, so keep
            # past events we've already seen. Events that are still inside the
            # window but missing from the feed were deleted in Moodle.
            for uid, ev in list(cache.items()):
                if uid not in fresh_ids and ev.get("start", "") >= now[:10]:
                    del cache[uid]
            for ev in fresh:
                cache[ev["uid"]] = ev
            save_json(CACHE_PATH, cache)
            sync_status["lastSync"] = now
            sync_status["error"] = None
    except Exception as exc:  # network errors, bad token, etc.
        with lock:
            sync_status["error"] = f"{type(exc).__name__}: {exc}"


def sync_loop():
    while True:
        sync_moodle()
        time.sleep(REFRESH_SECONDS)


def events_payload():
    with lock:
        cache = load_json(CACHE_PATH, {})
        state = load_json(STATE_PATH, {"done": []})
        return {
            **sync_status,
            "refreshSeconds": REFRESH_SECONDS,
            "events": sorted(cache.values(), key=lambda e: e.get("start", "")),
            "done": state.get("done", []),
        }


# ---------------------------------------------------------------- tasks

TASK_FIELDS = {"title", "notes", "color", "startDate", "endDate", "time",
               "durationMin", "freq", "interval", "byDay"}


def clean_task(body):
    task = {k: body[k] for k in TASK_FIELDS if k in body}
    if not str(task.get("title", "")).strip():
        raise ValueError("title is required")
    if task.get("freq") not in ("once", "daily", "weekly", "monthly"):
        raise ValueError("freq must be once, daily, weekly or monthly")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(task.get("startDate", ""))):
        raise ValueError("startDate must be YYYY-MM-DD")
    task["interval"] = max(1, int(task.get("interval") or 1))
    task["durationMin"] = max(5, int(task.get("durationMin") or 60))
    task["byDay"] = [int(d) for d in task.get("byDay") or [] if 0 <= int(d) <= 6]
    return task


# ---------------------------------------------------------------- HTTP

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def log_message(self, fmt, *args):
        # Keep the console quiet, and never log query strings.
        pass

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        if self.path == "/api/events":
            return self.send_json(events_payload())
        if self.path == "/api/tasks":
            with lock:
                return self.send_json(load_json(TASKS_PATH, []))
        return super().do_GET()

    def do_POST(self):
        try:
            if self.path == "/api/refresh":
                sync_moodle()
                return self.send_json(events_payload())
            if self.path == "/api/tasks":
                task = clean_task(self.read_body())
                task["id"] = uuid.uuid4().hex[:12]
                with lock:
                    tasks = load_json(TASKS_PATH, [])
                    tasks.append(task)
                    save_json(TASKS_PATH, tasks)
                return self.send_json(task, 201)
            if self.path == "/api/done":
                # {"key": "<moodle uid>" | "<task id>@<YYYY-MM-DD>", "done": bool}
                body = self.read_body()
                key, done = str(body.get("key", "")), bool(body.get("done"))
                with lock:
                    state = load_json(STATE_PATH, {"done": []})
                    keys = set(state.get("done", []))
                    (keys.add if done else keys.discard)(key)
                    state["done"] = sorted(keys)
                    save_json(STATE_PATH, state)
                return self.send_json({"ok": True})
        except (ValueError, TypeError) as exc:
            return self.send_json({"error": str(exc)}, 400)
        self.send_json({"error": "not found"}, 404)

    def do_PUT(self):
        m = re.fullmatch(r"/api/tasks/([0-9a-f]+)", self.path)
        if not m:
            return self.send_json({"error": "not found"}, 404)
        try:
            update = clean_task(self.read_body())
        except (ValueError, TypeError) as exc:
            return self.send_json({"error": str(exc)}, 400)
        with lock:
            tasks = load_json(TASKS_PATH, [])
            for t in tasks:
                if t["id"] == m.group(1):
                    for k in TASK_FIELDS - update.keys():
                        t.pop(k, None)
                    t.update(update)
                    save_json(TASKS_PATH, tasks)
                    return self.send_json(t)
        self.send_json({"error": "not found"}, 404)

    def do_DELETE(self):
        m = re.fullmatch(r"/api/tasks/([0-9a-f]+)", self.path)
        if not m:
            return self.send_json({"error": "not found"}, 404)
        with lock:
            tasks = load_json(TASKS_PATH, [])
            kept = [t for t in tasks if t["id"] != m.group(1)]
            save_json(TASKS_PATH, kept)
        self.send_json({"ok": len(kept) != len(tasks)})


def main():
    threading.Thread(target=sync_loop, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Study planner running at http://{HOST}:{PORT}  (Moodle sync every {REFRESH_SECONDS // 60} min)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
