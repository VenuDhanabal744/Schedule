import type { Constraints } from '../types';
import { fmtTime } from '../schedule';

const MORNING_OPTIONS = [8, 9, 10, 11, 12].map((h) => h * 60);
const EVENING_OPTIONS = [15, 16, 17, 18, 19, 20, 21].map((h) => h * 60);
const DAYS = ['M', 'T', 'W', 'Th', 'F'];
const MIN_GAP_OPTIONS = [10, 15, 30, 45, 60];
const MAX_GAP_OPTIONS = [15, 30, 60, 120, 180, 240];

const fmtGap = (m: number) => (m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60} hr` : `${Math.floor(m / 60)}h${m % 60}`);

export type GenBarState = {
  count: number;
  idx: number;
  truncated: boolean;
  impossible: string[];
  best: boolean;
  profAvg: number | null;
};

export function GeneratorBar({
  constraints,
  setConstraints,
  sortBy,
  setSortBy,
  onGenerate,
  onBest,
  canGenerate,
  busy,
  genState,
  onNav,
  onClearGen,
}: {
  constraints: Constraints;
  setConstraints: (c: Constraints) => void;
  sortBy: 'compact' | 'professors';
  setSortBy: (s: 'compact' | 'professors') => void;
  onGenerate: () => void;
  onBest: () => void;
  canGenerate: boolean;
  busy?: boolean;
  genState: GenBarState | null;
  onNav: (delta: number) => void;
  onClearGen: () => void;
}) {
  const set = (patch: Partial<Constraints>) => setConstraints({ ...constraints, ...patch });

  return (
    <div className="genbar">
      <div className="gen-controls">
        <label>
          No classes before
          <select
            value={constraints.earliest ?? ''}
            onChange={(e) => set({ earliest: e.target.value ? +e.target.value : null })}
          >
            <option value="">—</option>
            {MORNING_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {fmtTime(t)}
              </option>
            ))}
          </select>
        </label>
        <label>
          No classes after
          <select
            value={constraints.latest ?? ''}
            onChange={(e) => set({ latest: e.target.value ? +e.target.value : null })}
          >
            <option value="">—</option>
            {EVENING_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {fmtTime(t)}
              </option>
            ))}
          </select>
        </label>
        <label title="Break between back-to-back classes on the same day">
          Break between classes
          <select
            value={constraints.minGap ?? ''}
            onChange={(e) => set({ minGap: e.target.value ? +e.target.value : null })}
          >
            <option value="">any</option>
            {MIN_GAP_OPTIONS.map((m) => (
              <option key={m} value={m}>
                ≥ {fmtGap(m)}
              </option>
            ))}
          </select>
          <select
            value={constraints.maxGap ?? ''}
            onChange={(e) => set({ maxGap: e.target.value ? +e.target.value : null })}
          >
            <option value="">any</option>
            {MAX_GAP_OPTIONS.map((m) => (
              <option key={m} value={m}>
                ≤ {fmtGap(m)}
              </option>
            ))}
          </select>
        </label>
        <div className="day-toggles">
          <span>Free days:</span>
          {DAYS.map((d) => (
            <button
              key={d}
              className={`day-toggle${constraints.avoidDays.includes(d) ? ' on' : ''}`}
              title={`Keep ${d} class-free`}
              onClick={() =>
                set({
                  avoidDays: constraints.avoidDays.includes(d)
                    ? constraints.avoidDays.filter((x) => x !== d)
                    : [...constraints.avoidDays, d],
                })
              }
            >
              {d}
            </button>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={constraints.onlyOpen}
            onChange={(e) => set({ onlyOpen: e.target.checked })}
          />
          Open sections only
        </label>
        <label>
          Prioritize
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'compact' | 'professors')}
          >
            <option value="compact">Most compact</option>
            <option value="professors">Best professors</option>
          </select>
        </label>
        <div className="gen-buttons">
          <button className="btn-generate" onClick={onGenerate} disabled={!canGenerate}>
            {busy ? 'Looking up ratings…' : 'Generate schedules'}
          </button>
          <button
            className="btn-best"
            onClick={onBest}
            disabled={!canGenerate}
            title="Apply the single schedule that fits all parameters with the best-rated professors"
          >
            Best schedule
          </button>
        </div>
      </div>

      {genState && (
        <div className="gen-results">
          {genState.impossible.length > 0 ? (
            <span className="gen-error">
              No schedule possible: {genState.impossible.join(', ')} ha
              {genState.impossible.length === 1 ? 's' : 've'} no section matching your
              constraints
            </span>
          ) : genState.count === 0 && genState.truncated ? (
            <span className="gen-error">
              Stopped searching before finding a schedule — try loosening the break limits
              or locking a class
            </span>
          ) : genState.count === 0 ? (
            <span className="gen-error">
              No conflict-free combination exists with these constraints
            </span>
          ) : genState.best ? (
            <span className="gen-count">
              Best schedule applied
              {genState.profAvg != null && (
                <span className="gen-prof"> · professors avg ★ {genState.profAvg.toFixed(1)}</span>
              )}
            </span>
          ) : (
            <>
              <button onClick={() => onNav(-1)} disabled={genState.idx <= 0}>
                ‹
              </button>
              <span className="gen-count">
                Schedule {genState.idx + 1} of {genState.count}
                {genState.truncated ? '+' : ''}
                {genState.profAvg != null && (
                  <span className="gen-prof"> · professors avg ★ {genState.profAvg.toFixed(1)}</span>
                )}
              </span>
              <button onClick={() => onNav(1)} disabled={genState.idx >= genState.count - 1}>
                ›
              </button>
            </>
          )}
          <button className="gen-close" title="Clear generated schedules" onClick={onClearGen}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
