import { useMemo, useState } from 'react';
import type { IndexCourse } from '../types';
import { fetchRequirementTemplate } from '../api';
import { autoPlan, rankFocusAreas, semesters } from '../autoplan';
import { planWarnings, termCredits } from '../plan';
import type { Plan } from '../plan';
import type { SamplePlan } from '../samplePlans';

// Dialog for "Auto-plan": lays the catalog's sample program out over the
// semesters up to a graduation term, under a credit cap.
export function AutoPlan({
  school,
  plan,
  sample,
  index,
  imported,
  onApply,
  onClose,
}: {
  school: string;
  plan: Plan;
  sample: SamplePlan;
  index: Map<string, IndexCourse>;
  imported: string[];
  onApply: (plan: Plan) => void;
  onClose: () => void;
}) {
  const options = semesters(plan, 12);
  const last = plan.autoPlan; // settings of the previous run
  const [count, setCount] = useState(last?.semesterCount ?? Math.min(12, Math.max(8, plan.numTerms)));
  const [max, setMax] = useState(plan.maxCredits || 18);
  const [premed, setPremed] = useState(last?.premed ?? false);
  const [focus, setFocus] = useState<string | null>(
    sample.focusAreas.find((f) => f.name === last?.focusName)?.tag ?? null // null: not chosen by hand
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string[] | null>(null);

  const ranked = useMemo(() => rankFocusAreas(sample.focusAreas, index), [sample, index]);
  const best = ranked[0]?.science ? ranked[0] : undefined;
  // pre-med picks the top-ranked area unless the student chose one
  const chosen = focus ?? (premed ? best?.tag ?? '' : '');
  const hasAuto = Object.values(plan.terms).some((items) => items.some((it) => it.auto));

  const generate = async () => {
    setBusy(true);
    // without the template the plan is still built; it just can't tell which
    // of your own courses already fill an elective slot
    const template = await fetchRequirementTemplate(school, sample.templateId).catch(() => undefined);
    const { plan: next, unplaced, skipped } = autoPlan({
      plan,
      sample,
      premed,
      semesterCount: count,
      maxCredits: max,
      index,
      imported,
      template,
      focusName: ranked.find((r) => r.tag === chosen)?.name,
    });
    onApply(next);
    const placed = Object.values(next.terms).flat().filter((it) => it.auto);
    const flagged = [...planWarnings(next, index, imported).keys()].filter((id) => placed.some((it) => it.id === id));
    setResult([
      `Added ${placed.length} courses (${termCredits(placed)} credits) through ${options[count - 1]}.`,
      ...(unplaced.length
        ? [
            `${unplaced.length} did not fit under ${max} credits (${unplaced.reduce((n, e) => n + e.credits, 0)} cr): ${unplaced
              .map((e) => e.codes?.[0] ?? e.label)
              .join(', ')}. Raise the cap or graduate later.`,
          ]
        : []),
      ...(skipped.length
        ? [
            `Left out ${skipped.join(', ')}: courses you already have come after ${
              skipped.length === 1 ? 'it' : 'them'
            } or rule ${skipped.length === 1 ? 'it' : 'them'} out. If the Requirements tab still lists one, add your exam credit under Prior credit.`,
          ]
        : []),
      ...(flagged.length ? [`⚠ ${flagged.length} of them show${flagged.length === 1 ? 's' : ''} a prerequisite or offering warning to review.`] : []),
      ...(premed
        ? ['The pre-med checklist is on the Requirements tab: it shows what the catalog’s sample leaves open (biology, writing, social sciences).']
        : []),
    ]);
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ics-modal auto-modal" role="dialog" aria-label="Auto-plan" onClick={(e) => e.stopPropagation()}>
        <h2>Auto-plan: {sample.name}</h2>
        <p className="cd-parsed">
          Follows the order of the{' '}
          <a href={sample.source} target="_blank" rel="noreferrer">
            catalog’s sample program
          </a>
          . Keeps the courses you added, skips what they already cover, and replaces anything an earlier auto-plan
          placed. Unofficial — check it with your advisor.
        </p>
        {result ? (
          <>
            {result.map((line) => (
              <p key={line}>{line}</p>
            ))}
            <div className="ics-actions">
              <button className="ics-cancel" onClick={() => setResult(null)}>
                Change settings
              </button>
              <button onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div className="ics-dates">
              <label>
                Graduate after
                <select value={count} onChange={(e) => setCount(+e.target.value)}>
                  {options.map((t, i) =>
                    i < 3 ? null : (
                      <option key={t} value={i + 1}>
                        {t} ({i + 1} semesters)
                      </option>
                    )
                  )}
                </select>
              </label>
              <label>
                Max credits per semester
                <input type="number" min={6} max={30} value={max} onChange={(e) => setMax(+e.target.value || 0)} />
              </label>
            </div>
            <label className="auto-check">
              <input type="checkbox" checked={premed} onChange={(e) => setPremed(e.target.checked)} />
              Pre-med: use the catalog’s pre-med sample (adds Organic Chemistry I, II and lab) and turn on the pre-med
              checklist
            </label>
            <label className="auto-focus">
              Focus area
              <select value={chosen} onChange={(e) => setFocus(e.target.value)}>
                <option value="">Undecided</option>
                {ranked.map((r) => (
                  <option key={r.tag} value={r.tag}>
                    {r.name} — {r.science} of {r.total} courses in Natural Sciences
                    {premed && r === best ? ' (most pre-med overlap)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <p className="cd-parsed">
              Ranked by how many of each area’s courses the registrar tags Natural Sciences (N) — a rough measure of
              biology and chemistry content, not advising. The choice only labels the six focus-area slots.
            </p>
            <div className="ics-actions">
              {hasAuto && (
                <button
                  className="ics-cancel"
                  onClick={() => {
                    onApply({
                      ...plan,
                      autoPlan: undefined,
                      terms: Object.fromEntries(Object.entries(plan.terms).map(([t, items]) => [t, items.filter((it) => !it.auto)])),
                    });
                    onClose();
                  }}
                >
                  Remove auto-planned
                </button>
              )}
              <button className="ics-cancel" onClick={onClose}>
                Cancel
              </button>
              <button onClick={generate} disabled={busy || max < 1}>
                {busy ? 'Planning…' : 'Create plan'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
