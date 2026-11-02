# MySpace

My Space on Cloudflare Workers: one page with two spaces you switch between at the top.

- **Study_ETH**: Moodle deadlines in a month calendar and an assignment list, per-course pages, your own study tasks, progress (Not started / In progress / Done), and files you attach to each assignment (PDF preview included).
- **Schedule**: week and month planner. Drag to block out time, weekly repeats with an end date, per-schedule colours, "remove this week", and done-for-this-date.

Day/Night mode and the background (scenes, colour or your own photo) are kept too, and everything is shared across your devices.

**Live:** <https://myspace-planner.louis-zhou.workers.dev> (password protected; the whole site, not just the data)

The front end in `static/` comes from the local My Space app (`Personal website` project). The Worker replaces that app's `server.py`.

## How it's built

| Part | Where |
| --- | --- |
| Front end (HTML/CSS/JS, PDF.js in `vendor/pdfjs`) | `static/`, served as Workers static assets after login |
| API, Moodle sync, login | `src/worker.js` |
| Storage | Workers KV namespace `PLANNER` (`shared_state`, `moodle_assignments`, `courses`, `sync`, `file_index`, `file:<id>`, `background_image`) |
| Schedule | cron `*/10 * * * *` in `wrangler.toml` refreshes Moodle deadlines; the page picks them up every 10 minutes, and **Refresh** fetches immediately |
| Secrets | `MOODLE_ICS_URL`, `APP_PASSWORD` (Cloudflare secrets, never in git) |

Moodle course codes such as `252-0057-00L` are turned into course names by looking them up in the ETH course catalogue (VVZ) the first time they appear.

### API

| Route | Purpose |
| --- | --- |
| `GET/PUT /api/state` | Shared app state: spaces, Schedule entries, study tasks/courses, progress, theme, colours |
| `GET /api/assignments[?refresh=1]` | Moodle deadlines (every deadline ever seen; `refresh=1` syncs first) |
| `GET/POST /api/assignment-files?assignment=…` | List / upload your files for an assignment (max 20 MB) |
| `GET /api/assignment-files/<id>` | Download a file |
| `GET/PUT/DELETE /api/background-image` | Background photo |
| `POST /api/login`, `POST /api/logout` | Session cookie (60 days) |

Writes from other origins are rejected, and input is validated with the same rules as the original `server.py`.

## Deploying

Requires Node.js 18+.

```bash
npm install
npx wrangler login
```

First time only: create the KV namespace, put its id in `wrangler.toml`, then set the secrets.

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

Get the Moodle URL in Moodle under *Calendar → Import or export calendars → Export calendar*: choose **All events** and **Recent and next 60 days**, then click **Get calendar URL**. It contains a private token, so treat it like a password.

Changing `APP_PASSWORD` logs out every device.

## Importing data from the local app

`scripts/import_local_data.py` copies a local My Space install's `.private` data (shared state, Moodle archive, uploaded files, background photo) into KV. It only reads the source and overwrites the same keys in KV.

```bash
python3 scripts/import_local_data.py "/path/to/Personal website" --remote
```

Use `--local` instead to fill the `npm run dev` storage.

## Local development

```bash
cp .dev.vars.example .dev.vars
```

Fill in `.dev.vars`, then:

```bash
npm run dev
```

Open <http://127.0.0.1:8780>. Local data lives in `.wrangler/` and is separate from the live site. To run the Moodle sync locally, open <http://127.0.0.1:8780/__scheduled?cron=*/10+*+*+*+*>.
