import { describe, expect, it } from 'vitest';
import type { Course } from './types';
import { buildIcs } from './ics';

const course: Course = {
  code: 'EN.580.243',
  title: 'Linear Signals, and Systems',
  department: '',
  school: '',
  credits: '2',
  level: '',
  areas: '',
  writingIntensive: false,
  sections: [
    {
      section: '01',
      instructors: ['Miller, Michael I'],
      meetings: [
        { days: ['M', 'W'], start: 13 * 60 + 30, end: 14 * 60 + 45 },
        { days: ['F'], start: 9 * 60, end: 9 * 60 + 50 },
      ],
      status: 'Open',
      seatsAvailable: '',
      openSeats: '',
      waitlisted: '',
      location: 'Homewood Campus',
      instructionMethod: '',
    },
    { section: '02', instructors: [], meetings: [], status: '', seatsAvailable: '', openSeats: '', waitlisted: '', location: '', instructionMethod: '' },
  ],
};

describe('buildIcs', () => {
  // 2026-09-01 is a Tuesday
  const ics = buildIcs(course.sections.map((section) => ({ course, section })), '2026-09-01', '2026-12-11', new Date('2026-08-01T12:00:00Z'));
  it('starts each meeting on its first weekday on or after the term start', () => {
    expect(ics).toContain('DTSTART;TZID=America/New_York:20260902T133000'); // Wednesday
    expect(ics).toContain('DTEND;TZID=America/New_York:20260902T144500');
    expect(ics).toContain('DTSTART;TZID=America/New_York:20260904T090000'); // Friday
  });
  it('repeats weekly on the meeting days until the end of the last day', () => {
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261212T045959Z');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=FR;UNTIL=20261212T045959Z');
  });
  it('escapes text, skips sections without times, and is well formed', () => {
    expect(ics).toContain('SUMMARY:EN.580.243 Linear Signals\\, and Systems');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);
  });
});
