import type { Course, Section, Meeting, Constraints } from './types';

export function meetingsConflict(a: Meeting, b: Meeting): boolean {
  if (!a.days.some((d) => b.days.includes(d))) return false;
  return a.start < b.end && b.start < a.end;
}

export function sectionsConflict(a: Section, b: Section): boolean {
  return a.meetings.some((ma) => b.meetings.some((mb) => meetingsConflict(ma, mb)));
}

// Registrars word status differently: JHU "Open" / "Reserved Open" / "Approval
// Required" / "Waitlist Only" / "Closed" / "Canceled", Temple and UNC "Open" /
// "Waitlist Only" / "Full". A section is open if it has seats to register into.
export const sectionCanceled = (s: Section) => /cancel/i.test(s.status);
export const sectionIsOpen = (s: Section) =>
  !s.status || !/closed|full|waitlist|cancel/i.test(s.status);

export function sectionPassesConstraints(s: Section, c: Constraints): boolean {
  if (c.onlyOpen && !sectionIsOpen(s)) return false;
  for (const m of s.meetings) {
    if (c.earliest != null && m.start < c.earliest) return false;
    if (c.latest != null && m.end > c.latest) return false;
    if (m.days.some((d) => c.avoidDays.includes(d))) return false;
  }
  return true;
}

// Two sections with the same signature meet at exactly the same times.
function meetingSignature(s: Section): string {
  return s.meetings
    .map((m) => `${[...m.days].sort().join('')}:${m.start}-${m.end}`)
    .sort()
    .join('|');
}

export type RatingOf = (instructor: string) => number | null;

// Average RMP rating of a section's instructors; null if none are rated.
export function sectionRating(s: Section, ratingOf?: RatingOf): number | null {
  if (!ratingOf) return null;
  const ratings = s.instructors
    .map(ratingOf)
    .filter((r): r is number => r != null);
  if (!ratings.length) return null;
  return ratings.reduce((a, b) => a + b, 0) / ratings.length;
}

const NEUTRAL_RATING = 3;

// Average professor rating across a schedule; unrated sections count as neutral.
export function scheduleProfScore(courses: Course[], combo: number[], ratingOf?: RatingOf): number {
  if (!combo.length) return NEUTRAL_RATING;
  const vals = combo.map(
    (si, ci) => sectionRating(courses[ci].sections[si], ratingOf) ?? NEUTRAL_RATING
  );
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// Check every same-day gap between consecutive classes against min/max bounds.
function gapsOk(
  courses: Course[],
  combo: number[],
  minGap: number | null,
  maxGap: number | null
): boolean {
  if (minGap == null && maxGap == null) return true;
  const byDay: Record<string, { start: number; end: number }[]> = {};
  combo.forEach((si, ci) => {
    for (const m of courses[ci].sections[si].meetings) {
      for (const d of m.days) (byDay[d] ??= []).push(m);
    }
  });
  for (const blocks of Object.values(byDay)) {
    blocks.sort((a, b) => a.start - b.start);
    for (let i = 1; i < blocks.length; i++) {
      const gap = blocks[i].start - blocks[i - 1].end;
      if (minGap != null && gap < minGap) return false;
      if (maxGap != null && gap > maxGap) return false;
    }
  }
  return true;
}

export type GenOptions = {
  ratingOf?: RatingOf;
  sortBy?: 'compact' | 'professors';
  // Per course (same order as the courses array): a section index the user has
  // locked in place, or null. A locked section is the course's only option and
  // bypasses constraint filtering — the user pinned it deliberately.
  lockedIdx?: (number | null)[];
};

export type GenResult = {
  schedules: number[][]; // per course in input order, chosen section index
  // the search stopped before checking every combination, or found more
  // schedules than are returned
  truncated: boolean;
  // courses with no section passing constraints (blocks all schedules)
  impossible: string[];
};

// Schedules returned to page through, best first.
const KEEP = 1000;
// Complete schedules scored before the search stops. Sorting happens over all
// of them, so "best" is the best of up to this many, not of the first KEEP.
const MAX_FOUND = 50_000;
// Section placements tried before giving up, so impossible constraint sets
// (e.g. a max break nothing can satisfy) can't freeze the page.
const MAX_STEPS = 1_500_000;

// Smallest same-day distance between two sections' meetings (negative = overlap).
function minDayDistance(a: Section, b: Section): number {
  let min = Infinity;
  for (const ma of a.meetings) {
    for (const mb of b.meetings) {
      if (!ma.days.some((d) => mb.days.includes(d))) continue;
      min = Math.min(min, Math.max(ma.start - mb.end, mb.start - ma.end));
    }
  }
  return min;
}

// Score a schedule: lower is better. Sum of gaps between classes plus a small
// penalty per day on campus, so compact schedules sort first.
function scoreSchedule(courses: Course[], combo: number[]): number {
  const byDay: Record<string, { start: number; end: number }[]> = {};
  combo.forEach((si, ci) => {
    for (const m of courses[ci].sections[si].meetings) {
      for (const d of m.days) {
        (byDay[d] ??= []).push({ start: m.start, end: m.end });
      }
    }
  });
  let score = 0;
  for (const blocks of Object.values(byDay)) {
    blocks.sort((a, b) => a.start - b.start);
    for (let i = 1; i < blocks.length; i++) {
      score += Math.max(0, blocks[i].start - blocks[i - 1].end);
    }
    score += 60; // per-day-on-campus penalty
  }
  return score;
}

export function generateSchedules(
  courses: Course[],
  constraints: Constraints,
  opts: GenOptions = {}
): GenResult {
  const valid: number[][] = courses.map((c, ci) => {
    const lock = opts.lockedIdx?.[ci];
    if (lock != null && c.sections[lock]) return [lock];
    // Canceled sections are never an option. Prefer sections with actual meeting
    // times; a "Time TBA" section only counts when the whole course has no timed
    // sections (online/independent work).
    const live = c.sections.map((_, i) => i).filter((i) => !sectionCanceled(c.sections[i]));
    const timed = live.filter((i) => c.sections[i].meetings.length > 0);
    const pool = timed.length ? timed : live;
    const passing = pool.filter((i) => sectionPassesConstraints(c.sections[i], constraints));
    // Collapse sections that meet at identical times (same class, different
    // professor) into one option. The representative prefers open status, then
    // the best-rated professor.
    const isOpen = (j: number) => sectionIsOpen(c.sections[j]);
    const beats = (i: number, prev: number) => {
      if (isOpen(i) !== isOpen(prev)) return isOpen(i);
      const ri = sectionRating(c.sections[i], opts.ratingOf) ?? -1;
      const rp = sectionRating(c.sections[prev], opts.ratingOf) ?? -1;
      return ri > rp;
    };
    const bySig = new Map<string, number>();
    for (const i of passing) {
      const sig = meetingSignature(c.sections[i]);
      const prev = bySig.get(sig);
      if (prev == null || beats(i, prev)) bySig.set(sig, i);
    }
    return [...bySig.values()];
  });
  const impossible = courses.filter((_, i) => valid[i].length === 0).map((c) => c.code);
  if (impossible.length) return { schedules: [], truncated: false, impossible };

  const n = courses.length;
  const sec = (ci: number, a: number) => courses[ci].sections[valid[ci][a]];
  // Two classes closer than minGap anywhere on a day means some consecutive
  // pair is too, so pairwise compatibility can enforce minGap (and conflicts,
  // which are a negative distance) up front.
  const minGap = constraints.minGap ?? 0;
  // compat[ci][a][cj][b]: option a of course ci can coexist with option b of cj
  const compat: Uint8Array[][][] = valid.map((opsI, ci) =>
    opsI.map((_, a) =>
      valid.map((opsJ, cj) =>
        cj === ci
          ? new Uint8Array(0)
          : Uint8Array.from(opsJ, (_, b) => (minDayDistance(sec(ci, a), sec(cj, b)) >= minGap ? 1 : 0))
      )
    )
  );

  // A break longer than maxGap in a partial schedule is fatal unless some
  // still-unplaced course has an option with a meeting that fits inside it.
  function breaksFillable(domains: number[][], combo: number[]): boolean {
    const maxGap = constraints.maxGap;
    if (maxGap == null) return true;
    const byDay: Record<string, Meeting[]> = {};
    combo.forEach((si, ci) => {
      if (si === -1) return;
      for (const m of courses[ci].sections[si].meetings) {
        for (const d of m.days) (byDay[d] ??= []).push(m);
      }
    });
    for (const [day, blocks] of Object.entries(byDay)) {
      blocks.sort((x, y) => x.start - y.start);
      for (let i = 1; i < blocks.length; i++) {
        const from = blocks[i - 1].end;
        const to = blocks[i].start;
        if (to - from <= maxGap) continue;
        const fillable = domains.some(
          (dom, cj) =>
            combo[cj] === -1 &&
            dom.some((b) =>
              sec(cj, b).meetings.some(
                (m) => m.days.includes(day) && m.start >= from && m.end <= to
              )
            )
        );
        if (!fillable) return false;
      }
    }
    return true;
  }

  const results: number[][] = [];
  let stopped = false;
  let steps = 0;
  const combo: number[] = new Array(n).fill(-1);

  // domains[cj]: positions in valid[cj] still compatible with everything placed.
  // Each step places the course with the fewest options left, then prunes the
  // others' options; a course left with none means this branch is dead.
  function backtrack(domains: number[][], remaining: number) {
    if (remaining === 0) {
      if (gapsOk(courses, combo, constraints.minGap, constraints.maxGap)) {
        results.push([...combo]);
        if (results.length >= MAX_FOUND) stopped = true;
      }
      return;
    }
    let ci = -1;
    for (let j = 0; j < n; j++) {
      if (combo[j] === -1 && (ci === -1 || domains[j].length < domains[ci].length)) ci = j;
    }
    for (const a of domains[ci]) {
      if (++steps > MAX_STEPS) stopped = true;
      if (stopped) return;
      combo[ci] = valid[ci][a];
      const next = domains.slice();
      let dead = false;
      for (let j = 0; j < n && !dead; j++) {
        if (combo[j] !== -1) continue;
        const row = compat[ci][a][j];
        next[j] = domains[j].filter((b) => row[b]);
        dead = next[j].length === 0;
      }
      if (!dead && breaksFillable(next, combo)) backtrack(next, remaining - 1);
      combo[ci] = -1;
    }
  }
  backtrack(
    valid.map((ops) => ops.map((_, a) => a)),
    n
  );

  const scored = results.map((combo) => ({
    combo,
    compact: scoreSchedule(courses, combo),
    prof: opts.sortBy === 'professors' ? scheduleProfScore(courses, combo, opts.ratingOf) : 0,
  }));
  scored.sort((a, b) => b.prof - a.prof || a.compact - b.compact);
  return {
    schedules: scored.slice(0, KEEP).map((s) => s.combo),
    truncated: stopped || scored.length > KEEP,
    impossible: [],
  };
}

export function fmtTime(mins: number): string {
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const ap = h24 >= 12 ? 'PM' : 'AM';
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h}${ap}` : `${h}:${String(m).padStart(2, '0')}${ap}`;
}

export function fmtMeetings(meetings: Meeting[]): string {
  if (!meetings.length) return 'Time TBA';
  return meetings
    .map((m) => `${m.days.join('')} ${fmtTime(m.start)}–${fmtTime(m.end)}`)
    .join(', ');
}
