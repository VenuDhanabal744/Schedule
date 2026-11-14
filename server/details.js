// Builds server/data/coursedetails-<school>.json: descriptions and prerequisites
// for every course in the committed catalogs. Run locally and commit the result,
// like the catalogs themselves:
//
//   npm run details -- jhu      (needs SIS_API_KEY in .env)
//   npm run details -- temple
//   npm run details -- unc
//
// JHU comes from the SIS section-detail endpoint, which carries a structured
// prerequisite expression. Temple and UNC come from their public bulletins
// (both CourseLeaf sites), which only have prerequisite text.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

const SEASON_ORDER = { Intersession: 0, Spring: 1, Summer: 2, Fall: 3 };
// "Fall 2026" -> sortable number; unknown names sort first
export function termOrder(name) {
  const m = String(name).match(/^(Intersession|Spring|Summer|Fall)\b.*?(\d{4})$/);
  return m ? +m[2] * 10 + SEASON_ORDER[m[1]] : 0;
}

export function readCatalogs(school) {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith(`courses-${school}-`) && f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')))
    .sort((a, b) => termOrder(a.term) - termOrder(b.term));
}

export async function pool(items, concurrency, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) await fn(items[next++]);
    })
  );
}

export async function fetchRetry(url, parse) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await parse(res);
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

const stripTags = (s) =>
  String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;| /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();

// ---- JHU ----

function jhuDetail(rec) {
  const d = rec.SectionDetails?.[0] ?? {};
  const reqs = (list) =>
    (list ?? []).map((p) => ({
      text: stripTags(p.Description),
      ...(p.Expression ? { expr: p.Expression } : {}),
      ...(p.IsNegative === 'Y' ? { negative: true } : {}),
    }));
  const out = { description: stripTags(d.Description) };
  const prereqs = reqs(d.Prerequisites);
  const coreqs = reqs(d.CoRequisites);
  const restrictions = (d.Restrictions ?? []).map((r) => r.RestrictionName).filter(Boolean);
  const posTags = [...new Set((d.PosTags ?? []).map((t) => t.Tag).filter(Boolean))];
  if (prereqs.length) out.prereqs = prereqs;
  if (coreqs.length) out.coreqs = coreqs;
  if (restrictions.length) out.restrictions = restrictions;
  if (posTags.length) out.posTags = posTags;
  if (rec.Repeatable === 'Y') out.repeatable = true;
  return out;
}

async function buildJhu(key, log) {
  // newest term wins: details are per section, so ask for one section of each
  // course in the latest term it was offered
  const wanted = new Map();
  for (const cat of readCatalogs('jhu')) {
    for (const c of cat.courses) {
      if (c.sections[0]) wanted.set(c.code, { term: cat.term, section: c.sections[0].section });
    }
  }
  const courses = {};
  let done = 0;
  let failed = 0;
  await pool([...wanted], 8, async ([code, { term, section }]) => {
    const id = code.replace(/\./g, '') + section;
    const url =
      `https://sis.jhu.edu/api/classes/${encodeURIComponent(id)}/${encodeURIComponent(term)}` +
      `?key=${encodeURIComponent(key)}`;
    try {
      const recs = await fetchRetry(url, (r) => r.json());
      if (recs?.[0]) courses[code] = jhuDetail(recs[0]);
    } catch {
      failed++;
    }
    if (++done % 500 === 0) log(`${done}/${wanted.size} courses…`);
  });
  if (failed > wanted.size * 0.1) throw new Error(`${failed} of ${wanted.size} lookups failed`);
  if (failed) log(`warning: ${failed} lookups failed and were skipped`);
  return { source: 'https://sis.jhu.edu/api', courses };
}

// ---- Temple / UNC (CourseLeaf bulletins) ----

const BULLETINS = {
  temple: 'https://bulletin.temple.edu/courses/',
  unc: 'https://catalog.unc.edu/courses/',
};
const LABEL =
  /^(Pre-?requisites?|Co-?requisites?|Requisites|Repeatability|Repeat Rules|Course Attributes|Grading Status|IDEAs in Action Gen Ed|Same as|Rules & Requirements|Global Language)\s*:?\s*(.*)$/i;

// One CourseLeaf "courseblock" -> [code, detail] or null.
export function parseCourseBlock(html) {
  const lines = stripTags(
    html.replace(/<br\s*\/?>|<\/p>|<\/div>|<\/span>\s*<\/div>/gi, '\n')
  )
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const head = lines[0]?.match(/^([A-Z]{2,5} \d{2,4}[A-Z]?)\./);
  if (!head) return null;
  const out = { description: '' };
  const desc = [];
  for (const line of lines.slice(1)) {
    const m = line.match(LABEL);
    if (!m) {
      desc.push(line);
      continue;
    }
    const label = m[1].toLowerCase().replace('-', '');
    const text = m[2].trim();
    if (!text) continue;
    if (label.startsWith('prereq') || label === 'requisites') out.prereqs = [{ text }];
    else if (label.startsWith('coreq')) out.coreqs = [{ text }];
    else if (label.startsWith('repeat') && !/may not be repeated/i.test(text)) out.repeatable = true;
  }
  out.description = desc.join('\n');
  return [head[1], out];
}

async function buildCourseleaf(school, log) {
  const subjects = new Set();
  for (const cat of readCatalogs(school)) {
    for (const c of cat.courses) subjects.add(c.code.split(' ')[0]);
  }
  const all = {};
  let done = 0;
  let failed = 0;
  await pool([...subjects], 6, async (subject) => {
    try {
      const html = await fetchRetry(`${BULLETINS[school]}${subject.toLowerCase()}/`, (r) => r.text());
      for (const block of (html ?? '').split(/<div class="courseblock">/).slice(1)) {
        const parsed = parseCourseBlock(block);
        if (parsed) all[parsed[0]] = parsed[1];
      }
    } catch {
      failed++;
    }
    if (++done % 50 === 0) log(`${done}/${subjects.size} subjects…`);
  });
  if (failed > subjects.size * 0.1) throw new Error(`${failed} of ${subjects.size} subjects failed`);
  if (failed) log(`warning: ${failed} subject pages failed and were skipped`);
  // keep only courses in the committed catalogs (the bulletin lists every course
  // ever offered); "BIOL 101H" falls back to the bulletin's "BIOL 101"
  const courses = {};
  for (const cat of readCatalogs(school)) {
    for (const { code } of cat.courses) {
      const detail = all[code] ?? all[code.replace(/[A-Z]$/, '')];
      if (detail) courses[code] = detail;
    }
  }
  return { source: BULLETINS[school], courses };
}

export async function buildDetails(school, { sisKey, log = console.log } = {}) {
  let built;
  if (school === 'jhu') {
    if (!sisKey) throw new Error('SIS_API_KEY is not set in .env');
    built = await buildJhu(sisKey, log);
  } else if (BULLETINS[school]) {
    built = await buildCourseleaf(school, log);
  } else {
    throw new Error(`Unknown school "${school}"`);
  }
  const count = Object.keys(built.courses).length;
  if (!count) throw new Error('no course details found — keeping existing data');
  const file = path.join(DATA_DIR, `coursedetails-${school}.json`);
  const sorted = Object.fromEntries(Object.entries(built.courses).sort(([a], [b]) => a.localeCompare(b)));
  // write then rename so a crash mid-write can't leave a truncated file
  fs.writeFileSync(
    `${file}.tmp`,
    JSON.stringify({ school, builtAt: new Date().toISOString(), source: built.source, courses: sorted })
  );
  fs.renameSync(`${file}.tmp`, file);
  log(`done: ${count} courses -> ${path.relative(process.cwd(), file)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const envFile = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const school = process.argv[2];
  if (!school) {
    console.error('usage: npm run details -- <jhu|temple|unc>');
    process.exit(1);
  }
  buildDetails(school, { sisKey: process.env.SIS_API_KEY?.trim() }).catch((err) => {
    console.error(`error: ${err.message}`);
    process.exit(1);
  });
}
