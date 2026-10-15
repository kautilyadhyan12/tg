import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, Loader2, MapPin, Sparkles } from 'lucide-react';
import { REFERRAL_WORDS } from '@app/shared';
import { orgService, errorStatus, errorText } from '../api/orgsApi';
import { ACCENT, EnquiryForm, INK, LINE, MUTED } from './GymPublicPage';
import { inviteView } from './inviteView';

// A MEMBER'S INVITE LINK, `/invite/{code}` (ROADMAP 20e-ii-a; spec Part 3 §16.3): every
// business has this page, whether or not it has a page of its own. It says who invited the
// friend (their first name only), the welcome offer the business set, and its form makes
// them one of the business's leads, marked as the member's friend. Public: no sign-in. A
// welcome, not a form (Kd at the click-through: "the form looks really generic"): a warm
// header, the gift as a ticket (no code: the business adds it), three steps, then the form.

const AMBER = '#FFB347';
const WARM = '#FFF4EA';

/** The welcome offer as a ticket: the gift in the server's words and who adds it. No code:
 *  the friend has nothing to remember or say (Kd, 2026-10-15). */
function GiftTicket({ words, note }) {
  return (
    <section aria-label="Your welcome offer" className="relative rounded-3xl bg-white px-6 py-6 sm:px-8" style={{ border: `2px dashed ${ACCENT}`, boxShadow: '0 18px 40px -24px rgba(232,89,12,0.55)' }}>
      {/* The ticket's two notches. */}
      <span aria-hidden="true" className="absolute top-1/2 -left-3 h-6 w-6 -translate-y-1/2 rounded-full" style={{ background: WARM, borderRight: `2px dashed ${ACCENT}` }} />
      <span aria-hidden="true" className="absolute top-1/2 -right-3 h-6 w-6 -translate-y-1/2 rounded-full" style={{ background: WARM, borderLeft: `2px dashed ${ACCENT}` }} />
      <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: ACCENT }}>
        Your welcome offer
      </p>
      <p className="mt-2 text-2xl font-bold leading-snug" style={{ color: INK }}>
        {words.charAt(0).toUpperCase() + words.slice(1)}
      </p>
      <p className="mt-3 flex items-center gap-2 text-[15px]" style={{ color: MUTED }}>
        <Check aria-hidden="true" className="h-4 w-4 flex-shrink-0" style={{ color: ACCENT }} /> {note}
      </p>
    </section>
  );
}

function Steps({ gymName, hasGift }) {
  const steps = ['Send your details below', `${gymName} gets in touch`, hasGift ? 'Join, and your offer comes off' : 'Join and start training'];
  return (
    <ol className="grid gap-3 sm:grid-cols-3">
      {steps.map((step, i) => (
        <li key={step} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3" style={{ border: `1px solid ${LINE}` }}>
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: `linear-gradient(135deg, ${ACCENT}, ${AMBER})` }}>
            {i + 1}
          </span>
          <span className="text-[14px] font-medium" style={{ color: INK }}>
            {step}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function InvitePage() {
  const { code } = useParams();
  const [state, setState] = useState({ loading: true, invite: null, error: null });

  useEffect(() => {
    let gone = false;
    orgService.getPublicInvite(code).then(
      (res) => {
        if (!gone) setState({ loading: false, invite: res.data.invite, error: null });
      },
      (err) => {
        if (gone) return;
        setState({
          loading: false,
          invite: null,
          error: errorStatus(err) === 404 ? REFERRAL_WORDS.not_found : errorText(err, 'We couldn’t load this invite. Please try again.'),
        });
      },
    );
    return () => {
      gone = true;
    };
  }, [code]);

  useEffect(() => {
    if (state.invite !== null && typeof document !== 'undefined') document.title = `Invite to ${state.invite.gymName}`;
  }, [state.invite]);

  const shell = (children) => (
    <div className="min-h-screen px-4 py-8 sm:py-12" style={{ background: `linear-gradient(180deg, ${WARM} 0%, #F6F5F2 420px)`, color: INK }}>
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
  if (state.invite === null) {
    return shell(
      <p className="text-[15px]" style={{ color: MUTED }}>
        {state.error}
      </p>,
    );
  }

  const invite = state.invite;
  const gift = invite.friendGift;
  const { invited, touch, setBy } = inviteView(invite);
  // The form's own page fields: the business's name and the robot check's key.
  const page = { name: invite.gymName, robotCheckKey: invite.robotCheckKey };
  return shell(
    <>
      <header
        className="relative overflow-hidden rounded-3xl px-6 py-8 sm:px-10 sm:py-10 text-white"
        style={{ background: `linear-gradient(135deg, ${ACCENT} 0%, #F47B20 55%, ${AMBER} 100%)`, boxShadow: '0 24px 48px -28px rgba(232,89,12,0.75)' }}
      >
        <span aria-hidden="true" className="absolute -right-10 -top-10 h-40 w-40 rounded-full" style={{ background: 'rgba(255,255,255,0.14)' }} />
        <span aria-hidden="true" className="absolute -bottom-16 right-16 h-32 w-32 rounded-full" style={{ background: 'rgba(255,255,255,0.10)' }} />
        <p className="relative flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.16em]" style={{ background: 'rgba(255,255,255,0.22)' }}>
          <Sparkles aria-hidden="true" className="h-3.5 w-3.5" /> You&apos;re invited
        </p>
        <h1 className="relative mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{invited}</h1>
        {invite.city ? (
          <p className="relative mt-3 flex items-center gap-1.5 text-[15px]" style={{ color: 'rgba(255,255,255,0.88)' }}>
            <MapPin aria-hidden="true" className="h-4 w-4" /> {invite.city}
          </p>
        ) : null}
      </header>

      {gift !== null ? <GiftTicket words={gift.words} note={`${invite.gymName} adds it for you when you join.`} /> : null}

      <Steps gymName={invite.gymName} hasGift={gift !== null} />

      <section className="flex flex-col gap-3 rounded-3xl bg-white p-6 sm:p-8" style={{ border: `1px solid ${LINE}` }}>
        <h2 className="text-xl font-bold" style={{ color: INK }}>
          Send your details
        </h2>
        <p className="text-[15px]" style={{ color: MUTED }}>
          {touch}
        </p>
        <EnquiryForm page={page} askSource={false} requireEmail sendLabel="Send my details" send={(body) => orgService.sendInviteEnquiry(code, withoutSource(body))} />
      </section>

      {invite.pageSlug !== null ? (
        <Link to={`/gyms/${encodeURIComponent(invite.pageSlug)}`} className="self-start text-[15px] font-semibold underline" style={{ color: ACCENT }}>
          See {invite.gymName}&apos;s page
        </Link>
      ) : null}

      {setBy !== null ? (
        <p className="text-[13px]" style={{ color: MUTED }}>
          {setBy}
        </p>
      ) : null}
    </>,
  );
}

/** The invite's form never says where the person heard of the business: the link did. */
function withoutSource(body) {
  const rest = { ...body };
  delete rest.source;
  return rest;
}
