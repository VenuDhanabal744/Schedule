// UNC-Chapel Hill course data from the public class search at
// https://reports.unc.edu/class-search/ (server-rendered HTML, parsed here).
//
// Note: UNC deliberately removed instructor names and room numbers from the
// public search results ("removed based on request" in the page source), so
// sections import without instructors and professor ratings stay empty.

const BASE = 'https://reports.unc.edu/class-search/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
const CONCURRENCY = 6;

// "2026 Fall" -> "Fall 2026"
function normalizeTermName(raw) {
  const m = raw.match(/^(\d{4})\s+(.+)$/);
  return m ? `${m[2]} ${m[1]}` : raw;
}

async function fetchPage(params) {
  const url = params ? `${BASE}?${params}` : BASE;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`UNC class search ${res.status} for ${url}`);
  return res.text();
}

function embeddedJson(html, id) {
  const m = html.match(
    new RegExp(`<script id="${id}" type="application/json">(.*?)</script>`, 's')
  );
  return m ? JSON.parse(m[1]) : null;
}

export async function fetchUncTerms() {
  const html = await fetchPage();
  const terms = embeddedJson(html, 'json_terms');
  if (!terms) throw new Error('UNC terms list not found — page layout may have changed');
  // code = the raw value the search expects; name = our normalized display form
  return terms.map((t) => ({ code: t, name: normalizeTermName(t) })).reverse();
}

async function fetchSubjects() {
  const html = await fetchPage();
  const subjects = embeddedJson(html, 'json_subjects');
  if (!subjects) throw new Error('UNC subject list not found — page layout may have changed');
  return subjects;
}

// "TTH 12:30 PM-01:45 PM" -> { days, start, end } | null
const DAY_TOKENS = [
  ['TH', 'Th'],
  ['SU', 'Su'],
  ['SA', 'Sa'],
  ['M', 'M'],
  ['T', 'T'],
  ['W', 'W'],
  ['F', 'F'],
];

function parseUncTime(str) {
  const m = str.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return h * 60 + parseInt(m[2], 10);
}

function parseUncSchedule(cell) {
  const meetings = [];
  for (const part of cell.split('\n')) {
    const m = part.trim().match(/^([A-Z]+)\s+(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)$/i);
    if (!m) continue;
    const days = [];
    const dayStr = m[1].toUpperCase();
    let i = 0;
    while (i < dayStr.length) {
      const tok = DAY_TOKENS.find(([t]) => dayStr.startsWith(t, i));
      if (!tok) break;
      days.push(tok[1]);
      i += tok[0].length;
    }
    const start = parseUncTime(m[2]);
    const end = parseUncTime(m[3]);
    if (days.length && start != null && end != null) meetings.push({ days, start, end });
  }
  return meetings;
}

// Parse the results table into row objects, honoring rowspan carry-down.
export function parseResultsTable(html) {
  const bodyMatch = html.match(/<tbody[^>]*>(.*)<\/tbody>/s) ?? html.match(/<table[^>]*>(.*)<\/table>/s);
  if (!bodyMatch) return [];
  const rowsHtml = [...bodyMatch[1].matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)].map((m) => m[1]);

  const rows = [];
  const carry = []; // per column index: { value, remaining }
  for (const rowHtml of rowsHtml) {
    const tds = [...rowHtml.matchAll(/<td([^>]*)>(.*?)<\/td>/gs)].map((m) => ({
      rowspan: parseInt(m[1].match(/rowspan="(\d+)"/)?.[1] ?? '1', 10),
      // keep line breaks so multi-meeting schedules stay splittable
      text: m[2]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .trim(),
    }));
    if (!tds.length) continue;

    const cells = [];
    let tdIdx = 0;
    for (let col = 0; tdIdx < tds.length || (carry[col] && carry[col].remaining > 0); col++) {
      if (carry[col] && carry[col].remaining > 0) {
        cells[col] = carry[col].value;
        carry[col].remaining--;
      } else {
        const td = tds[tdIdx++];
        if (!td) break;
        cells[col] = td.text;
        if (td.rowspan > 1) carry[col] = { value: td.text, remaining: td.rowspan - 1 };
      }
    }
    rows.push(cells);
  }
  return rows;
}

export async function fetchUncCatalog(termCode, onProgress) {
  const subjects = await fetchSubjects();
  onProgress?.(`Searching ${subjects.length} subjects…`);
  const allRows = [];
  let done = 0;
  let queue = 0;

  async function worker() {
    while (queue < subjects.length) {
      const subject = subjects[queue++];
      try {
        const html = await fetchPage(
          `term=${encodeURIComponent(termCode)}&subject=${encodeURIComponent(subject)}`
        );
        const rows = parseResultsTable(html);
        if (rows.length) allRows.push(...rows);
      } catch (err) {
        onProgress?.(`  warning: ${subject}: ${err.message}`);
      }
      done++;
      if (done % 50 === 0) onProgress?.(`Searched ${done}/${subjects.length} subjects (${allRows.length} sections so far)…`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  onProgress?.(`Found ${allRows.length} sections`);
  return allRows;
}

// Current public table columns (from the page's own cell comments):
// 0 subject, 1 catalog, 2 cross-listed, 3 section, 4 class number,
// 5 description, 6 term, 7 hours, 8 meeting dates, 9 schedule,
// 10 instruction mode, 11 available seats
export function normalizeUncCatalog(rows) {
  const courses = new Map();
  for (const cells of rows) {
    if (cells.length < 12) continue;
    const subject = cells[0];
    const catalog = cells[1];
    if (!subject || !catalog) continue;
    const code = `${subject} ${catalog}`;
    if (!courses.has(code)) {
      courses.set(code, {
        code,
        title: cells[5],
        department: subject,
        school: 'UNC-Chapel Hill',
        credits: cells[7],
        level: '',
        areas: '',
        writingIntensive: false,
        sections: [],
      });
    }
    const course = courses.get(code);
    const sectionName = cells[3];
    if (!sectionName) continue;
    // a section with multiple meeting patterns appears as one row per pattern —
    // fold later rows' meetings into the existing section
    const existing = course.sections.find((s) => s.section === sectionName);
    if (existing) {
      existing.meetings.push(...parseUncSchedule(cells[9] ?? ''));
      continue;
    }
    const seats = parseInt(cells[11], 10);
    course.sections.push({
      section: sectionName,
      instructors: [], // intentionally empty: UNC redacts instructors from public search
      meetings: parseUncSchedule(cells[9] ?? ''),
      status: Number.isFinite(seats) && seats > 0 ? 'Open' : 'Full',
      seatsAvailable: Number.isFinite(seats) ? String(seats) : '',
      openSeats: Number.isFinite(seats) ? String(seats) : '',
      waitlisted: '',
      location: '',
      instructionMethod: cells[10] ?? '',
    });
  }
  const list = [...courses.values()];
  list.sort((a, b) => a.code.localeCompare(b.code));
  return list;
}
