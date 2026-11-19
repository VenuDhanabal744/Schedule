import { describe, expect, it } from 'vitest';
import type { IndexCourse, ReqTemplate } from './types';
import { defaultPlan } from './plan';
import type { Plan, PlanItem } from './plan';
import { recommend } from './recommend';

const TERMS = ['Fall 2026', 'Spring 2027'];
const course = (code: string, extra: Partial<IndexCourse> = {}): IndexCourse => ({
  code,
  title: code,
  department: '',
  credits: '3',
  level: 'Lower Level Undergraduate',
  areas: '',
  writingIntensive: false,
  terms: TERMS,
  ...extra,
});
const item = (id: string, extra: Partial<PlanItem>): PlanItem => ({ id, title: id, credits: 3, status: 'planned', ...extra });

const index = new Map(
  [
    course('AS.110.101'),
    course('AS.110.102', { prereqs: [{ text: '', expr: 'AS.110.101[C]' }] }),
    course('AS.110.103', { prereqs: [{ text: '', expr: 'AS.110.102[C]' }] }),
    // advice only: no registrar prerequisite
    course('AS.110.104', { background: 'Grade of C- or Better in AS.110.106 or AS.110.101, or a 5 on the AP AB exam' }),
    course('AS.171.101'),
    course('AS.171.103', { fullIn: ['Fall 2026'] }), // every Fall section closed or waitlisted
    course('AS.171.102', { terms: ['Spring 2027'] }),
    course('AS.030.101', { prereqs: [{ text: 'not eligible', expr: 'AS.030.103[C]', negative: true }] }),
    course('AS.030.103'),
    course('AS.010.101', { areas: 'Creative Expression (FA3)' }),
    course('AS.010.102', { areas: 'Creative Expression (FA3)', credits: '4' }),
    course('AS.010.601', { areas: 'Creative Expression (FA3)', level: 'Graduate' }),
  ].map((c) => [c.code, c])
);
const template: ReqTemplate = {
  id: 'major',
  school: 'x',
  name: 'Major',
  source: '',
  note: '',
  groups: [
    { id: 'core', name: 'Core', courses: ['AS.110.101', 'AS.110.102', 'AS.110.103', 'AS.110.104', 'AS.171.101', 'AS.171.102', 'AS.171.103', { oneOf: ['AS.030.101', 'AS.030.103'] }] },
    { id: 'arts', name: 'Arts', match: { areas: ['FA3'] }, credits: 6 },
  ],
};
const run = (plan: Plan, term = 'Fall 2026', extra: Partial<Parameters<typeof recommend>[0]> = {}) =>
  recommend({ plan, term, index, imported: TERMS, templates: [template], slotMatch: () => undefined, ...extra });
const codes = (rs: { course: IndexCourse }[]) => rs.map((r) => r.course.code);

describe('recommend', () => {
  it('suggests what is still needed, can be taken that term, and fits the cap', () => {
    const plan: Plan = { ...defaultPlan(), maxCredits: 12, terms: { 'Prior credit': [item('old', { code: 'AS.030.101', status: 'completed' })] } };
    const { suggested, more, room } = run(plan);
    expect(room).toBe(12);
    const all = codes([...suggested, ...more]);
    // AS.110.102/3 wait for prerequisites, AS.110.104 for its recommended
    // background, AS.171.102 isn't offered in Fall, AS.171.103 has no open seat,
    // AS.030.101 is taken (so its one-of slot is filled), graduate courses are left out
    expect(all.sort()).toEqual(['AS.010.101', 'AS.010.102', 'AS.110.101', 'AS.171.101']);
    // AS.110.101 unlocks AS.110.102, so it ranks first among the required courses
    expect(suggested[0].course.code).toBe('AS.110.101');
    expect(suggested[0].reasons).toContain('Prerequisite for AS.110.102');
    expect(suggested.reduce((n, r) => n + r.credits, 0)).toBeLessThanOrEqual(12);
    // the 4-credit arts course moves the 6-credit Arts group further than the 3-credit one
    expect(codes(suggested)).toEqual(['AS.110.101', 'AS.171.101', 'AS.010.102']);
  });

  it('says exactly what each course and the set move, by the same matcher as the Requirements tab', () => {
    const plan: Plan = { ...defaultPlan(), maxCredits: 12, terms: { 'Prior credit': [item('old', { code: 'AS.030.101', status: 'completed' })] } };
    const { suggested, more, setGains, total } = run(plan, 'Fall 2026', { templates: [{ ...template, totalCredits: 120 }] });
    // Core already has AS.030.101's slot: 1 of 8
    expect(suggested[0].gains).toEqual([{ name: 'Core', unit: 'courses', need: 8, from: 1, to: 2 }]);
    expect(more.find((r) => r.course.code === 'AS.010.101')!.gains).toEqual([
      { name: 'Arts', unit: 'credits', need: 6, from: 0, to: 3 },
    ]);
    expect(setGains).toEqual([
      { name: 'Core', unit: 'courses', need: 8, from: 1, to: 3 },
      { name: 'Arts', unit: 'credits', need: 6, from: 0, to: 4 },
    ]);
    expect(total).toEqual({ from: 3, to: 13, need: 120 });
  });

  it('counts a course toward a shared group too (an FA that double-counts with the major)', () => {
    const fa: ReqTemplate = {
      ...template,
      groups: [
        { id: 'fa2', name: 'FA2', shared: true, courses: ['AS.110.101'] },
        { id: 'math', name: 'Math', courses: ['AS.110.101'] },
      ],
    };
    const { suggested } = run(defaultPlan(), 'Fall 2026', { templates: [fa] });
    expect(suggested[0].gains.map((g) => g.name)).toEqual(['FA2', 'Math']);
  });

  it('leaves out a course the matcher would count nowhere new', () => {
    // two options for one slot: once one is planned, the other moves nothing
    const one: ReqTemplate = { ...template, groups: [{ id: 'g', name: 'G', courses: [{ oneOf: ['AS.110.101', 'AS.171.101'] }] }] };
    const plan: Plan = { ...defaultPlan(), terms: { 'Fall 2026': [item('a', { code: 'AS.110.101' })] } };
    expect(run(plan, 'Fall 2026', { templates: [one] }).more).toEqual([]);
  });

  it('takes earlier terms into account and skips what is already planned or barred', () => {
    const plan: Plan = {
      ...defaultPlan(),
      terms: { 'Fall 2026': [item('m1', { code: 'AS.110.101' }), item('new', { code: 'AS.030.103' })], 'Spring 2027': [] },
    };
    const all = codes([...run(plan, 'Spring 2027').suggested, ...run(plan, 'Spring 2027').more]);
    expect(all).toContain('AS.110.102');
    expect(all).toContain('AS.110.104'); // background met by AS.110.101
    expect(all).toContain('AS.171.102');
    expect(all).toContain('AS.171.103'); // full only in Fall
    expect(all).not.toContain('AS.110.101');
    expect(all).not.toContain('AS.030.101'); // barred after AS.030.103
    expect(all).not.toContain('AS.110.103');
  });

  it('fills a placeholder in the term and takes its credits into account', () => {
    const fa3 = item('fa3', { title: 'Course tagged FA3', credits: 3 });
    const plan: Plan = { ...defaultPlan(), maxCredits: 3, terms: { 'Fall 2026': [fa3] } };
    const { suggested, room } = run(plan, 'Fall 2026', {
      templates: [],
      slotMatch: (it) => (it.id === 'fa3' ? { areas: ['FA3'] } : undefined),
    });
    expect(room).toBe(0);
    // AS.010.102 is 4 credits: replacing the 3-credit placeholder would go over the cap
    expect(codes(suggested)).toEqual(['AS.010.101']);
    expect(suggested[0].replaces).toBe(fa3);
    expect(suggested[0].reasons).toEqual(['Takes the place of “Course tagged FA3”']);
  });

  it('a course that fills a required slot is added, not swapped for a placeholder', () => {
    const fa3 = item('fa3', { title: 'Course tagged FA3' });
    const plan: Plan = { ...defaultPlan(), terms: { 'Fall 2026': [fa3] } };
    const required: ReqTemplate = { ...template, groups: [{ id: 'core', name: 'Core', courses: ['AS.010.101'] }] };
    const { suggested } = run(plan, 'Fall 2026', {
      templates: [required],
      slotMatch: (it) => (it.id === 'fa3' ? { areas: ['FA3'] } : undefined),
    });
    expect(suggested.map((r) => [r.course.code, r.replaces?.id])).toEqual([
      ['AS.010.101', undefined],
      ['AS.010.102', 'fa3'],
    ]);
  });

  it('suggests nothing when there is nothing to fill', () => {
    expect(run(defaultPlan(), 'Fall 2026', { templates: [] })).toEqual({
      suggested: [],
      more: [],
      room: 18,
      setGains: [],
      total: { from: 0, to: 0, need: undefined },
    });
  });
});
