// Client for the JHU SIS public course search API (https://sis.jhu.edu/api)
// and normalization of its records into the app's course/section shape.

const BASE = 'https://sis.jhu.edu/api/classes';

async function sisFetch(path, key) {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`;
  // without a timeout, a request SIS never answers hangs the import forever
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`SIS API ${res.status} for ${path}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`SIS API returned non-JSON for ${path}: ${text.slice(0, 300)}`);
  }
}

export async function fetchTerms(key) {
  const terms = await sisFetch('/codes/terms', key);
  return terms.map((t) => t.Name ?? t.name ?? String(t));
}

export async function fetchSchools(key) {
  const schools = await sisFetch('/codes/schools', key);
  return schools.map((s) => s.Name ?? s.name ?? String(s));
}

// Fetch every section record for a term, school by school.
export async function fetchTermCatalog(key, term, onProgress) {
  const schools = await fetchSchools(key);
  const records = [];
  for (const school of schools) {
    onProgress?.(`Fetching ${school}…`);
    // A school with no offerings comes back as an empty list, so an error is a
    // real failure (SIS is flaky): retry, then abort rather than save a catalog
    // silently missing a whole school.
    for (let attempt = 1; ; attempt++) {
      try {
        const recs = await sisFetch(
          `/${encodeURIComponent(school)}/${encodeURIComponent(term)}`,
          key
        );
        if (Array.isArray(recs)) records.push(...recs);
        break;
      } catch (err) {
        if (attempt >= 3) throw new Error(`${school}: ${err.message}`);
        onProgress?.(`  ${school}: ${err.message}; retrying (${attempt}/2)`);
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
  }
  return records;
}

// ---- normalization ----

const DAY_TOKENS = [
  ['Th', 'Th'],
  ['Tu', 'T'],
  ['Sa', 'Sa'],
  ['Su', 'Su'],
  ['M', 'M'],
  ['T', 'T'],
  ['W', 'W'],
  ['F', 'F'],
  ['S', 'Sa'],
];

export function parseDays(dow) {
  if (!dow || typeof dow !== 'string') return [];
  const days = [];
  let i = 0;
  const s = dow.replace(/\s+/g, '');
  while (i < s.length) {
    let matched = false;
    for (const [token, canonical] of DAY_TOKENS) {
      if (s.startsWith(token, i)) {
        days.push(canonical);
        i += token.length;
        matched = true;
        break;
      }
    }
    if (!matched) i += 1;
  }
  return [...new Set(days)];
}

// "1:30PM", "1:30 PM", "13:30" -> minutes since midnight, or null. Trailing
// labels are ignored: SIS writes e.g. "7:30PM - 10:00PM Screenings".
export function parseTime(str) {
  if (!str) return null;
  const m = String(str)
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3]?.toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

// "1:30 PM - 2:45 PM" -> {start, end} in minutes, or null.
function parseTimeRange(str) {
  if (!str) return null;
  const parts = String(str).split(/\s*[-–]\s*/);
  if (parts.length !== 2) return null;
  const start = parseTime(parts[0]);
  const end = parseTime(parts[1]);
  if (start == null || end == null) return null;
  return { start, end };
}

// A meeting: { days: ["M","W"], start: minutes, end: minutes }
// Handles the shapes the SIS API is known to produce:
//  - record.Meetings as an array of {DOW, Times, ...}
//  - record.Meetings as a "DOW : Times; DOW : Times" style string
//  - flat record.DOW + record.TimeOfDay / record.Times
export function extractMeetings(record) {
  const meetings = [];

  const push = (dow, timesStr) => {
    const range = parseTimeRange(timesStr);
    const days = parseDays(dow);
    if (range && days.length) meetings.push({ days, ...range });
  };

  const m = record.Meetings;
  if (Array.isArray(m)) {
    for (const mt of m) push(mt.DOW ?? mt.Dow ?? mt.days, mt.Times ?? mt.times);
  } else if (typeof m === 'string' && m.trim()) {
    // multiple meetings are separated by "," (e.g. "MW 10:00AM - 10:50AM, F 10:00AM - 10:50AM")
    for (const part of m.split(/[;,]/)) {
      const seg = part.trim();
      if (!seg) continue;
      const colon = seg.indexOf(':') !== -1 ? seg.match(/^([^:]*?)\s*:\s*(.+)$/) : null;
      if (colon && parseTimeRange(colon[2])) {
        push(colon[1], colon[2]);
      } else {
        // "MWF 10:00 AM - 10:50 AM" style
        const sp = seg.match(/^([A-Za-z]+)\s+(.+)$/);
        if (sp) push(sp[1], sp[2]);
      }
    }
  }

  if (!meetings.length) {
    const timesStr = record.TimeOfDay ?? record.Times ?? record.Time;
    push(record.DOW ?? record.Dow, timesStr);
  }

  return meetings;
}

function cleanInstructors(record) {
  // "Last, First; Last, First" — semicolons separate people, commas are within a name
  const raw = record.InstructorsFullName ?? record.Instructors ?? '';
  return String(raw)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Group raw SIS section records into courses with sections.
export function normalizeCatalog(records) {
  const courses = new Map();
  for (const r of records) {
    const code = r.OfferingName?.trim();
    if (!code) continue;
    if (!courses.has(code)) {
      courses.set(code, {
        code,
        title: r.Title?.trim() ?? '',
        department: r.Department ?? '',
        school: r.SchoolName ?? '',
        credits: r.Credits ?? '',
        level: r.Level ?? '',
        areas: r.Areas ?? '',
        writingIntensive: r.IsWritingIntensive === 'Yes',
        sections: [],
      });
    }
    const course = courses.get(code);
    const sectionName = String(r.SectionName ?? '').trim();
    if (course.sections.some((s) => s.section === sectionName)) continue;
    course.sections.push({
      section: sectionName,
      instructors: cleanInstructors(r),
      meetings: extractMeetings(r),
      status: r.Status ?? '',
      seatsAvailable: r.SeatsAvailable ?? '',
      openSeats: r.OpenSeats ?? '',
      waitlisted: r.Waitlisted ?? '',
      location: r.Location ?? '',
      instructionMethod: r.InstructionMethod ?? '',
    });
  }
  const list = [...courses.values()];
  list.sort((a, b) => a.code.localeCompare(b.code));
  return list;
}
