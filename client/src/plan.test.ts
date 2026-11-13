import { describe, expect, it } from 'vitest';
import type { IndexCourse } from './types';
import { PRIOR, catalogTerm, defaultPlan, offeringPattern, parsePlanFile, planWarnings, termSequence } from './plan';
import type { Plan, PlanItem } from './plan';

const TERMS = ['Fall 2026', 'Spring 2027'];
const course = (code: string, terms: string[], extra: Partial<IndexCourse> = {}): IndexCourse => ({
  code,
  title: code,
  department: '',
  credits: '3',
  level: '',
  areas: '',
  writingIntensive: false,
  terms,
  ...extra,
});
const index = new Map(
  [
    course('AS.110.108', TERMS),
    course('AS.110.109', TERMS, { prereqs: [{ text: '', expr: 'AS.110.108[C]' }] }),
    course('AS.030.225', TERMS, { prereqs: [{ text: 'may be taken concurrently', expr: 'AS.030.205[C]' }] }),
    course('AS.030.205', ['Fall 2026']),
    course('EN.580.510', TERMS, { repeatable: true }),
  ].map((c) => [c.code, c])
);
const it_ = (code: string, extra: Partial<PlanItem> = {}): PlanItem => ({
  id: `${code}-${Math.random()}`,
  code,
  title: code,
  credits: 3,
  status: 'planned',
  ...extra,
});
const plan = (terms: Plan['terms']): Plan => ({ ...defaultPlan(), terms });
const kinds = (p: Plan, id: string) => (planWarnings(p, index, TERMS).get(id) ?? []).map((w) => w.kind);

describe('termSequence', () => {
  it('lays out prior credit plus eight Fall/Spring terms by default', () => {
    const seq = termSequence(defaultPlan());
    expect(seq).toHaveLength(9);
    expect(seq.slice(0, 3)).toEqual([PRIOR, 'Fall 2026', 'Spring 2027']);
    expect(seq.at(-1)).toBe('Spring 2030');
  });
  it('adds optional terms in calendar order', () => {
    const seq = termSequence({ ...defaultPlan(), numTerms: 2, showSummer: true, showIntersession: true });
    expect(seq).toEqual([PRIOR, 'Fall 2026', 'Intersession 2027', 'Spring 2027', 'Summer 2027']);
  });
  it('never hides a term that still has courses', () => {
    const p = plan({ 'Summer 2027': [it_('AS.110.108')] });
    expect(termSequence(p)).toContain('Summer 2027');
  });
  it('can start in Spring', () => {
    expect(termSequence({ ...defaultPlan(), firstSeason: 'Spring', firstYear: 2027, numTerms: 3 })).toEqual([
      PRIOR,
      'Spring 2027',
      'Fall 2027',
      'Spring 2028',
    ]);
  });
});

describe('planWarnings', () => {
  it('flags a prerequisite that is not in an earlier term', () => {
    const calc2 = it_('AS.110.109');
    expect(kinds(plan({ 'Fall 2026': [calc2] }), calc2.id)).toEqual(['prereq']);
    expect(kinds(plan({ 'Fall 2026': [it_('AS.110.108'), calc2] }), calc2.id)).toEqual(['prereq']); // same term is too late
    expect(kinds(plan({ 'Fall 2026': [it_('AS.110.108')], 'Spring 2027': [calc2] }), calc2.id)).toEqual([]);
  });
  it('accepts prior credit that counts as the prerequisite', () => {
    const calc2 = it_('AS.110.109');
    const ap: PlanItem = { id: 'ap', title: 'AP Calc', credits: 4, status: 'completed', countsAs: ['AS.110.108'] };
    expect(kinds(plan({ [PRIOR]: [ap], 'Fall 2026': [calc2] }), calc2.id)).toEqual([]);
  });
  it('allows concurrent prerequisites in the same term', () => {
    const lab = it_('AS.030.225');
    expect(kinds(plan({ 'Fall 2026': [it_('AS.030.205'), lab] }), lab.id)).toEqual([]);
    expect(kinds(plan({ 'Fall 2026': [lab] }), lab.id)).toEqual(['prereq']);
  });
  it('hints when a course is placed in a season it has not been seen in', () => {
    const orgo = it_('AS.030.205');
    expect(kinds(plan({ 'Spring 2028': [orgo] }), orgo.id)).toEqual(['offering']);
    expect(kinds(plan({ 'Fall 2028': [orgo] }), orgo.id)).toEqual([]);
    expect(kinds(plan({ 'Summer 2028': [orgo] }), orgo.id)).toEqual([]); // no summer data either way
  });
  it('warns about duplicates unless the course is repeatable', () => {
    const again = it_('AS.110.108');
    expect(kinds(plan({ 'Fall 2026': [it_('AS.110.108')], 'Spring 2027': [again] }), again.id)).toEqual(['duplicate']);
    const research = it_('EN.580.510');
    expect(kinds(plan({ 'Fall 2026': [it_('EN.580.510')], 'Spring 2027': [research] }), research.id)).toEqual([]);
    const marked = it_('AS.110.108', { repeatable: true });
    expect(kinds(plan({ 'Fall 2026': [it_('AS.110.108')], 'Spring 2027': [marked] }), marked.id)).toEqual([]);
  });
});

describe('helpers', () => {
  it('offeringPattern needs both seasons imported', () => {
    expect(offeringPattern(['Fall 2026'], TERMS)).toBe('Fall');
    expect(offeringPattern(TERMS, TERMS)).toBe('both');
    expect(offeringPattern(['Fall 2026'], ['Fall 2026'])).toBeNull();
  });
  it('catalogTerm maps planner summers onto session terms', () => {
    expect(catalogTerm('Fall 2026', TERMS)).toBe('Fall 2026');
    expect(catalogTerm('Fall 2027', TERMS)).toBeNull();
    expect(catalogTerm('Summer 2027', ['Summer I 2027', 'Summer II 2027'])).toBe('Summer I 2027');
  });
  it('parsePlanFile rejects other JSON', () => {
    expect(() => parsePlanFile('{"courses":[]}')).toThrow(/plan file/);
    expect(parsePlanFile(JSON.stringify(defaultPlan())).numTerms).toBe(8);
  });
});
