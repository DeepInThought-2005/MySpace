# MySpace — Study Planner

A small local study planner that imports deadlines from your Moodle calendar and lets you add your own recurring tasks.

- **Moodle import**: fetches your Moodle calendar export (iCal) every 10 minutes, plus a **Refresh** button to sync on demand. Past events are kept locally even after they drop out of Moodle's "recent & upcoming" window.
- **Calendar**: month, week and list views. Events are coloured by course. "opens" events are hidden by default.
- **Recurring tasks**: once, daily, weekly (pick weekdays) or monthly, every *N* days/weeks/months, with optional end date, time and duration. Click a day in the calendar to add a task starting that day.
- **Next 14 days**: sidebar list of upcoming deadlines and tasks, with checkboxes to mark them done.

No dependencies — just Python 3 (preinstalled on macOS).

## Setup

1. In Moodle, go to *Calendar → Import or export calendars → Export calendar*, choose **All events** and **Recent and next 60 days**, then click **Get calendar URL**.
2. Copy the example config and paste your URL into it:

   ```bash
   cp config.example.json config.json
   ```

   `config.json` contains your private Moodle token and is gitignored — never commit it. (You can also set `MOODLE_ICS_URL` as an environment variable instead.)

3. Start the server:

   ```bash
   python3 server.py
   ```

4. Open <http://127.0.0.1:8780>.

Use `PORT=9000 python3 server.py` to run on a different port.

## Data

Everything is stored locally in `data/` (gitignored):

| File | Contents |
| --- | --- |
| `moodle_cache.json` | every Moodle event seen so far |
| `tasks.json` | your recurring tasks |
| `state.json` | which deadlines / task occurrences are marked done |
