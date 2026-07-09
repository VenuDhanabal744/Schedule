# Schedule — JHU Course Planner

A course-scheduling web app for Johns Hopkins: search the full JHU catalog, build your
week with drag-and-drop, auto-generate every conflict-free schedule from your course list
and constraints, and see RateMyProfessors ratings next to each instructor.

Created by Venu Dhanabal.

## Running locally

1. Get a free JHU SIS API key at <https://sis.jhu.edu/api> (arrives by email).
2. Create a `.env` file in the project root (copy `.env.example`) and set:
   ```
   SIS_API_KEY=your-key
   ```
3. Install and run:
   ```
   npm install
   cd client && npm install && cd ..
   npm run dev
   ```
4. Open <http://localhost:5173>.

## Deploying (Render)

The repo already includes the Fall 2026 catalog, so the site works immediately.

1. Push this repo to GitHub.
2. On [render.com](https://render.com): **New → Web Service**, connect the repo.
3. Settings:
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
   - **Environment variable:** `SIS_API_KEY` = your key
4. Deploy. The server serves both the app and the API on one URL.

Note: on free/ephemeral hosting, catalogs imported at runtime reset on redeploy —
to add a new term permanently, import it locally and commit the JSON in `server/data/`.

## Features

- **Course search** — by code, title, or professor; filter by department, level, open seats.
- **Drag-and-drop planner** — drag a section onto the calendar to place it; drag a placed
  class to see its other sections as ghost slots and drop to switch; click a class box to
  lock that section in place. Conflicts outline red.
- **Schedule generator** — set constraints (no classes before/after a time, break
  between classes min/max, free days, open sections only), then page through every
  distinct conflict-free timing combination. "Best schedule" applies the single
  schedule with the best-rated professors that satisfies everything. Locked classes
  stay fixed while everything else permutes.
- **Professor ratings** — pulled from RateMyProfessors (unofficial API) and cached in
  `server/data/rmp-cache.json`; shown in search results, My Courses, and on the
  calendar blocks themselves.

## Architecture

- `server/` — Express: imports the SIS catalog per term to JSON, serves courses,
  proxies RateMyProfessors GraphQL lookups, and serves the built client in production.
- `client/` — Vite + React + TypeScript; @dnd-kit for drag-and-drop; schedule
  generation runs client-side (`src/schedule.ts`).
