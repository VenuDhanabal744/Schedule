import { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragStartEvent, DragMoveEvent, DragEndEvent } from '@dnd-kit/core';
import type { Course, Constraints, Selected } from './types';
import {
  fetchTermsInfo,
  fetchCourses,
  importTerm,
  fetchRatings,
  getRating,
  setRatingsSchool,
} from './api';
import type { TermsInfo } from './api';
import { generateSchedules, scheduleProfScore } from './schedule';
import { Calendar } from './components/Calendar';
import type { DragItem } from './components/Calendar';
import { Sidebar } from './components/Sidebar';
import { GeneratorBar } from './components/GeneratorBar';

const DEFAULT_CONSTRAINTS: Constraints = {
  earliest: null,
  latest: null,
  avoidDays: [],
  onlyOpen: false,
  minGap: null,
  maxGap: null,
};

type GenState = {
  courseOrder: string[];
  schedules: number[][];
  idx: number;
  truncated: boolean;
  impossible: string[];
  best: boolean;
};

const ratingOf = (name: string) => getRating(name)?.avgRating ?? null;

const SCHOOL_OPTIONS = [
  { key: 'jhu', label: 'Johns Hopkins' },
  { key: 'temple', label: 'Temple' },
  { key: 'unc', label: 'UNC-Chapel Hill' },
];

// Approximate end of a term ("Fall 2026" -> Jan 1 2027); null if unrecognized.
const TERM_END_MONTH: Record<string, number> = {
  Intersession: 1,
  Spring: 5,
  'Summer I': 6,
  'Summer II': 8,
  Summer: 8,
  Fall: 12,
};
function termEnd(name: string): Date | null {
  const m = name.match(/^(Intersession|Spring|Summer I{1,2}|Summer|Fall)\s+(\d{4})$/);
  if (!m) return null;
  return new Date(+m[2], TERM_END_MONTH[m[1]], 1); // month index rolls Fall into next January
}
const isCurrentOrFuture = (name: string) => {
  const end = termEnd(name);
  return !end || end > new Date();
};

export default function App() {
  const [school, setSchool] = useState<string>(() => localStorage.getItem('school') ?? 'jhu');
  const [termsInfo, setTermsInfo] = useState<TermsInfo | null>(null);
  const [term, setTerm] = useState<string>('');
  const [courses, setCourses] = useState<Course[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected[]>([]);
  const [constraints, setConstraints] = useState<Constraints>(DEFAULT_CONSTRAINTS);
  const [sortBy, setSortBy] = useState<'compact' | 'professors'>('compact');
  const [gen, setGen] = useState<GenState | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [activeDrag, setActiveDrag] = useState<DragItem | null>(null);
  const [importLog, setImportLog] = useState<string[] | null>(null);
  const importing = useRef(false);

  // load terms for the active school; prefer a real imported term over the demo
  useEffect(() => {
    localStorage.setItem('school', school);
    setRatingsSchool(school);
    setTermsInfo(null);
    setTerm('');
    setCourses([]);
    setSelected([]);
    setGen(null);
    setLoadError(null);
    fetchTermsInfo(school).then((info) => {
      setTermsInfo(info);
      const saved = localStorage.getItem(`term:${school}`);
      const candidates = [...info.imported, ...(info.sampleTerm ? [info.sampleTerm] : [])];
      setTerm(
        saved && candidates.includes(saved) ? saved : info.imported[0] ?? info.sampleTerm ?? ''
      );
    });
  }, [school]);

  // load courses when term changes; restore saved selection for that term
  useEffect(() => {
    if (!term) return;
    localStorage.setItem(`term:${school}`, term);
    setCourses([]);
    setGen(null);
    setLoadError(null);
    fetchCourses(school, term)
      .then((cs) => {
        setCourses(cs);
        try {
          const raw =
            localStorage.getItem(`selected:${school}:${term}`) ??
            // selections saved before multi-school support used an unscoped key
            (school === 'jhu' ? localStorage.getItem(`selected:${term}`) : null) ??
            '[]';
          const saved = JSON.parse(raw);
          setSelected(saved.filter((s: Selected) => cs.some((c) => c.code === s.code)));
        } catch {
          setSelected([]);
        }
      })
      .catch((err) => setLoadError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  useEffect(() => {
    // don't save until this term's courses (and restored selection) have loaded,
    // otherwise the initial empty selection wipes the stored one
    if (term && courses.length) {
      localStorage.setItem(`selected:${school}:${term}`, JSON.stringify(selected));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, term, courses]);

  const courseMap = useMemo(() => new Map(courses.map((c) => [c.code, c])), [courses]);

  const colorOf = useMemo(() => {
    const order = selected.map((s) => s.code);
    return (code: string) => {
      const i = order.indexOf(code);
      return i === -1 ? 0 : i % 8;
    };
  }, [selected]);

  const addCourse = (code: string) =>
    setSelected((sel) =>
      sel.some((s) => s.code === code) ? sel : [...sel, { code, sectionIdx: null }]
    );
  const removeCourse = (code: string) => {
    setSelected((sel) => sel.filter((s) => s.code !== code));
    setGen(null);
  };
  const placeSection = (code: string, sectionIdx: number) =>
    setSelected((sel) => {
      const existing = sel.find((s) => s.code === code);
      if (existing) return sel.map((s) => (s.code === code ? { ...s, sectionIdx } : s));
      return [...sel, { code, sectionIdx }];
    });
  const toggleLock = (code: string) =>
    setSelected((sel) =>
      sel.map((s) =>
        s.code === code && s.sectionIdx != null ? { ...s, locked: !s.locked } : s
      )
    );

  const applyCombo = (g: GenState, idx: number) => {
    const combo = g.schedules[idx];
    setSelected((sel) =>
      sel.map((s) => {
        const ci = g.courseOrder.indexOf(s.code);
        return ci === -1 ? s : { ...s, sectionIdx: combo[ci] };
      })
    );
  };

  const runGenerate = async (best = false) => {
    if (genBusy) return;
    setGenBusy(true);
    const chosen = selected
      .map((s) => courseMap.get(s.code))
      .filter((c): c is Course => !!c);
    // make sure every instructor's rating is cached before scoring schedules
    const names = [...new Set(chosen.flatMap((c) => c.sections.flatMap((s) => s.instructors)))];
    try {
      await fetchRatings(names);
    } catch {
      /* score with whatever ratings we have */
    }
    setGenBusy(false);
    const lockedIdx = chosen.map((c) => {
      const entry = selected.find((s) => s.code === c.code);
      return entry?.locked && entry.sectionIdx != null ? entry.sectionIdx : null;
    });
    const result = generateSchedules(chosen, constraints, {
      ratingOf,
      sortBy: best ? 'professors' : sortBy,
      lockedIdx,
    });
    const genState: GenState = {
      courseOrder: chosen.map((c) => c.code),
      schedules: best ? result.schedules.slice(0, 1) : result.schedules,
      idx: 0,
      truncated: !best && result.truncated,
      impossible: result.impossible,
      best,
    };
    setGen(genState);
    if (genState.schedules.length) applyCombo(genState, 0);
  };

  const navGen = (delta: number) => {
    if (!gen) return;
    const idx = Math.max(0, Math.min(gen.schedules.length - 1, gen.idx + delta));
    setGen({ ...gen, idx });
    applyCombo(gen, idx);
  };

  const [hoverTarget, setHoverTarget] = useState<string | null>(null);

  // Mouse: require a little movement before a drag activates so plain clicks
  // (e.g. clicking a calendar box to lock it) aren't swallowed by the sensor.
  // Touch: require a long-press so one-finger scrolling still works; a quick
  // tap stays a click.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );

  // Drop targets (ghost slots) mount only while a drag is active, so instead of
  // dnd-kit droppables we hit-test the pointer position against the DOM.
  const hitTest = (e: { activatorEvent: Event; delta: { x: number; y: number } }): string | null => {
    const ae = e.activatorEvent as PointerEvent;
    if (typeof ae.clientX !== 'number') return null;
    const els = document.elementsFromPoint(ae.clientX + e.delta.x, ae.clientY + e.delta.y);
    for (const el of els) {
      const ghost = (el as HTMLElement).closest?.('.cal-ghost') as HTMLElement | null;
      if (ghost?.dataset.drop) return ghost.dataset.drop;
    }
    if (els.some((el) => (el as HTMLElement).closest?.('.calendar'))) return 'calendar-drop';
    return null;
  };

  const onDragStart = (e: DragStartEvent) => setActiveDrag(e.active.data.current as DragItem);
  const onDragMove = (e: DragMoveEvent) => setHoverTarget(hitTest(e));
  const onDragEnd = (e: DragEndEvent) => {
    const drag = e.active.data.current as DragItem;
    const target = hitTest(e);
    setActiveDrag(null);
    setHoverTarget(null);
    if (!target || !drag) return;
    if (drag.type === 'chip' && (target === 'calendar-drop' || target.startsWith('ghost|'))) {
      placeSection(drag.code, drag.sectionIdx);
    } else if (drag.type === 'event' && target.startsWith('ghost|')) {
      const [, code, idx] = target.split('|');
      placeSection(code, parseInt(idx, 10));
    }
  };

  const runImport = async (t: string, code: string) => {
    if (importing.current) return;
    importing.current = true;
    setImportLog([`Importing ${t}…`]);
    try {
      await importTerm(school, t, code, (line) => setImportLog((log) => [...(log ?? []), line]));
      const info = await fetchTermsInfo(school);
      setTermsInfo(info);
      if (info.imported.includes(t)) {
        setImportLog(null);
        setTerm(t);
      }
    } catch (err) {
      setImportLog((log) => [...(log ?? []), `error: ${err}`]);
    } finally {
      importing.current = false;
    }
  };

  const termOptions = useMemo(() => {
    if (!termsInfo) return [];
    // only current/future terms — but never hide the term that's selected right now
    const show = (t: string) => isCurrentOrFuture(t) || t === term;
    const opts: { value: string; code: string; label: string; imported: boolean }[] = [];
    const availableNames = termsInfo.available.map((a) => a.name);
    // imported terms that aren't in the live list (e.g. key missing) still need to show
    for (const t of termsInfo.imported) {
      if (!availableNames.includes(t) && show(t)) {
        opts.push({ value: t, code: t, label: `${t} ✓`, imported: true });
      }
    }
    // one chronological list, imported terms marked in place
    for (const a of termsInfo.available) {
      if (!show(a.name)) continue;
      const imported = termsInfo.imported.includes(a.name);
      // picking a term that isn't imported triggers an import the server would refuse
      if (!imported && !termsInfo.canImport) continue;
      opts.push({ value: a.name, code: a.code, label: imported ? `${a.name} ✓` : a.name, imported });
    }
    if (termsInfo.sampleTerm) {
      opts.push({
        value: termsInfo.sampleTerm,
        code: termsInfo.sampleTerm,
        label: `${termsInfo.sampleTerm} (built-in demo)`,
        imported: true,
      });
    }
    return opts;
  }, [termsInfo, term]);

  const onTermChoice = (value: string) => {
    const opt = termOptions.find((o) => o.value === value);
    if (!opt) return;
    if (!opt.imported) {
      runImport(opt.value, opt.code);
    } else {
      setTerm(value);
    }
  };

  const genBarState = gen
    ? {
        count: gen.schedules.length,
        idx: gen.idx,
        truncated: gen.truncated,
        impossible: gen.impossible,
        best: gen.best,
        profAvg: gen.schedules.length
          ? scheduleProfScore(
              gen.courseOrder
                .map((code) => courseMap.get(code))
                .filter((c): c is Course => !!c),
              gen.schedules[gen.idx],
              ratingOf
            )
          : null,
      }
    : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
    >
      <div className="app">
        <header className="topbar">
          <h1>Schedule</h1>
          <div className="term-picker">
            <label>School</label>
            <select value={school} onChange={(e) => setSchool(e.target.value)}>
              {SCHOOL_OPTIONS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="term-picker">
            <label>Term</label>
            <select value={term} onChange={(e) => onTermChoice(e.target.value)}>
              {term === '' && <option value="">Select a term…</option>}
              {termOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {school === 'jhu' && termsInfo && !termsInfo.hasKey && (
            <div className="key-warning">
              No SIS API key — using demo data. Add SIS_API_KEY to .env and restart.
            </div>
          )}
          <div className="topbar-credit">Created by Venu Dhanabal</div>
        </header>

        <div className="main">
          <Sidebar
            courses={courses}
            courseMap={courseMap}
            selected={selected}
            colorOf={colorOf}
            onAdd={addCourse}
            onRemove={removeCourse}
            onPlace={placeSection}
          />
          <div className="content">
            <GeneratorBar
              constraints={constraints}
              setConstraints={setConstraints}
              sortBy={sortBy}
              setSortBy={setSortBy}
              onGenerate={() => runGenerate(false)}
              onBest={() => runGenerate(true)}
              canGenerate={selected.length > 0 && !genBusy}
              busy={genBusy}
              genState={genBarState}
              onNav={navGen}
              onClearGen={() => setGen(null)}
            />
            {loadError && <div className="load-error">{loadError}</div>}
            <Calendar
              courseMap={courseMap}
              selected={selected}
              colorOf={colorOf}
              activeDrag={activeDrag}
              hoverTarget={hoverTarget}
              onToggleLock={toggleLock}
            />
          </div>
        </div>

        {importLog && (
          <div className="modal-backdrop">
            <div className="modal">
              <h2>Importing course catalog</h2>
              <pre className="import-log">{importLog.join('\n')}</pre>
              {(importLog.at(-1)?.startsWith('error') || importLog.at(-1)?.startsWith('done')) && (
                <button onClick={() => setImportLog(null)}>Close</button>
              )}
            </div>
          </div>
        )}

        <DragOverlay dropAnimation={null}>
          {activeDrag && (
            <div className={`drag-overlay c${colorOf(activeDrag.code)}`}>
              {activeDrag.code}
              {activeDrag.type === 'chip' &&
                ` §${courseMap.get(activeDrag.code)?.sections[activeDrag.sectionIdx]?.section ?? ''}`}
            </div>
          )}
        </DragOverlay>
      </div>
    </DndContext>
  );
}
