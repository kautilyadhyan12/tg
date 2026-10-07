import { Link, useParams } from 'react-router-dom';
import { orgWords } from '@app/shared';
import { ConsoleCard, ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import GymDetailsPanel from '../../components/console/GymDetailsPanel';
import OpeningHoursPanel from '../../components/console/OpeningHoursPanel';
import LeadEmailsPanel from '../../components/console/LeadEmailsPanel';
import CheckinDevicesPanel from '../../components/console/CheckinDevicesPanel';
import BookingSettingsPanel from '../../components/console/BookingSettingsPanel';
import { useConsoleOrg } from './useConsoleOrg';
import { useSectionLink } from './useSectionLink';
import { DETAILS_SECTIONS, SETTINGS_SECTION } from './consolePlaces';
import { canManageSchedule } from './classesView';
import { canManageOrg } from './gymDetailsView';
import { consoleIsReadOnly } from './billingView';
import { viewerPrivileges } from './consoleView';

// SETTINGS — Part 3 §3.1's sixth nav item: the gym's own details, when it is open, class
// bookings, the front desk's devices and the follow-up emails to leads. What the gym
// sells is the Memberships page (23c-i) and its staff are on Members → Staff (23c-ii).
//
// EACH SECTION IS GATED ON THE PRIVILEGE THE SERVER GATES IT WITH, so a person holding
// one and not another sees exactly the sections they can use, rather than a screen that
// decides on a job title. Hiding is not the enforcement (R3.3): the server refuses every
// request either way.
//
// CODES ARE THE ONE EXCEPTION AND THEY ARE NOT MOVED. §4.7 lists them here;
// they were deliberately built as a SECTION on Overview (Kd's join-code card),
// under the code an owner is handing out, and moving them would be a removal
// from the screen a ruling put them on. So this screen POINTS at them instead —
// an owner who reads §4.7's list and comes looking should find the answer here
// rather than nothing.

export default function Settings() {
  const { orgSlug } = useParams();
  const { loading, error, org, notFound, reload } = useConsoleOrg(orgSlug);
  // A link that names a section ("#opening-hours") opens the page there, with it open.
  const section = useSectionLink(!loading && error === null && !notFound);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleLoading label="Loading your organisation…" />
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleFailed message={error} onRetry={reload} />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleCard>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            We couldn&apos;t find an organisation you run at this address.
          </p>
          <Link to="/console" className="text-sm inline-block mt-3" style={{ color: '#FF8A1F' }}>
            Your organisations
          </Link>
        </ConsoleCard>
      </div>
    );
  }

  const privileges = viewerPrivileges(org);
  const canEditGym = canManageOrg(privileges);
  const canEditSchedule = canManageSchedule(privileges);
  // Part 3 §4.2's read-only console. **It gates neither section**, and that
  // distinction is the whole design: a lapsed gym's staff still SEE everything
  // (Kd's ruling, :23711 — read-only "seals nobody out"), so the panels are
  // drawn exactly as before and it is their CONTROLS that go quiet.
  const readOnly = consoleIsReadOnly(org);
  // The words this screen speaks (roadmap 2b).
  const words = orgWords(org.orgType);

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#fff' }}>
          Settings
        </h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {org.name}
        </p>
      </div>

      {/* `key` IS THE WHOLE FIX FOR T3 ROUND 3's C/H-1, and it is a CLASS fix
          rather than a third patch of a case (:1239).

          `/console/:orgSlug/settings` is ONE route, so moving between two gyms'
          Settings changes the parameter WITHOUT remounting anything — and the
          panel deliberately does not follow the prop once somebody has typed
          (the same-gym rule, which is correct and stays). So gym A's typing sat
          under gym B, over gym B's own untouched city, and one Save wrote all of
          it to gym B's id **including the time zone**, moving the day boundary
          of a gym the owner was not editing.

          Keying on the gym id means React throws the panel away and builds a new
          one whenever the gym changes, so it cannot carry ANY state across —
          this draft, and every field anybody adds later, without that future
          field's author having to know this ever happened.

          **It is older than rounds 1 and 2 and was not caused by either fix** —
          round 1's work made it less bad, not worse. Kd ruled PATCH on the third
          firing of :5348's escape hatch, given that distinction (:14493: the
          hatch counts ROUNDS, Kd rules on what the rounds FOUND).

          **T3 ROUND 4 — THE KEY MUST ALSO BE UNIQUE AMONG ITS SIBLINGS, and this
          prefix is that.** Round 3 shipped the bare `org.id` on BOTH panels.
          React builds its child map by key, so the second write wins and the
          FIRST panel's fiber is dropped WITHOUT a deletion being scheduled — it
          stayed in the document across the gym change, fully typeable, showing
          gym A's name, city and zone under gym B's heading, with a live Save
          that wrote to gym A and gave the owner no confirmation either way.
          Worse than the defect it replaced, and React said so on every render:
          "Encountered two children with the same key". Prefixing per panel keeps
          round 3's guarantee and makes each key unique, which is the condition
          that guarantee always depended on. Kd ruled PATCH on the fourth
          firing. */}
      {canEditGym ? (
        // `id`: a button on another page opens Settings here, at the box it names (23d).
        <div id={SETTINGS_SECTION.details} style={{ scrollMarginTop: 16 }}>
          <GymDetailsPanel
            key={`gym-${org.id}`}
            org={org}
            privileges={privileges}
            readOnly={readOnly}
            startOpen={DETAILS_SECTIONS.includes(section)}
          />
        </div>
      ) : null}

      {/* WHEN WE'RE OPEN — Kd's opening-hours rulings (:26624, :26684, :26736),
          gated on the SAME privilege the server gates the three write routes
          with, so a person holding `org.manage` sees exactly the sections they
          can use.

          KEYED, and for the reason the two panels below it record rather than a
          new one: `/console/:orgSlug/settings` is ONE route, so moving between
          two gyms changes the parameter without remounting anything. This panel
          holds a DRAFT and its own fetched hours, so without the key gym A's
          half-typed timetable would sit under gym B's heading over gym B's
          real one — and Save writes to the CURRENT gym's id. The prefix is
          round 4's requirement: a bare `org.id` on two siblings makes React drop
          one fiber without scheduling its deletion, which was worse than the
          defect it replaced. */}
      {canEditGym ? (
        // `id`: Overview's Start here list opens the page here (23b).
        <div id={SETTINGS_SECTION.hours} style={{ scrollMarginTop: 16 }}>
          <OpeningHoursPanel
            key={`hours-${org.id}`}
            org={org}
            privileges={privileges}
            readOnly={readOnly}
            startOpen={section === SETTINGS_SECTION.hours}
          />
        </div>
      ) : null}

      {/* What the gym sells is not here: Memberships is a page of its own, in the menu
          (23c-i; Kd at its click-through: Settings needs nothing about it). */}

      {/* CLASS BOOKINGS (17c-ii-a): the four booking settings, on `schedule.manage` as the
          server gates them. Keyed per gym for the panels' reason above: it holds a form. */}
      {canEditSchedule ? <BookingSettingsPanel key={`bookings-${org.id}`} org={org} readOnly={readOnly} /> : null}

      {/* CHECK-IN DEVICES (16b-i): the front desk's tablets, on `org.manage` as the server
          gates them. Keyed per gym for the panels' reason above: it holds a typed name and
          a link shown once. */}
      {canEditGym ? (
        <div id={SETTINGS_SECTION.frontDesk} style={{ scrollMarginTop: 16 }}>
          <CheckinDevicesPanel
            key={`checkin-devices-${org.id}`}
            org={org}
            readOnly={readOnly}
            startOpen={section === SETTINGS_SECTION.frontDesk}
          />
        </div>
      ) : null}

      {/* FOLLOW-UP EMAILS TO LEADS (20c-v): the owner's "Send them for me", on the
          privilege the server gates it with. Keyed per gym for the panels' reason above:
          it holds a draft. */}
      {canEditGym ? (
        <div id={SETTINGS_SECTION.leadEmails} style={{ scrollMarginTop: 16 }}>
          <LeadEmailsPanel
            key={`lead-emails-${org.id}`}
            org={org}
            readOnly={readOnly}
            startOpen={section === SETTINGS_SECTION.leadEmails}
          />
        </div>
      ) : null}

      {/* Staff are not here: they are invited and managed on Members → Staff (23c-ii). */}

      {!canEditGym && !canEditSchedule ? (
        /* REACHABLE BY TYPING THE ADDRESS, and that is the only way here — the
           nav does not draw this tab for somebody holding neither power, because
           every section on it would answer them with a refusal. Somebody who
           arrives anyway is TOLD, rather than shown an empty screen. */
        <ConsoleCard>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            Only the {words.it}&apos;s owner can change these settings.
          </p>
        </ConsoleCard>
      ) : null}

    </div>
  );
}
