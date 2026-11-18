import type { IndexCourse, ReqMatch, ReqTemplate } from './types';
import { catalogTerm, itemCodes, offeringPattern, reqItems, termCredits, termOrder, termSeason, termSequence } from './plan';
import type { Plan, PlanItem } from './plan';
import { courseReqs, credited, parsePrereqText, reqCodes, unmet } from './prereqs';
import { matchRequirements, slotOptions } from './requirements';
import { matchingCourses } from './autoplan';

// Something the student still needs: a required course, a few credits of a
// requirement group, or a placeholder card in the term being planned.
type Need = {
  label: string;
  weight: number; // a required course counts most, a placeholder next, a broad group least
  left: number; // how many more courses (or credits, when `credits`) it takes
  credits?: boolean;
  codes: Set<string>;
  replaces?: PlanItem; // the placeholder a course for this need takes the place of
};

export type Recommendation = {
  course: IndexCourse;
  credits: number;
  reasons: string[];
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
}): { suggested: Recommendation[]; more: Recommendation[]; room: number } {
  const { plan, term, index, imported } = o;
  const order = termOrder(term);
  const terms = termSequence(plan);
  const codesIn = (ts: string[]) => ts.flatMap((t) => (plan.terms[t] ?? []).flatMap(itemCodes));
  const past = credited(codesIn(terms.filter((t) => termOrder(t) < order)), index);
  const now = new Set([...past, ...codesIn([term])]);
  // in the plan anywhere, or barred after something in it
  const ruledOut = credited(codesIn(terms), index);

  // ---- what the student still needs ----
  const needs: Need[] = [];
  const items = reqItems(plan, index);
  const undergrad = (m: ReqMatch) => matchingCourses(m, index).filter((c) => UNDERGRAD.test(c.level)).map((c) => c.code);
  for (const t of o.templates) {
    for (const p of matchRequirements(t, items, plan.assign[t.id])) {
      if (p.group.todo || p.have >= p.need) continue;
      p.slots?.forEach((s, i) => {
        if (s.itemIds) return;
        const codes = new Set(slotOptions(p.group.courses![i]).flat());
        needs.push({ label: `Required: ${s.label} (${p.group.name})`, weight: 3, left: 1, codes });
      });
      if (!p.slots && p.group.match) {
        needs.push({
          label: `Counts toward ${p.group.name}`,
          weight: 1,
          left: p.need - p.have,
          credits: p.unit === 'credits',
          codes: new Set(undergrad(p.group.match)),
        });
      }
    }
  }
  for (const it of plan.terms[term] ?? []) {
    const m = it.status === 'planned' ? o.slotMatch(it) : undefined;
    if (m) needs.push({ label: `Fills “${it.title}”`, weight: 2, left: 1, codes: new Set(undergrad(m)), replaces: it });
  }

  // required courses not yet planned: taking one of their prerequisites unlocks them
  const required = new Set(needs.filter((n) => n.weight === 3).flatMap((n) => [...n.codes]));
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

  const scored: (Recommendation & { needs: Need[] })[] = [];
  for (const code of new Set(needs.flatMap((n) => [...n.codes]))) {
    const c = index.get(code);
    if (!c || ruledOut.has(code) || !offered(c) || !ready(c)) continue;
    // a course counts toward one requirement: one that fills a required slot
    // can't also stand in for a placeholder (which would then reopen)
    const all = needs.filter((n) => n.codes.has(code));
    const fills = all.some((n) => n.weight === 3) ? all.filter((n) => !n.replaces) : all;
    if (!fills.length) continue;
    const opens = unlocks(code);
    scored.push({
      course: c,
      credits: parseFloat(c.credits) || 0,
      needs: fills,
      replaces: fills.find((n) => n.replaces)?.replaces,
      score: fills.reduce((s, n) => s + n.weight, 0) + 0.5 * opens.length,
      reasons: [
        ...fills.map((n) => n.label),
        ...(opens.length ? [`Prerequisite for ${opens.slice(0, 3).join(', ')}${opens.length > 3 ? '…' : ''}`] : []),
      ],
    });
  }
  const rate = (r: Recommendation) => o.rating?.(r.course) ?? 0;
  scored.sort((a, b) => b.score - a.score || rate(b) - rate(a) || a.course.code.localeCompare(b.course.code));

  // ---- a set that fits: best first, each filling a need not yet covered ----
  const left = new Map(needs.map((n) => [n, n.left]));
  const open = (r: (typeof scored)[number]) => r.needs.filter((n) => left.get(n)! > 0);
  const room = plan.maxCredits - termCredits(plan.terms[term]);
  let free = room;
  const suggested: typeof scored = [];
  for (;;) {
    const cost = (r: (typeof scored)[number]) => r.credits - (r.replaces?.credits ?? 0);
    const value = (r: (typeof scored)[number]) => open(r).reduce((s, n) => s + n.weight, 0);
    const next = scored
      .filter((r) => !suggested.includes(r) && value(r) > 0 && cost(r) <= free)
      .filter((r) => !r.replaces || !suggested.some((s) => s.replaces === r.replaces))
      .sort((a, b) => value(b) - value(a) || b.score - a.score)[0];
    if (!next) break;
    suggested.push(next);
    free -= cost(next);
    for (const n of open(next)) left.set(n, left.get(n)! - (n.credits ? next.credits : 1));
  }
  const strip = ({ needs: _needs, ...r }: (typeof scored)[number]): Recommendation => r;
  return {
    suggested: suggested.map(strip),
    more: scored.filter((r) => !suggested.includes(r)).map(strip),
    room,
  };
}
