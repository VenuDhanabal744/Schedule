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
  return terms
    .filter((t) => !/view only/i.test(t.description))
    .map((t) => ({ code: t.code, name: normalizeTermName(t.description) }));
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

export async function fetchTempleCatalog(termCode, onProgress) {
  // establish a search session for this term and keep its cookies
  const init = await fetch(`${BASE}/term/search?mode=search`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `term=${encodeURIComponent(termCode)}`,
  });
  if (!init.ok) throw new Error(`Temple session request failed (${init.status})`);
  const cookies = (init.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');

  const records = [];
  let total = Infinity;
  for (let offset = 0; offset < total; offset += PAGE_SIZE) {
    const url =
      `${BASE}/searchResults/searchResults?txt_term=${encodeURIComponent(termCode)}` +
      `&pageOffset=${offset}&pageMaxSize=${PAGE_SIZE}&sortColumn=subjectDescription&sortDirection=asc`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', Cookie: cookies },
    });
    if (!res.ok) throw new Error(`Temple search failed at offset ${offset} (${res.status})`);
    const body = await res.json();
    if (!body.success && !Array.isArray(body.data)) {
      throw new Error('Temple search returned no data — session may have expired');
    }
    total = body.totalCount ?? 0;
    records.push(...(body.data ?? []));
    onProgress?.(`Fetched ${Math.min(offset + PAGE_SIZE, total)} of ${total} sections…`);
  }
  return records;
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
