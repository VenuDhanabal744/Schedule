// Temple University course data via Ellucian Banner self-service (unofficial
// but public JSON endpoints). A search session is established per import by
// POSTing the term, then results are paged through with the session cookies.

const BASE = 'https://prd-xereg.temple.edu/StudentRegistrationSsb/ssb';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
const PAGE_SIZE = 500;

// "2026 Fall" -> "Fall 2026", "2026 Summer I" -> "Summer I 2026"
function normalizeTermName(description) {
  const m = description.match(/^(\d{4})\s+(.+)$/);
  return m ? `${m[2]} ${m[1]}` : description;
}

export async function fetchTempleTerms() {
  const res = await fetch(`${BASE}/classSearch/getTerms?searchTerm=&offset=1&max=60`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Temple terms request failed (${res.status})`);
  const terms = await res.json();
  // "View Only" marks terms closed to registration. Old ones are history, but a
  // view-only term newer than every open one is an upcoming term whose schedule
  // is already published — exactly what a planner wants. Codes sort as YYYYTT.
  const viewOnly = (t) => /\(view only\)/i.test(t.description);
  const newestOpen = terms
    .filter((t) => !viewOnly(t))
    .reduce((max, t) => (t.code > max ? t.code : max), '');
  return terms
    .filter((t) => !viewOnly(t) || t.code > newestOpen)
    .map((t) => ({
      code: t.code,
      name: normalizeTermName(t.description.replace(/\s*\(view only\)\s*/i, '').trim()),
    }));
}

// "1140" -> minutes since midnight
function bannerTime(str) {
  if (!str || !/^\d{3,4}$/.test(str)) return null;
  const h = parseInt(str.slice(0, -2), 10);
  const m = parseInt(str.slice(-2), 10);
  return h * 60 + m;
}

const DAY_FLAGS = [
  ['monday', 'M'],
  ['tuesday', 'T'],
  ['wednesday', 'W'],
  ['thursday', 'Th'],
  ['friday', 'F'],
  ['saturday', 'Sa'],
  ['sunday', 'Su'],
];

function extractTempleMeetings(record) {
  const meetings = [];
  for (const mf of record.meetingsFaculty ?? []) {
    const mt = mf.meetingTime;
    if (!mt) continue;
    const start = bannerTime(mt.beginTime);
    const end = bannerTime(mt.endTime);
    if (start == null || end == null) continue;
    const days = DAY_FLAGS.filter(([flag]) => mt[flag]).map(([, d]) => d);
    if (days.length) meetings.push({ days, start, end });
  }
  return meetings;
}

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

const REQUEST_TIMEOUT_MS = 60_000;
const SESSION_ATTEMPTS = 4;

// Establish a search session for this term. Banner keys search state on the
// cookies plus a client-chosen uniqueSessionId, as its own web page does.
async function startSession(termCode) {
  const uniqueSessionId = `sched${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const init = await fetch(`${BASE}/term/search?mode=search`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `term=${encodeURIComponent(termCode)}&uniqueSessionId=${uniqueSessionId}`,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!init.ok) throw new Error(`Temple session request failed (${init.status})`);
  const cookies = (init.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');
  return { cookies, uniqueSessionId };
}

async function fetchPage(termCode, session, offset) {
  const url =
    `${BASE}/searchResults/searchResults?txt_term=${encodeURIComponent(termCode)}` +
    `&uniqueSessionId=${session.uniqueSessionId}` +
    `&pageOffset=${offset}&pageMaxSize=${PAGE_SIZE}&sortColumn=subjectDescription&sortDirection=asc`;
  for (let attempt = 0; ; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
    try {
      // without a timeout, a request Banner never answers hangs the import forever
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json', Cookie: session.cookies },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (!body.success && !Array.isArray(body.data)) {
        throw new Error('no data — session may have expired');
      }
      return body;
    } catch (err) {
      if (attempt >= 3) throw new Error(`Temple search failed at offset ${offset}: ${err.message}`);
    }
  }
}

export async function fetchTempleCatalog(termCode, onProgress) {
  // Banner intermittently answers a fresh session with zero results, or drops a
  // session midway; either way, start over with a new session.
  for (let attempt = 1; ; attempt++) {
    try {
      const session = await startSession(termCode);
      const records = [];
      let total = Infinity;
      for (let offset = 0; offset < total; offset += PAGE_SIZE) {
        const body = await fetchPage(termCode, session, offset);
        total = body.totalCount ?? 0;
        if (!total) throw new Error('search returned 0 sections');
        if (!body.data?.length) throw new Error(`empty page at offset ${offset} of ${total}`);
        records.push(...body.data);
        onProgress?.(`Fetched ${Math.min(offset + PAGE_SIZE, total)} of ${total} sections…`);
      }
      return records;
    } catch (err) {
      if (attempt >= SESSION_ATTEMPTS) throw err;
      onProgress?.(`  ${err.message}; retrying with a new session (${attempt}/${SESSION_ATTEMPTS - 1})`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

export function normalizeTempleCatalog(records) {
  const courses = new Map();
  for (const r of records) {
    if (!r.subject || !r.courseNumber) continue;
    const code = `${r.subject} ${r.courseNumber}`;
    if (!courses.has(code)) {
      courses.set(code, {
        code,
        title: decodeEntities(r.courseTitle),
        department: decodeEntities(r.subjectDescription ?? r.subject),
        school: decodeEntities(r.collegeDescription ?? 'Temple University'),
        credits: String(r.creditHourLow ?? r.creditHours ?? ''),
        level: '',
        areas: '',
        writingIntensive: false,
        sections: [],
      });
    }
    const course = courses.get(code);
    const sectionName = String(r.sequenceNumber ?? '').trim();
    if (course.sections.some((s) => s.section === sectionName)) continue;
    const seats = r.seatsAvailable ?? 0;
    course.sections.push({
      section: sectionName,
      instructors: (r.faculty ?? []).map((f) => decodeEntities(f.displayName)).filter(Boolean),
      meetings: extractTempleMeetings(r),
      status: seats > 0 ? 'Open' : (r.waitAvailable ?? 0) > 0 ? 'Waitlist Only' : 'Full',
      seatsAvailable: `${seats}/${r.maximumEnrollment ?? ''}`,
      openSeats: String(seats),
      waitlisted: String(r.waitCount ?? ''),
      location: decodeEntities(r.campusDescription ?? ''),
      instructionMethod: decodeEntities(r.instructionalMethodDescription ?? ''),
    });
  }
  const list = [...courses.values()];
  list.sort((a, b) => a.code.localeCompare(b.code));
  return list;
}
