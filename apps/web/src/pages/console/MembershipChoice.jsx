import DatePick from '../../components/console/DatePick';
import { termLine } from './membershipTypesView';
import { membershipChoice, startRange } from './heldMembershipsView';
import { NO_PAYMENTS_LINE } from './memberBillsView';

// THE CHOICE OF A MEMBERSHIP TO GIVE (ROADMAP 17a-ii): a type from the gym's price list, a
// start date and the dates it will have, where a membership is added on a person's page. `value` is
// { typeId, startsOn }; '' for the type means none chosen. It is given owed: its payment is recorded on its bill once it is added (Kd, 2026-11-04),
// by staff who may record one (`canBill`).

export default function MembershipChoice({ types, today, value, onChange, canBill = true }) {
  const { type, line, problem } = membershipChoice(types, value, today);
  const range = startRange(today);
  return (
    <>
      <label className="c-field">
        <span className="c-label">Membership type</span>
        <select className="c-sel" value={value.typeId} onChange={(e) => onChange({ ...value, typeId: e.target.value })}>
          {types.length > 1 ? <option value="">Choose one</option> : null}
          {types.map((t) => (
            <option key={t.id} value={t.id}>{`${t.name} · ${termLine(t)}`}</option>
          ))}
        </select>
      </label>
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
      {type !== null && type.priceMinor > 0 && problem === null ? (
        <span className="c-hint" data-testid={canBill ? 'held-add-pay-later' : 'held-add-no-payments'}>
          {canBill ? 'Once it is added, record the payment on its bill.' : `They will owe it until a payment is recorded. ${NO_PAYMENTS_LINE}`}
        </span>
      ) : null}
    </>
  );
}
