import { useEffect, useState } from 'react';
import { useInRouterContext } from 'react-router-dom';
import { Check, Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { useSectionLink } from '../../pages/console/useSectionLink';
import { formatMinor } from '@app/shared';
import {
  NO_PAYMENTS_LINE,
  billDayChoices,
  billDayExample,
  freezeFeeFromText,
  freezeFeeHint,
  freezeFeeText,
  graceChoices,
  graceExample,
} from '../../pages/console/memberBillsView';
import { CARD_EXPIRY_WORDS, EXPIRY_FEW, cardExpiryBox } from '../../pages/console/cardExpiryView';

// BILLS, on the Memberships page (spec Part 3 §14.2; ROADMAP 18a-i): the gym's settings
// for them, how many days of grace an unpaid bill has before it reads Overdue, and the day of
// the month it bills every new membership on (18y), the fee for each month a membership is frozen (18z), and the reminder
// emailed before a saved card expires (18d-iii-c), with who it goes to this month. They wait for Save. Staff without the payments tick read it and are told who can
// change it; a gym with no live plan reads it too.

/** "/memberships#bills" (Booking rules' Change the grace period) brings this box into view
 *  once it has loaded. */
function ToBills({ ready }) {
  useSectionLink(ready);
  return null;
}

const TICK = { accentColor: 'var(--accent)' };

/** One group of the reminder's list: a few names, then See all. */
function ExpiryGroup({ group }) {
  const [all, setAll] = useState(false);
  const shown = all ? group.people : group.people.slice(0, EXPIRY_FEW);
  const more = group.people.length - shown.length;
  return (
    <div className="flex flex-col gap-1" data-testid={`expiry-${group.key}`}>
      <span className="c-s14 c-w6 c-t1">{group.title}</span>
      <ul className="m-0 pl-5 c-s14 c-t2 flex flex-col gap-0.5">
        {shown.map((p) => (
          <li key={p.entryId}>{p.line}</li>
        ))}
      </ul>
      {more > 0 ? (
        <button type="button" className="c-btn c-btn-link c-s14 self-start" onClick={() => setAll(true)}>
          {`and ${String(more)} more · See all`}
        </button>
      ) : null}
    </div>
  );
}

// `readOnlyLine`: why nothing here can be changed, for a gym with no live plan.
export default function BillSettingsCard({ gymId, readOnly, readOnlyLine = null }) {
  const routed = useInRouterContext();
  /** What the server holds: { overdueAfterDays, billDay, freezeFeeMinor, currency, canChange }. */
  const [saved, setSaved] = useState(null);
  const [days, setDays] = useState(0);
  const [billDay, setBillDay] = useState(null);
  const [freezeText, setFreezeText] = useState('0');
  const [reminders, setReminders] = useState(false);
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
        setBillDay(res.data.billDay ?? null);
        setFreezeText(freezeFeeText(res.data.freezeFeeMinor, res.data.currency));
        setReminders(res.data.cardExpiryReminders === true);
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
  // The freeze fee's box is drawn, and sent, only where the gym's money is known (18z).
  const hasFreezeFee = Boolean(saved.currency);
  const freezeFee = freezeFeeFromText(freezeText, saved.currency);
  // The reminder's tick is drawn where the gym has saved cards to remind about (connected to Square,
  // and the reader takes payments), or where it is on (18d-iii-c).
  const hasReminders = Boolean(saved.cardExpiry) || saved.cardExpiryReminders === true;
  const savedReminders = saved.cardExpiryReminders === true;
  const changed =
    days !== saved.overdueAfterDays ||
    billDay !== (saved.billDay ?? null) ||
    (hasFreezeFee && freezeFee !== (saved.freezeFeeMinor ?? 0)) ||
    (hasReminders && reminders !== savedReminders);
  const expiryBox = cardExpiryBox(saved.cardExpiry, { on: savedReminders, ticked: reminders });
  const sign = saved.currency ? formatMinor(0, saved.currency).replace(/[\d.,\s]/g, '') || saved.currency : '';

  const save = async () => {
    if (hasFreezeFee && freezeFee === null) {
      setFailed('Type the freeze fee as an amount, or 0 for no fee.');
      return;
    }
    setBusy(true);
    setNotice(null);
    setFailed(null);
    try {
      const res = await orgService.saveBillSettings(gymId, {
        overdueAfterDays: days,
        billDay,
        ...(hasFreezeFee ? { freezeFeeMinor: freezeFee } : {}),
        ...(hasReminders ? { cardExpiryReminders: reminders } : {}),
      });
      setSaved(res.data);
      setDays(res.data.overdueAfterDays);
      setBillDay(res.data.billDay ?? null);
      setFreezeText(freezeFeeText(res.data.freezeFeeMinor, res.data.currency));
      setReminders(res.data.cardExpiryReminders === true);
      setNotice('Saved.');
    } catch (err) {
      setFailed(errorText(err, "We couldn't save that. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="bills" className="c-card p-5 md:p-6 flex flex-col gap-3" data-testid="bill-settings">
      {routed ? <ToBills ready={saved !== null} /> : null}
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
      <div className="c-field">
        <label className="c-field">
          <span className="c-label">Billing day for new memberships</span>
          <select
            className="c-sel"
            style={{ maxWidth: 280 }}
            value={billDay === null ? '' : String(billDay)}
            disabled={!canChange || busy}
            data-testid="bill-day"
            onChange={(e) => {
              setNotice(null);
              setBillDay(e.target.value === '' ? null : Number(e.target.value));
            }}
          >
            {billDayChoices().map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <span className="c-hint">{billDayExample(billDay)}</span>
      </div>
      {hasFreezeFee ? (
        <div className="c-field">
          <label className="c-field">
            <span className="c-label">Freeze fee, each month</span>
            <span className="flex items-center gap-1.5" style={{ maxWidth: 280 }}>
              <span className="c-s15 c-t1">{sign}</span>
              <input
                type="text"
                inputMode="decimal"
                className="c-input"
                style={{ maxWidth: 140 }}
                value={freezeText}
                disabled={!canChange || busy}
                data-testid="freeze-fee"
                onChange={(e) => {
                  setNotice(null);
                  setFailed(null);
                  setFreezeText(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 12));
                }}
              />
            </span>
          </label>
          <span className="c-hint">{freezeFeeHint(freezeFee, saved.currency)}</span>
        </div>
      ) : null}
      {hasReminders ? (
        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-3 min-h-11 c-s15 c-t1">
            <input
              type="checkbox"
              className="w-[18px] h-[18px] mt-0.5 flex-shrink-0"
              style={TICK}
              checked={reminders}
              disabled={!canChange || busy}
              data-testid="card-expiry-reminders"
              onChange={(e) => {
                setNotice(null);
                setReminders(e.target.checked);
              }}
            />
            <span className="flex flex-col gap-0.5">
              <span>{CARD_EXPIRY_WORDS.label}</span>
              <span className="c-s14 c-t2">{CARD_EXPIRY_WORDS.hint}</span>
            </span>
          </label>
          {expiryBox !== null ? (
            <div className="rounded-[14px] p-3 flex flex-col gap-2" style={{ background: 'var(--raise)', border: '1px solid var(--raise-line)' }} data-testid="card-expiry-box">
              <span className="c-s14 c-w6 c-t1">{expiryBox.heading}</span>
              {expiryBox.empty !== null ? <span className="c-s14 c-t2">{expiryBox.empty}</span> : null}
              {expiryBox.groups.map((group) => (
                <ExpiryGroup key={group.key} group={group} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {!saved.canChange ? <p className="c-s14 c-t2 m-0">{NO_PAYMENTS_LINE}</p> : null}
      {saved.canChange && readOnly && readOnlyLine !== null ? <p className="c-s14 c-t2 m-0">{readOnlyLine}</p> : null}
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
