// First and last day of classes per school and term ("YYYY-MM-DD"), used by
// the calendar export. Add a line when you import a new term; a term missing
// here just asks for its dates in the export dialog. Anything the user types
// there is remembered in localStorage and wins over this table.
// These are the most common section date range in each registrar's own data,
// read Nov 2026. Section ranges can run into reading days or finals, so each
// is worth checking against the published academic calendar.
const SOURCE: Record<string, string> = {
  jhu: "JHU SIS section dates.",
  temple: "Temple's registrar section dates (may run into finals).",
  unc: "UNC's class search meeting dates (may run into finals).",
};

const TERM_DATES: Record<string, Record<string, [string, string]>> = {
  jhu: {
    'Fall 2026': ['2026-08-31', '2026-12-11'],
    'Spring 2027': ['2027-01-25', '2027-04-30'],
  },
  temple: {
    'Fall 2026': ['2026-08-24', '2026-12-15'],
    'Spring 2027': ['2027-01-11', '2027-05-04'],
  },
  unc: {
    'Fall 2026': ['2026-08-17', '2026-12-11'],
    'Spring 2027': ['2027-01-06', '2027-05-06'],
  },
};

const key = (school: string, term: string) => `termdates:${school}:${term}`;

export function termDates(
  school: string,
  term: string
): { start: string; end: string; saved: boolean; source: string } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key(school, term)) ?? 'null');
    if (Array.isArray(saved) && saved.length === 2) {
      return { start: saved[0], end: saved[1], saved: true, source: '' };
    }
  } catch {
    /* fall through to the table */
  }
  const d = TERM_DATES[school]?.[term];
  return d ? { start: d[0], end: d[1], saved: false, source: SOURCE[school] ?? '' } : null;
}

export function saveTermDates(school: string, term: string, start: string, end: string) {
  const d = TERM_DATES[school]?.[term];
  // only store real overrides, so a later fix to the table still reaches the user
  if (d && d[0] === start && d[1] === end) localStorage.removeItem(key(school, term));
  else localStorage.setItem(key(school, term), JSON.stringify([start, end]));
}
