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
  truncated: boolean;
  // courses with no section passing constraints (blocks all schedules)
  impossible: string[];
};

const CAP = 1000;

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

  // Order courses by fewest options first: prunes the search tree faster.
  const order = courses.map((_, i) => i).sort((a, b) => valid[a].length - valid[b].length);

  const results: number[][] = [];
  let truncated = false;
  const combo: number[] = new Array(courses.length).fill(-1);

  function backtrack(pos: number) {
    if (truncated) return;
    if (pos === order.length) {
      if (gapsOk(courses, combo, constraints.minGap, constraints.maxGap)) {
        results.push([...combo]);
        if (results.length >= CAP) truncated = true;
      }
      return;
    }
    const ci = order[pos];
    for (const si of valid[ci]) {
      const sec = courses[ci].sections[si];
      let ok = true;
      for (let p = 0; p < pos; p++) {
        const pj = order[p];
        if (sectionsConflict(sec, courses[pj].sections[combo[pj]])) {
          ok = false;
          break;
        }
      }
      if (ok) {
        combo[ci] = si;
        backtrack(pos + 1);
        combo[ci] = -1;
        if (truncated) return;
      }
    }
  }
  backtrack(0);

  if (opts.sortBy === 'professors') {
    const profScore = new Map(results.map((r) => [r, scheduleProfScore(courses, r, opts.ratingOf)]));
    results.sort(
      (a, b) =>
        profScore.get(b)! - profScore.get(a)! ||
        scoreSchedule(courses, a) - scoreSchedule(courses, b)
    );
  } else {
    results.sort((a, b) => scoreSchedule(courses, a) - scoreSchedule(courses, b));
  }
  return { schedules: results, truncated, impossible: [] };
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
