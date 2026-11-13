import { useEffect, useState } from 'react';
import type { Course, CourseInfo, RawReq } from '../types';
import { fetchCourseInfo } from '../api';
import { fmtMeetings } from '../schedule';
import { parseRawReqs, fmtReq } from '../prereqs';
import { offeringLabel, offeringPattern } from '../plan';
import { areaTags } from '../requirements';
import { useRatings } from '../useRatings';
import { RatingBadge } from './RatingBadge';

function Sections({ course }: { course: Course }) {
  const getRating = useRatings(course.sections.flatMap((s) => s.instructors));
  return (
    <div className="cd-sections">
      {course.sections.map((s) => (
        <div key={s.section} className="cd-section">
          <span className="chip-sec">§{s.section}</span>
          <span className="chip-time">{fmtMeetings(s.meetings)}</span>
          {s.status && s.status !== 'Open' && <span className="chip-closed">{s.status}</span>}
          <span className="chip-inst">
            {s.instructors.length
              ? s.instructors.map((name) => (
                  <span key={name}>
                    {name} <RatingBadge rating={getRating(name)} />{' '}
                  </span>
                ))
              : 'Instructor TBA'}
          </span>
        </div>
      ))}
    </div>
  );
}

function Reqs({ title, raw, parse }: { title: string; raw: RawReq[]; parse?: boolean }) {
  const parsed = parse ? parseRawReqs(raw) : [];
  return (
    <div className="cd-block">
      <h3>{title}</h3>
      {raw.map((r, i) => (
        <p key={i} className="cd-raw">
          {r.negative && <strong>Not with: </strong>}
          {r.text || r.expr}
        </p>
      ))}
      {parse && (
        <p className="cd-parsed">
          {parsed.length
            ? `Checked by the planner: ${parsed
                .map((p) => fmtReq(p.tree, parsed.length > 1) + (p.concurrent ? ' (may be concurrent)' : ''))
                .join(' and ')}`
            : 'Could not be read into a checkable rule — the planner will not warn about this course.'}
        </p>
      )}
    </div>
  );
}

// Everything known about one course. Shared by the scheduler and the planner.
// `fallback` covers entries the server doesn't know (custom planner items).
export function CourseDetail({
  school,
  code,
  fallback,
  onClose,
}: {
  school: string;
  code: string;
  fallback?: { title: string; credits: number };
  onClose: () => void;
}) {
  const [info, setInfo] = useState<CourseInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetchCourseInfo(school, code).then(
      (i) => live && setInfo(i),
      (e) => live && setError(e.message)
    );
    return () => {
      live = false;
    };
  }, [school, code]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const course = info?.offerings[0]?.course;
  const d = info?.detail;
  const pattern = info && offeringLabel(offeringPattern(info.offerings.map((o) => o.term), info.importedTerms));
  const tags = course ? areaTags(course.areas) : [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal course-detail" role="dialog" aria-label={`${code} details`} onClick={(e) => e.stopPropagation()}>
        <div className="cd-head">
          <div>
            <div className="cd-code">{code}</div>
            <h2>{course?.title ?? fallback?.title ?? ''}</h2>
          </div>
          <button className="btn-remove" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="cd-body">
          {error && <div className="load-error">{error}</div>}
          {!info && !error && <div className="empty">Loading…</div>}
          {info && (
            <>
              <div className="cd-facts">
                <span>{course ? course.credits : fallback?.credits} credits</span>
                {course?.department && <span>{course.department}</span>}
                {course?.level && <span>{course.level}</span>}
                {tags.length > 0 && <span>Areas: {tags.join(', ')}</span>}
                {course?.writingIntensive && <span>Writing intensive</span>}
                {d?.repeatable && <span>Repeatable</span>}
                {pattern && (
                  <span title={`Based on ${info.importedTerms.length} imported terms — a hint, not a guarantee`}>
                    {pattern} ({info.importedTerms.length} terms of data)
                  </span>
                )}
              </div>
              {d?.description && <p className="cd-desc">{d.description}</p>}
              {!d && course && <p className="cd-parsed">No description or prerequisite data for this course.</p>}
              {d?.prereqs && <Reqs title="Prerequisites" raw={d.prereqs} parse />}
              {d?.coreqs && <Reqs title="Corequisites / concurrent rules" raw={d.coreqs} />}
              {d?.restrictions && (
                <div className="cd-block">
                  <h3>Restricted to</h3>
                  <p className="cd-raw">{d.restrictions.join(' · ')}</p>
                </div>
              )}
              {info.offerings.map((o) => (
                <div key={o.term} className="cd-block">
                  <h3>
                    {o.term} — {o.course.sections.length} section{o.course.sections.length === 1 ? '' : 's'}
                  </h3>
                  <Sections course={o.course} />
                </div>
              ))}
              {!info.offerings.length && (
                <p className="cd-parsed">Not in any imported catalog (custom entry or not offered in the imported terms).</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
