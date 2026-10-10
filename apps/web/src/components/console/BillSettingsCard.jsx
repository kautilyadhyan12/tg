import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { NO_PAYMENTS_LINE, graceChoices, graceExample } from '../../pages/console/memberBillsView';

// BILLS, on the Memberships page (spec Part 3 §14.2; ROADMAP 18a-i): the gym's one
// setting for them, how many days of grace an unpaid bill has before it reads Overdue.
// It waits for Save. Staff without the payments tick read it and are told who can
// change it; a gym with no live plan reads it too.

export default function BillSettingsCard({ gymId, readOnly }) {
  /** What the server holds: { overdueAfterDays, canChange }. */
  const [saved, setSaved] = useState(null);
  const [days, setDays] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [failed, setFailed] = useState(null);

  useEffect(() => {
    let live = true;
    orgService.getBillSettings(gymId).then(
      (res) => {
        if (!live) return;
        setSaved(res.data);
        setDays(res.data.overdueAfterDays);
      },
      // A setting that cannot be read is not drawn: the page above it stands without it.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [gymId]);

  if (saved === null) return null;
  const canChange = saved.canChange && !readOnly;
  const changed = days !== saved.overdueAfterDays;

  const save = async () => {
    setBusy(true);
    setNotice(null);
    setFailed(null);
    try {
      const res = await orgService.saveBillSettings(gymId, { overdueAfterDays: days });
      setSaved(res.data);
      setDays(res.data.overdueAfterDays);
      setNotice('Saved.');
    } catch (err) {
      setFailed(errorText(err, "We couldn't save that. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="c-card p-5 md:p-6 flex flex-col gap-3" data-testid="bill-settings">
      <h2 className="c-h2">Bills</h2>
      <p className="c-s14 c-t2 m-0">
        A membership with a price gets a bill for each period, by itself. You record what a person paid on their page, under Memberships.
      </p>
      <div className="c-field">
        <label className="c-field">
          <span className="c-label">Grace period before an unpaid bill reads Overdue</span>
          <select
            className="c-sel"
            style={{ maxWidth: 280 }}
            value={String(days)}
            disabled={!canChange || busy}
            onChange={(e) => {
              setNotice(null);
              setDays(Number(e.target.value));
            }}
          >
            {graceChoices(saved.overdueAfterDays).map((choice) => (
              <option key={choice.value} value={String(choice.value)}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <span className="c-hint">{graceExample(days)}</span>
      </div>
      {!saved.canChange ? <p className="c-s14 c-t2 m-0">{NO_PAYMENTS_LINE}</p> : null}
      {canChange ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="c-btn c-btn-p" disabled={busy || !changed} onClick={() => void save()}>
            {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            Save
          </button>
          {notice !== null ? (
            <span className="c-s14 c-w5 flex items-center gap-2" style={{ color: 'var(--good)' }} role="status">
              <Check aria-hidden="true" className="w-4 h-4" />
              {notice}
            </span>
          ) : null}
        </div>
      ) : null}
      {failed !== null ? (
        <p className="c-s14 c-t1 m-0 rounded-[14px] p-3" style={{ background: 'var(--bad-bg)' }} role="alert">
          {failed}
        </p>
      ) : null}
    </section>
  );
}
