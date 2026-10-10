import DatePick from '../../components/console/DatePick';
import { Tick } from './MemberListUpload';
import { termLine } from './membershipTypesView';
import { membershipChoice, startRange } from './heldMembershipsView';
import { NO_PAYMENTS_LINE, PAYMENT_METHODS } from './memberBillsView';

// THE CHOICE OF A MEMBERSHIP TO GIVE (ROADMAP 17a-ii): a type from the gym's price list, a
// start date, the dates it will have, and whether it is paid. Used where a membership is
// added on a person's page, and in Add member, where `allowNone` offers "No membership".
// `value` is { typeId, startsOn, paid, method }; '' for the type means none chosen, and
// '' for the method that how they paid is not picked yet. Saying it is paid records a
// payment (18a-i), so the tick is offered only to staff who may record one (`canBill`).

export default function MembershipChoice({ types, today, value, onChange, allowNone = false, canBill = true }) {
  const { type, line, paidLabel, problem } = membershipChoice(types, value, today);
  const range = startRange(today);
  return (
    <>
      <label className="c-field">
        <span className="c-label">Membership type</span>
        <select className="c-sel" value={value.typeId} onChange={(e) => onChange({ ...value, typeId: e.target.value })}>
          {allowNone ? <option value="">No membership</option> : types.length > 1 ? <option value="">Choose one</option> : null}
          {types.map((t) => (
            <option key={t.id} value={t.id}>{`${t.name} · ${termLine(t)}`}</option>
          ))}
        </select>
      </label>
      {type !== null || !allowNone ? (
        <div className="c-field">
          <span className="c-label">Start date</span>
          <DatePick
            newLook
            label="Start date"
            value={value.startsOn}
            min={range.min}
            max={range.max}
            today={today}
            yearSelect
            onChange={(day) => onChange({ ...value, startsOn: day })}
          />
          {line !== null ? (
            <span className="c-hint" data-testid="held-add-line">
              {line}
            </span>
          ) : null}
          {problem !== null ? (
            <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
              {problem}
            </span>
          ) : null}
        </div>
      ) : null}
      {paidLabel !== null && canBill ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col">
            <Tick checked={value.paid} onChange={(paid) => onChange({ ...value, paid })}>
              {paidLabel}
            </Tick>
            <span className="c-hint">Leave it unticked if they still owe it. You can record the payment later.</span>
          </div>
          {value.paid ? (
            <label className="c-field">
              <span className="c-label">How they paid</span>
              <select className="c-sel" value={value.method ?? ''} onChange={(e) => onChange({ ...value, method: e.target.value })}>
                <option value="">Choose one</option>
                {PAYMENT_METHODS.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      {paidLabel !== null && !canBill ? (
        <span className="c-hint" data-testid="held-add-no-payments">
          {`They will owe it until a payment is recorded. ${NO_PAYMENTS_LINE}`}
        </span>
      ) : null}
    </>
  );
}
