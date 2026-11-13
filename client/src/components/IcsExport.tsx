import { useState } from 'react';
import { buildIcs } from '../ics';
import type { IcsEntry } from '../ics';
import { saveTermDates, termDates } from '../termDates';

// Dialog for "Export to calendar": confirms the term's first and last day of
// classes (editable, remembered per term), then downloads an .ics file.
export function IcsExport({
  school,
  term,
  entries,
  onClose,
}: {
  school: string;
  term: string;
  entries: IcsEntry[];
  onClose: () => void;
}) {
  const known = termDates(school, term);
  const [start, setStart] = useState(known?.start ?? '');
  const [end, setEnd] = useState(known?.end ?? '');
  const timed = entries.filter((e) => e.section.meetings.length);
  const valid = !!start && !!end && start <= end;

  const download = () => {
    saveTermDates(school, term, start, end);
    const url = URL.createObjectURL(new Blob([buildIcs(timed, start, end)], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule-${school}-${term.replace(/\s+/g, '-')}.ics`;
    a.click();
    URL.revokeObjectURL(url);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ics-modal" role="dialog" aria-label="Export to calendar" onClick={(e) => e.stopPropagation()}>
        <h2>Export {term} to calendar</h2>
        <p className="cd-parsed">
          {timed.length} class{timed.length === 1 ? '' : 'es'} as weekly events
          {timed.length < entries.length && ` (${entries.length - timed.length} without meeting times skipped)`}. Holidays
          and breaks are not removed.
        </p>
        {!known && (
          <div className="plan-warning credits">
            TODO: no class dates on file for {term} — enter the first and last day of classes from the academic calendar.
          </div>
        )}
        {known && (
          <p className="cd-parsed">
            {known.saved ? 'Dates you entered earlier.' : `Dates from ${known.source}`} Check them against the academic
            calendar; edits are remembered.
          </p>
        )}
        <div className="ics-dates">
          <label>
            First day of classes
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            Last day of classes
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <div className="ics-actions">
          <button className="ics-cancel" onClick={onClose}>
            Cancel
          </button>
          <button onClick={download} disabled={!valid || !timed.length}>
            Download .ics
          </button>
        </div>
      </div>
    </div>
  );
}
