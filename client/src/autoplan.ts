import type { IndexCourse, ReqTemplate } from './types';
import { itemCodes, newId, offeringPattern, reqItems, termCredits, termOrder, termSeason } from './plan';
import type { Plan, PlanItem } from './plan';
import { parseRawReqs, unmet } from './prereqs';
import { areaTags, matchRequirements, slotOptions } from './requirements';
import type { SampleEntry, SamplePlan } from './samplePlans';

// The first `n` Fall/Spring terms of a plan.
export function semesters(plan: Pick<Plan, 'firstSeason' | 'firstYear'>, n: number): string[] {
  const out: string[] = [];
  let season = plan.firstSeason;
  let year = plan.firstYear;
  while (out.length < n) {
    out.push(`${season} ${year}`);
    if (season === 'Fall') year++;
    season = season === 'Fall' ? 'Spring' : 'Fall';
  }
  return out;
}

export type FocusRank = { tag: string; name: string; total: number; science: number };

// Focus areas ordered by the share of their courses the registrar tags as
// Natural Sciences (N). A proxy for overlap with pre-med coursework, not advice.
export function rankFocusAreas(areas: SamplePlan['focusAreas'], index: Map<string, IndexCourse>): FocusRank[] {
  const courses = [...index.values()];
  return areas
    .map(({ tag, name }) => {
      const tagged = courses.filter((c) => c.posTags?.includes(tag));
      return { tag, name, total: tagged.length, science: tagged.filter((c) => areaTags(c.areas).includes('N')).length };
    })
    .sort((a, b) => b.science / (b.total || 1) - a.science / (a.total || 1) || b.science - a.science);
}

export type AutoPlanOptions = {
  plan: Plan;
  sample: SamplePlan;
  premed: boolean;
  semesterCount: number; // Fall/Spring terms from the plan's first term to graduation
  maxCredits: number;
  index: Map<string, IndexCourse>;
  imported: string[];
  template?: ReqTemplate; // lets courses already in the plan stand in for sample rows
  focusName?: string;
};

// Lays the catalog's sample program out over the plan's semesters. Keeps every
// course the student entered, replaces what an earlier run placed, and never
// adds to a semester that already holds completed or in-progress courses.
export function autoPlan(o: AutoPlanOptions): { plan: Plan; unplaced: SampleEntry[] } {
  const { plan, sample, index, maxCredits } = o;
  const grid = o.premed ? sample.premed : sample.standard;
  const kept = Object.fromEntries(Object.entries(plan.terms).map(([t, items]) => [t, items.filter((it) => !it.auto)]));
  const base: Plan = { ...plan, terms: kept, numTerms: o.semesterCount };
  const sems = semesters(plan, o.semesterCount);
  const started = sems.map((t) => !!kept[t]?.some((it) => it.status !== 'planned')).lastIndexOf(true) + 1;
  const open = sems.slice(started);

  // ---- what the student's own courses already cover ----
  const progress = o.template ? matchRequirements(o.template, reqItems(base, index), plan.assign[o.template.id]) : [];
  const covered = new Set(Object.values(kept).flatMap((items) => items.flatMap(itemCodes)));
  const spare = new Map<string, { left: number; credits: boolean }>(); // per group: filled amount not yet used to skip a slot
  for (const p of progress) {
    p.slots?.forEach((slot, i) => {
      if (slot.itemIds) for (const code of slotOptions(p.group.courses![i]).flat()) covered.add(code);
    });
    spare.set(p.group.id, {
      left: p.slots ? (p.have >= p.need ? Infinity : 0) : p.have,
      credits: p.unit === 'credits',
    });
  }
  const filled = (e: SampleEntry) => {
    if (e.codes) return e.codes.some((code) => covered.has(code));
    const s = spare.get(sample.slotGroups[e.slot!] ?? '');
    const cost = s?.credits ? e.credits : 1;
    if (!s || s.left < cost) return false;
    s.left -= cost;
    return true;
  };

  // ---- placement ----
  const when = new Map<string, number>(); // code -> order of the first term holding it
  const hold = (code: string, order: number) => when.set(code, Math.min(when.get(code) ?? Infinity, order));
  for (const [t, items] of Object.entries(kept)) for (const it of items) itemCodes(it).forEach((code) => hold(code, termOrder(t)));
  const load = open.map((t) => termCredits(kept[t]));
  const terms: Plan['terms'] = { ...kept };
  const assign = { ...plan.assign[sample.templateId] };
  const unplaced: SampleEntry[] = [];
  let lastDesign = -1;
  const first = Math.min(started, grid.length - 1); // sample semester the open terms start from
  const scale = Math.min(1, open.length / (grid.length - first)); // < 1 squeezes the sample into fewer terms

  grid.forEach((sem, s) => {
    for (const e of sem) {
      if (filled(e)) continue;
      const code = e.codes && (e.codes.find((x) => index.has(x)) ?? e.codes[0]);
      const course = code ? index.get(code) : undefined;
      const pattern = course && offeringPattern(course.terms, o.imported);
      // a two-semester design sequence keeps the catalog's season
      const season = e.slot === 'design' ? (s % 2 ? 'Spring' : 'Fall') : pattern === 'both' ? null : pattern;
      const reqs = parseRawReqs(course?.prereqs);
      const checks = [
        (i: number) => {
          const order = termOrder(open[i]);
          return reqs.every((r) => {
            const have = new Set([...when].filter(([, at]) => at < order || (r.concurrent && at === order)).map(([x]) => x));
            return !unmet(r.tree, have, (x) => index.has(x));
          });
        },
        (i: number) => !season || termSeason(open[i]) === season,
        (i: number) => load[i] + e.credits <= maxCredits && (e.slot !== 'design' || i > lastDesign),
      ];
      const want = Math.max(0, Math.floor((s - first) * scale));
      const order = [...open.keys()].slice(want).concat([...open.keys()].slice(0, want).reverse());
      // all checks, then without prerequisites, then without the season; the
      // planner's own warnings flag whatever had to give
      let at = -1;
      for (let drop = 0; drop < checks.length && at < 0; drop++) {
        at = order.find((i) => checks.slice(drop).every((ok) => ok(i))) ?? -1;
      }
      if (at < 0) {
        unplaced.push(e);
        continue;
      }
      const item: PlanItem = {
        id: newId(),
        ...(code ? { code } : {}),
        title: course?.title ?? code ?? (e.slot === 'focus' && o.focusName ? `${e.label} (${o.focusName})` : e.label!),
        credits: e.credits,
        status: 'planned',
        auto: true,
        ...(e.slot === 'fa3' || e.slot === 'fa4' ? { tags: [e.slot.toUpperCase()] } : {}),
      };
      // slots without a tag of their own are counted by assignment
      const group = e.slot && sample.slotGroups[e.slot];
      if (group && !item.tags) assign[item.id] = group;
      terms[open[at]] = [...(terms[open[at]] ?? []), item];
      load[at] += e.credits;
      if (code) hold(code, termOrder(open[at]));
      if (e.slot === 'design') lastDesign = at;
    }
  });

  // drop assignments of courses that no longer exist
  const ids = new Set(Object.values(terms).flatMap((items) => items.map((it) => it.id)));
  const templates = [sample.templateId, ...(o.premed ? [sample.premedTemplateId] : [])];
  return {
    unplaced,
    plan: {
      ...base,
      maxCredits,
      terms,
      templates: [...new Set([...plan.templates, ...templates])],
      assign: {
        ...plan.assign,
        [sample.templateId]: Object.fromEntries(Object.entries(assign).filter(([id]) => ids.has(id))),
      },
    },
  };
}
