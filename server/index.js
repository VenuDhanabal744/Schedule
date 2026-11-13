import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchTerms, fetchTermCatalog, normalizeCatalog } from './sis.js';
import { fetchTempleTerms, fetchTempleCatalog, normalizeTempleCatalog } from './temple.js';
import { fetchUncTerms, fetchUncCatalog, normalizeUncCatalog } from './unc.js';
import { lookupInstructor } from './rmp.js';
import { SAMPLE_TERM, SAMPLE_COURSES } from './sample.js';
import { readCatalogs } from './details.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const ENV_FILE = path.join(__dirname, '..', '.env');

if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const SIS_KEY = process.env.SIS_API_KEY?.trim() || null;
// Importing scrapes the registrar (with our SIS key) and overwrites catalog files,
// so by default only requests from this machine may do it. On a public deploy the
// committed catalogs are served read-only; set ALLOW_IMPORT=1 to override.
const ALLOW_ANY_IMPORT = process.env.ALLOW_IMPORT === '1';

const SCHOOLS = {
  jhu: { name: 'Johns Hopkins', rmpName: 'Johns Hopkins University' },
  temple: { name: 'Temple', rmpName: 'Temple University' },
  // UNC's public class search redacts instructor names, so ratings stay empty
  unc: { name: 'UNC-Chapel Hill', rmpName: 'University of North Carolina at Chapel Hill' },
};

const app = express();
app.use(express.json());

// Hosts like Render proxy every visitor through localhost, so a loopback socket
// alone proves nothing; proxies add X-Forwarded-For, a direct local request doesn't.
const isLoopback = (req) =>
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) &&
  !req.headers['x-forwarded-for'];
const canImport = (req) => ALLOW_ANY_IMPORT || isLoopback(req);

const slug = (s) => s.replace(/[^a-z0-9]+/gi, '_');
const termFile = (school, term) => path.join(DATA_DIR, `courses-${school}-${slug(term)}.json`);

// legacy pre-multi-school filename: courses-Fall_2026.json -> courses-jhu-Fall_2026.json
if (fs.existsSync(DATA_DIR)) {
  for (const f of fs.readdirSync(DATA_DIR)) {
    const m = f.match(/^courses-(.+)\.json$/);
    const hasSchoolPrefix = m && Object.keys(SCHOOLS).some((s) => m[1].startsWith(`${s}-`));
    if (m && !hasSchoolPrefix) {
      fs.renameSync(path.join(DATA_DIR, f), path.join(DATA_DIR, `courses-jhu-${m[1]}.json`));
    }
  }
}

function importedTerms(school) {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith(`courses-${school}-`) && f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')).term);
}

app.get('/api/status', (req, res) => {
  res.json({
    hasKey: !!SIS_KEY,
    imported: Object.fromEntries(Object.keys(SCHOOLS).map((s) => [s, importedTerms(s)])),
  });
});

app.get('/api/terms', async (req, res) => {
  const school = String(req.query.school ?? 'jhu');
  if (!SCHOOLS[school]) return res.status(400).json({ error: `Unknown school "${school}"` });
  const imported = importedTerms(school);
  let available = [];
  let error = null;
  try {
    if (school === 'jhu') {
      if (SIS_KEY) available = (await fetchTerms(SIS_KEY)).map((name) => ({ name, code: name }));
    } else if (school === 'temple') {
      available = await fetchTempleTerms();
    } else {
      available = await fetchUncTerms();
    }
  } catch (err) {
    error = err.message;
  }
  res.json({
    school,
    hasKey: school === 'jhu' ? !!SIS_KEY : true,
    canImport: canImport(req),
    available,
    imported,
    sampleTerm: school === 'jhu' ? SAMPLE_TERM : null,
    error,
  });
});

// A fresh import with far fewer courses than the catalog it would replace almost
// always means the registrar failed partway (rate limits, outages), not that the
// term shrank — keep the existing file rather than clobbering it.
const MIN_KEEP_RATIO = 0.5;
let importInProgress = false;

// Import full catalog for a term. Streams progress lines as plain text.
app.post('/api/import', async (req, res) => {
  if (!canImport(req)) {
    return res.status(403).json({ error: 'Importing is disabled on this server' });
  }
  const { school = 'jhu', term, code } = req.body ?? {};
  if (!SCHOOLS[school]) return res.status(400).json({ error: `Unknown school "${school}"` });
  if (!term) return res.status(400).json({ error: 'term is required' });
  if (school === 'jhu' && !SIS_KEY) {
    return res.status(400).json({ error: 'No SIS_API_KEY configured in .env' });
  }
  if (importInProgress) return res.status(409).json({ error: 'Another import is running' });
  importInProgress = true;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Accel-Buffering', 'no');
  const progress = (msg) => res.write(msg + '\n');
  try {
    let courses;
    if (school === 'jhu') {
      const records = await fetchTermCatalog(SIS_KEY, term, progress);
      courses = normalizeCatalog(records);
      progress(`normalized ${records.length} section records`);
    } else if (school === 'temple') {
      const records = await fetchTempleCatalog(code ?? term, progress);
      courses = normalizeTempleCatalog(records);
      progress(`normalized ${records.length} section records`);
    } else {
      const rows = await fetchUncCatalog(code ?? term, progress);
      courses = normalizeUncCatalog(rows);
      progress(`normalized ${rows.length} section rows`);
    }
    const file = termFile(school, term);
    if (!courses.length) throw new Error('import returned no courses — keeping existing data');
    if (fs.existsSync(file)) {
      const prev = JSON.parse(fs.readFileSync(file, 'utf8')).courses?.length ?? 0;
      if (courses.length < prev * MIN_KEEP_RATIO) {
        throw new Error(
          `import returned ${courses.length} courses vs ${prev} already saved — ` +
            'looks incomplete, keeping existing data'
        );
      }
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // write then rename so a crash mid-write can't leave a truncated catalog
    const tmp = `${file}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({ school, term, importedAt: new Date().toISOString(), courses })
    );
    fs.renameSync(tmp, file);
    res.write(`done: ${courses.length} courses\n`);
  } catch (err) {
    res.write(`error: ${err.message}\n`);
  } finally {
    importInProgress = false;
  }
  res.end();
});

app.get('/api/courses', (req, res) => {
  const school = String(req.query.school ?? 'jhu');
  const term = req.query.term;
  // school goes into a file path unslugged — it must be one we know
  if (!SCHOOLS[school]) return res.status(400).json({ error: `Unknown school "${school}"` });
  if (typeof term !== 'string' || !term) return res.status(400).json({ error: 'term is required' });
  if (school === 'jhu' && term === SAMPLE_TERM) {
    return res.json({ school, term, courses: SAMPLE_COURSES });
  }
  const file = termFile(school, term);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: `Term "${term}" has not been imported yet` });
  }
  res.sendFile(file);
});

// ---- planner data: every imported term of a school merged into one index ----

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);

// Parsed catalogs + details per school, rebuilt when a data file changes
// (a local import or `npm run details`).
const plannerCache = new Map();
function plannerData(school) {
  const files = fs.existsSync(DATA_DIR)
    ? fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(`-${school}.json`) || f.startsWith(`courses-${school}-`))
    : [];
  const stamp = files.map((f) => `${f}:${fs.statSync(path.join(DATA_DIR, f)).mtimeMs}`).join('|');
  const cached = plannerCache.get(school);
  if (cached?.stamp === stamp) return cached;

  const catalogs = readCatalogs(school); // oldest term first
  const details = readJson(path.join(DATA_DIR, `coursedetails-${school}.json`))?.courses ?? {};
  const byCode = new Map();
  for (const cat of catalogs) {
    for (const c of cat.courses) {
      const { sections: _sections, school: _school, ...info } = c;
      // later terms overwrite title/credits, so the newest listing wins
      byCode.set(c.code, { ...info, terms: [...(byCode.get(c.code)?.terms ?? []), cat.term] });
    }
  }
  for (const [code, entry] of byCode) {
    const d = details[code];
    if (d?.prereqs) entry.prereqs = d.prereqs;
    if (d?.posTags) entry.posTags = d.posTags;
    if (d?.repeatable) entry.repeatable = true;
  }
  const data = { stamp, catalogs, details, index: [...byCode.values()] };
  plannerCache.set(school, data);
  return data;
}

// Requirement templates are plain JSON files; each names its school.
function requirementTemplates(school) {
  const dir = path.join(DATA_DIR, 'requirements');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(dir, f)))
    .filter((t) => t?.school === school);
}

app.get('/api/planner', (req, res) => {
  const school = String(req.query.school ?? 'jhu');
  if (!SCHOOLS[school]) return res.status(400).json({ error: `Unknown school "${school}"` });
  const data = plannerData(school);
  res.json({
    school,
    terms: data.catalogs.map((c) => c.term),
    courses: data.index,
    templates: requirementTemplates(school),
  });
});

// Everything known about one course: description/prerequisites and its
// sections in every imported term.
app.get('/api/course', (req, res) => {
  const school = String(req.query.school ?? 'jhu');
  const code = String(req.query.code ?? '');
  if (!SCHOOLS[school]) return res.status(400).json({ error: `Unknown school "${school}"` });
  const data = plannerData(school);
  const offerings = data.catalogs
    .map((cat) => ({ term: cat.term, course: cat.courses.find((c) => c.code === code) }))
    .filter((o) => o.course)
    .reverse(); // newest first
  if (school === 'jhu') {
    const sample = SAMPLE_COURSES.find((c) => c.code === code);
    if (sample && !offerings.length) offerings.push({ term: SAMPLE_TERM, course: sample });
  }
  res.json({
    code,
    detail: data.details[code] ?? null,
    offerings,
    importedTerms: data.catalogs.map((c) => c.term),
  });
});

// /api/ratings?school=jhu&instructors=Last, First|Last, First
app.get('/api/ratings', async (req, res) => {
  const school = String(req.query.school ?? 'jhu');
  const cfg = SCHOOLS[school];
  if (!cfg) return res.status(400).json({ error: `Unknown school "${school}"` });
  const names = String(req.query.instructors ?? '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);
  const out = {};
  await Promise.all(
    names.map(async (name) => {
      out[name] = await lookupInstructor(school, cfg.rmpName, name);
    })
  );
  res.json(out);
});

// In production, serve the built client (client/dist) from this same server.
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      return res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    }
    next();
  });
}

const PORT = process.env.PORT || 5174;
app.listen(PORT, () => {
  console.log(`API server on http://localhost:${PORT} (SIS key: ${SIS_KEY ? 'yes' : 'no'})`);
});
