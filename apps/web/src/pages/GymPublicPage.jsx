import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Clock, Loader2, MapPin, X } from 'lucide-react';
import { ENQUIRY_SOURCE_WORDS, ENQUIRY_WORDS, GYM_ENQUIRY_MAX_MESSAGE_CHARS, LEAD_SOURCES } from '@app/shared';
import { orgService, errorCode, errorStatus, errorText, gymPhotoUrl } from '../api/orgsApi';
import { EMPTY_ENQUIRY, enquiryBody, enquiryProblem, facilityLines, hoursView } from './gymPublicView';
import { useRobotCheck } from './useRobotCheck';

// A gym's own page, `/gyms/{slug}` (ROADMAP 20c-iv-a; spec Part 3 §16.3): the gym's
// name, town, photos (20c-iv-b), opening hours, "About us" and facilities, and a form that makes the
// person one of its leads. Public: no sign-in. `?embed=1` is the form alone, for the
// frame a gym puts in its own website. Whatever happened to the message, a sent form
// says the same thanks.

const INK = '#1A1916';
const MUTED = '#5E5A52';
const LINE = '#E4E1DA';
const ACCENT = '#E8590C';

const inputClass = 'w-full rounded-xl px-3.5 py-3 text-[15px] outline-none focus:ring-2';
const inputStyle = { border: `1px solid ${LINE}`, background: '#fff', color: INK, '--tw-ring-color': ACCENT };

function Field({ label, hint, children, htmlFor }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold" style={{ color: INK }}>
        {label}
      </label>
      {children}
      {hint ? (
        <p className="text-[13px]" style={{ color: MUTED }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function EnquiryForm({ slug, page }) {
  const [form, setForm] = useState(EMPTY_ENQUIRY);
  const [problem, setProblem] = useState(null);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState(null);
  const { boxRef, token: robotToken, failed: robotFailed, blocked: robotBlocked, reset: resetRobot } = useRobotCheck(page.robotCheckKey);
  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    setProblem(null);
  };

  const send = async (e) => {
    e.preventDefault();
    if (sending) return;
    const wrong = enquiryProblem(form);
    if (wrong !== null) {
      setProblem(wrong);
      return;
    }
    if (robotToken === null) {
      if (robotBlocked) setProblem(ENQUIRY_WORDS.robot_blocked(page.name));
      else setProblem(robotFailed ? ENQUIRY_WORDS.robot : 'Tick the box to show you’re not a robot.');
      return;
    }
    setSending(true);
    try {
      await orgService.sendGymEnquiry(slug, enquiryBody(form, robotToken));
      setSentTo(form.fullName.trim().split(/\s+/)[0] ?? '');
    } catch (err) {
      resetRobot();
      // The page's own allowance says so in its own words; the address's is "from here".
      const busy = errorStatus(err) === 429 && errorCode(err) !== 'page_busy';
      setProblem(busy ? ENQUIRY_WORDS.too_many : errorText(err, 'We couldn’t send your message. Please try again.'));
    } finally {
      setSending(false);
    }
  };

  if (sentTo !== null) {
    return (
      <div className="flex flex-col gap-2 py-4" role="status">
        <p className="text-lg font-bold" style={{ color: INK }}>
          Thanks{sentTo === '' ? '' : `, ${sentTo}`}.
        </p>
        <p className="text-[15px]" style={{ color: MUTED }}>
          {page.name} will be in touch.
        </p>
      </div>
    );
  }

  const noEmail = form.email.trim() === '';
  return (
    <form onSubmit={send} noValidate className="flex flex-col gap-4">
      <Field label="Name" htmlFor="enq-name">
        <input id="enq-name" autoComplete="name" maxLength={120} value={form.fullName} onChange={set('fullName')} className={inputClass} style={inputStyle} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" htmlFor="enq-email">
          <input
            id="enq-email"
            type="email"
            autoComplete="email"
            maxLength={254}
            value={form.email}
            onChange={set('email')}
            className={inputClass}
            style={inputStyle}
          />
        </Field>
        <Field label="Phone" htmlFor="enq-phone">
          <input id="enq-phone" type="tel" autoComplete="tel" maxLength={40} value={form.phone} onChange={set('phone')} className={inputClass} style={inputStyle} />
        </Field>
      </div>
      <p className="text-[13px] -mt-2" style={{ color: MUTED }}>
        An email address or a phone number, so they can reach you.
      </p>
      <Field label="How did you hear about us?" htmlFor="enq-source">
        <select id="enq-source" value={form.source} onChange={set('source')} className={inputClass} style={inputStyle}>
          <option value="">Choose one (optional)</option>
          {LEAD_SOURCES.map((source) => (
            <option key={source} value={source}>
              {ENQUIRY_SOURCE_WORDS[source]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Message (optional)" htmlFor="enq-message">
        <textarea
          id="enq-message"
          rows={4}
          maxLength={GYM_ENQUIRY_MAX_MESSAGE_CHARS}
          value={form.message}
          onChange={set('message')}
          placeholder="What would you like to know?"
          className={inputClass}
          style={inputStyle}
        />
      </Field>
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={form.mayEmail} onChange={set('mayEmail')} className="mt-1 w-4 h-4 accent-current" style={{ color: ACCENT }} />
        <span className="text-[15px]" style={{ color: INK }}>
          Happy to hear from {page.name} by email
          {form.mayEmail && noEmail ? (
            <span className="block text-[13px]" style={{ color: MUTED }}>
              Add your email address above.
            </span>
          ) : null}
        </span>
      </label>
      {/* A field no person sees or fills; a robot filling every field fills it. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        {/* A name and label no autofill knows, so a browser never fills it for a person. */}
        <label htmlFor="enq-hp">Leave this field empty</label>
        <input id="enq-hp" name="enq_hp" tabIndex={-1} autoComplete="off" value={form.trap} onChange={set('trap')} />
      </div>
      <div ref={boxRef} data-testid="robot-check" />
      {problem !== null ? (
        <p className="text-sm font-medium" role="alert" style={{ color: '#B42318' }}>
          {problem}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={sending}
        className="w-full rounded-xl py-3.5 text-[15px] font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
        style={{ background: ACCENT, color: '#fff', minHeight: 48 }}
      >
        {sending ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
        {sending ? 'Sending…' : 'Send'}
      </button>
      <p className="text-[13px]" style={{ color: MUTED }}>
        Your details go only to {page.name}, so they can reply.
      </p>
    </form>
  );
}

/** The gym's photos: the main one large, the rest in a row under it; a tap opens one
 *  full size, with Previous, Next and Close (Esc and the arrow keys too). */
function Photos({ slug, page }) {
  const [open, setOpen] = useState(null);
  const photos = page.photos;
  const count = photos.length;
  const closeRef = useRef(null);

  useEffect(() => {
    if (open === null) return undefined;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight') setOpen((i) => (i + 1) % count);
      if (e.key === 'ArrowLeft') setOpen((i) => (i - 1 + count) % count);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, count]);

  if (count === 0) return null;
  const src = (photo) => gymPhotoUrl({ slug, photoId: photo.id });
  const alt = (i) => `${page.name}, photo ${i + 1} of ${count}`;
  const [main, ...rest] = photos;
  return (
    <section aria-label="Photos" className="flex flex-col gap-2">
      <button type="button" onClick={() => setOpen(0)} className="block w-full rounded-2xl overflow-hidden" style={{ aspectRatio: '16 / 9', background: LINE }}>
        <img src={src(main)} alt={alt(0)} className="w-full h-full object-cover" />
      </button>
      {rest.length > 0 ? (
        <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
          {rest.map((photo, i) => (
            <button key={photo.id} type="button" onClick={() => setOpen(i + 1)} className="block rounded-xl overflow-hidden" style={{ aspectRatio: '1 / 1', background: LINE }}>
              <img src={src(photo)} alt={alt(i + 1)} loading="lazy" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
      {open !== null ? (
        <div role="dialog" aria-modal="true" aria-label={alt(open)} className="fixed inset-0 z-50 flex flex-col" style={{ background: 'rgba(12, 11, 10, 0.94)' }}>
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <span className="text-sm">
              {open + 1} of {count}
            </span>
            <button ref={closeRef} type="button" aria-label="Close" onClick={() => setOpen(null)} className="w-11 h-11 flex items-center justify-center rounded-full">
              <X aria-hidden="true" className="w-6 h-6" />
            </button>
          </div>
          <div className="relative flex-grow min-h-0 flex items-center justify-center px-2 pb-6">
            <img src={src(photos[open])} alt={alt(open)} className="max-w-full max-h-full object-contain" />
            {count > 1 ? (
              <>
                <button type="button" aria-label="Previous photo" onClick={() => setOpen((open - 1 + count) % count)} className="absolute left-2 w-11 h-11 flex items-center justify-center rounded-full text-white" style={{ background: 'rgba(0,0,0,0.45)' }}>
                  <ChevronLeft aria-hidden="true" className="w-6 h-6" />
                </button>
                <button type="button" aria-label="Next photo" onClick={() => setOpen((open + 1) % count)} className="absolute right-2 w-11 h-11 flex items-center justify-center rounded-full text-white" style={{ background: 'rgba(0,0,0,0.45)' }}>
                  <ChevronRight aria-hidden="true" className="w-6 h-6" />
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function GymPublicPage() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const embedded = params.get('embed') === '1';
  const [state, setState] = useState({ loading: true, page: null, error: null });

  useEffect(() => {
    let gone = false;
    orgService.getPublicGymPage(slug).then(
      (res) => {
        if (!gone) setState({ loading: false, page: res.data.page, error: null });
      },
      (err) => {
        if (gone) return;
        setState({
          loading: false,
          page: null,
          error: errorStatus(err) === 404 ? ENQUIRY_WORDS.not_found : errorText(err, 'We couldn’t load this page. Please try again.'),
        });
      },
    );
    return () => {
      gone = true;
    };
  }, [slug]);

  useEffect(() => {
    if (state.page !== null && typeof document !== 'undefined') document.title = state.page.name;
  }, [state.page]);

  const shell = (children) => (
    // Its own background in a frame too: the app's is dark, and the page behind a frame
    // is the gym's website, whatever colour that is.
    <div className={embedded ? 'min-h-screen p-4' : 'min-h-screen px-4 py-8 sm:py-12'} style={{ background: embedded ? '#FFFFFF' : '#F6F5F2', color: INK }}>
      <div className="mx-auto w-full max-w-2xl flex flex-col gap-6">{children}</div>
    </div>
  );

  if (state.loading) {
    return shell(
      <p className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
        <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Loading…
      </p>,
    );
  }
  if (state.page === null) {
    return shell(
      <p className="text-[15px]" style={{ color: MUTED }}>
        {state.error}
      </p>,
    );
  }

  const page = state.page;
  if (embedded) {
    return shell(
      <section className="flex flex-col gap-4">
        <h1 className="text-xl font-bold" style={{ color: INK }}>
          Get in touch with {page.name}
        </h1>
        <EnquiryForm slug={slug} page={page} />
      </section>,
    );
  }

  const hours = hoursView(page.hours);
  const facilities = facilityLines(page);
  const card = 'rounded-2xl p-5 sm:p-6 flex flex-col gap-3';
  const cardStyle = { background: '#fff', border: `1px solid ${LINE}` };
  return shell(
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight" style={{ color: INK }}>
          {page.name}
        </h1>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[15px]" style={{ color: MUTED }}>
          {page.city ? (
            <span className="flex items-center gap-1.5">
              <MapPin aria-hidden="true" className="w-4 h-4" /> {page.city}
            </span>
          ) : null}
          {hours !== null ? (
            <span className="flex items-center gap-1.5">
              <Clock aria-hidden="true" className="w-4 h-4" /> {hours.headline}
            </span>
          ) : null}
        </div>
      </header>

      <Photos slug={slug} page={page} />

      {page.about.trim() !== '' ? (
        <section className={card} style={cardStyle}>
          <h2 className="text-lg font-bold" style={{ color: INK }}>About us</h2>
          <p className="text-[15px] whitespace-pre-line" style={{ color: MUTED }}>
            {page.about}
          </p>
        </section>
      ) : null}

      {facilities.length > 0 ? (
        <section className={card} style={cardStyle}>
          <h2 className="text-lg font-bold" style={{ color: INK }}>Facilities</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {facilities.map((line) => (
              <li key={line} className="flex items-start gap-2 text-[15px]">
                <Check aria-hidden="true" className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: ACCENT }} />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {hours !== null && hours.week.length > 0 ? (
        <section className={card} style={cardStyle}>
          <h2 className="text-lg font-bold" style={{ color: INK }}>Opening hours</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[15px]">
            {hours.week.map((day) => (
              <div key={day.label} className="contents" style={day.today ? { fontWeight: 700 } : undefined}>
                <dt style={{ color: day.today ? INK : MUTED }}>{day.label}</dt>
                <dd style={{ color: INK }}>{day.line}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className={card} style={cardStyle}>
        <h2 className="text-lg font-bold" style={{ color: INK }}>Get in touch</h2>
        <EnquiryForm slug={slug} page={page} />
      </section>
    </>,
  );
}
