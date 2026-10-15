import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Gift, Loader2, MapPin } from 'lucide-react';
import { REFERRAL_WORDS } from '@app/shared';
import { orgService, errorStatus, errorText } from '../api/orgsApi';
import { ACCENT, EnquiryForm, INK, LINE, MUTED } from './GymPublicPage';
import { inviteView } from './inviteView';

// A MEMBER'S INVITE LINK, `/invite/{code}` (ROADMAP 20e-ii-a; spec Part 3 §16.3): every
// business has this page, whether or not it has a page of its own. It says which business
// invited the friend and the welcome offer it set, and its form makes them one of the
// business's leads, marked as the member's friend. It never names the member. Public: no
// sign-in.

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
    <div className="min-h-screen px-4 py-8 sm:py-12" style={{ background: '#F6F5F2', color: INK }}>
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
  const { invited, offer, touch, setBy } = inviteView(invite);
  const card = 'rounded-2xl p-5 sm:p-6 flex flex-col gap-3';
  const cardStyle = { background: '#fff', border: `1px solid ${LINE}` };
  // The form's own page fields: the business's name and the robot check's key.
  const page = { name: invite.gymName, robotCheckKey: invite.robotCheckKey };
  return shell(
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight" style={{ color: INK }}>
          {invite.gymName}
        </h1>
        {invite.city ? (
          <p className="flex items-center gap-1.5 text-[15px]" style={{ color: MUTED }}>
            <MapPin aria-hidden="true" className="w-4 h-4" /> {invite.city}
          </p>
        ) : null}
        <p className="text-[17px]" style={{ color: INK }}>
          {invited}
        </p>
      </header>

      {gift !== null ? (
        <section className={card} style={{ ...cardStyle, borderColor: ACCENT }} aria-label="Your welcome offer">
          <div className="flex items-start gap-3">
            <Gift aria-hidden="true" className="w-6 h-6 flex-shrink-0 mt-0.5" style={{ color: ACCENT }} />
            <div className="flex flex-col gap-2">
              <p className="text-[15px]" style={{ color: INK }}>
                {offer}
              </p>
              <p className="text-2xl font-bold tracking-widest" style={{ color: INK }}>
                {gift.code}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className={card} style={cardStyle}>
        <h2 className="text-lg font-bold" style={{ color: INK }}>
          Get in touch
        </h2>
        <p className="text-[15px]" style={{ color: MUTED }}>
          {touch}
        </p>
        <EnquiryForm page={page} askSource={false} send={(body) => orgService.sendInviteEnquiry(code, withoutSource(body))} />
      </section>

      {invite.pageSlug !== null ? (
        <Link to={`/gyms/${encodeURIComponent(invite.pageSlug)}`} className="text-[15px] font-semibold underline" style={{ color: ACCENT }}>
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
