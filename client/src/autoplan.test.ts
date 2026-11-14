import { describe, expect, it } from 'vitest';
import type { IndexCourse } from './types';
import { autoPlan, rankFocusAreas, semesters } from './autoplan';
import { defaultPlan, planWarnings, termCredits } from './plan';
import type { Plan, PlanItem } from './plan';
import { samplePlans } from './samplePlans';

const sample = samplePlans.jhu;
const TERMS = ['Fall 2026', 'Spring 2027'];
const course = (code: string, extra: Partial<IndexCourse> = {}): IndexCourse => ({
  code,
  title: code,
  department: '',
  credits: '3',
  level: '',
  areas: '',
  writingIntensive: false,
  terms: TERMS,
  ...extra,
});
const indexOf = (...courses: IndexCourse[]) => new Map(courses.map((c) => [c.code, c]));
const run = (extra: Partial<Parameters<typeof autoPlan>[0]> = {}) =>
  autoPlan({
    plan: defaultPlan(),
    sample,
    premed: false,
    semesterCount: 8,
    maxCredits: 18,
    index: new Map(),
    imported: TERMS,
    ...extra,
  });
const credits = (plan: Plan, n = 8) => semesters(plan, n).map((t) => termCredits(plan.terms[t]));
const codes = (plan: Plan, term: string) => (plan.terms[term] ?? []).map((it) => it.code ?? it.title);

describe('semesters', () => {
  it('alternates Fall and Spring from the first term', () => {
    expect(semesters({ firstSeason: 'Fall', firstYear: 2026 }, 3)).toEqual(['Fall 2026', 'Spring 2027', 'Fall 2027']);
    expect(semesters({ firstSeason: 'Spring', firstYear: 2027 }, 2)).toEqual(['Spring 2027', 'Fall 2027']);
  });
});

describe('autoPlan', () => {
  it('reproduces the catalog sample when it fits', () => {
    const { plan, unplaced } = run();
    expect(unplaced).toEqual([]);
    expect(credits(plan)).toEqual([17, 18, 15, 15, 17, 16, 16, 15]);
    expect(codes(plan, 'Fall 2026')).toEqual(sample.standard[0].map((e) => e.codes![0]));
    expect(plan.templates).toEqual(['jhu-bme-bs']);
  });

  it('uses the pre-med sample and checklist when asked', () => {
    const { plan } = run({ premed: true });
    expect(credits(plan).reduce((a, b) => a + b)).toBe(130);
    expect(codes(plan, 'Fall 2027')).toContain('AS.030.205');
    expect(plan.templates).toEqual(['jhu-bme-bs', 'jhu-premed']);
  });

  it('never exceeds the credit cap and reports what does not fit', () => {
    const tight = run({ maxCredits: 15 });
    expect(Math.max(...credits(tight.plan))).toBeLessThanOrEqual(15);
    expect(tight.unplaced.length).toBeGreaterThan(0);
    const longer = run({ maxCredits: 15, semesterCount: 10 });
    expect(Math.max(...credits(longer.plan, 10))).toBeLessThanOrEqual(15);
    expect(longer.unplaced).toEqual([]);
    expect(longer.plan.numTerms).toBe(10);
  });

  it('squeezes into fewer semesters when graduating early', () => {
    const { plan, unplaced } = run({ semesterCount: 6, maxCredits: 22 });
    expect(unplaced).toEqual([]);
    expect(credits(plan, 6).reduce((a, b) => a + b)).toBe(129);
  });

  it('keeps the student’s courses, skips what they cover and replaces an earlier run', () => {
    const mine: PlanItem = { id: 'mine', code: 'AS.030.101', title: 'Chem', credits: 3, status: 'in-progress' };
    const ap: PlanItem = { id: 'ap', title: 'AP Calculus', credits: 8, status: 'completed', countsAs: ['AS.110.108', 'AS.110.109'] };
    const start: Plan = { ...defaultPlan(), terms: { 'Prior credit': [ap], 'Fall 2026': [mine] } };
    const once = run({ plan: start }).plan;
    const twice = run({ plan: once }).plan;
    for (const plan of [once, twice]) {
      // Fall 2026 is underway, so nothing is added to it
      expect(plan.terms['Fall 2026']).toEqual([mine]);
      const all = Object.values(plan.terms).flat();
      expect(all.filter((it) => it.code === 'AS.030.101')).toHaveLength(1);
      expect(all.some((it) => it.code === 'AS.110.108' || it.code === 'AS.110.109')).toBe(false);
      expect(all.filter((it) => it.title === 'Focus Area Course 1')).toHaveLength(1);
    }
    expect(Object.keys(twice.assign['jhu-bme-bs'])).toHaveLength(Object.keys(once.assign['jhu-bme-bs']).length);
  });

  it('leaves out courses the student is already past', () => {
    const index = indexOf(
      course('AS.030.101'),
      course('AS.030.102', {
        prereqs: [{ text: 'Antirequisite', expr: 'AS.030.103[C]', negative: true }, { text: '', expr: 'AS.030.101[C]' }],
      }),
      course('AS.030.105', { prereqs: [{ text: 'Antirequisite', expr: 'AS.030.103[C]', negative: true }] }),
      course('AS.030.106', { prereqs: [{ text: 'Antirequisite', expr: 'AS.030.103[C]', negative: true }] }),
      course('AS.030.205', { prereqs: [{ text: '', expr: 'AS.030.102[C]^OR^AS.030.103[C]' }] }),
      course('AS.030.103')
    );
    const item = (id: string, code: string): PlanItem => ({ id, code, title: code, credits: 4, status: 'planned' });
    const start: Plan = {
      ...defaultPlan(),
      terms: { 'Prior credit': [item('ap', 'AS.030.103')], 'Fall 2026': [item('orgo', 'AS.030.205')] },
    };
    const { plan, skipped } = run({ plan: start, index, premed: true });
    // 105/106/102 are barred after 103; 101 only leads to courses already taken
    expect(skipped.sort()).toEqual(['AS.030.101', 'AS.030.102', 'AS.030.105', 'AS.030.106']);
    const all = Object.values(plan.terms).flat().map((it) => it.code);
    expect(all).not.toContain('AS.030.101');
    expect(all).toContain('AS.030.206');
    // a course planned for later does not make its prerequisites "past"
    const later: Plan = { ...defaultPlan(), terms: { 'Fall 2029': [item('orgo', 'AS.030.205')] } };
    expect(run({ plan: later, index }).skipped).toEqual([]);
  });

  it('moves later courses up when prior credit empties the early terms', () => {
    const prior: PlanItem[] = [...sample.standard[0], ...sample.standard[1]].map((e, i) => ({
      id: `p${i}`,
      code: e.codes![0],
      title: 'AP',
      credits: e.credits,
      status: 'completed',
    }));
    const { plan, unplaced } = run({ plan: { ...defaultPlan(), terms: { 'Prior credit': prior } }, semesterCount: 7 });
    expect(unplaced).toEqual([]);
    // every term but the last is a full load, and none is far above the even share (13.4)
    expect(Math.min(...credits(plan, 7).slice(0, -1))).toBeGreaterThanOrEqual(12);
    expect(Math.max(...credits(plan, 7))).toBeLessThanOrEqual(15);
  });

  it('waits for prerequisites and for the season a course runs in', () => {
    const index = indexOf(
      course('AS.030.101', { terms: ['Spring 2027'] }), // spring only
      course('AS.030.105', { prereqs: [{ text: 'may be taken concurrently', expr: 'AS.030.101[C]' }] }),
      course('AS.030.102', { prereqs: [{ text: '', expr: 'AS.030.101[C]' }] })
    );
    const { plan } = run({ index });
    expect(codes(plan, 'Fall 2026')).not.toContain('AS.030.101');
    expect(codes(plan, 'Spring 2027')).toEqual(expect.arrayContaining(['AS.030.101', 'AS.030.105']));
    expect(codes(plan, 'Fall 2027')).toContain('AS.030.102');
  });

  it('keeps corequisites together and accepts a course that stands in for a prerequisite', () => {
    const index = indexOf(
      // lecture and lab name each other; the lab only runs in Spring
      course('EN.580.231', { coreqs: [{ text: 'EN.580.233', expr: 'EN.580.233[C]' }] }),
      course('EN.580.233', { terms: ['Spring 2027'], coreqs: [{ text: 'EN.580.231', expr: 'EN.580.231[C]' }] }),
      // EN.553.291 is barred after AS.110.201, so it stands in for it
      course('AS.110.201', { prereqs: [{ text: 'not eligible', expr: 'EN.553.291[C]', negative: true }] }),
      course('EN.553.291'),
      course('EN.580.242', { prereqs: [{ text: '', expr: 'AS.110.201[C]' }] })
    );
    const { plan } = run({ index });
    const termOf = (code: string) => Object.keys(plan.terms).find((t) => codes(plan, t).includes(code));
    expect(termOf('EN.580.231')).toBe(termOf('EN.580.233'));
    expect(termOf('EN.580.233')).toMatch(/^Spring/);
    // 242 stays where the catalog has it: 291 the term before satisfies it
    expect(termOf('EN.580.242')).toBe('Spring 2028');
    expect([...planWarnings(plan, index, TERMS).values()].flat().filter((w) => w.kind === 'prereq')).toEqual([]);
  });

  it('names focus slots and counts slots toward their requirement group', () => {
    const { plan } = run({ focusName: 'Immunoengineering' });
    const all = Object.values(plan.terms).flat();
    const focus = all.filter((it) => it.title.endsWith('(Immunoengineering)'));
    expect(focus).toHaveLength(6);
    expect(plan.assign['jhu-bme-bs'][focus[0].id]).toBe('focus-area');
    expect(all.find((it) => it.title === 'Course tagged FA3')?.tags).toEqual(['FA3']);
  });
});

describe('rankFocusAreas', () => {
  it('orders focus areas by their share of Natural Sciences courses', () => {
    const index = indexOf(
      course('A', { posTags: ['BME-IMD'], areas: 'Engineering (E)' }),
      course('B', { posTags: ['BME-IMD', 'BME-IMMU'], areas: 'Engineering (E)^Natural Sciences (N)' }),
      course('C', { posTags: ['BME-IMMU'], areas: 'Natural Sciences (N)' })
    );
    const ranked = rankFocusAreas(sample.focusAreas, index);
    expect(ranked[0]).toMatchObject({ tag: 'BME-IMMU', total: 2, science: 2 });
    expect(ranked[1]).toMatchObject({ tag: 'BME-IMD', total: 2, science: 1 });
  });
});
