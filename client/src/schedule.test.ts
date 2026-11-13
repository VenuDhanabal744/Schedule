import { describe, expect, it } from 'vitest';
import type { Constraints, Course, Meeting, Section } from './types';
import {
  fmtMeetings,
  fmtTime,
  generateSchedules,
  meetingsConflict,
  sectionIsOpen,
  sectionPassesConstraints,
  sectionsConflict,
} from './schedule';

const mt = (days: string, start: number, end: number): Meeting => ({
  days: days.match(/Th|Sa|Su|[MTWF]/g) ?? [],
  start: start * 60,
  end: end * 60,
});
const sec = (name: string, meetings: Meeting[], extra: Partial<Section> = {}): Section => ({
  section: name,
  instructors: [],
  meetings,
  status: 'Open',
  seatsAvailable: '',
  openSeats: '',
  waitlisted: '',
  location: '',
  instructionMethod: '',
  ...extra,
});
const course = (code: string, sections: Section[]): Course => ({
  code,
  title: code,
  department: '',
  school: '',
  credits: '3',
  level: '',
  areas: '',
  writingIntensive: false,
  sections,
});
const NONE: Constraints = { earliest: null, latest: null, avoidDays: [], onlyOpen: false, minGap: null, maxGap: null };

describe('conflicts', () => {
  it('needs a shared day and overlapping times', () => {
    expect(meetingsConflict(mt('MW', 9, 10), mt('W', 9.5, 11))).toBe(true);
    expect(meetingsConflict(mt('MW', 9, 10), mt('TTh', 9, 10))).toBe(false);
    expect(meetingsConflict(mt('T', 9, 10), mt('Th', 9, 10))).toBe(false); // T is not Th
  });
  it('treats back-to-back classes as compatible', () => {
    expect(meetingsConflict(mt('M', 9, 10), mt('M', 10, 11))).toBe(false);
  });
  it('checks every meeting of a section', () => {
    const a = sec('01', [mt('MW', 9, 10), mt('F', 13, 14)]);
    expect(sectionsConflict(a, sec('02', [mt('F', 13.5, 15)]))).toBe(true);
    expect(sectionsConflict(a, sec('03', [mt('F', 14, 15)]))).toBe(false);
  });
});

describe('constraints', () => {
  const s = sec('01', [mt('MW', 9, 10.25)]);
  it('earliest / latest / free days', () => {
    expect(sectionPassesConstraints(s, { ...NONE, earliest: 9 * 60 })).toBe(true);
    expect(sectionPassesConstraints(s, { ...NONE, earliest: 10 * 60 })).toBe(false);
    expect(sectionPassesConstraints(s, { ...NONE, latest: 10 * 60 })).toBe(false);
    expect(sectionPassesConstraints(s, { ...NONE, avoidDays: ['W'] })).toBe(false);
    expect(sectionPassesConstraints(s, { ...NONE, avoidDays: ['F'] })).toBe(true);
  });
  it('open sections only', () => {
    for (const status of ['Closed', 'Full', 'Waitlist Only', 'Canceled']) {
      expect(sectionIsOpen(sec('01', [], { status }))).toBe(false);
    }
    expect(sectionIsOpen(sec('01', [], { status: 'Reserved Open' }))).toBe(true);
    expect(sectionPassesConstraints(sec('01', [], { status: 'Closed' }), { ...NONE, onlyOpen: true })).toBe(false);
  });
});

describe('generateSchedules', () => {
  const A = course('A', [sec('01', [mt('MW', 9, 10)]), sec('02', [mt('MW', 11, 12)])]);
  const B = course('B', [sec('01', [mt('MW', 9, 10)]), sec('02', [mt('TTh', 9, 10)])]);

  it('returns only conflict-free combinations', () => {
    const { schedules, impossible } = generateSchedules([A, B], NONE);
    expect(impossible).toEqual([]);
    expect(schedules).toHaveLength(3); // every pairing except both at MW 9
    for (const [a, b] of schedules) expect(sectionsConflict(A.sections[a], B.sections[b])).toBe(false);
  });

  it('puts the most compact schedule first', () => {
    const X = course('X', [sec('01', [mt('MW', 9, 10)])]);
    const C = course('C', [sec('01', [mt('MW', 15, 16)]), sec('02', [mt('MW', 10, 11)])]);
    // back-to-back beats a five-hour gap
    expect(generateSchedules([X, C], NONE).schedules).toEqual([[0, 1], [0, 0]]);
  });

  it('reports courses no section of which passes the constraints', () => {
    const r = generateSchedules([A, B], { ...NONE, earliest: 10 * 60 });
    expect(r.schedules).toEqual([]);
    expect(r.impossible).toEqual(['B']);
  });

  it('keeps a locked section even when it breaks a constraint', () => {
    const r = generateSchedules([A, B], { ...NONE, earliest: 10 * 60 }, { lockedIdx: [null, 1] });
    expect(r.schedules).toEqual([[1, 1]]);
  });

  it('enforces minimum and maximum breaks between classes', () => {
    const C = course('C', [sec('01', [mt('MW', 10, 11)]), sec('02', [mt('MW', 15, 16)])]);
    const first = course('X', [sec('01', [mt('MW', 9, 10)])]);
    expect(generateSchedules([first, C], { ...NONE, minGap: 30 }).schedules).toEqual([[0, 1]]);
    expect(generateSchedules([first, C], { ...NONE, maxGap: 60 }).schedules).toEqual([[0, 0]]);
    expect(generateSchedules([first, C], { ...NONE, minGap: 30, maxGap: 60 }).schedules).toEqual([]);
  });

  it('never offers canceled sections and prefers timed ones', () => {
    const D = course('D', [
      sec('01', [mt('F', 9, 10)], { status: 'Canceled' }),
      sec('02', []),
      sec('03', [mt('F', 11, 12)]),
    ]);
    expect(generateSchedules([D], NONE).schedules).toEqual([[2]]);
    const tba = course('E', [sec('01', [])]);
    expect(generateSchedules([tba], NONE).schedules).toEqual([[0]]);
  });

  it('collapses same-time sections to the open, best-rated one', () => {
    const E = course('E', [
      sec('01', [mt('M', 9, 10)], { instructors: ['Low'] }),
      sec('02', [mt('M', 9, 10)], { instructors: ['High'] }),
      sec('03', [mt('M', 9, 10)], { instructors: ['Best'], status: 'Closed' }),
    ]);
    const ratingOf = (n: string) => ({ Low: 2, High: 4.5, Best: 5 })[n] ?? null;
    expect(generateSchedules([E], NONE, { ratingOf }).schedules).toEqual([[1]]);
  });

  it('sorts by professor rating when asked', () => {
    const F = course('F', [
      sec('01', [mt('M', 9, 10)], { instructors: ['Low'] }),
      sec('02', [mt('T', 9, 10)], { instructors: ['High'] }),
    ]);
    const ratingOf = (n: string) => (n === 'High' ? 5 : 1);
    expect(generateSchedules([F], NONE, { ratingOf, sortBy: 'professors' }).schedules[0]).toEqual([1]);
  });
});

describe('formatting', () => {
  it('formats times and meetings', () => {
    expect(fmtTime(0)).toBe('12AM');
    expect(fmtTime(13 * 60 + 30)).toBe('1:30PM');
    expect(fmtMeetings([])).toBe('Time TBA');
    expect(fmtMeetings([mt('MW', 9, 10)])).toBe('MW 9AM–10AM');
  });
});
