import { describe, expect, it } from 'vitest';
import type { IndexCourse, Section } from './types';
import type { SampleEntry, SamplePlan } from './samplePlans';
import { autoPlan, matchingCourses, rankFocusAreas, removeAutoPlan, semesters, slotEntry, slotMatch } from './autoplan';
import { defaultPlan, planWarnings, termCredits } from './plan';
import type { Plan, PlanItem } from './plan';
import { samplePlans, sampleFor } from './samplePlans';

const sample = samplePlans['jhu-bme-bs'];
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

  it('plans a generated major from its template’s sample; pre-med only adds the checklist', () => {
    const template = {
      id: 'jhu-history-bachelor-arts',
      school: 'jhu',
      name: 'History, Bachelor of Arts',
      source: 'https://e-catalogue.jhu.edu/history/',
      note: '',
      groups: [],
      sample: [
        [{ credits: 3, codes: ['AS.100.101'] }, { credits: 3, slot: 'free' as const, label: 'Free Elective' }],
        [{ credits: 3, slot: 'major' as const, label: 'AS.100.3xx History Elective' }],
      ],
    };
    const generated = sampleFor(template)!;
    const { plan, unplaced } = run({ sample: generated, premed: true, semesterCount: 2 });
    expect(unplaced).toEqual([]);
    expect(codes(plan, 'Fall 2026')).toEqual(['AS.100.101', 'Free Elective']);
    expect(codes(plan, 'Spring 2027')).toEqual(['AS.100.3xx History Elective']);
    expect(plan.templates).toEqual(['jhu-history-bachelor-arts', 'jhu-premed']);
    expect(plan.autoPlan?.templateId).toBe('jhu-history-bachelor-arts');
    // the hand-written BME sample wins over a generated one
    expect(sampleFor({ ...template, id: 'jhu-bme-bs' })).toBe(sample);
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

  it('treats courses that accept each other as one level: Linear Algebra does not put Calculus III behind you', () => {
    // the registrar's expressions: each takes Calculus II or one of the others
    const calc2 = 'AS.110.107[C]^OR^AS.110.109[C]^OR^AS.110.113[C]';
    const index = indexOf(
      course('AS.110.108'),
      course('AS.110.109', { prereqs: [{ text: '', expr: 'AS.110.106[C]^OR^AS.110.108[C]' }] }),
      course('AS.110.201', { prereqs: [{ text: '', expr: `${calc2}^OR^AS.110.202[C]^OR^AS.110.302[C]` }] }),
      course('AS.110.202', { prereqs: [{ text: '', expr: `${calc2}^OR^AS.110.201[C]^OR^AS.110.212[C]^OR^AS.110.302[C]` }] }),
      course('AS.110.302', { prereqs: [{ text: '', expr: `${calc2}^OR^AS.110.201[C]^OR^AS.110.202[C]^OR^AS.110.211[C]` }] }),
      // honors Calculus III needs linear algebra, and nothing lists it back directly
      course('AS.110.211', { prereqs: [{ text: '', expr: 'AS.110.201[C]^OR^AS.110.212[C]' }] })
    );
    const held = (code: string): Plan => ({
      ...defaultPlan(),
      terms: { 'Prior credit': [{ id: 'la', code, title: code, credits: 4, status: 'completed' }] },
    });
    // (honors Calculus III reaches Calculus II only through the same-level courses)
    for (const code of ['AS.110.201', 'AS.110.302', 'AS.110.211']) {
      const { plan, skipped } = run({ plan: held(code), index });
      // Calculus I and II are behind you; Calculus III is still to come
      expect(skipped.sort()).toEqual(['AS.110.108', 'AS.110.109']);
      expect(Object.values(plan.terms).flat().map((it) => it.code)).toContain('AS.110.202');
    }
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

describe('what is the student’s and what is the planner’s', () => {
  const template = {
    id: 'jhu-chembe',
    school: 'jhu',
    name: 'ChemBE',
    source: 'https://e-catalogue.jhu.edu/chembe/',
    note: '',
    groups: [],
    sample: [
      [
        { credits: 3, codes: ['AS.030.101'] },
        { credits: 3, slot: 'fa3' as const, label: 'Course with EN Foundational Ability tag FA3 (Creative Expression)' },
        { credits: 2, slot: 'major' as const, label: 'FYS or Design Cornerstone' },
      ],
      [{ credits: 3, slot: 'major' as const, label: 'EN.540.3xx/4xx ChemBE Elective' }, { credits: 3, slot: 'free' as const, label: 'Free Elective' }],
    ],
  };
  const generated = sampleFor(template)!;
  const index = indexOf(
    course('EN.501.124', { title: 'FYS: Design Cornerstone', credits: '2' }),
    course('AS.001.100', { title: 'FYS: What is the Common Good?' }),
    course('AS.220.105', { areas: 'Humanities (H)^Creative Expression (FA3)' }),
    course('EN.540.301'),
    course('EN.540.409'),
    course('EN.540.202')
  );
  const item = (id: string, extra: Partial<PlanItem>): PlanItem => ({ id, title: id, credits: 3, status: 'planned', ...extra });

  it('never plans past the graduation term: placeholders left there by an older version are pulled back', () => {
    // as an earlier version left them: no `auto`, no `fills`
    const start: Plan = {
      ...defaultPlan(),
      terms: {
        'Spring 2030': [
          item('f6', { title: 'Focus Area Course 6 (Translational Cell and Tissue Engineering)' }),
          item('fa', { title: 'Course tagged FA3 or FA4' }),
        ],
      },
    };
    const { plan, unplaced } = run({ plan: start, premed: true, semesterCount: 7, maxCredits: 21 });
    expect(unplaced).toEqual([]);
    // the design sequence moves up a year so its Spring half still fits
    expect(codes(plan, 'Fall 2028')).toContain('Design Sequence 1');
    expect(codes(plan, 'Spring 2029')).toContain('Design Sequence 2');
    expect(plan.terms['Spring 2030']).toEqual([]);
    expect(plan.numTerms).toBe(7);
    const all = Object.values(plan.terms).flat();
    expect(all.filter((it) => it.fills === 'Focus Area Course 6')).toHaveLength(1);
    expect(all.filter((it) => it.fills === 'Course tagged FA3 or FA4')).toHaveLength(2);
  });

  it('skips a slot the student’s own course already fills', () => {
    const start: Plan = {
      ...defaultPlan(),
      terms: { 'Fall 2026': [item('fys', { code: 'EN.501.124', credits: 2 }), item('art', { code: 'AS.220.105' })] },
    };
    const { plan } = run({ plan: start, sample: generated, index, semesterCount: 2 });
    const titles = Object.values(plan.terms).flat().map((it) => it.code ?? it.title);
    expect(titles.sort()).toEqual(['AS.030.101', 'AS.220.105', 'EN.501.124', 'EN.540.3xx/4xx ChemBE Elective', 'Free Elective']);
    expect(plan.terms['Fall 2026'].slice(0, 2)).toEqual(start.terms['Fall 2026']);
  });

  it('leaves a moved placeholder and a finished auto-planned course where they are', () => {
    const once = run({ sample: generated, index, semesterCount: 2 }).plan;
    const free = once.terms['Spring 2027'].find((it) => it.fills === 'Free Elective')!;
    // what the planner does on a drag (pinned) and on "Mark done" (completed)
    const moved: Plan = {
      ...once,
      terms: {
        'Fall 2026': [...once.terms['Fall 2026'].map((it) => ({ ...it, status: 'completed' as const })), { ...free, pinned: true }],
        'Spring 2027': once.terms['Spring 2027'].filter((it) => it !== free),
      },
    };
    const twice = run({ plan: moved, sample: generated, index, semesterCount: 2 }).plan;
    expect(twice.terms['Fall 2026']).toEqual(moved.terms['Fall 2026']);
    expect(codes(twice, 'Spring 2027')).toEqual(['EN.540.3xx/4xx ChemBE Elective']);
  });

  it('lists the courses that can fill a slot', () => {
    const list = (label: string, slot: 'major' | 'fa3' | 'free' = 'major') => {
      const m = slotMatch({ credits: 3, slot, label }, generated);
      return m && matchingCourses(m, index).map((c) => c.code);
    };
    expect(list('FYS or Design Cornerstone')).toEqual(['EN.501.124', 'AS.001.100']);
    expect(list('EN.540.3xx/4xx ChemBE Elective')).toEqual(['EN.540.301', 'EN.540.409']);
    expect(list('Course tagged FA3', 'fa3')).toEqual(['AS.220.105']);
    expect(list('Free Elective', 'free')).toBeNull();
    expect(list('Upper Level Biology Elective')).toBeNull();
    // the BME template's groups: a focus area's tag, the second half of a design sequence
    const bme = { ...template, id: 'jhu-bme-bs', groups: [{ id: 'design', name: '', courses: [{ oneOf: [['EN.580.311', 'EN.580.312']] }] }] };
    expect(slotMatch({ credits: 4, slot: 'design', label: 'Design Sequence 2' }, sample, bme)).toEqual({ codes: ['EN.580.312'] });
    expect(slotMatch({ credits: 3, slot: 'focus', label: 'Focus Area Course 1' }, sample, bme, 'Neuroengineering')).toEqual({ posTags: ['BME-NE'] });
    // placeholders from before `fills` are recognised by their title
    expect(slotEntry(item('x', { title: 'Focus Area Course 1 (Neuroengineering)' }), sample)?.slot).toBe('focus');
    expect(slotEntry(item('y', { title: 'My own elective' }), sample)).toBeUndefined();
  });
});

describe('semesters that can actually be scheduled', () => {
  const mini = (standard: SampleEntry[][]): SamplePlan => ({
    name: 'Mini',
    source: '',
    templateId: 'mini',
    premedTemplateId: 'jhu-premed',
    slotGroups: {},
    focusAreas: [],
    standard,
  });
  const at = (days: string[], start: number): Section => ({
    section: '01',
    instructors: [],
    meetings: [{ days, start: start * 60, end: start * 60 + 75 }],
    status: 'Open',
    seatsAvailable: '',
    openSeats: '',
    waitlisted: '',
    location: '',
    instructionMethod: '',
  });
  const where = (plan: Plan, code: string) =>
    Object.entries(plan.terms).flatMap(([t, items]) => items.filter((it) => it.code === code).map(() => t));
  const idx = indexOf(course('AS.100.101'), course('AS.100.102'), course('AS.100.103'));

  it('moves a course whose every section overlaps another of that semester', () => {
    const sample = mini([[{ credits: 3, codes: ['AS.100.101'] }, { credits: 3, codes: ['AS.100.102'] }], []]);
    // both only meet MW 9:00 in Fall 2026; Spring 2027's times aren't known
    const sections = (term: string, code: string) =>
      term === 'Fall 2026' && code !== 'AS.100.103' ? [at(['M', 'W'], 9)] : undefined;
    const { plan } = run({ sample, index: idx, semesterCount: 2, sections });
    expect(where(plan, 'AS.100.101')).toEqual(['Fall 2026']);
    expect(where(plan, 'AS.100.102')).toEqual(['Spring 2027']);
    // without section times the sample's order stands
    expect(where(run({ sample, index: idx, semesterCount: 2 }).plan, 'AS.100.102')).toEqual(['Fall 2026']);
  });

  it('never puts one course twice in a semester', () => {
    // a repeatable course the sample lists every semester, squeezed into one
    const sample = mini([[{ credits: 1, codes: ['AS.100.103'] }], [{ credits: 1, codes: ['AS.100.103'] }]]);
    const { plan, unplaced } = run({ sample, index: idx, semesterCount: 1 });
    expect(where(plan, 'AS.100.103')).toEqual(['Fall 2026']);
    expect(unplaced.map((e) => e.codes)).toEqual([['AS.100.103']]);
  });
});

describe('removeAutoPlan', () => {
  it('removes every card auto-plan placed that is still planned, and nothing of the student’s', () => {
    const once = run().plan;
    const [first, second, ...rest] = once.terms['Fall 2026'];
    const mine = (id: string, extra: Partial<PlanItem>): PlanItem => ({ id, title: id, credits: 3, status: 'planned', ...extra });
    const plan: Plan = {
      ...once,
      terms: {
        ...once.terms,
        'Fall 2026': [
          { ...first, status: 'completed' }, // taken: stays
          mine('own', { code: 'AS.010.101', title: 'Art' }), // added by the student
          mine('custom', { title: 'Research credit' }), // a custom entry
          ...rest,
        ],
        'Spring 2027': [
          ...once.terms['Spring 2027'],
          { ...second, pinned: true }, // auto-placed, then dragged here
          mine('old', { title: 'Focus Area Course 2 (Neuroengineering)' }), // placeholder from before `auto`
          mine('oldmoved', { title: 'Free Elective', fills: 'Free Elective' }), // dragged before `pinned`
        ],
      },
      assign: { ...once.assign, 'jhu-bme-bs': { ...once.assign['jhu-bme-bs'], own: 'fa3-fa4' } },
    };
    const left = removeAutoPlan(plan);
    expect(Object.values(left.terms).flat().map((it) => it.id)).toEqual([first.id, 'own', 'custom']);
    expect(left.autoPlan).toBeUndefined();
    // assignments of removed cards go too; the student's stay
    expect(left.assign['jhu-bme-bs']).toEqual({ own: 'fa3-fa4' });
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
