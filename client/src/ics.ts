import type { Course, Section } from './types';

// iCalendar weekday code and JS weekday number for the app's day tokens.
const DAY: Record<string, [string, number]> = {
  Su: ['SU', 0],
  M: ['MO', 1],
  T: ['TU', 2],
  W: ['WE', 3],
  Th: ['TH', 4],
  F: ['FR', 5],
  Sa: ['SA', 6],
};

// JHU, Temple and UNC are all on US Eastern time.
const TZID = 'America/New_York';
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TZID}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const hms = (mins: number) => `${pad(Math.floor(mins / 60))}${pad(mins % 60)}00`;
const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
// RFC 5545: lines longer than 75 octets are folded with CRLF + space
const fold = (line: string) => line.replace(/(.{73})(?=.)/g, '$1\r\n ');

export type IcsEntry = { course: Course; section: Section };

// A weekly recurring event per meeting, from the first matching weekday on or
// after `start` through `end` (both "YYYY-MM-DD", inclusive). Holidays and
// breaks are not skipped. Sections without meeting times produce nothing.
export function buildIcs(entries: IcsEntry[], start: string, end: string, now = new Date()): string {
  const first = new Date(`${start}T00:00:00Z`);
  const until = new Date(`${end}T00:00:00Z`);
  // UNTIL must be UTC: 04:59:59Z the next day is the end of `end` in Eastern time
  until.setUTCDate(until.getUTCDate() + 1);
  const stamp = `${ymd(now)}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Schedule//Course Planner//EN', 'CALSCALE:GREGORIAN', ...VTIMEZONE];
  for (const { course, section } of entries) {
    section.meetings.forEach((m, mi) => {
      const days = m.days.filter((d) => DAY[d]);
      if (!days.length) return;
      const day = new Date(first);
      while (!days.some((d) => DAY[d][1] === day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
      if (day > new Date(`${end}T00:00:00Z`)) return;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${course.code}-${section.section}-${mi}-${start}@schedule`.replace(/\s/g, ''),
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=${TZID}:${ymd(day)}T${hms(m.start)}`,
        `DTEND;TZID=${TZID}:${ymd(day)}T${hms(m.end)}`,
        `RRULE:FREQ=WEEKLY;BYDAY=${days.map((d) => DAY[d][0]).join(',')};UNTIL=${ymd(until)}T045959Z`,
        `SUMMARY:${esc(`${course.code} ${course.title}`)}`,
        `DESCRIPTION:${esc(`Section ${section.section}\n${section.instructors.join('; ') || 'Instructor TBA'}`)}`,
        ...(section.location ? [`LOCATION:${esc(section.location)}`] : []),
        'END:VEVENT'
      );
    });
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
