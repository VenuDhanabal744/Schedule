import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchTerms, fetchTermCatalog, normalizeCatalog } from './sis.js';
import { fetchTempleTerms, fetchTempleCatalog, normalizeTempleCatalog } from './temple.js';
import { fetchUncTerms, fetchUncCatalog, normalizeUncCatalog } from './unc.js';
import { lookupInstructor } from './rmp.js';
import { SAMPLE_TERM, SAMPLE_COURSES } from './sample.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const ENV_FILE = path.join(__dirname, '..', '.env');

if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const SIS_KEY = process.env.SIS_API_KEY?.trim() || null;

const SCHOOLS = {
  jhu: { name: 'Johns Hopkins', rmpName: 'Johns Hopkins University' },
  temple: { name: 'Temple', rmpName: 'Temple University' },
  // UNC's public class search redacts instructor names, so ratings stay empty
  unc: { name: 'UNC-Chapel Hill', rmpName: 'University of North Carolina at Chapel Hill' },
};

const app = express();
app.use(express.json());

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
    available,
    imported,
    sampleTerm: school === 'jhu' ? SAMPLE_TERM : null,
    error,
  });
});

// Import full catalog for a term. Streams progress lines as plain text.
app.post('/api/import', async (req, res) => {
  const { school = 'jhu', term, code } = req.body ?? {};
  if (!SCHOOLS[school]) return res.status(400).json({ error: `Unknown school "${school}"` });
  if (!term) return res.status(400).json({ error: 'term is required' });
  if (school === 'jhu' && !SIS_KEY) {
    return res.status(400).json({ error: 'No SIS_API_KEY configured in .env' });
  }

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
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      termFile(school, term),
      JSON.stringify({ school, term, importedAt: new Date().toISOString(), courses })
    );
    res.write(`done: ${courses.length} courses\n`);
  } catch (err) {
    res.write(`error: ${err.message}\n`);
  }
  res.end();
});

app.get('/api/courses', (req, res) => {
  const school = String(req.query.school ?? 'jhu');
  const term = req.query.term;
  if (!term) return res.status(400).json({ error: 'term is required' });
  if (school === 'jhu' && term === SAMPLE_TERM) {
    return res.json({ school, term, courses: SAMPLE_COURSES });
  }
  const file = termFile(school, term);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: `Term "${term}" has not been imported yet` });
  }
  res.sendFile(file);
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
