import type { ReqGroup, ReqMatch, ReqSlot, ReqTemplate } from './types';

// What the matcher needs to know about a planned course.
export type ReqItem = {
  id: string;
  codes: string[]; // its own code plus any codes it counts as (AP credit etc.)
  credits: number;
  tags: string[]; // area tags: "H", "FA3"…
  posTags: string[];
  writingIntensive: boolean;
  completed: boolean;
};

export type GroupProgress = {
  group: ReqGroup;
  unit: 'courses' | 'credits';
  need: number;
  have: number;
  done: number; // the part of `have` that is completed
  itemIds: string[];
  // checklist groups: one entry per slot
  slots?: { label: string; itemIds: string[] | null }[];
};

// "Engineering (E)^Science and Data (FA2)" -> ["E", "FA2"]
export const areaTags = (areas: string) => [...areas.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);

const glob = (pattern: string) =>
  new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
  );

// An item matches when ANY listed criterion matches.
export function itemMatches(item: ReqItem, m: ReqMatch): boolean {
  return (
    !!m.codes?.some((c) => item.codes.includes(c)) ||
    !!m.patterns?.some((p) => item.codes.some((c) => glob(p).test(c))) ||
    !!m.areas?.some((a) => item.tags.includes(a)) ||
    !!m.posTags?.some((t) => item.posTags.includes(t)) ||
    (!!m.writingIntensive && item.writingIntensive)
  );
}

const slotOptions = (slot: ReqSlot): string[][] =>
  (typeof slot === 'string' ? [slot] : slot.oneOf).map((o) => (typeof o === 'string' ? [o] : o));

export const slotLabel = (slot: ReqSlot): string =>
  typeof slot === 'string'
    ? slot
    : slot.label ?? slotOptions(slot).map((o) => o.join(' + ')).join(' or ');

// Match planned courses against a template. Each course counts toward at most
// one group (checklists claim first, then pools, in template order) unless the
// group is `shared`. `assign` (item id -> group id) forces a course into a group.
export function matchRequirements(
  template: ReqTemplate,
  items: ReqItem[],
  assign: Record<string, string> = {}
): GroupProgress[] {
  const used = new Set<string>(); // item ids already counted somewhere
  // checklist slots claim per code, so one AP entry that counts as two courses
  // can fill both of their slots
  const usedCodes = new Set<string>();
  const free = (g: ReqGroup, it: ReqItem, code?: string) =>
    assign[it.id]
      ? assign[it.id] === g.id
      : g.shared || (code ? !usedCodes.has(`${it.id}|${code}`) : !used.has(it.id));
  const result = new Map<string, GroupProgress>();
  const sum = (ids: string[], f: (it: ReqItem) => number) =>
    ids.reduce((n, id) => n + f(items.find((it) => it.id === id)!), 0);

  const checklist = (g: ReqGroup) => {
    const forced = items.filter((it) => assign[it.id] === g.id);
    const slots = g.courses!.map((slot) => {
      // an option is filled when every one of its codes is planned
      for (const option of slotOptions(slot)) {
        const found = option.map((code) => items.find((it) => it.codes.includes(code) && free(g, it, code)));
        if (found.every((it) => it)) {
          const ids = found.map((it) => it!.id);
          if (!g.shared) {
            ids.forEach((id, i) => {
              used.add(id);
              usedCodes.add(`${id}|${option[i]}`);
            });
          }
          return { label: slotLabel(slot), itemIds: ids as string[] | null };
        }
      }
      return { label: slotLabel(slot), itemIds: null as string[] | null };
    });
    // a manually assigned course that matched no slot fills the first open one
    for (const it of forced) {
      if (slots.some((s) => s.itemIds?.includes(it.id))) continue;
      const open = slots.find((s) => !s.itemIds);
      if (open) open.itemIds = [it.id];
      used.add(it.id);
    }
    const filled = slots.filter((s) => s.itemIds);
    const done = filled.filter((s) => s.itemIds!.every((id) => items.find((it) => it.id === id)!.completed));
    result.set(g.id, {
      group: g,
      unit: 'courses',
      need: slots.length,
      have: filled.length,
      done: done.length,
      itemIds: filled.flatMap((s) => s.itemIds!),
      slots,
    });
  };

  const pool = (g: ReqGroup) => {
    const unit = g.credits != null ? 'credits' : 'courses';
    const need = g.credits ?? g.count ?? 0;
    const measure = (it: ReqItem) => (unit === 'credits' ? it.credits : 1);
    const ids: string[] = [];
    let have = 0;
    for (const it of items) {
      const forced = assign[it.id] === g.id;
      if (!forced && !(g.match && itemMatches(it, g.match) && free(g, it))) continue;
      // don't swallow more courses than the group needs; leave them for later groups
      if (!forced && !g.shared && have >= need) continue;
      ids.push(it.id);
      have += measure(it);
      if (!g.shared) used.add(it.id);
    }
    result.set(g.id, {
      group: g,
      unit,
      need,
      have,
      done: sum(ids, (it) => (it.completed ? measure(it) : 0)),
      itemIds: ids,
    });
  };

  for (const g of template.groups) if (g.courses) checklist(g);
  for (const g of template.groups) if (!g.courses) pool(g);
  return template.groups.map((g) => result.get(g.id)!);
}
