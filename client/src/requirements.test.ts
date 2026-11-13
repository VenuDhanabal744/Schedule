import { describe, expect, it } from 'vitest';
import type { ReqTemplate } from './types';
import { areaTags, itemMatches, matchRequirements } from './requirements';
import type { ReqItem } from './requirements';

const item = (id: string, extra: Partial<ReqItem> = {}): ReqItem => ({
  id,
  codes: [id],
  credits: 3,
  tags: [],
  posTags: [],
  writingIntensive: false,
  completed: false,
  ...extra,
});

const template = (groups: ReqTemplate['groups']): ReqTemplate => ({
  id: 't',
  school: 'jhu',
  name: 'Test',
  source: '',
  note: '',
  groups,
});

const byId = (t: ReqTemplate, items: ReqItem[], assign = {}) =>
  Object.fromEntries(matchRequirements(t, items, assign).map((p) => [p.group.id, p]));

describe('areaTags / itemMatches', () => {
  it('pulls tags out of the catalog areas string', () => {
    expect(areaTags('Engineering (E)^Science and Data (FA2)')).toEqual(['E', 'FA2']);
    expect(areaTags('None')).toEqual([]);
  });
  it('matches on any listed criterion', () => {
    const it1 = item('EN.580.441', { tags: ['E'], posTags: ['BME-TCTE'], writingIntensive: true });
    expect(itemMatches(it1, { codes: ['EN.580.441'] })).toBe(true);
    expect(itemMatches(it1, { patterns: ['EN.580.4*'] })).toBe(true);
    expect(itemMatches(it1, { patterns: ['EN.580.3*'] })).toBe(false);
    expect(itemMatches(it1, { patterns: ['EN.580'] })).toBe(false); // globs match the whole code
    expect(itemMatches(it1, { areas: ['H', 'E'] })).toBe(true);
    expect(itemMatches(it1, { posTags: ['BME-TCTE'] })).toBe(true);
    expect(itemMatches(it1, { writingIntensive: true })).toBe(true);
    expect(itemMatches(it1, { areas: ['H'], posTags: ['BME-NE'] })).toBe(false);
  });
});

describe('checklist groups', () => {
  const t = template([
    {
      id: 'math',
      name: 'Math',
      courses: ['CALC1', { label: 'Linear algebra', oneOf: ['LADE', ['LA', 'DE']] }],
    },
  ]);
  it('fills slots, including an option that needs two courses', () => {
    expect(byId(t, [item('CALC1')]).math).toMatchObject({ have: 1, need: 2, unit: 'courses' });
    expect(byId(t, [item('CALC1'), item('LA')]).math.have).toBe(1); // half an option is not enough
    const full = byId(t, [item('CALC1', { completed: true }), item('LA'), item('DE')]).math;
    expect(full).toMatchObject({ have: 2, done: 1 });
    expect(full.slots!.map((s) => s.itemIds)).toEqual([['CALC1'], ['LA', 'DE']]);
  });
  it('lets one credit entry stand in for several courses', () => {
    const two = template([{ id: 'calc', name: 'Calc', courses: ['CALC1', 'CALC2'] }]);
    const ap = item('ap', { codes: ['CALC1', 'CALC2'], credits: 8 });
    expect(byId(two, [ap]).calc.have).toBe(2);
  });
});

describe('pool groups', () => {
  const t = template([
    { id: 'core', name: 'Core', courses: ['A'] },
    { id: 'hum', name: 'Humanities', credits: 6, match: { areas: ['H'] } },
    { id: 'any', name: 'Electives', count: 2, match: { areas: ['H', 'S'] } },
    { id: 'wi', name: 'Writing', count: 1, shared: true, match: { writingIntensive: true } },
  ]);
  const items = [
    item('A', { tags: ['H'], writingIntensive: true }),
    item('B', { tags: ['H'] }),
    item('C', { tags: ['H'], completed: true }),
    item('D', { tags: ['H'] }),
    item('E', { tags: ['S'] }),
  ];
  it('counts each course once, checklists first, in template order', () => {
    const r = byId(t, items);
    expect(r.core.itemIds).toEqual(['A']);
    expect(r.hum).toMatchObject({ unit: 'credits', have: 6, done: 3, itemIds: ['B', 'C'] });
    expect(r.any).toMatchObject({ unit: 'courses', have: 2, itemIds: ['D', 'E'] });
  });
  it('lets shared groups reuse a course', () => {
    expect(byId(t, items).wi.itemIds).toEqual(['A']);
  });
  it('honours manual assignment', () => {
    const r = byId(t, items, { B: 'any', E: 'hum' });
    expect(r.hum.itemIds).toEqual(['C', 'D', 'E']); // E forced in even though it is not H
    expect(r.any.itemIds).toEqual(['B']);
  });
  it('assigning to a checklist fills its first open slot', () => {
    const r = byId(t, [item('Z')], { Z: 'core' });
    expect(r.core).toMatchObject({ have: 1 });
  });
});
