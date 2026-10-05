# Pulse Ops

Pulse Ops was formerly named **Levi Ops**. This repository is the sanitized public mirror.
The rebrand updates the product name and GitHub links; existing runtime paths, script
names, environment variables, and protocol identifiers retain their compatibility names.

For ongoing work with ChatGPT or Codex, follow [AGENTS.md](AGENTS.md). Use a local
project for repository changes, or connect this repository as a source for a ChatGPT project.

Pulse Ops is a personal operations dashboard: one page with four lanes (**Pulse**, **Events**, **Jobs**, and **Food**)
plus a live view of the [Pulse Agent](https://github.com/LeviKCarter/pulseagent-public) automation queue. On a phone, the lanes
sit in a row and one opens at a time.

It is a Next.js App Router app built with [vinext](https://www.npmjs.com/package/vinext) (Vite), React 19, and
Tailwind 4. The same code runs in two places:

| Where | How it's reached | What works |
|---|---|---|
| **Local server** (this PC, `vinext start` on `:3000`) | `localhost`, the LAN, or Tailscale (MagicDNS short names, `*.ts.net`, `100.64.0.0/10`, `fd7a:115c:a1e0::/48`) | Everything, including the local-only API routes |
| **Published copy** (Cloudflare, `pulse-ops-center.levikcarter.chatgpt.site`) | The public web | The page and the live feed. Local-only routes refuse the request and the page falls back (browser-only dismissals and stages, a fixed central-Denver Open-Meteo forecast) |

## What it looks like

Captured from the live dashboard on 2026-10-05, 1720 px wide on the PC and 390 px on the phone. The app has moved on
since the rest of this README was written: the lanes are now **Pulse, Events, Deals and Work** (Deals was Food, and
Jobs became the Careers tab of Work), and the PC opens on a music-video wallpaper with the lanes as glass over it.

**The wallpaper** (F). The music video fills the screen. The clock, the weather and what's playing sit on the left;
the music player, the lane icons, the Now thought and the Mail, To Do and Lights pills sit on the right.

![The bare wallpaper: clock, weather, music player, lane icons and the Now thought over the music video](docs/screenshots/wallpaper.jpg)

**Wheel down for the feed, a key for a lane.** The wheel slides the feed in. W and E open Events and Deals as one
pane beside it, and Esc puts everything away.

![Wheel down brings the feed in, W opens Events, E swaps to Deals, Esc returns to the wallpaper](docs/screenshots/wallpaper-feed-and-lanes.gif)

**A story opens in place.** It grows out of the feed's lane, V and B scroll it, and Esc shrinks it back.

![A story opened from the feed grows out of the lane, scrolls, and closes back into the lane](docs/screenshots/feed-story.gif)

**Three views.** F switches between the wallpaper and the hybrid view (all four lanes as glass over the video). M
switches the hybrid view to the classic dashboard and back.

![F toggles the wallpaper and the hybrid view; M toggles the hybrid view and the classic dashboard](docs/screenshots/views.gif)

| The hybrid view (the PC default) | To Do pinned open (4) |
|---|---|
| ![The four lanes as glass over the music video](docs/screenshots/hybrid.jpg) | ![The To Do list open over the hybrid view, with its add box](docs/screenshots/todo.jpg) |

| Events beside the feed (W) | Deals beside the feed (E) |
|---|---|
| ![The Events lane as a pane between the docked feed and the Now column](docs/screenshots/lane-events.jpg) | ![The Deals lane with food deals and the gear watch](docs/screenshots/lane-deals.jpg) |

**The classic dashboard** (M), without the video behind the lanes.

![The classic dashboard without the video behind the lanes](docs/screenshots/classic.jpg)

**On a phone.** It starts on the wallpaper with the Now card. The four buttons at the top open the lanes.

<p>
  <img src="docs/screenshots/phone-wallpaper.jpg" width="260" alt="The phone wallpaper: lane buttons, clock and weather, the Now card, the Mail and To Do pills and the music bar">
  <img src="docs/screenshots/phone-events.jpg" width="260" alt="The Events lane opened on the phone">
</p>

## What each lane shows

- **Pulse**: the morning brief and evening recap that Pulse Agent's `pulse_local.py` publishes (weather, air quality,
  training and body composition, news picks, recent deal and gear alerts), plus live conditions for the phone's
  location.
- **Events**: upcoming Denver events from the Event Ledger with 3/8/15 mi distance chips and a Free filter. Also
  merges your own calendars and Google Tasks when configured. Events can be dismissed and restored.
- **Jobs**: science and geospatial roles from the job pipeline, with a per-role application stage (Saved, Applied,
  Interviewing, …) shared across devices.
- **Food**: verified and recurring food deals with distance chips, the gear watch, and dismiss/restore.

## Where the data comes from

```
 Google Sheets (queue, food, events, jobs)
        |
        |  scripts/refresh_snapshot.py  (service account)
        v
 app/queueSnapshot.ts  ── committed snapshot the page renders from
        +
 'Site Snapshot' tab ── scripts/push_live_snapshot.py ──> Cloudflare Worker + KV (edge-feed/)
                                                              |
                                          page polls /snapshot for live queue state
```

- **`app/queueSnapshot.ts`** is generated. Don't edit it by hand; run `npm run refresh:snapshot`.
- **`edge-feed/`** is the `levi-ops-live-feed` Cloudflare Worker. It serves a read-only `/snapshot` from KV with an
  allowlisted schema and CORS locked to the published origin. Local copies read it through the same-origin
  `/api/live-feed` proxy instead.
- **Local-only API routes** (`app/api/`) run on the local server only. They refuse any host that isn't local:

  | Route | Does |
  |---|---|
  | `food-dismiss`, `events-dismiss` | Run Pulse Agent's `food_dismiss.py` / `events_dismiss.py` to dismiss, restore, or list dismissed rows in the sheet |
  | `job-stages` | Reads and writes `LeviAgent\data\leviops_job_stages.json`. Needs `vinext start`, not `vinext dev` |
  | `forecast` | Runs `google_environment_cli.py` (Google Weather + Air Quality) for the phone's location |
  | `origin` | Phone location from Tasker, rounded to about 1 km, for the distance chips |
  | `personal-calendar`, `personal-tasks` | Your ICS calendars and Google Tasks overlay, and marking a task done |
  | `live-feed` | Same-origin proxy for the Worker feed |

## Setup

Requires Node 22.13+ and a Pulse Agent checkout on the same machine (the local routes shell out to its scripts).

```bash
npm install
```

Optional local settings go in `.env.local` (gitignored):

| Variable | Default | Purpose |
|---|---|---|
| `FOOD_DISMISS_DIR` | `C:\Users\YOU\Documents\Codex\LeviAgent` | Pulse Agent checkout the local routes run scripts from |
| `FOOD_DISMISS_PYTHON` | `C:\Users\YOU\miniforge3\python.exe` | Python used to run them |
| `JOB_STAGES_FILE` | `<LeviAgent>\data\leviops_job_stages.json` | Shared job-stage store |
| `TASKER_LOCATION_FILE` | `G:\My Drive\Tasker\location` | Phone location for forecast and distances |
| `PERSONAL_CALENDAR_ICS_URLS` | unset | Your calendar ICS feeds for the Events overlay |
| `PERSONAL_TASKS_URL` | unset | Web-app URL of [`scripts/google-tasks-feed.gs`](scripts/google-tasks-feed.gs). Setup steps are in the file header |
| `SITE_ORIGIN` | `http://localhost:3000` | Base URL for page metadata (`metadataBase`) |

`refresh_snapshot.py` and `push_live_snapshot.py` read the Google service account from
`%LOCALAPPDATA%\LeviAgent\google-service-account.json`.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server. Local file-backed routes such as `job-stages` don't work here |
| `npm run build` then `npm run start` | Production build and the Node server the local dashboard runs on |
| `npm run lint` | ESLint |
| `npm run refresh:snapshot` | Regenerate `app/queueSnapshot.ts` from the sheets |
| `npm run publish:handoff` | Refresh, build, lint, and package a hashed bundle in `handoff/` for publishing |
| `npm run build:public-preview` | Sanitized static build with invented data, deployed to Cloudflare Pages on every push to main. See [`public-preview/README.md`](public-preview/README.md) |

## Updating the live dashboard

The local dashboard on `:3000` is kept running by Pulse Agent's `leviagent_web_services.pyw` supervisor. After a
change, run `npm run build` and restart that supervised server. Until you do, it keeps serving the old build. Phones
reach the same server over Tailscale.

## CI

- **Auto-Merge PRs** (`.github/workflows/auto-merge.yml`): every PR runs `npm ci && npm run build`, then squash-merges
  itself if the build passes. There is no human review step. Branch protection isn't available on this plan, so
  treat opening a PR as merging it.
- **Deploy public preview** (`.github/workflows/deploy-public-preview.yml`): builds the sanitized preview on pushes to `main` and manual runs. Deployment is skipped unless its Cloudflare token is configured.
