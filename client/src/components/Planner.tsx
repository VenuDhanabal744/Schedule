import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import type { IndexCourse, PlannerData, ReqTemplate } from '../types';
import { fetchPlannerData } from '../api';
import {
  PRIOR,
  catalogTerm,
  loadPlan,
  newId,
  offeringLabel,
  offeringPattern,
  parsePlanFile,
  planWarnings,
  reqItems,
  savePlan,
  termCredits,
  termSeason,
  termSequence,
} from '../plan';
import type { Plan, PlanItem, PlanStatus, Warning } from '../plan';
import { matchRequirements } from '../requirements';
import type { GroupProgress } from '../requirements';

type Drag = { kind: 'item'; id: string; label: string } | { kind: 'new'; code: string; label: string };

const STATUS_LABEL: Record<PlanStatus, string> = {
  planned: 'Planned',
  'in-progress': 'In progress',
  completed: 'Completed',
};

const splitList = (s: string) => s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);

function SearchResult({
  course,
  pattern,
  onAdd,
  onInfo,
}: {
  course: IndexCourse;
  pattern: string | null;
  onAdd: () => void;
  onInfo: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `new-${course.code}`,
    data: { kind: 'new', code: course.code, label: course.code } satisfies Drag,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`course-card plan-result${isDragging ? ' dragging' : ''}`}
    >
      <div className="cc-head" onClick={onInfo} title="Click for details · drag into a semester">
        <div className="cc-titles">
          <span className="cc-code">{course.code}</span>
          <span className="cc-title">{course.title}</span>
          {pattern && <span className="plan-pattern">{pattern}</span>}
        </div>
        <span className="cc-credits">{parseFloat(course.credits) || 0} cr</span>
        <button
          className="btn-add"
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
        >
          + Add
        </button>
      </div>
    </div>
  );
}

function PlanCard({
  item,
  term,
  terms,
  warnings,
  templates,
  assign,
  open,
  onToggle,
  onPatch,
  onMove,
  onRemove,
  onAssign,
  onInfo,
}: {
  item: PlanItem;
  term: string;
  terms: string[];
  warnings: Warning[];
  templates: ReqTemplate[];
  assign: Plan['assign'];
  open: boolean;
  onToggle: () => void;
  onPatch: (patch: Partial<PlanItem>) => void;
  onMove: (to: string) => void;
  onRemove: () => void;
  onAssign: (templateId: string, groupId: string) => void;
  onInfo: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
    data: { kind: 'item', id: item.id, label: item.code ?? item.title } satisfies Drag,
  });
  return (
    <div className={`plan-card st-${item.status}${isDragging ? ' dragging' : ''}${warnings.length ? ' warn' : ''}`}>
      <div ref={setNodeRef} {...listeners} {...attributes} className="plan-card-head">
        <span className="plan-status" title={STATUS_LABEL[item.status]} />
        <button className="plan-card-title" onClick={item.code ? onInfo : onToggle} title={item.code ? 'Course details' : 'Edit'}>
          <strong>{item.code ?? item.title}</strong>
          {item.code && <span>{item.title}</span>}
        </button>
        <span className="cc-credits">{item.credits} cr</span>
        <button className="plan-more" aria-label={`Edit ${item.code ?? item.title}`} aria-expanded={open} onClick={onToggle}>
          ⋯
        </button>
      </div>
      {warnings.map((w, i) => (
        <div key={i} className={`plan-warning ${w.kind}`}>
          {w.kind === 'offering' ? 'Hint: ' : '⚠ '}
          {w.text}
        </div>
      ))}
      {open && (
        <div className="plan-edit">
          {!item.code && (
            <label>
              Name
              <input type="text" value={item.title} onChange={(e) => onPatch({ title: e.target.value })} />
            </label>
          )}
          <label>
            Status
            <select value={item.status} onChange={(e) => onPatch({ status: e.target.value as PlanStatus })}>
              {Object.entries(STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Move to
            <select value={term} onChange={(e) => onMove(e.target.value)}>
              {terms.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Credits
            <input
              type="number"
              min={0}
              step={0.5}
              value={item.credits}
              onChange={(e) => onPatch({ credits: Math.max(0, +e.target.value || 0) })}
            />
          </label>
          {!item.code && (
            <>
              <label>
                Area tags
                <input
                  type="text"
                  placeholder="H, S, FA3"
                  defaultValue={item.tags?.join(', ') ?? ''}
                  onBlur={(e) => onPatch({ tags: splitList(e.target.value) })}
                />
              </label>
              <label>
                Counts as
                <input
                  type="text"
                  placeholder="AS.110.108"
                  defaultValue={item.countsAs?.join(', ') ?? ''}
                  onBlur={(e) => onPatch({ countsAs: splitList(e.target.value) })}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!item.writingIntensive}
                  onChange={(e) => onPatch({ writingIntensive: e.target.checked })}
                />
                Writing intensive
              </label>
            </>
          )}
          {item.code && (
            <label className="check">
              <input
                type="checkbox"
                checked={!!item.repeatable}
                onChange={(e) => onPatch({ repeatable: e.target.checked })}
              />
              Repeatable (don't warn about duplicates)
            </label>
          )}
          {templates.map((t) => (
            <label key={t.id}>
              Count toward ({t.name})
              <select value={assign[t.id]?.[item.id] ?? ''} onChange={(e) => onAssign(t.id, e.target.value)}>
                <option value="">Automatic</option>
                {t.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button className="plan-remove" onClick={onRemove}>
            Remove from plan
          </button>
        </div>
      )}
    </div>
  );
}

function TermColumn({
  term,
  credits,
  cumulative,
  flag,
  build,
  children,
}: {
  term: string;
  credits: number;
  cumulative: number;
  flag: string | null;
  build: { onClick: () => void; missing: number } | null;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: term });
  return (
    <section ref={setNodeRef} className={`plan-term${isOver ? ' over' : ''}${term === PRIOR ? ' prior' : ''}`}>
      <header className="plan-term-head">
        <h3>{term}</h3>
        <span className={`plan-term-credits${flag ? ' flagged' : ''}`} title={flag ?? undefined}>
          {credits} cr{flag ? ' ⚠' : ''}
        </span>
        <span className="plan-term-total" title="Cumulative credits through this term">
          Σ {cumulative}
        </span>
      </header>
      {flag && <div className="plan-warning credits">⚠ {flag}</div>}
      <div className="plan-term-items">{children}</div>
      {build && (
        <button
          className="plan-build"
          onClick={build.onClick}
          title={
            build.missing
              ? `${build.missing} planned course(s) are not in this term's catalog and will be skipped`
              : 'Load these courses into the weekly scheduler'
          }
        >
          Build this semester's schedule →{build.missing ? ` (${build.missing} not offered)` : ''}
        </button>
      )}
    </section>
  );
}

function Progress({ p, title }: { p: GroupProgress; title: (id: string) => string }) {
  const pct = (n: number) => `${p.need ? Math.min(100, (n / p.need) * 100) : 0}%`;
  const met = p.have >= p.need;
  return (
    <div className={`req-group${met ? ' met' : ''}`}>
      <div className="req-group-head">
        <span>
          {p.group.name}
          {p.group.todo && <span className="req-todo">TODO</span>}
        </span>
        <span className="req-count">
          {p.have}/{p.need} {p.unit}
        </span>
      </div>
      <div className="req-bar" role="progressbar" aria-valuenow={p.have} aria-valuemax={p.need} aria-label={p.group.name}>
        <div className="req-bar-have" style={{ width: pct(p.have) }} />
        <div className="req-bar-done" style={{ width: pct(p.done) }} />
      </div>
      {p.group.note && <div className="req-note">{p.group.note}</div>}
      {p.slots ? (
        <ul className="req-slots">
          {p.slots.map((s, i) => (
            <li key={i} className={s.itemIds ? 'filled' : ''}>
              {s.itemIds ? '✓' : '○'} {s.label}
              {s.itemIds && !s.itemIds.every((id) => s.label.includes(title(id))) && ` — ${s.itemIds.map(title).join(' + ')}`}
            </li>
          ))}
        </ul>
      ) : (
        p.itemIds.length > 0 && <div className="req-matched">{p.itemIds.map(title).join(', ')}</div>
      )}
    </div>
  );
}

export function Planner({
  school,
  onBuildSchedule,
  onInfo,
}: {
  school: string;
  // load catalog courses into the weekly scheduler for an imported term
  onBuildSchedule: (catalogTerm: string, codes: string[]) => void;
  onInfo: (code: string) => void;
}) {
  const [plan, setPlan] = useState<Plan>(() => loadPlan(school));
  const [data, setData] = useState<PlannerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'add' | 'reqs'>('add');
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState('');
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchPlannerData(school).then(setData, (e) => setError(e.message));
  }, [school]);
  useEffect(() => savePlan(school, plan), [school, plan]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );

  const index = useMemo(() => new Map((data?.courses ?? []).map((c) => [c.code, c])), [data]);
  const imported = useMemo(() => data?.terms ?? [], [data]);
  const seq = useMemo(() => termSequence(plan), [plan]);
  const warnings = useMemo(() => planWarnings(plan, index, imported), [plan, index, imported]);
  const targetTerm = seq.includes(target) ? target : seq[1] ?? PRIOR;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || !data) return [];
    return data.courses.filter((c) => c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q));
  }, [data, query]);

  const setTermItems = (p: Plan, term: string, items: PlanItem[]): Plan => ({
    ...p,
    terms: { ...p.terms, [term]: items },
  });
  const addItem = (term: string, item: Omit<PlanItem, 'id' | 'status'>) =>
    setPlan((p) => setTermItems(p, term, [...(p.terms[term] ?? []), { ...item, id: newId(), status: 'planned' }]));
  const addCourse = (term: string, code: string) => {
    const c = index.get(code);
    if (c) addItem(term, { code, title: c.title, credits: parseFloat(c.credits) || 0 });
  };
  const patchItem = (term: string, id: string, patch: Partial<PlanItem>) =>
    setPlan((p) => setTermItems(p, term, p.terms[term].map((it) => (it.id === id ? { ...it, ...patch } : it))));
  const moveItem = (id: string, to: string) =>
    setPlan((p) => {
      const from = Object.keys(p.terms).find((t) => p.terms[t].some((it) => it.id === id));
      if (!from || from === to) return p;
      const item = p.terms[from].find((it) => it.id === id)!;
      const without = setTermItems(p, from, p.terms[from].filter((it) => it.id !== id));
      return setTermItems(without, to, [...(without.terms[to] ?? []), item]);
    });
  const removeItem = (term: string, id: string) =>
    setPlan((p) => setTermItems(p, term, p.terms[term].filter((it) => it.id !== id)));
  const assignItem = (templateId: string, itemId: string, groupId: string) =>
    setPlan((p) => {
      const forTemplate = { ...p.assign[templateId] };
      if (groupId) forTemplate[itemId] = groupId;
      else delete forTemplate[itemId];
      return { ...p, assign: { ...p.assign, [templateId]: forTemplate } };
    });

  const onDragStart = (e: DragStartEvent) => setDrag(e.active.data.current as Drag);
  const onDragEnd = (e: DragEndEvent) => {
    const d = e.active.data.current as Drag;
    setDrag(null);
    if (!e.over) return;
    const term = String(e.over.id);
    if (d.kind === 'item') moveItem(d.id, term);
    else addCourse(term, d.code);
  };

  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `plan-${school}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const next = parsePlanFile(await file.text());
      const count = Object.values(plan.terms).flat().length;
      if (count && !window.confirm(`Replace your current plan (${count} courses) with "${file.name}"?`)) return;
      setPlan(next);
    } catch (err) {
      window.alert(`Could not import: ${(err as Error).message}`);
    }
  };

  // custom entry form
  const [custom, setCustom] = useState({ title: '', credits: '3', tags: '', countsAs: '', wi: false });
  const addCustom = () => {
    if (!custom.title.trim()) return;
    addItem(targetTerm, {
      title: custom.title.trim(),
      credits: Math.max(0, +custom.credits || 0),
      tags: splitList(custom.tags),
      countsAs: splitList(custom.countsAs),
      writingIntensive: custom.wi,
    });
    setCustom({ ...custom, title: '' });
  };

  const activeTemplates = (data?.templates ?? []).filter((t) => plan.templates.includes(t.id));
  const items = useMemo(() => reqItems(plan, index), [plan, index]);
  const titleOf = (id: string) => {
    const it = Object.values(plan.terms).flat().find((x) => x.id === id);
    return it?.code ?? it?.title ?? '';
  };
  const totalCredits = Object.values(plan.terms).reduce((n, its) => n + termCredits(its), 0);
  const doneCredits = Object.values(plan.terms)
    .flat()
    .reduce((n, it) => n + (it.status === 'completed' ? it.credits : 0), 0);

  let cumulative = 0;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDrag(null)}>
      <div className="main planner">
        <aside className="sidebar plan-sidebar">
          <div className="tabs">
            <button className={tab === 'add' ? 'active' : ''} onClick={() => setTab('add')}>
              Add courses
            </button>
            <button className={tab === 'reqs' ? 'active' : ''} onClick={() => setTab('reqs')}>
              Requirements
            </button>
          </div>

          {tab === 'add' && (
            <div className="search-pane">
              <label className="plan-target">
                Add to
                <select value={targetTerm} onChange={(e) => setTarget(e.target.value)}>
                  {seq.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <input
                className="search-input"
                placeholder="Search all imported terms by code or title…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <details className="plan-custom">
                <summary>Custom entry (elective placeholder, AP/transfer credit, study abroad…)</summary>
                <input
                  type="text"
                  placeholder="Name, e.g. Humanities elective"
                  value={custom.title}
                  onChange={(e) => setCustom({ ...custom, title: e.target.value })}
                />
                <div className="plan-custom-row">
                  <label>
                    Credits
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={custom.credits}
                      onChange={(e) => setCustom({ ...custom, credits: e.target.value })}
                    />
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={custom.wi} onChange={(e) => setCustom({ ...custom, wi: e.target.checked })} />
                    Writing intensive
                  </label>
                </div>
                <input
                  type="text"
                  placeholder="Area tags (optional): H, S, FA3"
                  value={custom.tags}
                  onChange={(e) => setCustom({ ...custom, tags: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Counts as course codes (optional): AS.110.108"
                  value={custom.countsAs}
                  onChange={(e) => setCustom({ ...custom, countsAs: e.target.value })}
                />
                <button className="btn-add" onClick={addCustom} disabled={!custom.title.trim()}>
                  + Add to {targetTerm}
                </button>
              </details>
              {error && <div className="load-error">{error}</div>}
              <div className="result-count">
                {!data
                  ? 'Loading catalogs…'
                  : query.trim().length < 2
                    ? `${data.courses.length} courses across ${imported.length} imported term${imported.length === 1 ? '' : 's'} — type to search`
                    : `${results.length} course${results.length === 1 ? '' : 's'}`}
              </div>
              <div className="results">
                {results.slice(0, 40).map((c) => (
                  <SearchResult
                    key={c.code}
                    course={c}
                    pattern={offeringLabel(offeringPattern(c.terms, imported))}
                    onAdd={() => addCourse(targetTerm, c.code)}
                    onInfo={() => onInfo(c.code)}
                  />
                ))}
                {results.length > 40 && <div className="more">Showing 40 of {results.length} — refine your search</div>}
              </div>
            </div>
          )}

          {tab === 'reqs' && (
            <div className="search-pane req-pane">
              {data && !data.templates.length && (
                <div className="empty">
                  No requirement templates for this school yet. Add a JSON file to server/data/requirements/ (see the README).
                </div>
              )}
              {data?.templates.map((t) => (
                <label key={t.id} className="check">
                  <input
                    type="checkbox"
                    checked={plan.templates.includes(t.id)}
                    onChange={(e) =>
                      setPlan((p) => ({
                        ...p,
                        templates: e.target.checked ? [...p.templates, t.id] : p.templates.filter((id) => id !== t.id),
                      }))
                    }
                  />
                  {t.name}
                </label>
              ))}
              <div className="results">
                {activeTemplates.map((t) => (
                  <div key={t.id} className="req-template">
                    <h3>{t.name}</h3>
                    <div className="req-note">
                      {t.note}{' '}
                      <a href={t.source} target="_blank" rel="noreferrer">
                        Source
                      </a>
                    </div>
                    {t.totalCredits != null && (
                      <Progress
                        title={titleOf}
                        p={{
                          group: { id: 'total', name: 'Total credits' },
                          unit: 'credits',
                          need: t.totalCredits,
                          have: totalCredits,
                          done: doneCredits,
                          itemIds: [],
                        }}
                      />
                    )}
                    {matchRequirements(t, items, plan.assign[t.id]).map((p) => (
                      <Progress key={p.group.id} p={p} title={titleOf} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        <div className="content plan-content">
          <div className="genbar plan-toolbar">
            <div className="gen-controls">
              <label>
                First term
                <select
                  value={plan.firstSeason}
                  onChange={(e) => setPlan({ ...plan, firstSeason: e.target.value as Plan['firstSeason'] })}
                >
                  <option>Fall</option>
                  <option>Spring</option>
                </select>
                <input
                  type="number"
                  className="plan-num"
                  aria-label="First year"
                  min={2000}
                  max={2100}
                  value={plan.firstYear}
                  onChange={(e) => setPlan({ ...plan, firstYear: +e.target.value || plan.firstYear })}
                />
              </label>
              <label>
                Semesters
                <input
                  type="number"
                  className="plan-num"
                  min={1}
                  max={16}
                  value={plan.numTerms}
                  onChange={(e) => setPlan({ ...plan, numTerms: Math.min(16, Math.max(1, +e.target.value || 1)) })}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={plan.showSummer}
                  onChange={(e) => setPlan({ ...plan, showSummer: e.target.checked })}
                />
                Summer
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={plan.showIntersession}
                  onChange={(e) => setPlan({ ...plan, showIntersession: e.target.checked })}
                />
                Intersession
              </label>
              <label>
                Warn under
                <input
                  type="number"
                  className="plan-num"
                  min={0}
                  value={plan.minCredits}
                  onChange={(e) => setPlan({ ...plan, minCredits: +e.target.value || 0 })}
                />
                over
                <input
                  type="number"
                  className="plan-num"
                  min={0}
                  value={plan.maxCredits}
                  onChange={(e) => setPlan({ ...plan, maxCredits: +e.target.value || 0 })}
                />
                cr
              </label>
              <div className="gen-buttons">
                <button onClick={exportJson}>Export JSON</button>
                <button onClick={() => fileInput.current?.click()}>Import JSON</button>
                <button onClick={() => window.print()}>Print / PDF</button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={(e) => {
                    importJson(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
          </div>

          <div className="plan-print-title">
            4-Year Plan — {totalCredits} credits planned ({doneCredits} completed)
          </div>

          <div className="plan-grid">
            {seq.map((term) => {
              const termItems = plan.terms[term] ?? [];
              const credits = termCredits(termItems);
              cumulative += credits;
              const season = termSeason(term);
              const regular = season === 'Fall' || season === 'Spring';
              const flag = !regular
                ? null
                : credits > plan.maxCredits
                  ? `Over ${plan.maxCredits} credits`
                  : termItems.length && credits < plan.minCredits
                    ? `Under ${plan.minCredits} credits`
                    : null;
              const cat = catalogTerm(term, imported);
              const codes = termItems.flatMap((it) => (it.code ? [it.code] : []));
              const offered = codes.filter((c) => index.get(c)?.terms.includes(cat ?? ''));
              return (
                <TermColumn
                  key={term}
                  term={term}
                  credits={credits}
                  cumulative={cumulative}
                  flag={flag}
                  build={
                    cat && codes.length
                      ? { onClick: () => onBuildSchedule(cat, offered), missing: codes.length - offered.length }
                      : null
                  }
                >
                  {termItems.map((it) => (
                    <PlanCard
                      key={it.id}
                      item={it}
                      term={term}
                      terms={seq}
                      warnings={warnings.get(it.id) ?? []}
                      templates={activeTemplates}
                      assign={plan.assign}
                      open={openCard === it.id}
                      onToggle={() => setOpenCard(openCard === it.id ? null : it.id)}
                      onPatch={(patch) => patchItem(term, it.id, patch)}
                      onMove={(to) => moveItem(it.id, to)}
                      onRemove={() => removeItem(term, it.id)}
                      onAssign={(templateId, groupId) => assignItem(templateId, it.id, groupId)}
                      onInfo={() => it.code && onInfo(it.code)}
                    />
                  ))}
                  {!termItems.length && <div className="plan-empty">Drop courses here</div>}
                </TermColumn>
              );
            })}
          </div>
        </div>
      </div>
      <DragOverlay dropAnimation={null}>{drag && <div className="drag-overlay c0">{drag.label}</div>}</DragOverlay>
    </DndContext>
  );
}
