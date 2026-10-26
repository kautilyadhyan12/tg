import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { SQUARE_MEMBERS_WORDS, squareMembersNames } from '@app/shared';
import { errorText, orgService } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import { viewerPrivileges } from '../../pages/console/consoleView';
import { placeFor } from '../../pages/console/consolePlaces';
import { useLiveNews } from '../../pages/console/liveNews';
import PlaceLink from './PlaceLink';
import { Line, Step, Words } from './SquareChecklist';
import { boxStyle, labelStyle, linkButton, mainButton, plainButton, strongStyle } from './squareChecklistStyles';

// MEMBERS IN SQUARE (ROADMAP 18d-iii-b-ii-b-i), a line of Square Point of Sale's checklist: the gym's members
// put into its Square customer list, so staff can select them in Square Point of Sale. The owner presses Add
// members to Square; the line checks Square, then says who is added, who is linked to a customer Square
// already has, who is left out and why, and whom Square charges itself, before anything changes; the press
// of Add does that. Then new members are added automatically. Everybody on the staff reads the line; the
// names are for the owner, who acts. Live news says when a check or the adding has moved on; without a line,
// the box reads again every 30 seconds while it waits on Square, for at most 15 minutes (Kd, 2026-10-24).

const W = SQUARE_MEMBERS_WORDS;
const WAIT_MS = 30_000;
const WAIT_FOR_MS = 15 * 60_000;

/** A group's names in a line, with See all opening the whole list under it. */
function Names({ org, group, data, testId }) {
  const [all, setAll] = useState(null);
  const [next, setNext] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const named = data.groups[group];
  const more = named.count > named.names.length;
  const load = (from) => {
    setLoading(true);
    setError(null);
    orgService
      .getSquareMembersNames(org.id, group, from)
      .then((res) => {
        setAll((before) => [...(from === 0 ? [] : (before ?? [])), ...res.data.names]);
        setNext(res.data.next);
      })
      .catch((err) => setError(errorText(err, "We couldn't load the names. Try again.")))
      .finally(() => setLoading(false));
  };
  if (named.names.length === 0) return null;
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <span className="text-sm" style={strongStyle}>
        {squareMembersNames(named)}
      </span>
      {more ? (
        <button
          type="button"
          className={linkButton}
          style={{ color: 'var(--t1)' }}
          aria-expanded={all !== null}
          onClick={() => {
            if (all !== null) setAll(null);
            else load(0);
          }}
        >
          {all !== null ? W.hideAll : W.seeAll}
        </button>
      ) : null}
      {all !== null ? (
        <ul className="m-0 pl-4 flex flex-col gap-0.5 text-sm" style={labelStyle}>
          {all.map((name, i) => (
            <li key={`${String(i)}${name}`}>{name}</li>
          ))}
        </ul>
      ) : null}
      {all !== null && next !== null ? (
        <button type="button" className={linkButton} style={{ color: 'var(--t1)' }} disabled={loading} onClick={() => load(next)}>
          {W.showMore}
        </button>
      ) : null}
      {error !== null ? (
        <span className="text-sm" role="alert" style={{ color: 'var(--warn)' }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** One group: what it is, its names, and what to do about it. */
function Group({ org, data, group, lead, fix = null, children = null }) {
  const count = data.groups[group].count;
  if (count === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg px-3 py-3" style={boxStyle} data-testid={`square-members-${group}`}>
      <Line>{lead(count)}</Line>
      <Names org={org} group={group} data={data} testId={`square-members-${group}-names`} />
      {fix !== null ? <Words text={fix} soft /> : null}
      {children}
    </div>
  );
}

export default function SquareMembers({ org, owner, readOnly }) {
  const [data, setData] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pressing, setPressing] = useState(null);
  const [pressError, setPressError] = useState(null);
  // Cancel closes the check's box; the line then offers the press again.
  const [dismissed, setDismissed] = useState(null);
  const [withoutLine, setWithoutLine] = useState(false);

  const load = useCallback(
    (isLive = () => true) =>
      orgService
        .getSquareMembers(org.id)
        .then((res) => {
          if (!isLive()) return;
          setData(res.data.members);
          setLoadFailed(false);
        })
        .catch(() => {
          if (isLive()) setLoadFailed(true);
        }),
    [org.id],
  );

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
  }, [load]);

  useLiveNews(org.id, (message) => {
    if (message.what === 'refused') setWithoutLine(true);
    if (message.what === 'ready') setWithoutLine(false);
    if (message.what === 'squareMembers' || message.what === 'people' || message.what === 'ready' || message.what === 'cameBack') void load();
  });

  // No live line while Square is being read: every 30 seconds, for at most 15 minutes.
  const waiting = data !== null && (data.state === 'checking' || data.state === 'adding');
  useEffect(() => {
    if (!waiting || !withoutLine) return undefined;
    const until = Date.now() + WAIT_FOR_MS;
    const timer = setInterval(() => {
      if (Date.now() > until) clearInterval(timer);
      else void load();
    }, WAIT_MS);
    return () => clearInterval(timer);
  }, [waiting, withoutLine, load]);

  const press = (which, run) => {
    setPressing(which);
    setPressError(null);
    run()
      .then((res) => {
        setData(res.data.members);
        setDismissed(null);
      })
      .catch((err) => setPressError(errorText(err, "We couldn't reach Square. Try again in a minute.")))
      .finally(() => setPressing(null));
  };
  const check = () => press('check', () => orgService.checkSquareMembers(org.id));
  const add = () => press('add', () => orgService.addSquareMembers(org.id, data.runId));

  if (data === null) {
    return loadFailed ? (
      <Step icon="unknown" title={W.noneTitle} testId="square-members-step">
        <Line>{"We couldn't load this. Try again in a minute."}</Line>
      </Step>
    ) : (
      <Step icon="checking" title={W.noneTitle} testId="square-members-step" />
    );
  }

  const canPress = owner && data.canAdd && !readOnly;
  const pressButton = (label, onClick, which, main = true) => (
    <button
      type="button"
      onClick={onClick}
      disabled={pressing !== null || !canPress}
      className={`self-start rounded-full ${main ? 'px-5 py-3' : 'px-4 py-2'} text-sm font-semibold flex items-center gap-2 disabled:opacity-40 min-h-11`}
      style={main ? mainButton(pressing === null && canPress) : plainButton}
    >
      {pressing === which ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
      {label}
    </button>
  );
  const who = owner ? (readOnly ? <Line soft>{readOnlyNote(org.orgType)}</Line> : null) : <Line soft>{W.ownerOnly(org.name)}</Line>;
  const problem =
    pressError !== null ? (
      <span className="text-sm" role="alert" style={{ color: 'var(--warn)' }}>
        {pressError}
      </span>
    ) : null;
  const duplicatesTo = placeFor(org.slug, viewerPrivileges(org), 'duplicates');
  const leftOut = (
    <>
      <Group org={org} data={data} group="several_customers" lead={W.severalCustomersLead} fix={W.severalCustomersFix} />
      <Group org={org} data={data} group="several_people" lead={W.severalPeopleLead} fix={W.severalPeopleFix}>
        {duplicatesTo !== null ? (
          <PlaceLink to={duplicatesTo} className="c-btn c-btn-s c-btn-sm self-start">
            {W.duplicatesButton}
          </PlaceLink>
        ) : null}
      </Group>
    </>
  );

  // Never checked, Cancel pressed, or Try again: the press, for the owner.
  const offer = (icon, title, detail, label = W.addButton) => (
    <Step icon={icon} title={title} testId="square-members-step">
      {detail}
      {owner ? pressButton(label, check, 'check') : null}
      {who}
      {problem}
    </Step>
  );

  if (data.state === 'none' || (data.state === 'checked' && dismissed === data.runId)) return offer('todo', W.noneTitle, <Line>{W.noneDetail}</Line>);

  if (data.state === 'checking') {
    return (
      <Step icon="checking" title={W.checkingTitle} testId="square-members-step">
        <Line>{W.checkingLooked(data.looked)}</Line>
        <Line soft>{W.takesTime}</Line>
        {data.unanswered ? <Line soft>{W.unanswered}</Line> : null}
      </Step>
    );
  }

  if (data.state === 'checked') {
    if (!owner) {
      return (
        <Step icon="todo" title={W.noneTitle} testId="square-members-step">
          <Line>{W.checkedOther(org.name)}</Line>
        </Step>
      );
    }
    const adds = data.groups.add.count;
    const links = data.groups.link.count;
    return (
      <Step icon="todo" title={W.checkedTitle} testId="square-members-step">
        <div className="flex flex-col gap-2" data-testid="square-members-check">
          <Group org={org} data={data} group="add" lead={W.addLead} />
          <Group org={org} data={data} group="link" lead={W.linkLead} />
          <Group org={org} data={data} group="billed" lead={W.billedLead} fix={W.billedFix} />
          {leftOut}
          {adds + links === 0 ? <Line>{W.nothingToAdd}</Line> : null}
        </div>
        {data.expired ? (
          <>
            <Line soft>{W.expired}</Line>
            {pressButton(W.checkAgain, check, 'check')}
          </>
        ) : adds + links > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            {pressButton(W.confirmButton(adds, links), add, 'add')}
            <button type="button" className={linkButton} style={{ color: 'var(--t1)' }} disabled={pressing !== null} onClick={() => setDismissed(data.runId)}>
              {W.cancel}
            </button>
          </div>
        ) : (
          pressButton(W.checkAgain, check, 'check', false)
        )}
        {who}
        {problem}
      </Step>
    );
  }

  if (data.state === 'adding') {
    return (
      <Step icon="checking" title={W.addingTitle} testId="square-members-step">
        {data.progress !== null ? <Line>{W.addingProgress(data.progress.done, data.progress.of)}</Line> : null}
        <Line soft>{W.takesTime}</Line>
        {data.unanswered ? <Line soft>{W.unanswered}</Line> : null}
      </Step>
    );
  }

  if (data.state === 'failed') {
    return offer('fix', W.failedTitle, <Line>{data.failure === 'square_unauthorized' ? W.failedUnauthorized : W.failedRefused}</Line>, W.tryAgain);
  }

  // Added: new members are added automatically; the people not in Square, and why.
  const notIn = data.members - data.inSquare;
  return (
    <Step icon="done" title={W.addedTitle} testId="square-members-step">
      <Line>{W.addedDetail(data.inSquare, data.members)}</Line>
      {/* Square's own subscriptions charge some of them, as the last look read them (round one, Low 5). */}
      <Group org={org} data={data} group="billed" lead={W.billedLead} fix={W.billedFix} />
      {notIn > 0 ? (
        <div className="flex flex-col gap-2" data-testid="square-members-not-in">
          <Line>{W.notInLead}</Line>
          {leftOut}
          <Group org={org} data={data} group="refused" lead={W.refusedLead} fix={W.refusedFix} />
          <Group org={org} data={data} group="waiting" lead={W.waitingLead} />
          <Group org={org} data={data} group="merged_away" lead={W.mergedAwayLead} fix={W.mergedAwayFix} />
        </div>
      ) : null}
      {/* Square's Dashboard lists customers who share an email or phone as duplicates (18d-iii-b-ii-b-ii-a). */}
      <Line soft>{W.duplicatesNote}</Line>
      {owner ? pressButton(W.checkAgain, check, 'check', false) : null}
      {problem}
    </Step>
  );
}
