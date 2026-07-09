import { useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { Course, Selected } from '../types';
import { fmtMeetings } from '../schedule';
import { useRatings } from '../useRatings';
import { RatingBadge } from './RatingBadge';
import type { DragItem } from './Calendar';
import { LockIcon } from './LockIcon';

function SectionChip({
  course,
  sectionIdx,
  chosen,
  onPlace,
}: {
  course: Course;
  sectionIdx: number;
  chosen: boolean;
  onPlace: () => void;
}) {
  const section = course.sections[sectionIdx];
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `chip-${course.code}-${sectionIdx}`,
    data: { type: 'chip', code: course.code, sectionIdx } satisfies DragItem,
  });
  const getRating = useRatings(section.instructors);
  const closed = section.status && section.status !== 'Open';
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`section-chip${chosen ? ' chosen' : ''}${isDragging ? ' dragging' : ''}`}
      onClick={onPlace}
      title="Click or drag onto the calendar to schedule this section"
    >
      <div className="chip-row">
        <span className="chip-sec">§{section.section}</span>
        <span className="chip-time">{fmtMeetings(section.meetings)}</span>
        {closed && <span className="chip-closed">{section.status}</span>}
      </div>
      <div className="chip-row chip-meta">
        {section.instructors.length ? (
          section.instructors.map((name) => (
            <span key={name} className="chip-inst">
              {name} <RatingBadge rating={getRating(name)} />
            </span>
          ))
        ) : (
          <span className="chip-inst">Instructor TBA</span>
        )}
      </div>
    </div>
  );
}

function CourseCard({
  course,
  selectedEntry,
  colorIdx,
  onAdd,
  onRemove,
  onPlace,
  startOpen,
}: {
  course: Course;
  selectedEntry: Selected | undefined;
  colorIdx: number | null;
  onAdd?: () => void;
  onRemove?: () => void;
  onPlace: (sectionIdx: number) => void;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!startOpen);
  return (
    <div className={`course-card${selectedEntry ? ' selected' : ''}`}>
      <div className="cc-head" onClick={() => setOpen(!open)}>
        {colorIdx != null && <span className={`dot c${colorIdx}`} />}
        <div className="cc-titles">
          <span className="cc-code">
            {selectedEntry?.locked && (
              <span title="Section locked on the calendar">
                <LockIcon />{' '}
              </span>
            )}
            {course.code}
          </span>
          <span className="cc-title">{course.title}</span>
        </div>
        <span className="cc-credits">{parseFloat(course.credits) || 0} cr</span>
        {onAdd && (
          <button className="btn-add" onClick={(e) => { e.stopPropagation(); onAdd(); }}>
            + Add
          </button>
        )}
        {onRemove && (
          <button className="btn-remove" title="Remove course" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
            ×
          </button>
        )}
      </div>
      {open && (
        <div className="cc-body">
          <div className="cc-dept">{course.department}{course.writingIntensive ? ' · Writing intensive' : ''}</div>
          {course.sections.map((_, i) => (
            <SectionChip
              key={i}
              course={course}
              sectionIdx={i}
              chosen={selectedEntry?.sectionIdx === i}
              onPlace={() => onPlace(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  courses,
  courseMap,
  selected,
  colorOf,
  onAdd,
  onRemove,
  onPlace,
}: {
  courses: Course[];
  courseMap: Map<string, Course>;
  selected: Selected[];
  colorOf: (code: string) => number;
  onAdd: (code: string) => void;
  onRemove: (code: string) => void;
  onPlace: (code: string, sectionIdx: number) => void;
}) {
  const [tab, setTab] = useState<'search' | 'mine'>('search');
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('');
  const [level, setLevel] = useState('');
  const [openOnly, setOpenOnly] = useState(false);

  const departments = useMemo(
    () => [...new Set(courses.map((c) => c.department).filter(Boolean))].sort(),
    [courses]
  );
  const levels = useMemo(
    () => [...new Set(courses.map((c) => c.level).filter(Boolean))].sort(),
    [courses]
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return courses.filter((c) => {
      if (dept && c.department !== dept) return false;
      if (level && c.level !== level) return false;
      if (openOnly && !c.sections.some((s) => !s.status || s.status === 'Open')) return false;
      if (!q) return true;
      return (
        c.code.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        c.sections.some((s) => s.instructors.some((i) => i.toLowerCase().includes(q)))
      );
    });
  }, [courses, query, dept, level, openOnly]);

  const totalCredits = selected.reduce(
    (sum, s) => sum + (parseFloat(courseMap.get(s.code)?.credits ?? '0') || 0),
    0
  );

  return (
    <aside className="sidebar">
      <div className="tabs">
        <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>
          Search
        </button>
        <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>
          My Courses ({selected.length})
        </button>
      </div>

      {tab === 'search' && (
        <div className="search-pane">
          <input
            className="search-input"
            placeholder="Search by code, title, or professor…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="filters">
            <select value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">All levels</option>
              {levels.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            <label className="check">
              <input
                type="checkbox"
                checked={openOnly}
                onChange={(e) => setOpenOnly(e.target.checked)}
              />
              Open sections only
            </label>
          </div>
          <div className="result-count">
            {results.length} course{results.length === 1 ? '' : 's'}
          </div>
          <div className="results">
            {results.slice(0, 50).map((c) => {
              const entry = selected.find((s) => s.code === c.code);
              return (
                <CourseCard
                  key={c.code}
                  course={c}
                  selectedEntry={entry}
                  colorIdx={entry ? colorOf(c.code) : null}
                  onAdd={entry ? undefined : () => onAdd(c.code)}
                  onPlace={(i) => onPlace(c.code, i)}
                />
              );
            })}
            {results.length > 50 && <div className="more">Showing 50 of {results.length} — refine your search</div>}
          </div>
        </div>
      )}

      {tab === 'mine' && (
        <div className="mine-pane">
          <div className="credits-line">
            Total: <strong>{totalCredits}</strong> credits
          </div>
          <div className="results">
            {selected.length === 0 && (
              <div className="empty">No courses yet. Find them in the Search tab.</div>
            )}
            {selected.map((s) => {
              const c = courseMap.get(s.code);
              if (!c) return null;
              return (
                <CourseCard
                  key={s.code}
                  course={c}
                  selectedEntry={s}
                  colorIdx={colorOf(s.code)}
                  onRemove={() => onRemove(s.code)}
                  onPlace={(i) => onPlace(s.code, i)}
                  startOpen
                />
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
