import { useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  Copy,
  Loader2,
  Mail,
  MoreHorizontal,
  Search,
  Smartphone,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import { MEMBER_INVITE_AGAIN_PER_PERSON, MEMBER_INVITE_AGAIN_PERSON_DAYS, MEMBER_INVITE_WORDS, MEMBER_LIST_QUERY_MAX_CHARS } from '@app/shared';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import DatePick from '../../components/console/DatePick';
import { ShareInvite } from './MemberListInvite';
import { FIELD_LABELS, dayWords } from './memberListView';
import {
  DAY_FIELDS,
  TEXT_FIELDS,
  WORD_FIELDS,
  contactWords,
  endsWords,
  entriesQueryString,
  EMPTY_FILTERS,
  formFrom,
  handEditedWords,
  inputFrom,
  invitationView,
  inviteOutcomeWords,
  outcomeWords,
  personInviteAction,
  patchFrom,
  compareRecords,
  whenWords,
} from './memberListPeople';

// One person on the gym's own list (ROADMAP 5b-i; spec Part 3 §11.6): everything kept
// about them, and Edit; under More, Remove from list, Merge duplicate and (for a past member)
// Delete for good, as gym software keeps its rarer actions. "Add member" is
// the same box with an empty form. It closes only by its X, as the import box does.
//
// Every answer is shown only for the record it was asked about: the box draws a
// person's details only when they belong to the record it has open, so a slow answer
// for somebody opened earlier can never stand under somebody else's name.

const C = {
  panel: '#0f0e0d',
  card: '#141210',
  line: 'rgba(255,255,255,0.07)',
  muted: 'rgba(255,255,255,0.5)',
  soft: 'rgba(255,255,255,0.8)',
  orange: '#FF8A1F',
  orangeBg: 'rgba(255,138,31,0.12)',
  green: '#34d399',
  greenBg: 'rgba(52,211,153,0.12)',
  red: '#f87171',
  redBg: 'rgba(248,113,113,0.1)',
  plain: 'rgba(255,255,255,0.06)',
};
const TAG_TONES = {
  green: [C.greenBg, C.green],
  orange: [C.orangeBg, C.orange],
  red: [C.redBg, C.red],
  plain: [C.plain, C.soft],
};

const BUTTON = 'rounded-xl min-h-[44px] px-4 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40';
const INPUT = 'w-full rounded-lg px-3 min-h-[44px] text-base';
const inputStyle = { background: '#0A0908', border: '1px solid rgba(255,255,255,0.10)', color: '#fff' };

const pad = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function dayRanges() {
  const now = new Date();
  const today = localDay(now);
  const later = localDay(new Date(now.getFullYear() + 20, 11, 31));
  return {
    today,
    joinedOn: { min: '1950-01-01', max: today },
    endsOn: { min: '1970-01-01', max: later },
    dateOfBirth: { min: '1900-01-01', max: today },
  };
}

export function Tag({ view }) {
  if (view === null) return null;
  const [bg, fg] = TAG_TONES[view.tone];
  return (
    <span className="rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap" style={{ background: bg, color: fg }}>
      {view.tag}
    </span>
  );
}

function Fact({ label, value, edited }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2" style={{ borderTop: `1px solid ${C.line}` }}>
      <dt className="text-sm flex-shrink-0" style={{ color: C.muted }}>
        {label}
      </dt>
      <dd className="text-sm text-right break-words min-w-0" style={{ color: '#fff' }}>
        {value}
        {edited ? (
          <span className="block text-xs" style={{ color: C.muted }}>
            changed by hand
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function Section({ title, note, children }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: C.muted }}>
        {title}
        {note ? <span className="normal-case font-normal tracking-normal"> ({note})</span> : null}
      </h3>
      <dl>{children}</dl>
    </section>
  );
}

/** "More ⋯": the rarer actions of a person's page, as gym software keeps them out of
 *  the way. Each item runs once and closes the menu. */
function MoreMenu({ items, disabled }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (wrap.current !== null && !wrap.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className={BUTTON}
        style={{ background: C.plain, color: C.soft }}
      >
        More
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 sm:right-auto sm:left-0 bottom-full sm:bottom-auto sm:top-full mb-2 sm:mb-0 sm:mt-2 w-64 rounded-2xl p-1.5 z-10"
          style={{ background: '#1a1816', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onPick();
              }}
              className="w-full text-left rounded-xl px-3 py-2.5 flex items-start gap-2.5"
              style={{ color: item.danger ? C.red : '#fff' }}
            >
              {item.icon ? <item.icon className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <span className="w-4 flex-shrink-0" />}
              <span>
                <span className="block text-sm font-medium">{item.label}</span>
                {item.hint ? (
                  <span className="block text-xs" style={{ color: C.muted }}>
                    {item.hint}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Merge duplicate: the two records as a table, one row a detail, Keep and Remove as
 *  its columns, as merge dialogs lay it out. A row whose values differ is shaded, and
 *  the line above says how many differ, so staff can see at a glance whether this is
 *  one person twice or two different people. Each value cell names its side and field
 *  for the tests. */
function CompareRecords({ keep, remove, fields }) {
  const rows = compareRecords(keep, remove, fields);
  const differ = rows.filter((row) => row.differs).length;
  return (
    <div data-testid="merge-compare" className="flex flex-col gap-2">
      <p className="text-sm" style={{ color: C.soft }}>
        {differ === 0 ? 'Every detail is the same.' : `${String(differ)} of ${String(rows.length)} details differ.`}
      </p>
      <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '28%' }} />
            <col style={{ width: '36%' }} />
            <col style={{ width: '36%' }} />
          </colgroup>
          <thead>
            <tr style={{ background: C.card }}>
              <th />
              <th className="text-left px-2 py-2 text-xs font-bold uppercase tracking-wide" style={{ color: C.green }}>
                Keep
              </th>
              <th className="text-left px-2 py-2 text-xs font-bold uppercase tracking-wide" style={{ color: C.red }}>
                Remove
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                data-differs={row.differs ? 'true' : 'false'}
                style={{ borderTop: `1px solid ${C.line}`, background: row.differs ? 'rgba(255,138,31,0.07)' : 'transparent' }}
              >
                <th scope="row" className="text-left font-normal px-1.5 sm:px-2 py-2 align-top text-xs sm:text-sm" style={{ color: C.muted }}>
                  {row.label}
                </th>
                {[
                  ['keep', row.keep],
                  ['remove', row.remove],
                ].map(([side, value]) => (
                  <td
                    key={side}
                    data-testid={`join-${side}-${row.key}`}
                    className="px-1.5 sm:px-2 py-2 align-top text-[13px] sm:text-sm"
                    style={{ color: value === '—' ? C.muted : '#fff', overflowWrap: 'break-word' }}
                  >
                    {/* An address may wrap at its @, never in the middle of a word. */}
                    {value.includes('@') ? (
                      <>
                        {value.slice(0, value.indexOf('@'))}
                        <wbr />
                        {value.slice(value.indexOf('@'))}
                      </>
                    ) : (
                      value
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MemberListPerson({ gymId, gym, entryId, list, words, readOnly, onClose, onChanged }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const fields = list?.fields ?? [];

  /** The record the box has open; null while adding somebody new. */
  const [id, setId] = useState(entryId);
  /** Which record the box has open at this moment, for answers that arrive late. */
  const wanted = useRef(entryId);
  const [entry, setEntry] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState(entryId === null ? 'edit' : 'view');
  const [form, setForm] = useState(() => formFrom(null, fields));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  /** A refusal: its sentence, and what can be done about it. */
  const [refusal, setRefusal] = useState(null);
  const [deleted, setDeleted] = useState(null);
  // Join: the search, the record picked, and which of the two is kept.
  const [joinQuery, setJoinQuery] = useState('');
  const [joinResults, setJoinResults] = useState(null);
  const [joinPick, setJoinPick] = useState(null);
  const [keepThis, setKeepThis] = useState(false);
  /** The record being opened to compare, while its whole page is read. */
  const [picking, setPicking] = useState(null);

  const ranges = dayRanges();

  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  const keepFocusInside = (e) => {
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (root === null) return;
    const focusable = [...root.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])')];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) {
      e.preventDefault();
      last.focus();
    }
  };

  /** Open another record in this box: nothing of the one before stays on screen. */
  const openRecord = (next) => {
    wanted.current = next;
    setId(next);
    setEntry(null);
    setLoadError(null);
    setMode('view');
    setRefusal(null);
    setJoinPick(null);
    setJoinResults(null);
    setJoinQuery('');
    setKeepThis(false);
  };

  useEffect(() => {
    if (id === null) return undefined;
    let live = true;
    const asked = id;
    Promise.resolve()
      .then(() => orgService.getMemberListEntry(gymId, asked))
      .then(
        (res) => {
          if (!live || wanted.current !== asked) return;
          const got = res.data.entry;
          if (got.entryId !== asked) {
            setLoadError("We couldn't open this person. Please try again.");
            return;
          }
          setEntry(got);
        },
        (err) => {
          if (!live || wanted.current !== asked) return;
          setLoadError(errorText(err, "We couldn't open this person."));
        },
      );
    return () => {
      live = false;
    };
  }, [gymId, id, attempt]);

  // The join's search: every record, current and past, but this one.
  useEffect(() => {
    if (mode !== 'join' || joinPick !== null || id === null) return undefined;
    const q = joinQuery.trim();
    if (q === '') return undefined;
    let live = true;
    const timer = setTimeout(() => {
      orgService
        .getMemberListEntries(gymId, entriesQueryString({ ...EMPTY_FILTERS, records: 'all', query: q }))
        .then(
          (res) => {
            if (live) setJoinResults({ q, items: res.data.page.entries.filter((e) => e.entryId !== id) });
          },
          (err) => {
            if (live) setJoinResults({ q, error: errorText(err, "We couldn't search your list.") });
          },
        );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [gymId, id, mode, joinQuery, joinPick]);

  /** The record on screen, only if it is the one the box has open. */
  const shown = entry !== null && entry.entryId === id ? entry : null;

  /** A write's answer, applied only if the box still has that record open. */
  const written = (asked, res) => {
    if (wanted.current !== asked) return;
    const next = res.data.entry;
    wanted.current = next.entryId;
    setId(next.entryId);
    setEntry(next);
    setMode('view');
    const invited = res.data.invite === undefined ? null : inviteOutcomeWords(res.data.invite.outcome, false);
    setNotice([outcomeWords(res.data.outcome), invited].filter((line) => line !== null).join(' '));
    setRefusal(null);
    onChanged();
  };

  const refused = (err, fallback, extra = {}) => {
    const code = errorCode(err);
    const other = err?.response?.data?.entryId;
    setRefusal({
      message: errorText(err, fallback),
      openId: (code === 'already_on_list' || code === 'former_record') && typeof other === 'string' ? other : null,
      ack: code === 'leaves_list' ? extra.ack ?? null : null,
    });
  };

  const run = async (asked, work, fallback, extra) => {
    setBusy(true);
    setNotice(null);
    setRefusal(null);
    try {
      const res = await work();
      written(asked, res);
    } catch (err) {
      if (wanted.current === asked) refused(err, fallback, extra);
    } finally {
      setBusy(false);
    }
  };

  /** Save the form. Adding, `invite` is "Add and invite": both happen, or neither. */
  const save = async (invite = false) => {
    if (shown === null) {
      const input = invite ? { ...inputFrom(form), invite: true } : inputFrom(form);
      await run(null, () => orgService.addMemberListEntry(gymId, input), "We couldn't add this person.");
      return;
    }
    const asked = shown.entryId;
    const patch = patchFrom(form, shown, fields);
    if (Object.keys(patch).length === 0) {
      setMode('view');
      setNotice(outcomeWords('unchanged'));
      return;
    }
    await sendChange(asked, patch, false);
  };

  /** A change, and its confirm: "Go ahead anyway" sends exactly the change that was refused,
   *  never the form as it is by then; changing a box takes the confirm away. */
  const sendChange = (asked, patch, acknowledge) =>
    run(
      asked,
      () => orgService.changeMemberListEntry(gymId, asked, acknowledge ? { ...patch, acknowledgeLeavesList: true } : patch),
      "We couldn't save the change.",
      { ack: () => sendChange(asked, patch, true) },
    );

  const takeOff = () => {
    const asked = shown.entryId;
    return run(asked, () => orgService.takeOffMemberListEntry(gymId, asked), "We couldn't take this person off.");
  };

  /** Invite this person, or send their invitation again because they asked. The
   *  answer's invitation replaces the one on screen only if the box still has them open. */
  const sendInvite = async (again) => {
    const asked = shown.entryId;
    setBusy(true);
    setNotice(null);
    setRefusal(null);
    try {
      const res = again ? await orgService.resendMemberListInvite(gymId, asked) : await orgService.inviteMemberListEntry(gymId, asked);
      if (wanted.current !== asked) return;
      const { outcome, invitation } = res.data.invite;
      setEntry((e) => (e !== null && e.entryId === asked ? { ...e, invitation } : e));
      setMode('view');
      setNotice(inviteOutcomeWords(outcome, again));
      onChanged();
    } catch (err) {
      if (wanted.current === asked) refused(err, again ? "We couldn't send the invitation again." : "We couldn't invite this person.");
    } finally {
      setBusy(false);
    }
  };

  const putBack = () => {
    const asked = shown.entryId;
    return run(asked, () => orgService.restoreMemberListEntry(gymId, asked), "We couldn't put this person back.");
  };

  const deleteForGood = async () => {
    const asked = shown.entryId;
    const name = shown.fullName;
    setBusy(true);
    setNotice(null);
    setRefusal(null);
    try {
      await orgService.deleteFormerMemberListEntry(gymId, asked);
      if (wanted.current !== asked) return;
      setDeleted(name || 'This person');
      setEntry(null);
      onChanged();
    } catch (err) {
      if (wanted.current === asked) refused(err, "We couldn't delete this record.");
    } finally {
      setBusy(false);
    }
  };

  /** The other record's whole page is read before the two are compared, so the
   *  comparison has every field, custom fields included. The answer is used only if the
   *  box still has the same record open and it is the record picked. */
  const pickRecord = async (otherId) => {
    const asked = shown.entryId;
    setPicking(otherId);
    setRefusal(null);
    try {
      const res = await orgService.getMemberListEntry(gymId, otherId);
      if (wanted.current !== asked || res.data.entry.entryId !== otherId) return;
      setKeepThis(false);
      setJoinPick(res.data.entry);
    } catch (err) {
      if (wanted.current === asked) refused(err, "We couldn't open that record.");
    } finally {
      setPicking(null);
    }
  };

  const onPick = (e) => void pickRecord(e.currentTarget.dataset.entryId);

  /** Join: the record under "Remove" is the one the request removes, and the one under
   *  "Keep" is the one it keeps — worked out once, here, from what is on screen. */
  const joinRoles = () => (keepThis ? { keep: shown, remove: joinPick } : { keep: joinPick, remove: shown });

  const join = async () => {
    const { keep, remove } = joinRoles();
    await sendMerge(shown.entryId, remove.entryId, keep.entryId, false);
  };

  /** A merge, and its confirm: "Go ahead anyway" sends exactly the merge that was refused,
   *  the same record removed and the same kept; Swap, Back or another pick takes it away. */
  const sendMerge = (asked, removeId, keepId, acknowledge) =>
    run(
      asked,
      () => orgService.mergeMemberListEntries(gymId, removeId, keepId, acknowledge),
      "We couldn't join the two records.",
      { ack: () => sendMerge(asked, removeId, keepId, true) },
    );

  /** Merge duplicate starts with this person's name already searched, so a second record
   *  under the same name shows at once. */
  const startJoin = () => {
    setJoinQuery(shown?.fullName ?? '');
    setJoinPick(null);
    setKeepThis(false);
    setNotice(null);
    setRefusal(null);
    setMode('join');
  };

  const startEdit = () => {
    setForm(formFrom(shown, fields));
    setNotice(null);
    setRefusal(null);
    setMode('edit');
  };

  // A box changed after a refusal takes its confirm away: the confirm was for the change
  // as it stood, and Save sends the form as it is now.
  const setField = (key, value) => {
    setRefusal(null);
    setForm((f) => ({ ...f, [key]: value }));
  };
  const setExtra = (key, value) => {
    setRefusal(null);
    setForm((f) => ({ ...f, extra: { ...f.extra, [key]: value } }));
  };
  /** Leave a step (Back, Swap): a refusal about what was on screen goes with it. */
  const backTo = (next) => {
    setRefusal(null);
    setMode(next);
  };

  const title = deleted !== null ? 'Record deleted' : id === null ? `Add ${words.person}` : shown?.fullName || (shown ? 'No name' : '');

  // ── What the box draws ──

  const renderForm = () => (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {TEXT_FIELDS.map((f) => (
        <label key={f.key} className="flex flex-col gap-1">
          <span className="text-sm" style={{ color: C.soft }}>
            {f.label}
          </span>
          <input
            type={f.type}
            autoComplete={f.autoComplete}
            value={form[f.key]}
            onChange={(e) => setField(f.key, e.target.value)}
            className={INPUT}
            style={inputStyle}
          />
        </label>
      ))}
      <p className="text-xs -mt-2" style={{ color: C.muted }}>
        An email address or a phone number is needed to tell people apart.
      </p>
      {WORD_FIELDS.map((f) => {
        const listId = `${titleId}-${f.key}`;
        const known = (list?.[f.from] ?? []).map((w) => w.label).filter((w) => w !== '');
        return (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="text-sm" style={{ color: C.soft }}>
              {f.label}
            </span>
            <input
              type="text"
              list={known.length > 0 ? listId : undefined}
              value={form[f.key]}
              onChange={(e) => setField(f.key, e.target.value)}
              className={INPUT}
              style={inputStyle}
            />
            {known.length > 0 ? (
              <datalist id={listId}>
                {known.map((w) => (
                  <option key={w} value={w} />
                ))}
              </datalist>
            ) : null}
          </label>
        );
      })}
      {DAY_FIELDS.map((f) => (
        <div key={f.key} className="flex flex-col gap-1">
          <span className="text-sm" style={{ color: C.soft }}>
            {f.label}
          </span>
          <DatePick
            label={f.label}
            value={form[f.key]}
            min={ranges[f.key].min}
            max={ranges[f.key].max}
            today={ranges.today}
            yearSelect
            onChange={(day) => setField(f.key, day)}
            onClear={() => setField(f.key, '')}
            emptyText="Not set"
          />
          {f.key === 'endsOn' && form.endsOn !== '' ? (
            <select
              aria-label="Ends or renews"
              value={form.endsOnKind}
              onChange={(e) => setField('endsOnKind', e.target.value)}
              className={INPUT}
              style={inputStyle}
            >
              <option value="ends">Membership ends on this date</option>
              <option value="renews">Membership renews on this date</option>
            </select>
          ) : null}
        </div>
      ))}
      {fields.map((f) => (
        <label key={f.key} className="flex flex-col gap-1">
          <span className="text-sm" style={{ color: C.soft }}>
            {f.label}
          </span>
          <input
            type="text"
            value={form.extra[f.key] ?? ''}
            onChange={(e) => setExtra(f.key, e.target.value)}
            className={INPUT}
            style={inputStyle}
          />
        </label>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || readOnly} className={BUTTON} style={{ background: C.orange, color: '#000' }}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {id === null ? `Add ${words.person}` : 'Save'}
        </button>
        {id === null ? (
          <button type="button" onClick={() => void save(true)} disabled={busy || readOnly} className={BUTTON} style={{ background: C.orangeBg, color: C.orange }}>
            <Mail className="w-4 h-4" />
            Add and invite
          </button>
        ) : null}
        {id !== null ? (
          <button type="button" onClick={() => backTo('view')} className={BUTTON} style={{ background: C.plain, color: C.soft }}>
            Back
          </button>
        ) : null}
      </div>
    </form>
  );

  const renderDetails = (p) => {
    const inv = invitationView(p, ranges.today);
    const action = personInviteAction(p, ranges.today);
    const edited = new Set(p.handEdited);
    const contact = [
      ['email', p.email],
      ['phone', p.phone],
      ['memberNumber', p.memberNumber],
    ].filter(([, v]) => v !== null);
    const membership = [
      ['status', p.status],
      ['membershipType', p.membershipType],
      ['joinedOn', p.joinedOn === null ? null : dayWords(p.joinedOn)],
      ['endsOn', endsWords(p)],
      ['paymentStatus', p.paymentStatus],
      ['dateOfBirth', p.dateOfBirth === null ? null : dayWords(p.dateOfBirth)],
    ].filter(([, v]) => v !== null && v !== '');
    const extra = p.extra.filter((x) => x.value !== '');
    const byHand = handEditedWords(p, fields, FIELD_LABELS);
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          {p.formerAt !== null ? (
            <span className="rounded-md px-2 py-0.5 text-xs font-medium" style={{ background: C.plain, color: C.soft }}>
              Past member · removed {whenWords(p.formerAt)}
            </span>
          ) : null}
          <Tag view={inv} />
        </div>
        {inv?.detail ? (
          <p className="text-sm flex gap-2" style={{ color: C.orange }}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {inv.detail}
          </p>
        ) : null}
        {action === 'under_age' ? (
          <p className="text-sm" style={{ color: C.muted }} data-testid="under-age-note">
            {MEMBER_INVITE_WORDS.under_age}
          </p>
        ) : null}
        <Section title="Contact">
          {contact.length === 0 ? <Fact label="Email or phone" value="None" /> : null}
          {contact.map(([k, v]) => (
            <Fact key={k} label={FIELD_LABELS[k]} value={v} edited={edited.has(k)} />
          ))}
        </Section>
        {membership.length > 0 ? (
          <Section title="Membership">
            {membership.map(([k, v]) => (
              <Fact key={k} label={FIELD_LABELS[k]} value={v} edited={edited.has(k)} />
            ))}
          </Section>
        ) : null}
        {extra.length > 0 ? (
          <Section title="Custom fields" note="extra columns from your file">
            {extra.map((x) => (
              <Fact key={x.key} label={x.label} value={x.value} edited={edited.has(`extra:${x.key}`)} />
            ))}
          </Section>
        ) : null}
        {p.members.length > 0 ? (
          <Section title="In the app">
            {p.members.map((m) => (
              <div key={m.userId} className="py-2 flex gap-3 items-start" style={{ borderTop: `1px solid ${C.line}` }}>
                <Smartphone className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: C.green }} />
                <div className="text-sm" style={{ color: C.soft }}>
                  <span style={{ color: '#fff' }}>{m.displayName}</span> joined {whenWords(m.joinedAt)}
                  <span className="block text-xs" style={{ color: C.muted }}>
                    {m.visits === 1 ? '1 visit' : `${String(m.visits)} visits`}
                    {m.lastVisitOn !== null ? ` · last ${dayWords(m.lastVisitOn)}` : ''}
                  </span>
                </div>
              </div>
            ))}
          </Section>
        ) : null}
        {byHand.length > 0 ? (
          <p className="text-xs" style={{ color: C.muted }}>
            Changed by hand: {byHand.join(', ')}. An import asks before it writes over these.
          </p>
        ) : null}
        {p.formerAt === null ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={startEdit} disabled={busy || readOnly} className={`${BUTTON} flex-1 sm:flex-none`} style={{ background: C.orange, color: '#000' }}>
              Edit
            </button>
            {action === 'invite' ? (
              <button type="button" onClick={() => void sendInvite(false)} disabled={busy || readOnly} className={`${BUTTON} flex-1 sm:flex-none whitespace-nowrap`} style={{ background: C.orangeBg, color: C.orange }}>
                <Mail className="w-4 h-4" />
                Invite
              </button>
            ) : null}
            {action === 'again' ? (
              <button type="button" onClick={() => backTo('again')} disabled={busy || readOnly} className={`${BUTTON} flex-1 sm:flex-none whitespace-nowrap`} style={{ background: C.plain, color: C.soft }}>
                <Mail className="w-4 h-4" />
                Send again
              </button>
            ) : null}
            <MoreMenu
              disabled={busy || readOnly}
              items={[
                ...(p.invitation?.state === 'pending'
                  ? [{ label: 'Share the invitation', hint: 'Its words and link, to send yourself', icon: Copy, onPick: () => backTo('share') }]
                  : []),
                { label: 'Remove from list', icon: UserMinus, onPick: () => setMode('takeOff') },
                { label: 'Merge duplicate', hint: 'When this person is on your list twice', icon: ArrowLeftRight, onPick: startJoin },
              ]}
            />
          </div>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={() => void putBack()} disabled={busy || readOnly} className={`${BUTTON} flex-1 sm:flex-none`} style={{ background: C.orange, color: '#000' }}>
              <UserPlus className="w-4 h-4" />
              Put back on list
            </button>
            <MoreMenu
              disabled={busy || readOnly}
              items={[
                { label: 'Edit', onPick: startEdit },
                { label: 'Merge duplicate', hint: 'When this person is on your list twice', icon: ArrowLeftRight, onPick: startJoin },
                { label: 'Delete for good', icon: Trash2, danger: true, onPick: () => setMode('delete') },
              ]}
            />
          </div>
        )}
      </div>
    );
  };

  const renderConfirm = (p) => {
    const name = p.fullName || 'this person';
    if (mode === 'again') {
      return (
        <div className="flex flex-col gap-3" data-testid="confirm-again">
          <p className="text-[15px]" style={{ color: '#fff' }}>
            Send {name}&apos;s invitation again?
          </p>
          <p className="text-sm" style={{ color: C.soft }}>
            Only when they ask for it, for example when they can&apos;t find the email. It goes to {p.email}. An invitation can be
            sent again {String(MEMBER_INVITE_AGAIN_PER_PERSON)} times in {String(MEMBER_INVITE_AGAIN_PERSON_DAYS)} days.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void sendInvite(true)} disabled={busy || readOnly} className={BUTTON} style={{ background: C.orange, color: '#000' }}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              Send again
            </button>
            <button type="button" onClick={() => backTo('view')} className={BUTTON} style={{ background: C.plain, color: C.soft }}>
              Back
            </button>
          </div>
        </div>
      );
    }
    if (mode === 'share') {
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm" style={{ color: C.soft }}>
            Send these words to {name} by WhatsApp, text or your own email. The link only lets them in when they sign in with{' '}
            {p.email}.
          </p>
          <ShareInvite gymName={gym.name} slug={gym.slug} email={p.email} />
          <button type="button" onClick={() => backTo('view')} className={`${BUTTON} self-start`} style={{ background: C.plain, color: C.soft }}>
            Back
          </button>
        </div>
      );
    }
    if (mode === 'takeOff') {
      const pending = p.invitation?.state === 'pending';
      return (
        <div className="flex flex-col gap-3" data-testid="confirm-take-off">
          <p className="text-[15px]" style={{ color: '#fff' }}>
            Remove {name} from your list?
          </p>
          <p className="text-sm" style={{ color: C.soft }}>
            Their record is kept as a past member, and you can put it back.
            {pending ? ' Their invitation stops working.' : ''}
            {p.inApp ? ` They keep the app until you remove them under Using the app.` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void takeOff()} disabled={busy || readOnly} className={BUTTON} style={{ background: C.orange, color: '#000' }}>
              Remove from list
            </button>
            <button type="button" onClick={() => backTo('view')} className={BUTTON} style={{ background: C.plain, color: C.soft }}>
              Keep on list
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3" data-testid="confirm-delete">
        <p className="text-[15px]" style={{ color: '#fff' }}>
          Delete {name}&apos;s record for good?
        </p>
        <p className="text-sm" style={{ color: C.soft }}>
          Everything on it is gone and can&apos;t be brought back.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void deleteForGood()} disabled={busy || readOnly} className={BUTTON} style={{ background: C.redBg, color: C.red }}>
            Delete for good
          </button>
          <button type="button" onClick={() => backTo('view')} className={BUTTON} style={{ background: C.plain, color: C.soft }}>
            Keep the record
          </button>
        </div>
      </div>
    );
  };

  const renderJoin = (p) => {
    if (joinPick !== null) {
      const { keep, remove } = joinRoles();
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm" style={{ color: C.soft }}>
            Merge duplicate: the two records become one. The one you <b>keep</b> keeps everything it has, and takes the other&apos;s
            details only where its own are empty. The other is removed.
          </p>
          <CompareRecords keep={keep} remove={remove} fields={fields} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void join()} disabled={busy || readOnly} className={BUTTON} style={{ background: C.orange, color: '#000' }}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Merge
            </button>
            <button type="button" onClick={() => {
                setRefusal(null);
                setKeepThis((k) => !k);
              }} disabled={busy} className={BUTTON} style={{ background: C.plain, color: C.soft }}>
              <ArrowLeftRight className="w-4 h-4" />
              Swap
            </button>
            <button type="button" onClick={() => {
                setRefusal(null);
                setJoinPick(null);
              }} disabled={busy} className={BUTTON} style={{ background: C.plain, color: C.soft }}>
              Back
            </button>
          </div>
        </div>
      );
    }
    // Only the answer for what the box says now: an older search's answer is not shown.
    const found = joinResults !== null && joinResults.q === joinQuery.trim() ? joinResults : null;
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm" style={{ color: C.soft }}>
          Merge duplicate: find the other record of {p.fullName || 'this person'}. You choose which one to keep next.
        </p>
        <label className="relative block">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.muted }} />
          <input
            type="search"
            aria-label="Find the other record"
            maxLength={MEMBER_LIST_QUERY_MAX_CHARS}
            placeholder="Name, email or phone"
            value={joinQuery}
            onChange={(e) => setJoinQuery(e.target.value)}
            className={`${INPUT} pl-9`}
            style={inputStyle}
          />
        </label>
        {found?.error ? (
          <p className="text-sm" style={{ color: C.red }}>
            {found.error}
          </p>
        ) : null}
        {found?.items && found.items.length === 0 ? (
          <p className="text-sm" style={{ color: C.muted }}>
            No other record matches.
          </p>
        ) : null}
        {found?.items ? (
          <ul className="flex flex-col gap-2">
            {found.items.map((r) => (
              <li key={r.entryId}>
                <button
                  type="button"
                  data-entry-id={r.entryId}
                  onClick={onPick}
                  disabled={picking !== null}
                  className="w-full text-left rounded-xl px-3 py-2.5"
                  style={{ background: C.card, border: `1px solid ${C.line}` }}
                >
                  <span className="block font-medium" style={{ color: '#fff' }}>
                    {r.fullName || 'No name'}
                  </span>
                  <span className="block text-sm truncate" style={{ color: C.muted }}>
                    {contactWords(r)}
                    {r.formerAt !== null ? ' · past member' : ''}
                    {picking === r.entryId ? ' · opening…' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <button type="button" onClick={() => setMode('view')} className={`${BUTTON} self-start`} style={{ background: C.plain, color: C.soft }}>
          Back
        </button>
      </div>
    );
  };

  let body;
  if (deleted !== null) {
    body = (
      <p className="text-sm" style={{ color: C.soft }} data-testid="deleted-note">
        {deleted}&apos;s record was deleted.
      </p>
    );
  } else if (id === null || (mode === 'edit' && shown !== null)) {
    body = renderForm();
  } else if (loadError !== null) {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm" style={{ color: C.soft }}>
          {loadError}
        </p>
        <button
          type="button"
          onClick={() => {
            setLoadError(null);
            setAttempt((n) => n + 1);
          }}
          className={`${BUTTON} self-start`}
          style={{ background: C.plain, color: C.soft }}
        >
          Try again
        </button>
      </div>
    );
  } else if (shown === null) {
    body = (
      <p className="text-sm flex items-center gap-2" style={{ color: C.muted }}>
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </p>
    );
  } else if (mode === 'takeOff' || mode === 'delete' || mode === 'again' || mode === 'share') {
    body = renderConfirm(shown);
  } else if (mode === 'join') {
    body = renderJoin(shown);
  } else {
    body = renderDetails(shown);
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: 'rgba(10,9,8,0.88)' }} data-testid="member-person">
      <div className="min-h-full flex items-start sm:items-center justify-center sm:p-6">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onKeyDown={keepFocusInside}
          className="w-full sm:max-w-[560px] min-h-[100dvh] sm:min-h-0 sm:rounded-[28px] p-5 sm:p-6 flex flex-col gap-4 outline-none"
          style={{ background: C.panel, border: `1px solid ${C.line}` }}
        >
          <div className="flex items-center gap-3">
            <h2 id={titleId} className="text-xl font-bold flex-1 min-w-0 break-words" style={{ color: '#fff' }}>
              {title}
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: C.plain, color: C.soft }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {notice !== null ? (
            <p className="text-sm flex items-center gap-2" style={{ color: C.green }} role="status">
              <Check className="w-4 h-4" />
              {notice}
            </p>
          ) : null}
          {refusal !== null ? (
            <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: C.redBg }} role="alert">
              <p className="text-sm" style={{ color: '#fff' }}>
                {refusal.message}
              </p>
              <div className="flex flex-wrap gap-2">
                {refusal.openId !== null ? (
                  <button type="button" onClick={() => openRecord(refusal.openId)} className={BUTTON} style={{ background: C.plain, color: C.soft }}>
                    Open that record
                  </button>
                ) : null}
                {refusal.ack !== null ? (
                  <button type="button" onClick={() => void refusal.ack()} disabled={busy} className={BUTTON} style={{ background: C.plain, color: C.soft }}>
                    Go ahead anyway
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {body}
        </div>
      </div>
    </div>
  );
}
