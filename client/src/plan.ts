import type { IndexCourse } from './types';
import { parseRawReqs, unmet, fmtReq } from './prereqs';
import { areaTags } from './requirements';
import type { ReqItem } from './requirements';

export type PlanStatus = 'planned' | 'in-progress' | 'completed';

export type PlanItem = {
  id: string;
  code?: string; // catalog course; absent for a custom/placeholder entry
  title: string;
  credits: number;
  status: PlanStatus;
  // custom entries only:
  tags?: string[]; // area tags, e.g. ["H", "FA3"]
  writingIntensive?: boolean;
  countsAs?: string[]; // course codes this stands in for (AP/transfer credit)
  repeatable?: boolean;
};

export type Plan = {
  version: 1;
  firstSeason: 'Fall' | 'Spring';
  firstYear: number;
  numTerms: number; // Fall/Spring terms
  showSummer: boolean;
  showIntersession: boolean;
  minCredits: number;
  maxCredits: number;
  terms: Record<string, PlanItem[]>; // by term name; PRIOR for prior credit
  templates: string[]; // active requirement template ids
  assign: Record<string, Record<string, string>>; // template id -> item id -> group id
  hidden: Record<string, string[]>; // template id -> group ids marked "doesn't apply"
};

export const PRIOR = 'Prior credit';

export const defaultPlan = (): Plan => ({
  version: 1,
  firstSeason: 'Fall',
  firstYear: 2026,
  numTerms: 8,
  showSummer: false,
  showIntersession: false,
  minCredits: 12,
  maxCredits: 18,
  terms: {},
  templates: [],
  assign: {},
  hidden: {},
});

const planKey = (school: string) => `plan:v1:${school}`;

export function loadPlan(school: string): Plan {
  try {
    const saved = JSON.parse(localStorage.getItem(planKey(school)) ?? 'null');
    if (saved?.version === 1) return { ...defaultPlan(), ...saved };
  } catch {
    /* corrupt entry: start fresh */
  }
  return defaultPlan();
}

export const savePlan = (school: string, plan: Plan) =>
  localStorage.setItem(planKey(school), JSON.stringify(plan));

// Accepts an exported plan file; throws with a readable message otherwise.
export function parsePlanFile(text: string): Plan {
  const data = JSON.parse(text);
  if (data?.version !== 1 || typeof data.terms !== 'object') {
    throw new Error('Not a Schedule plan file (expected "version": 1)');
  }
  return { ...defaultPlan(), ...data };
}

export const newId = () => Math.random().toString(36).slice(2, 10);

const SEASONS = ['Intersession', 'Spring', 'Summer', 'Fall'] as const;
export type Season = (typeof SEASONS)[number];

export function termSeason(name: string): Season | null {
  return SEASONS.find((s) => name.startsWith(s)) ?? null;
}

// Chronological sort key; prior credit sorts before everything.
export function termOrder(name: string): number {
  const season = termSeason(name);
  const year = name.match(/(\d{4})$/);
  return season && year ? +year[1] * 10 + SEASONS.indexOf(season) : -1;
}

// Every column the planner shows, in order: prior credit, the configured
// Fall/Spring run (plus optional Intersession/Summer), and any other term that
// still holds courses, so hiding Summer never hides a planned course.
export function termSequence(plan: Plan): string[] {
  const names = new Set<string>([PRIOR]);
  let season = plan.firstSeason;
  let year = plan.firstYear;
  for (let i = 0; i < plan.numTerms; i++) {
    names.add(`${season} ${year}`);
    if (season === 'Fall') {
      if (plan.showIntersession) names.add(`Intersession ${year + 1}`);
      season = 'Spring';
      year++;
    } else {
      if (plan.showSummer) names.add(`Summer ${year}`);
      season = 'Fall';
    }
  }
  for (const [name, items] of Object.entries(plan.terms)) if (items.length) names.add(name);
  return [...names].sort((a, b) => termOrder(a) - termOrder(b));
}

// The imported catalog term a planner column corresponds to, if any. Registrars
// split summer into sessions ("Summer I 2027"), the planner doesn't.
export function catalogTerm(name: string, imported: string[]): string | null {
  if (imported.includes(name)) return name;
  const year = name.slice(-4);
  return termSeason(name) === 'Summer'
    ? imported.find((t) => t.startsWith('Summer') && t.endsWith(year)) ?? null
    : null;
}

export const termCredits = (items: PlanItem[] = []) => items.reduce((n, it) => n + it.credits, 0);

// "Seen in Fall only" etc., from the imported terms a course appears in. Null
// unless both a Fall and a Spring catalog are imported: one season proves nothing.
export function offeringPattern(courseTerms: string[], imported: string[]): 'Fall' | 'Spring' | 'both' | null {
  const seasons = (ts: string[]) => new Set(ts.map(termSeason));
  const have = seasons(imported);
  if (!have.has('Fall') || !have.has('Spring')) return null;
  const seen = seasons(courseTerms);
  if (seen.has('Fall') && seen.has('Spring')) return 'both';
  return seen.has('Fall') ? 'Fall' : seen.has('Spring') ? 'Spring' : null;
}

export const offeringLabel = (p: ReturnType<typeof offeringPattern>) =>
  p === 'both' ? 'Seen in Fall and Spring' : p ? `Seen in ${p} only` : null;

export type Warning = { kind: 'prereq' | 'offering' | 'duplicate'; text: string };

const itemCodes = (it: PlanItem) => [...(it.code ? [it.code] : []), ...(it.countsAs ?? [])];

// Soft checks for every planned course, keyed by item id. Nothing here blocks.
export function planWarnings(
  plan: Plan,
  index: Map<string, IndexCourse>,
  imported: string[]
): Map<string, Warning[]> {
  const out = new Map<string, Warning[]>();
  const warn = (id: string, w: Warning) => out.set(id, [...(out.get(id) ?? []), w]);
  const earlier = new Set<string>(); // codes placed in earlier terms
  const seenAt = new Map<string, string>(); // code -> first term it was placed in

  for (const term of termSequence(plan)) {
    const items = plan.terms[term] ?? [];
    const sameTerm = new Set(items.flatMap(itemCodes));
    for (const it of items) {
      const course = it.code ? index.get(it.code) : undefined;
      if (!it.code) continue;

      const first = seenAt.get(it.code);
      if (first && !(it.repeatable || course?.repeatable)) {
        warn(it.id, { kind: 'duplicate', text: `Also planned in ${first}` });
      }
      if (!first) seenAt.set(it.code, term);

      if (term === PRIOR || !course) continue;

      for (const req of parseRawReqs(course.prereqs)) {
        const have = req.concurrent ? new Set([...earlier, ...sameTerm]) : earlier;
        const missing = unmet(req.tree, have, (c) => index.has(c));
        if (missing) {
          warn(it.id, {
            kind: 'prereq',
            text: `Prerequisite not in an earlier term: ${fmtReq(missing)}`,
          });
        }
      }

      const pattern = offeringPattern(course.terms, imported);
      const season = termSeason(term);
      if ((pattern === 'Fall' || pattern === 'Spring') && (season === 'Fall' || season === 'Spring') && season !== pattern) {
        const n = imported.length;
        warn(it.id, {
          kind: 'offering',
          text: `Only seen in ${pattern} so far (${n} imported term${n === 1 ? '' : 's'}) — may not run in ${season}`,
        });
      }
    }
    for (const c of sameTerm) earlier.add(c);
  }
  return out;
}

// Planned courses in the shape the requirement matcher wants.
export function reqItems(plan: Plan, index: Map<string, IndexCourse>): ReqItem[] {
  return termSequence(plan).flatMap((term) =>
    (plan.terms[term] ?? []).map((it) => {
      const course = it.code ? index.get(it.code) : undefined;
      return {
        id: it.id,
        codes: itemCodes(it),
        credits: it.credits,
        tags: [...(it.tags ?? []), ...areaTags(course?.areas ?? '')],
        posTags: course?.posTags ?? [],
        writingIntensive: !!(it.writingIntensive || course?.writingIntensive),
        completed: it.status === 'completed',
      };
    })
  );
}
