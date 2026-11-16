import { useMemo, useState } from 'react';
import type { IndexCourse, ReqMatch } from '../types';
import { matchingCourses } from '../autoplan';
import { offeringLabel, offeringPattern } from '../plan';

// Dialog for a placeholder card ("Course tagged FA3 or FA4"): the catalog
// courses that can fill it. Choosing one replaces the placeholder.
export function SlotOptions({
  label,
  match,
  source,
  index,
  imported,
  taken,
  onPick,
  onInfo,
  onClose,
}: {
  label: string;
  match: ReqMatch | null; // null: anything fits, or the catalog doesn't say
  source: string;
  index: Map<string, IndexCourse>;
  imported: string[];
  taken: Set<string>; // already in the plan
  onPick: (code: string) => void;
  onInfo: (code: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const all = useMemo(
    () => (match ? matchingCourses(match, index).filter((c) => !taken.has(c.code)) : []),
    [match, index, taken]
  );
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((c) => c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q)) : all;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ics-modal slot-modal" role="dialog" aria-label={`Courses for ${label}`} onClick={(e) => e.stopPropagation()}>
        <h2>{label}</h2>
        {match ? (
          <>
            <p className="cd-parsed">
              {all.length} course{all.length === 1 ? '' : 's'} in the imported terms fit this slot and aren’t in your plan
              yet. Choosing one replaces the placeholder. Unofficial — check the{' '}
              <a href={source} target="_blank" rel="noreferrer">
                catalog
              </a>
              .
            </p>
            <input
              type="search"
              autoFocus
              placeholder="Filter by code or title…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="slot-list">
              {shown.slice(0, 60).map((c) => (
                <div key={c.code} className="course-card">
                  <div className="cc-head" onClick={() => onInfo(c.code)} title="Click for details">
                    <div className="cc-titles">
                      <span className="cc-code">{c.code}</span>
                      <span className="cc-title">{c.title}</span>
                      <span className="plan-pattern">{offeringLabel(offeringPattern(c.terms, imported))}</span>
                    </div>
                    <span className="cc-credits">{parseFloat(c.credits) || 0} cr</span>
                    <button
                      className="btn-add"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPick(c.code);
                      }}
                    >
                      Choose
                    </button>
                  </div>
                </div>
              ))}
              {shown.length > 60 && <div className="more">Showing 60 of {shown.length} — type to narrow</div>}
              {!shown.length && <div className="more">No matching courses.</div>}
            </div>
          </>
        ) : (
          <p className="cd-parsed">
            The catalog doesn’t tie this slot to specific courses — any course your program accepts here counts. See the{' '}
            <a href={source} target="_blank" rel="noreferrer">
              program page
            </a>
            , then add the course from the search on the left and remove this placeholder.
          </p>
        )}
        <div className="ics-actions">
          <button className="ics-cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
