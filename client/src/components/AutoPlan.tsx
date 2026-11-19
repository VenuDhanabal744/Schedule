import { useEffect, useMemo, useState } from 'react';
import type { IndexCourse, ReqSummary, ReqTemplate } from '../types';
import { fetchRequirementTemplate, fetchSections } from '../api';
import { autoPlan, autoPlanCodes, hasAutoPlan, rankFocusAreas, removeAutoPlan, replaceable, semesters } from '../autoplan';
import { planWarnings, termCredits, termOrder } from '../plan';
import type { Plan } from '../plan';
import { samplePlans, sampleFor } from '../samplePlans';

// Dialog for "Auto-plan": lays the catalog's sample program out over the
// semesters up to a graduation term, under a credit cap.
export function AutoPlan({
  school,
  plan,
  programs,
  index,
  imported,
  onApply,
  onClose,
}: {
  school: string;
  plan: Plan;
  programs: ReqSummary[]; // requirement templates that have a sample program
  index: Map<string, IndexCourse>;
  imported: string[];
  onApply: (plan: Plan) => void;
  onClose: () => void;
}) {
  const options = semesters(plan, 12);
  const last = plan.autoPlan; // settings of the previous run
  // the planner's own Semesters setting: the last run set it, unless you changed it since
  const [count, setCount] = useState(Math.min(12, Math.max(4, plan.numTerms)));
  const [max, setMax] = useState(plan.maxCredits || 18);
  const [premed, setPremed] = useState(last?.premed ?? false);
  const [programId, setProgramId] = useState(
    // auto-plans made before majors were selectable were all BME
    (last && (last.templateId ?? 'jhu-bme-bs')) ??
      plan.templates.find((id) => programs.some((p) => p.id === id)) ??
      programs[0].id
  );
  // the focus area of the last run, if this major has it; null: not chosen by hand
  const lastFocus = (id: string) => samplePlans[id]?.focusAreas.find((f) => f.name === last?.focusName)?.tag ?? null;
  const [focus, setFocus] = useState(() => lastFocus(programId));
  const [template, setTemplate] = useState<ReqTemplate | 'loading' | 'failed'>('loading');
  useEffect(() => {
    setTemplate('loading');
    fetchRequirementTemplate(school, programId).then(setTemplate, () => setTemplate('failed'));
  }, [school, programId]);
  // without the template a hand-written sample still plans; it just can't tell
  // which of your own courses already fill an elective slot
  const sample = typeof template === 'object' ? sampleFor(template) : samplePlans[programId];
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string[] | null>(null);

  const ranked = useMemo(() => rankFocusAreas(sample?.focusAreas ?? [], index), [sample, index]);
  const best = ranked[0]?.science ? ranked[0] : undefined;
  // pre-med picks the top-ranked area unless the student chose one
  const chosen = focus ?? (premed ? best?.tag ?? '' : '');
  const hasAuto = hasAutoPlan(plan);

  const generate = async () => {
    if (!sample) return;
    setBusy(true);
    // without section times the plan is still built; it just can't check that
    // each imported semester can be scheduled
    const sections = await fetchSections(school, autoPlanCodes(plan, sample), imported).catch(() => undefined);
    const { plan: next, unplaced, skipped } = autoPlan({
      plan,
      sample,
      premed,
      semesterCount: count,
      maxCredits: max,
      index,
      imported,
      template: typeof template === 'object' ? template : undefined,
      focusName: ranked.find((r) => r.tag === chosen)?.name,
      sections,
    });
    onApply(next);
    const placed = Object.values(next.terms).flat().filter(replaceable);
    // the student's own courses past the graduation term: theirs to move
    const late = Object.entries(next.terms)
      .filter(([t]) => termOrder(t) > termOrder(options[count - 1]))
      .flatMap(([t, items]) => items.map((it) => `${it.code ?? it.title} (${t})`));
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
      ...(late.length
        ? [
            `After ${options[count - 1]} your plan still has ${late.join(', ')}. You placed ${
              late.length === 1 ? 'it' : 'them'
            }, so auto-plan left ${late.length === 1 ? 'it' : 'them'} there — move or remove ${late.length === 1 ? 'it' : 'them'} to graduate on time.`,
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
        <h2>Auto-plan</h2>
        <label className="auto-focus">
          Major
          <select
            value={programId}
            onChange={(e) => {
              setProgramId(e.target.value);
              setFocus(lastFocus(e.target.value));
            }}
          >
            {[...programs]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <p className="cd-parsed">
          Follows the order of the{' '}
          {sample ? (
            <a href={sample.source} target="_blank" rel="noreferrer">
              catalog’s sample program
            </a>
          ) : (
            'catalog’s sample program'
          )}
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
              {sample?.premed
                ? 'Pre-med: use the catalog’s pre-med sample (adds Organic Chemistry I, II and lab) and turn on the pre-med checklist'
                : 'Pre-med: turn on the pre-med checklist (this major’s catalog has no pre-med sample)'}
            </label>
            {template === 'failed' && !sample && <p className="cd-parsed">Couldn’t load this major’s sample program.</p>}
            {!!sample?.focusAreas.length && (
              <>
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
              </>
            )}
            <div className="ics-actions">
              {hasAuto && (
                <button
                  className="ics-cancel"
                  onClick={() => {
                    onApply(removeAutoPlan(plan));
                    onClose();
                  }}
                >
                  Remove auto-planned
                </button>
              )}
              <button className="ics-cancel" onClick={onClose}>
                Cancel
              </button>
              <button onClick={generate} disabled={busy || max < 1 || !sample}>
                {busy ? 'Planning…' : 'Create plan'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
