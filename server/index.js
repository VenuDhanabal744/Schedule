import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchTerms, fetchTermCatalog, normalizeCatalog } from './sis.js';
import { lookupInstructor } from './rmp.js';
import { SAMPLE_TERM, SAMPLE_COURSES } from './sample.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const ENV_FILE = path.join(__dirname, '..', '.env');

if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const SIS_KEY = process.env.SIS_API_KEY?.trim() || null;

const app = express();
app.use(express.json());

const termFile = (term) =>
  path.join(DATA_DIR, `courses-${term.replace(/[^a-z0-9]+/gi, '_')}.json`);

function importedTerms() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith('courses-') && f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')).term);
}

app.get('/api/status', (req, res) => {
  res.json({ hasKey: !!SIS_KEY, importedTerms: importedTerms() });
});

app.get('/api/terms', async (req, res) => {
  const imported = importedTerms();
  let available = [];
  let error = null;
  if (SIS_KEY) {
    try {
      available = await fetchTerms(SIS_KEY);
    } catch (err) {
      error = err.message;
    }
  }
  res.json({ hasKey: !!SIS_KEY, available, imported, sampleTerm: SAMPLE_TERM, error });
});

// Import full catalog for a term. Streams progress lines as plain text.
app.post('/api/import', async (req, res) => {
  const { term } = req.body ?? {};
  if (!term) return res.status(400).json({ error: 'term is required' });
  if (!SIS_KEY) return res.status(400).json({ error: 'No SIS_API_KEY configured in .env' });

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Accel-Buffering', 'no');
  try {
    const records = await fetchTermCatalog(SIS_KEY, term, (msg) => res.write(msg + '\n'));
    const courses = normalizeCatalog(records);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      termFile(term),
      JSON.stringify({ term, importedAt: new Date().toISOString(), courses })
    );
    res.write(`done: ${courses.length} courses, ${records.length} section records\n`);
  } catch (err) {
    res.write(`error: ${err.message}\n`);
  }
  res.end();
});

app.get('/api/courses', (req, res) => {
  const term = req.query.term;
  if (!term) return res.status(400).json({ error: 'term is required' });
  if (term === SAMPLE_TERM) {
    return res.json({ term, courses: SAMPLE_COURSES });
  }
  const file = termFile(term);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: `Term "${term}" has not been imported yet` });
  }
  res.sendFile(file);
});

// /api/ratings?instructors=Last, First|Last, First
app.get('/api/ratings', async (req, res) => {
  const names = String(req.query.instructors ?? '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);
  const out = {};
  await Promise.all(
    names.map(async (name) => {
      out[name] = await lookupInstructor(name);
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
