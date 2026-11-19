import type { IndexCourse, ReqMatch, ReqTemplate, Section } from './types';
import { itemCodes, newId, offeringPattern, reqItems, termCredits, termOrder, termSeason } from './plan';
import type { Plan, PlanItem } from './plan';
import { courseReqs, credited, reqCodes, unmet } from './prereqs';
import { canSchedule } from './schedule';
import { areaTags, itemMatches, matchRequirements, slotOptions } from './requirements';
import { samplePlans } from './samplePlans';
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

// course codes named in a registrar prerequisite expression
const exprCodes = (expr?: string) => expr?.match(/[A-Z]{2}\.\d{3}\.\d{3}/g) ?? [];

export type FocusRank = {
  tag: string;
  name: string;
  total: number;
  science: number;
};

// Focus areas ordered by the share of their courses the registrar tags as
// Natural Sciences (N). A proxy for overlap with pre-med coursework, not advice.
export function rankFocusAreas(areas: SamplePlan['focusAreas'], index: Map<string, IndexCourse>): FocusRank[] {
  const courses = [...index.values()];
  return areas
    .map(({ tag, name }) => {
      const tagged = courses.filter((c) => c.posTags?.includes(tag));
      return {
        tag,
        name,
        total: tagged.length,
        science: tagged.filter((c) => areaTags(c.areas).includes('N')).length,
      };
    })
    .sort((a, b) => b.science / (b.total || 1) - a.science / (a.total || 1) || b.science - a.science);
}

// The sample slot a placeholder card stands for. Placeholders carry the slot's
// label (`fills`); ones placed before that only have it as their title, with
// the focus area appended ("Focus Area Course 1 (Neuroengineering)").
export function slotEntry(it: PlanItem, sample: SamplePlan): SampleEntry | undefined {
  if (it.code) return undefined;
  const slots = [...sample.standard, ...(sample.premed ?? [])].flat().filter((e) => e.slot);
  const find = (label: string) => slots.find((e) => e.label === label);
  return find(it.fills ?? it.title) ?? find(it.title.replace(/ \([^)]*\)$/, ''));
}

// What can fill a slot, as a requirement match. null: anything can (a free
// elective), or the catalog's label doesn't say.
export function slotMatch(
  e: SampleEntry,
  sample: SamplePlan,
  template?: ReqTemplate,
  focusName?: string
): ReqMatch | null {
  const label = e.label ?? '';
  const focus = e.slot === 'focus' && sample.focusAreas.find((f) => f.name === focusName);
  if (focus) return { posTags: [focus.tag] };
  if (e.slot === 'fa3' || e.slot === 'fa4' || e.slot === 'fa3-fa4') return { areas: e.slot.toUpperCase().split('-') };
  const group = template?.groups.find((g) => g.id === sample.slotGroups[e.slot!]);
  if (group?.match) return group.match;
  if (group?.courses) {
    // "Design Sequence 2": the second course of each two-semester option
    const nth = +(label.match(/ (\d)$/)?.[1] ?? 0) - 1;
    return { codes: group.courses.flatMap(slotOptions).flatMap((o) => (o[nth] ? [o[nth]] : o)) };
  }
  if (e.slot === 'free') return null;
  const patterns = /\bFYS\b|first[- ]year seminar/i.test(label) ? ['AS.001.*', 'EN.501.*'] : [];
  // "EN.601.3xx/4xx", "AS.100.3xx - AS.100.4xx", "AS.061.XXX"
  for (const [, dept, lo, hi] of label.matchAll(
    /([A-Z]{2}\.\d{3})\.(?:(\d)xx(?:\s*[-–/]\s*(?:[A-Z]{2}\.\d{3}\.)?(\d)xx)?|xxx)/gi
  )) {
    if (!lo) patterns.push(`${dept}.*`);
    else for (let level = +lo; level <= +(hi ?? lo); level++) patterns.push(`${dept}.${level}??`);
  }
  const areas = [...label.matchAll(/\btag (FA\d(?:\.\d)?(?:eP)?)/g)].map((m) => m[1]);
  const posTags = label.match(/\b[A-Z]{3,5}-[A-Z]{2,7}\b/g) ?? []; // "(BEHB-BIOBEH)", "POS-Tag MSCH-HUM"
  return patterns.length || areas.length || posTags.length ? { patterns, areas, posTags } : null;
}

// Catalog courses a match accepts.
export const matchingCourses = (m: ReqMatch, index: Map<string, IndexCourse>): IndexCourse[] =>
  [...index.values()].filter((c) =>
    itemMatches(
      {
        id: c.code,
        codes: [c.code],
        credits: parseFloat(c.credits) || 0,
        tags: areaTags(c.areas),
        posTags: c.posTags ?? [],
        writingIntensive: c.writingIntensive,
        completed: false,
      },
      m
    )
  );

// Course codes an auto-plan run may place or keep: the ones to fetch times for.
export const autoPlanCodes = (plan: Plan, sample: SamplePlan) => [
  ...[...sample.standard, ...(sample.premed ?? [])].flat().flatMap((e) => e.codes ?? []),
  ...Object.values(plan.terms).flat().flatMap((it) => (it.code ? [it.code] : [])),
];

// Placed by the auto-planner and not yet under way: the next run replaces it.
// A course the student adds, or an auto-planned one they move, stays put.
export const replaceable = (it: PlanItem) => !!it.auto && !it.pinned && it.status === 'planned';

// A planned placeholder without `auto` or `fills` is left over from an earlier
// version (any program's): the planner's own, not the student's.
const stray = (it: PlanItem, samples: SamplePlan[]) =>
  it.status === 'planned' && !it.fills && samples.some((s) => slotEntry(it, s));

// Everything the auto-planner placed that isn't under way yet, moved or not:
// what "Remove auto-planned" takes out. A placeholder carries `fills` even
// after a drag that predates `pinned`.
const autoPlaced = (it: PlanItem, samples: SamplePlan[]) =>
  it.status === 'planned' && (!!it.auto || !!it.fills || stray(it, samples));

export const hasAutoPlan = (plan: Plan) =>
  Object.values(plan.terms).some((items) => items.some((it) => autoPlaced(it, Object.values(samplePlans))));

// The plan without its auto-plan: keeps the student's own courses and whatever
// is completed or in progress, and drops the removed cards' assignments.
export function removeAutoPlan(plan: Plan): Plan {
  const samples = Object.values(samplePlans);
  const terms = Object.fromEntries(
    Object.entries(plan.terms).map(([t, items]) => [t, items.filter((it) => !autoPlaced(it, samples))])
  );
  const ids = new Set(Object.values(terms).flatMap((items) => items.map((it) => it.id)));
  const assign = Object.fromEntries(
    Object.entries(plan.assign).map(([t, a]) => [t, Object.fromEntries(Object.entries(a).filter(([id]) => ids.has(id)))])
  );
  return { ...plan, autoPlan: undefined, terms, assign };
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
  // a course's sections in a planner term whose catalog is imported; undefined
  // where times aren't known (later terms), which then can't rule a term out
  sections?: (term: string, code: string) => Section[] | undefined;
  // term -> courses (by code) or placeholders (by slot label) the student keeps out of it
  blocked?: Record<string, string[]>;
};

// Lays the catalog's sample program out over the plan's semesters. Keeps every
// course the student entered or moved, replaces what an earlier run placed, and
// never adds to a semester that already holds completed or in-progress courses.
export function autoPlan(o: AutoPlanOptions): {
  plan: Plan;
  unplaced: SampleEntry[];
  skipped: string[];
} {
  const { plan, sample, index, maxCredits } = o;
  const grid = (o.premed && sample.premed) || sample.standard;
  const samples = [sample, ...Object.values(samplePlans)];
  const kept = Object.fromEntries(
    Object.entries(plan.terms).map(([t, items]) => [t, items.filter((it) => !replaceable(it) && !stray(it, samples))])
  );
  const base: Plan = { ...plan, terms: kept, numTerms: o.semesterCount };
  const sems = semesters(plan, o.semesterCount);
  const started = sems.map((t) => !!kept[t]?.some((it) => it.status !== 'planned')).lastIndexOf(true) + 1;
  const open = sems.slice(started);

  // ---- what the student's own courses already cover ----
  const own = reqItems(base, index);
  const progress = o.template ? matchRequirements(o.template, own, plan.assign[o.template.id]) : [];
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
  // ---- sample courses the student is already past ----
  // `due`: the earliest term holding a course that this one comes before. A
  // prerequisite can't follow the course it leads to.
  const needs = (code: string) =>
    (index.get(code)?.prereqs ?? []).filter((r) => !r.negative).flatMap((r) => exprCodes(r.expr));
  // every course named anywhere in a course's prerequisite chain
  const chains = new Map<string, Set<string>>();
  const chain = (code: string) => {
    let all = chains.get(code);
    if (!all) {
      chains.set(code, (all = new Set()));
      for (const queue = needs(code); queue.length; ) {
        const c = queue.pop()!;
        if (all.has(c)) continue;
        all.add(c);
        queue.push(...needs(c));
      }
    }
    return all;
  };
  // A course comes before a held one when it is in the held course's chain and
  // not the other way round. Courses in each other's chains are on one level:
  // Linear Algebra, Calculus III and Differential Equations each accept
  // "Calculus II, or one of the other two".
  const due = new Map<string, number>();
  for (const [t, items] of Object.entries(kept)) {
    for (const held of items.flatMap(itemCodes)) {
      for (const c of chain(held)) {
        if (!chain(c).has(held)) due.set(c, Math.min(due.get(c) ?? Infinity, termOrder(t)));
      }
    }
  }
  const mine = new Set(covered); // before the requirement slots widen it
  const horizon = open.length ? termOrder(open[0]) : Infinity;
  const skipped: string[] = [];
  // already past it, or the registrar bars it after a course the student has
  // (AS.030.102 after AS.030.103)
  const past = (code: string) =>
    (due.get(code) ?? Infinity) <= horizon ||
    !!index.get(code)?.prereqs?.some((r) => r.negative && exprCodes(r.expr).some((c) => mine.has(c)));

  // slots outside the requirement groups: each is filled by a placeholder the
  // student moved, or by one of their courses that fits it and isn't one of
  // the sample's own courses ("FYS or Design Cornerstone" by EN.501.124)
  const named = new Set(grid.flat().flatMap((e) => e.codes ?? []));
  const placeholders = Object.values(kept).flat();
  const spent = new Set<string>();
  const filled = (e: SampleEntry) => {
    if (e.codes) return e.codes.some((code) => covered.has(code));
    const group = sample.slotGroups[e.slot!];
    if (!group) {
      const match = slotMatch(e, sample, o.template, o.focusName);
      const by =
        placeholders.find((it) => it.fills === e.label && !spent.has(it.id)) ??
        (match && own.find((it) => !spent.has(it.id) && !it.codes.some((c) => named.has(c)) && itemMatches(it, match)));
      if (by) spent.add(by.id);
      return !!by;
    }
    const s = spare.get(group);
    const cost = s?.credits ? e.credits : 1;
    if (!s || s.left < cost) return false;
    s.left -= cost;
    return true;
  };

  // ---- placement ----
  const when = new Map<string, number>(); // code -> order of the first term holding it
  const hold = (code: string, order: number) => when.set(code, Math.min(when.get(code) ?? Infinity, order));
  for (const [t, items] of Object.entries(kept))
    for (const it of items) itemCodes(it).forEach((code) => hold(code, termOrder(t)));
  const load = open.map((t) => termCredits(kept[t]));
  const terms: Plan['terms'] = { ...kept };
  const assign = { ...plan.assign[sample.templateId] };
  const unplaced: SampleEntry[] = [];
  let lastDesign = -1;
  let lastCoded = 0; // latest term given a named course so far
  const first = Math.min(started, grid.length - 1); // sample semester the open terms start from
  const scale = Math.min(1, open.length / (grid.length - first)); // < 1 squeezes the sample into fewer terms

  const slotOf = (s: number) => Math.max(0, Math.floor((s - first) * scale)); // term a sample semester maps to

  const todo: { e: SampleEntry; s: number; code?: string }[] = [];
  grid.forEach((sem, s) => {
    for (const e of sem) {
      if (filled(e)) continue;
      const code = e.codes && (e.codes.find((x) => index.has(x)) ?? e.codes[0]);
      if (code && past(code)) skipped.push(code);
      else todo.push({ e, s, code });
    }
  });

  // ---- pace ----
  // Credit the student already has leaves gaps in the sample's early terms.
  // Later courses may move up into a term until it reaches `level`: the
  // catalog's load for that term, or an even share of what is left if lower.
  const need = todo.reduce((n, { e }) => n + e.credits, 0);
  let lo = 0;
  let even = need + Math.max(0, ...load);
  for (let k = 0; k < 30; k++) {
    const mid = (lo + even) / 2;
    if (load.reduce((room, l) => room + Math.max(0, mid - l), 0) < need) lo = mid;
    else even = mid;
  }
  even = Math.max(even, plan.minCredits);
  const level = load.map(() => 0);
  grid.forEach((sem, s) => {
    if (open.length) level[Math.min(slotOf(s), open.length - 1)] += sem.reduce((n, e) => n + e.credits, 0);
  });
  level.forEach((l, i) => (level[i] = Math.min(l, even)));

  // A design sequence runs Fall then Spring. It is placed first, while those
  // terms still have room, and early enough that the rest of it fits.
  const design = (t: { e: SampleEntry }) => t.e.slot === 'design';
  todo.sort((a, b) => +design(b) - +design(a));
  let designs = todo.filter(design).length;
  for (const { e, s, code } of todo) {
    const after = e.slot === 'design' ? --designs : 0; // sequence courses that must follow this one
    const course = code ? index.get(code) : undefined;
    // the one season a course has been seen in, if only one
    const only = (c: IndexCourse | undefined) => {
      const pattern = c && offeringPattern(c.terms, o.imported);
      return pattern === 'both' ? null : pattern;
    };
    // a two-semester design sequence keeps the catalog's season
    const season = e.slot === 'design' ? (s % 2 ? 'Spring' : 'Fall') : only(course);
    const reqs = courseReqs(course);
    const names = (c: string | undefined, other: string) =>
      courseReqs(c ? index.get(c) : undefined).some((r) => r.coreq && reqCodes(r.tree).includes(other));
    // corequisites still to be placed: they will share this course's term, so
    // leave room for them
    const partners = todo.filter((t) => t.code && code && t.code !== code && !when.has(t.code) && names(code, t.code));
    const room = e.credits + partners.reduce((n, t) => n + t.e.credits, 0);
    // a course already placed that names this one as a corequisite fixes its term
    const tied = Math.min(...[...when].filter(([c]) => code && names(c, code)).map(([, at]) => at));
    // never twice in one semester, and, where the term's times are known, only
    // if some sections of it, its corequisites and the term's courses don't overlap
    const fits = (t: string) => {
      if (o.blocked?.[t]?.includes(code ?? e.label!)) return false;
      const items = terms[t] ?? [];
      if (code && items.some((it) => itemCodes(it).includes(code))) return false;
      const times = (c: string) => o.sections?.(t, c);
      if (!code || !times(code)) return true;
      const lists = [...items.flatMap((it) => (it.code ? [it.code] : [])), code, ...partners.map((p) => p.code!)].map(times);
      return canSchedule(lists.filter((l): l is Section[] => !!l));
    };
    const checks = [
      (i: number) => {
        const order = termOrder(open[i]);
        if (order > tied) return false;
        const held = (same: boolean) =>
          [...when].filter(([, at]) => (same ? at === order : at < order)).map(([c]) => c);
        const before = credited(held(false), index);
        const now = new Set([...before, ...held(true), ...partners.map((t) => t.code!)]);
        return reqs.every((r) => !unmet(r.tree, r.concurrent ? now : before, (c) => index.has(c)));
      },
      (i: number) =>
        [season, ...partners.map((t) => only(index.get(t.code!)))].every((x) => !x || termSeason(open[i]) === x),
      (i: number) =>
        load[i] + room <= maxCredits &&
        (e.slot !== 'design' || (i > lastDesign && i + after < open.length)) &&
        fits(open[i]),
    ];
    // major electives stay behind the courses the catalog lists before them;
    // general ones (FA3/FA4, free) can go anywhere
    const major = e.slot === 'core-elective' || e.slot === 'design' || e.slot === 'focus' || e.slot === 'major';
    // first to give way: earlier than the catalog has it only into a gap, and
    // no term far above the even share (so the last one isn't left nearly empty)
    checks.unshift(
      (i: number) => i >= slotOf(s) || (load[i] < level[i] && (!major || i >= lastCoded)),
      (i: number) => load[i] + room <= Math.ceil(even) + 1
    );
    const gap = load.findIndex((l, i) => l < level[i]);
    const keys = [...open.keys()];
    const want =
      e.slot === 'design' ? Math.min(slotOf(s), open.length - 1 - after) : gap < 0 ? slotOf(s) : Math.min(slotOf(s), gap);
    // from the wanted term on, then back; a design course looks earlier first
    const order =
      e.slot === 'design'
        ? keys.slice(0, want + 1).reverse().concat(keys.slice(want + 1))
        : keys.slice(want).concat(keys.slice(0, want).reverse());
    // all checks, then without the two pace rules, prerequisites, and the season; the
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
      ...(e.slot ? { fills: e.label } : {}),
      ...(e.slot === 'fa3' || e.slot === 'fa4' ? { tags: [e.slot.toUpperCase()] } : {}),
    };
    // slots without a tag of their own are counted by assignment
    const group = e.slot && sample.slotGroups[e.slot];
    if (group && !item.tags) assign[item.id] = group;
    terms[open[at]] = [...(terms[open[at]] ?? []), item];
    load[at] += e.credits;
    if (code) hold(code, termOrder(open[at]));
    if (e.slot === 'design') lastDesign = at;
    if (code) lastCoded = Math.max(lastCoded, at);
  }

  // drop assignments of courses that no longer exist
  const ids = new Set(Object.values(terms).flatMap((items) => items.map((it) => it.id)));
  const templates = [sample.templateId, ...(o.premed ? [sample.premedTemplateId] : [])];
  return {
    unplaced,
    skipped,
    plan: {
      ...base,
      maxCredits,
      autoPlan: {
        premed: o.premed,
        semesterCount: o.semesterCount,
        focusName: o.focusName,
        templateId: sample.templateId,
        ...(o.blocked && Object.keys(o.blocked).length ? { blocked: o.blocked } : {}),
      },
      terms,
      templates: [...new Set([...plan.templates, ...templates])],
      assign: {
        ...plan.assign,
        [sample.templateId]: Object.fromEntries(Object.entries(assign).filter(([id]) => ids.has(id))),
      },
    },
  };
}
