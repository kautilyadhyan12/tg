import { useEffect, useId, useState } from 'react';
import { Check, FileSignature, Loader2 } from 'lucide-react';
import { AGREEMENT_WORDS, WAIVER_NAME_MAX_CHARS, waiverReadyToSign } from '@app/shared';
import { agreementLinkService } from '../api/agreementLinkApi';
import { errorCode, errorStatus, errorText } from '../api/orgsApi';
import { deskSigner } from './console/waiverView';
import { ACCENT, INK, LINE, MUTED } from './GymPublicPage';
import { LINK_OPEN_AGAIN, linkClosedLine, linkSignedLine, linkSignerWords, linkTokenFromHash } from './agreementLinkView';

// THE PAGE AN EMAILED LINK TO SIGN OPENS, `/sign-agreement#<token>` (ROADMAP 18u-ii-b; spec Part 3
// §14.8). Public: no sign-in. The person, or a parent or guardian for somebody under 18, reads the
// membership's details and the business's terms, types their name and ticks, as at the desk. The
// token is after "#", so no server sees it in an address; the page keeps it in memory, sends it in
// the body, and takes it out of the address bar and the browser's history at once.
// Changed details or words are read again before anything is signed.

const WARM = '#FFF4EA';
const AMBER = '#FFB347';

function Tick({ checked, onChange, disabled, children }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)} disabled={disabled} className="flex items-start gap-3 min-h-11 text-left">
      <span
        className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md"
        style={{ border: `2px solid ${checked ? ACCENT : '#B9B4AA'}`, background: checked ? ACCENT : '#fff' }}
      >
        {checked ? <Check aria-hidden="true" className="h-3.5 w-3.5 text-white" strokeWidth={3} /> : null}
      </span>
      <span className="text-[15px] font-medium" style={{ color: INK }}>
        {children}
      </span>
    </button>
  );
}

function Card({ children, label }) {
  return (
    <section aria-label={label} className="flex flex-col gap-3 rounded-3xl bg-white p-6 sm:p-8" style={{ border: `1px solid ${LINE}` }}>
      {children}
    </section>
  );
}

export default function AgreementSignPage() {
  const nameId = useId();
  const [token] = useState(() => (typeof window === 'undefined' ? null : linkTokenFromHash(window.location.hash)));
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash !== '') window.history.replaceState(window.history.state, '', window.location.pathname);
  }, []);
  const [page, setPage] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState(null);
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (token === null) return undefined;
    let live = true;
    agreementLinkService.read(token).then(
      (data) => {
        if (!live) return;
        setLoadError(null);
        setPage(data);
      },
      (err) => {
        if (!live) return;
        setLoadError(errorStatus(err) === 404 ? AGREEMENT_WORDS.link_not_valid : errorText(err, "We couldn't load the agreement. Try again."));
      },
    );
    return () => {
      live = false;
    };
  }, [token, attempt]);

  useEffect(() => {
    if (page !== null && typeof document !== 'undefined') document.title = `Membership agreement · ${page.gymName}`;
  }, [page]);

  const open = page?.state === 'open' ? page : null;
  const signer = open === null ? null : deskSigner(open.minor, picked);
  const words = open === null || signer === null ? null : linkSignerWords(open.personName, signer, open.minor);
  const canSign = open !== null && signer !== null && waiverReadyToSign(name, agreed) && !busy && done === null;

  const sign = async () => {
    if (!canSign) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await agreementLinkService.sign(token, { agreementId: open.agreement.id, factsKey: open.factsKey, signer, name });
      setDone(linkSignedLine(res.emailed, open.gymName));
    } catch (err) {
      const code = errorCode(err);
      if (code === 'link_expired') {
        setPage({ state: 'closed', gymName: open.gymName, reason: 'expired' });
      } else if (code === 'link_not_valid') {
        setPage(null);
        setLoadError(AGREEMENT_WORDS.link_not_valid);
      } else {
        setProblem(errorText(err, "We couldn't sign the agreement. Try again."));
        // New details or words, or the record now says under 18: the page reads again, and the
        // tick is pressed again for what is on screen.
        if (code === 'facts_changed' || code === 'agreement_changed' || code === 'guardian_needed' || code === 'person_signs' || code === 'agreement_not_in_use') {
          if (code === 'guardian_needed' || code === 'person_signs') setName('');
          setAgreed(false);
          setAttempt((n) => n + 1);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const shell = (children) => (
    <div className="min-h-screen px-4 py-8 sm:py-12" style={{ background: `linear-gradient(180deg, ${WARM} 0%, #F6F5F2 420px)`, color: INK }}>
      <main className="mx-auto w-full max-w-2xl flex flex-col gap-6">{children}</main>
    </div>
  );
  const header = (gymName) => (
    <header
      className="relative overflow-hidden rounded-3xl px-6 py-8 sm:px-10 sm:py-10 text-white"
      style={{ background: `linear-gradient(135deg, ${ACCENT} 0%, #F47B20 55%, ${AMBER} 100%)`, boxShadow: '0 24px 48px -28px rgba(232,89,12,0.75)' }}
    >
      <span aria-hidden="true" className="absolute -right-10 -top-10 h-40 w-40 rounded-full" style={{ background: 'rgba(255,255,255,0.14)' }} />
      <span aria-hidden="true" className="absolute -bottom-16 right-16 h-32 w-32 rounded-full" style={{ background: 'rgba(255,255,255,0.10)' }} />
      <p className="relative flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.16em]" style={{ background: 'rgba(255,255,255,0.22)' }}>
        <FileSignature aria-hidden="true" className="h-3.5 w-3.5" /> Membership agreement
      </p>
      <h1 className="relative mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl" style={{ overflowWrap: 'anywhere' }}>
        {gymName}
      </h1>
    </header>
  );
  const notice = (text) => (
    <Card label="About this link">
      <p className="text-[15px]" role="status" style={{ color: MUTED }}>
        {text}
      </p>
    </Card>
  );

  if (token === null) return shell(notice(LINK_OPEN_AGAIN));
  if (loadError !== null && page === null) return shell(notice(loadError));
  if (page === null) {
    return shell(
      <p className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
        <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Loading the agreement…
      </p>,
    );
  }
  if (open === null) return shell(<>{header(page.gymName)}{notice(linkClosedLine(page))}</>);

  if (done !== null) {
    return shell(
      <>
        {header(open.gymName)}
        <Card label="Signed">
          <p className="flex items-center gap-2 text-xl font-bold" role="status" style={{ color: INK }}>
            <span className="flex h-8 w-8 items-center justify-center rounded-full text-white" style={{ background: ACCENT }}>
              <Check aria-hidden="true" className="h-4 w-4" strokeWidth={3} />
            </span>
            Signed
          </p>
          <p className="text-[15px]" style={{ color: MUTED }}>
            {done}
          </p>
        </Card>
      </>,
    );
  }

  const termsTitle = open.agreement.name ?? `${open.gymName}'s terms`;
  return shell(
    <>
      {header(open.gymName)}
      <Card label="The membership">
        <h2 className="text-lg font-bold" style={{ color: INK }}>
          The membership
        </h2>
        <dl className="m-0 grid gap-x-4 gap-y-1.5" style={{ gridTemplateColumns: 'minmax(6.5rem, max-content) 1fr' }}>
          {open.facts.map((fact) => (
            <div key={fact.label} className="contents">
              <dt className="text-[14px]" style={{ color: MUTED }}>
                {fact.label}
              </dt>
              <dd className="m-0 text-[15px]" style={{ color: INK, overflowWrap: 'anywhere' }}>
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card label="The terms">
        <h2 className="text-lg font-bold" style={{ color: INK }}>
          {termsTitle}
        </h2>
        <div
          role="region"
          aria-label={termsTitle}
          tabIndex={0}
          className="max-h-96 overflow-y-auto rounded-2xl px-4 py-3 text-[15px] leading-relaxed"
          style={{ background: '#FAF9F7', border: `1px solid ${LINE}`, color: INK, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        >
          {open.agreement.text}
        </div>
      </Card>
      <Card label="Sign">
        <h2 className="text-lg font-bold" style={{ color: INK }}>
          Sign
        </h2>
        {open.minor === null ? (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Who is signing?">
            <span className="text-sm font-semibold" style={{ color: INK }}>
              Who is signing?
            </span>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'person', label: open.personName === '' ? 'The member' : open.personName },
                { value: 'guardian', label: 'A parent or guardian, for someone under 18' },
              ].map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  role="radio"
                  aria-checked={picked === choice.value}
                  onClick={() => {
                    setPicked(choice.value);
                    setName('');
                    setAgreed(false);
                  }}
                  className="min-h-11 rounded-full px-4 text-[15px] font-medium"
                  style={picked === choice.value ? { background: ACCENT, color: '#fff', border: `1px solid ${ACCENT}` } : { background: '#fff', color: INK, border: `1px solid ${LINE}` }}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {words !== null ? (
          <>
            {words.lead !== null ? (
              <p className="text-[15px]" style={{ color: MUTED }}>
                {words.lead}
              </p>
            ) : null}
            <label htmlFor={nameId} className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold" style={{ color: INK }}>
                {words.nameLabel}
              </span>
              <input
                id={nameId}
                type="text"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
                maxLength={WAIVER_NAME_MAX_CHARS}
                className="w-full rounded-xl px-3.5 py-3 text-[15px] outline-none focus:ring-2"
                style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK, '--tw-ring-color': ACCENT }}
              />
            </label>
            <Tick checked={agreed} onChange={setAgreed} disabled={busy}>
              {words.agree}
            </Tick>
          </>
        ) : null}
        {problem !== null ? (
          <p className="rounded-xl px-3 py-2 text-[14px]" role="alert" style={{ background: '#FFF4E5', color: '#8A4B00' }}>
            {problem}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void sign()}
          disabled={!canSign}
          className="mt-1 inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-full px-7 text-[16px] font-semibold text-white disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${ACCENT}, #F47B20)`, boxShadow: canSign ? '0 12px 28px -12px rgba(232,89,12,0.8)' : 'none' }}
        >
          {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          {busy ? 'Signing…' : 'Sign agreement'}
        </button>
      </Card>
    </>,
  );
}
