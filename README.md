# Schedule — JHU, Temple & UNC Course Planner

A course-planning web app for Johns Hopkins, Temple, and UNC-Chapel Hill: search each school's full catalog, build your
week with drag-and-drop, auto-generate every conflict-free schedule from your course list
and constraints, see RateMyProfessors ratings next to each instructor, and lay out every
semester through graduation in a 4-year planner that checks prerequisites and tracks
degree requirements.

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

Checks: `npm test` (Vitest unit tests), and in `client/`: `npx tsc -b` and `npm run lint`.

## Deploying (Render)

The repo already includes these catalogs, so the site works immediately:

| School | Committed terms |
| --- | --- |
| Johns Hopkins | Fall 2026, Spring 2027 |
| Temple | Fall 2026, Spring 2027 |
| UNC-Chapel Hill | Fall 2026 |

It also includes course details (descriptions and prerequisites) for all three schools, and
requirement templates for every bachelor's program in the three catalogs (89 JHU, 239
Temple, 96 UNC), plus two hand-checked JHU templates (BME B.S. and pre-med).

1. Push this repo to GitHub.
2. On [render.com](https://render.com): **New → Web Service**, connect the repo.
3. Settings:
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
   - **Environment variable:** `SIS_API_KEY` = your key
4. Deploy. The server serves both the app and the API on one URL.

The deployed site serves the committed catalogs read-only: importing (which scrapes the
registrar and overwrites catalog files) is only allowed from requests on the same machine,
so the term picker there lists just the imported terms. To add a term, run the app
locally, pick the term to import it, and commit the new JSON in `server/data/`. (Set
`ALLOW_IMPORT=1` to allow imports from anywhere — only on a server you trust.)

Temple publishes upcoming terms as "View Only" before registration opens; those show up
in the picker so you can plan ahead as soon as the schedule is out.

## Regenerating planner data

Like the catalogs, everything the planner needs is built locally and committed; the
deployed site only reads it.

**Course details** (`server/data/coursedetails-<school>.json`: descriptions, prerequisites,
and for JHU repeatable flags and POS tags). Re-run after importing a new term:

```
npm run details -- jhu      # JHU SIS API, needs SIS_API_KEY; about a minute
npm run details -- temple   # Temple bulletin
npm run details -- unc      # UNC catalog
```

**Requirement templates for every major** are generated from each school's online catalog
(all three use CourseLeaf, whose program pages have machine-readable course-list tables):

```
npm run requirements -- jhu     # or temple, unc; a minute or two each
```

This writes `server/data/requirements/generated/<school>.json`. The generator reads the
major's own course lists — required courses, "one of" choices, "N courses / N credits from"
pools, and JHU POS and Foundational Ability tags. It does not cover university or
school-wide requirements, and rules written only in prose ("any BIOL course above 200")
become TODO groups you fill by assigning courses by hand. Programs with tracks list every
track; hide the groups that don't apply. Pages with no course lists (mostly discontinued
or combined bachelor's/master's programs) get a single placeholder group. Generated
templates are unofficial — always check the linked catalog page.

**Hand-written templates** (`server/data/requirements/*.json`) take precedence: one with
the same `id` or `source` URL as a generated template replaces it. To fix up a generated
template, copy its entry from the generated file into its own file and edit it there (a
regeneration won't overwrite it). To add a minor, another major or another school, copy
`jhu-bme-bs.json` and edit:

```jsonc
{
  "id": "jhu-my-minor",          // unique
  "school": "jhu",               // jhu | temple | unc
  "name": "My Minor",
  "source": "https://…",         // the official page you transcribed
  "note": "Unofficial — verify with your advisor.",
  "totalCredits": 129,           // optional: adds a total-credits bar
  "groups": [
    // Checklist: every entry must be planned. An entry is a course code, or a choice
    // whose options are a code or a set of codes that must all be taken.
    { "id": "core", "name": "Core", "courses": [
        "AS.110.108",
        { "label": "Linear algebra", "oneOf": ["EN.553.291", ["AS.110.201", "AS.110.302"]] }
    ] },
    // Pool: anything matching ANY criterion counts toward "credits" or "count".
    { "id": "electives", "name": "Electives", "credits": 12, "match": {
        "codes": ["EN.580.441"],
        "patterns": ["EN.580.4*"],   // * = anything, ? = one character
        "areas": ["H", "S", "FA3"],  // area tags from the catalog or a custom entry
        "posTags": ["BME-NE"],       // JHU only
        "writingIntensive": true
    } }
  ]
}
```

A course counts toward one group per template (checklists first, then pools, in file
order) unless the group sets `"shared": true`; `"todo": true` shows a TODO badge, and
`"note"` is displayed under the group. In the planner, a card's ⋯ menu can assign it to a
group by hand, and each group has a Hide button for requirements that don't apply to you
(another track or focus area); hidden groups don't claim courses. The two shipped templates were transcribed from the JHU e-catalogue and
Pre-Professional Advising pages named in their `source`; they are unofficial, and their
`note` fields list what is not modelled.

**Term dates** for the calendar export live in `client/src/termDates.ts`.

## Features

- **4-Year Planner** — a second view next to the weekly scheduler. Semester columns from a
  configurable first term (plus Prior credit, optional Summer and Intersession); add
  courses from every imported term or as custom entries (elective placeholders, AP/transfer
  credit that "counts as" a course, study abroad); drag between semesters or use a card's
  ⋯ menu. Shows credits per term and cumulative, and warns — never blocks — about credit
  load, prerequisites not placed in an earlier term, courses placed in a season they
  haven't been seen in, and duplicates. Search any major at your school in the
  Requirements tab to track it with a progress bar per group. "Build this semester's schedule" loads a planned term into the scheduler, which
  lists planned courses you haven't added yet. Saved in the browser per school; export or
  import as JSON, and Print / PDF gives a one-page view.
- **Course details** — the ⓘ button on any course (search results, My Courses, calendar
  blocks) or a planner card opens its description, prerequisites, offering pattern,
  sections in every imported term, and ratings.
- **Calendar export** — "Export to calendar (.ics)" downloads the current week as
  recurring events between the term's first and last day of classes (editable).

- **Course search** — by code, title, or professor; filter by department, level, open seats.
- **Drag-and-drop planner** — drag a section onto the calendar to place it; drag a placed
  class to see its other sections as ghost slots and drop to switch; click a class box to
  lock that section in place. Conflicts outline red.
- **Schedule generator** — set constraints (no classes before/after a time, break
  between classes min/max, free days, open sections only), then page through every
  distinct conflict-free timing combination. "Best schedule" applies the single
  schedule with the best-rated professors that satisfies everything. Locked classes
  stay fixed while everything else permutes.
- **Compare schedules** — "Pin to compare" saves the current schedule (hand-built or
  generated); "Compare pinned" shows every pinned schedule side by side, each with its
  professor average and a Load button to go back to editing it. Pins are kept per term.
- **Professor ratings** — pulled from RateMyProfessors (unofficial API) and cached in
  `server/data/rmp-cache.json`; shown in search results, My Courses, and on the
  calendar blocks themselves.

## Architecture

- `server/` — Express: imports each school's catalog per term to JSON, serves courses,
  the merged planner index and course details, proxies RateMyProfessors GraphQL lookups,
  and serves the built client in production. `details.js` builds the course-details files.
- `client/` — Vite + React + TypeScript; @dnd-kit for drag-and-drop. Logic runs
  client-side and is unit-tested: schedule generation (`src/schedule.ts`), prerequisite
  parsing (`src/prereqs.ts`), requirement matching (`src/requirements.ts`), plan checks
  (`src/plan.ts`), calendar export (`src/ics.ts`).
