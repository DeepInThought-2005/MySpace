# MySpace — Study Planner

A study planner that imports deadlines from your Moodle calendar and lets you add your own recurring tasks. It runs on Cloudflare Workers.

**Live:** <https://myspace-planner.louis-zhou.workers.dev> (password protected)

- **Moodle import**: a Cloudflare cron trigger fetches your Moodle calendar export (iCal) every 10 minutes. The **Refresh** button syncs on demand. Past events are kept even after they drop out of Moodle's "recent & upcoming" window.
- **Calendar**: month, week and list views, coloured by course. "opens" events are hidden by default.
- **Recurring tasks**: once, daily, weekly (pick weekdays) or monthly, every *N* days/weeks/months, with optional end date, time and duration. Click a day in the calendar to add a task starting that day.
- **Next 14 days**: sidebar list of upcoming deadlines and tasks, with checkboxes to mark them done.

## How it's built

| Part | Where |
| --- | --- |
| UI (HTML/CSS/JS, FullCalendar from CDN) | `static/`, served as Workers static assets |
| API, Moodle sync, login | `src/worker.js` |
| Storage | Workers KV namespace `PLANNER` (`moodle_cache`, `sync`, `tasks`, `state`) |
| Schedule | cron `*/10 * * * *` in `wrangler.toml` |
| Secrets | `MOODLE_ICS_URL`, `APP_PASSWORD` (Cloudflare secrets, never in git) |

## Deploying

Requires Node.js 18+.

```bash
npm install
npx wrangler login
```

First time only — create the KV namespace, put its id in `wrangler.toml`, then set the secrets:

```bash
npx wrangler kv namespace create PLANNER
```

```bash
npx wrangler secret put MOODLE_ICS_URL
```

```bash
npx wrangler secret put APP_PASSWORD
```

Then, and after every change:

```bash
npm run deploy
```

Get the Moodle URL in Moodle under *Calendar → Import or export calendars → Export calendar*: choose **All events** and **Recent and next 60 days**, then click **Get calendar URL**. It contains a private token — treat it like a password.

Changing `APP_PASSWORD` logs out every device.

## Local development

```bash
cp .dev.vars.example .dev.vars
```

Fill in `.dev.vars`, then:

```bash
npm run dev
```

Open <http://127.0.0.1:8780>. Local data lives in `.wrangler/` and is separate from the live site. To trigger the cron locally, open <http://127.0.0.1:8780/__scheduled?cron=*/10+*+*+*+*>.
