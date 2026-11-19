import type { IndexCourse, ReqMatch, ReqTemplate } from './types';
import { catalogTerm, itemCodes, offeringPattern, reqItems, termCredits, termOrder, termSeason, termSequence } from './plan';
import type { Plan, PlanItem } from './plan';
import { courseReqs, credited, parsePrereqText, reqCodes, unmet } from './prereqs';
import { matchRequirements, slotOptions } from './requirements';
import type { GroupProgress } from './requirements';
import { matchingCourses } from './autoplan';

// Something the student still needs: a required course, a requirement group,
// or a placeholder card in the term being planned.
type Need = {
  required: boolean; // a slot of a checklist group
  codes: Set<string>;
  replaces?: PlanItem; // the placeholder a course for this need takes the place of
};

// What a course (or a set of them) moves: one requirement group's progress.
export type Gain = { name: string; unit: 'courses' | 'credits'; need: number; from: number; to: number };

export type Recommendation = {
  course: IndexCourse;
  credits: number;
  gains: Gain[];
  reasons: string[]; // the placeholder it replaces, the required courses it unlocks
  score: number;
  replaces?: PlanItem;
};

const UNDERGRAD = /undergraduate/i;

// Courses worth taking in `term`: ones that fill something the student still
// needs, that they can take then (prerequisites done, offered that season, not
// already planned or ruled out), ranked by how much they fill and unlock.
// `suggested` is a set that fits under the credit cap without double-filling a need.
export function recommend(o: {
  plan: Plan;
  term: string;
  index: Map<string, IndexCourse>;
  imported: string[];
  templates: ReqTemplate[]; // the student's majors, hidden groups removed
  slotMatch: (it: PlanItem) => ReqMatch | null | undefined; // what fills a placeholder
  rating?: (c: IndexCourse) => number | null;
}): {
  suggested: Recommendation[];
  more: Recommendation[];
  room: number;
  setGains: Gain[]; // what the suggested set moves, together
  total: { from: number; to: number; need?: number }; // degree credits, before and with the set
} {
  const { plan, term, index, imported } = o;
  const order = termOrder(term);
  const terms = termSequence(plan);
  const codesIn = (ts: string[]) => ts.flatMap((t) => (plan.terms[t] ?? []).flatMap(itemCodes));
  const past = credited(codesIn(terms.filter((t) => termOrder(t) < order)), index);
  const now = new Set([...past, ...codesIn([term])]);
  // in the plan anywhere, or barred after something in it
  const ruledOut = credited(codesIn(terms), index);

  // ---- what the student still needs ----
  // requirement progress of a plan, by template and group
  const progressOf = (p: Plan) => {
    const items = reqItems(p, index);
    return new Map<string, GroupProgress>(
      o.templates.flatMap((t) =>
        matchRequirements(t, items, p.assign[t.id])
          .filter((g) => !g.group.todo)
          .map((g) => [`${t.id} ${g.group.id}`, g] as const)
      )
    );
  };
  const base = progressOf(plan);

  const needs: Need[] = [];
  const undergrad = (m: ReqMatch) => matchingCourses(m, index).filter((c) => UNDERGRAD.test(c.level)).map((c) => c.code);
  for (const p of base.values()) {
    if (p.have >= p.need) continue;
    p.slots?.forEach((s, i) => {
      if (!s.itemIds) needs.push({ required: true, codes: new Set(slotOptions(p.group.courses![i]).flat()) });
    });
    if (!p.slots && p.group.match) needs.push({ required: false, codes: new Set(undergrad(p.group.match)) });
  }
  for (const it of plan.terms[term] ?? []) {
    const m = it.status === 'planned' ? o.slotMatch(it) : undefined;
    if (m) needs.push({ required: false, codes: new Set(undergrad(m)), replaces: it });
  }

  // the plan with these courses taken in `term`; one for a placeholder takes its place (and id)
  const withCourses = (rs: Recommendation[]): Plan => {
    let items = [...(plan.terms[term] ?? [])];
    for (const r of rs) {
      const it: PlanItem = {
        id: r.replaces?.id ?? `rec-${r.course.code}`,
        code: r.course.code,
        title: r.course.title,
        credits: r.credits,
        status: 'planned',
      };
      items = r.replaces ? items.map((x) => (x.id === it.id ? it : x)) : [...items, it];
    }
    return { ...plan, terms: { ...plan.terms, [term]: items } };
  };
  // groups whose progress toward their goal moves between two plans
  const gainsBetween = (from: Map<string, GroupProgress>, to: Map<string, GroupProgress>) =>
    [...to].flatMap(([key, g]) => {
      const was = from.get(key)!.have;
      return Math.min(g.have, g.need) > Math.min(was, g.need)
        ? [{ name: g.group.name, unit: g.unit, need: g.need, from: was, to: g.have, required: !!g.slots }]
        : [];
    });
  // a required course counts most, a placeholder filled next, a broad group least (per 3 credits)
  const worth = (gains: ReturnType<typeof gainsBetween>, rs: Recommendation[]) =>
    gains.reduce(
      (s, g) => s + (g.required ? 3 : 1) * ((Math.min(g.to, g.need) - Math.min(g.from, g.need)) / (g.unit === 'credits' ? 3 : 1)),
      0
    ) + 2 * new Set(rs.flatMap((r) => (r.replaces ? [r.replaces.id] : []))).size;
  const asGain = ({ required: _r, ...g }: ReturnType<typeof gainsBetween>[number]): Gain => g;

  // required courses not yet planned: taking one of their prerequisites unlocks them
  const required = new Set(needs.filter((n) => n.required).flatMap((n) => [...n.codes]));
  const unlocks = (code: string) =>
    [...required].filter((r) =>
      courseReqs(index.get(r)).some((q) => !q.coreq && reqCodes(q.tree).includes(code))
    );

  // ---- what the student can take in this term ----
  const cat = catalogTerm(term, imported);
  const season = termSeason(term);
  const offered = (c: IndexCourse) => {
    if (cat) return c.terms.includes(cat);
    const pattern = offeringPattern(c.terms, imported);
    return !(season === 'Fall' || season === 'Spring') || !pattern || pattern === 'both' || pattern === season;
  };
  // prerequisites, and the background the catalog recommends ("AS.110.106 or
  // AS.110.108, or a 5 on the AP AB exam": exam credit is entered as a course)
  const background = (c: IndexCourse) =>
    parsePrereqText(c.background?.replace(/,?\s*or (?:a |an )?\d(?: or (?:better|higher))? on the [^,;.]*?\bexam\b/gi, '') ?? '');
  const ready = (c: IndexCourse) =>
    [...courseReqs(c), ...background(c)].every((r) => !unmet(r.tree, r.concurrent ? now : past, (x) => index.has(x)));

  const scored: Recommendation[] = [];
  for (const code of new Set(needs.flatMap((n) => [...n.codes]))) {
    const c = index.get(code);
    if (!c || ruledOut.has(code) || !offered(c) || !ready(c)) continue;
    if (cat && c.fullIn?.includes(cat)) continue; // no open seat left that term
    // a course counts toward one requirement: one that fills a required slot
    // can't also stand in for a placeholder (which would then reopen)
    const fills = needs.filter((n) => n.codes.has(code));
    const replaces = fills.some((n) => n.required) ? undefined : fills.find((n) => n.replaces)?.replaces;
    const r: Recommendation = { course: c, credits: parseFloat(c.credits) || 0, gains: [], reasons: [], score: 0, replaces };
    const gains = gainsBetween(base, progressOf(withCourses([r])));
    const opens = unlocks(code);
    r.score = worth(gains, [r]) + 0.5 * opens.length;
    if (!r.score) continue; // the matcher would count it nowhere new
    r.gains = gains.map(asGain);
    r.reasons = [
      ...(replaces ? [`Takes the place of “${replaces.title}”`] : []),
      ...(opens.length ? [`Prerequisite for ${opens.slice(0, 3).join(', ')}${opens.length > 3 ? '…' : ''}`] : []),
    ];
    scored.push(r);
  }
  const rate = (r: Recommendation) => o.rating?.(r.course) ?? 0;
  scored.sort((a, b) => b.score - a.score || rate(b) - rate(a) || a.course.code.localeCompare(b.course.code));

  // ---- a set that fits: each step adds the course that moves progress most
  // on top of the ones already picked, so two that fill the same slot aren't both taken
  const room = plan.maxCredits - termCredits(plan.terms[term]);
  const cost = (r: Recommendation) => r.credits - (r.replaces?.credits ?? 0);
  const pool = scored.slice(0, 40); // shortcut: the best 40 alone; enough for one semester's picks
  const suggested: Recommendation[] = [];
  let free = room;
  let current = base;
  for (;;) {
    let best: { r: Recommendation; value: number; after: Map<string, GroupProgress> } | undefined;
    for (const r of pool) {
      if (suggested.includes(r) || cost(r) > free) continue;
      if (r.replaces && suggested.some((s) => s.replaces === r.replaces)) continue;
      const after = progressOf(withCourses([...suggested, r]));
      const value = worth(gainsBetween(current, after), [r]);
      if (value > 0 && (!best || value > best.value)) best = { r, value, after };
    }
    if (!best) break;
    suggested.push(best.r);
    free -= cost(best.r);
    current = best.after;
  }

  const planned = (p: Plan) => Object.values(p.terms).reduce((n, items) => n + termCredits(items), 0);
  const need = Math.max(0, ...o.templates.map((t) => t.totalCredits ?? 0)) || undefined;
  return {
    suggested,
    more: scored.filter((r) => !suggested.includes(r)),
    room,
    setGains: gainsBetween(base, current).map(asGain),
    total: { from: planned(plan), to: planned(withCourses(suggested)), need },
  };
}
