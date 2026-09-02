import { Link, useParams } from 'react-router-dom';
import { ConsoleCard, ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import GymDetailsPanel from '../../components/console/GymDetailsPanel';
import OpeningHoursPanel from '../../components/console/OpeningHoursPanel';
import AttendanceSettingsPanel from '../../components/console/AttendanceSettingsPanel';
import StaffPanel from '../../components/console/StaffPanel';
import { useConsoleOrg } from './useConsoleOrg';
import { canManageStaff } from './staffView';
import { canManageOrg } from './gymDetailsView';
import { consoleIsReadOnly } from './billingView';
import { viewerPrivileges } from './consoleView';

// SETTINGS — Part 3 §3.1's sixth nav item, and §4.7 is what belongs on it:
// Profile · Codes · Privacy · Notifications · Staff.
//
// IT NOW CARRIES TWO OF THEM: the gym's own details (§4.7's "Profile") and
// Staff. Profile arrived on 2026-08-26 with `PATCH /v1/orgs/:gymId` — until that
// morning the gym row was insert-only and the comment here said so.
// Notifications still has no server side whatsoever, and Privacy's §2.4 sheet is
// built for the MEMBER's side of the door rather than the console's. Each has
// its own owed line. A greyed heading for an unbuilt section is a promise on
// screen, which is the same call `ConsoleLayout` makes about the four nav items
// it does not draw.
//
// THE TWO SECTIONS ARE GATED SEPARATELY, on the two privileges the server gates
// them with. Both are the owner's by default, and an owner may tick either
// across to a manager (:11429 rule 3) — so a person holding one and not the
// other sees exactly the section they can use, rather than a screen that decides
// on a job title. Hiding is not the enforcement (R3.3): the server refuses every
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

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleLoading label="Loading your gym…" />
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
            We couldn&apos;t find a gym you run at this address.
          </p>
          <Link to="/console" className="text-sm inline-block mt-3" style={{ color: '#FF8A1F' }}>
            Your gyms
          </Link>
        </ConsoleCard>
      </div>
    );
  }

  const privileges = viewerPrivileges(org);
  const canEditGym = canManageOrg(privileges);
  const canEditStaff = canManageStaff(privileges);
  // Part 3 §4.2's read-only console. **It gates neither section**, and that
  // distinction is the whole design: a lapsed gym's staff still SEE everything
  // (Kd's ruling, :23711 — read-only "seals nobody out"), so the panels are
  // drawn exactly as before and it is their CONTROLS that go quiet.
  const readOnly = consoleIsReadOnly(org);

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
        <GymDetailsPanel
          key={`gym-${org.id}`}
          org={org}
          privileges={privileges}
          readOnly={readOnly}
        />
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
        <OpeningHoursPanel
          key={`hours-${org.id}`}
          org={org}
          privileges={privileges}
          readOnly={readOnly}
        />
      ) : null}

      {/* MARKING ATTENDANCE — the owner's on/off switch (:26469 §1.4).
          **THE SWITCH IS HERE AND THE LIST OF WHO CAME IS NOT, and that is Kd's
          ruling 17 rather than an inconsistency** (:28107): *"Settings is where
          a gym CONFIGURES itself; a section is where it WORKS"*. The list moved
          out to its own console section; the setting that turns the feature on
          stayed.

          Gated on `org.manage`, the same privilege the server gates
          `PATCH /v1/orgs/:gymId` with — the switch rides that request for
          `clockFormat`'s reason, being a setting ABOUT the feature rather than a
          use OF it.

          KEYED for the two panels' reason above: one route, so moving between
          gyms changes the parameter without remounting, and this panel holds a
          pending flag and a save error that must not follow the owner onto
          another gym. The prefix is round 4's requirement (:20867). */}
      {canEditGym ? (
        <AttendanceSettingsPanel
          key={`attendance-${org.id}`}
          org={org}
          readOnly={readOnly}
        />
      ) : null}

      {/* KEYED FOR THE SAME REASON, AND IT IS THE CLASS HALF OF THE FIX ABOVE.
          Found by probing for the sibling rather than by the review, which named
          only `GymDetailsPanel` — :1239's rule is that fixing the instance and
          leaving the class is the recorded defect, and this repo has recorded it
          at least five times.

          MEASURED, not assumed: with gym B's staff read still in flight, gym A's
          staff rows were on screen under gym B's name. It is worse than a stale
          list, because the row's controls act on the CURRENT `gymId` with the OLD
          person's id — so a Remove aimed at somebody visible would be sent
          against a gym they do not staff.

          The effect already re-reads on `gymId`, which is why the wrong list is
          temporary; the key is what stops it ever being shown.

          PREFIXED for round 4's reason above. It was the SURVIVOR of the
          duplicate pair purely because it is written second — nothing recorded
          that dependency, and reordering these two blocks would have silently
          handed the defect to this panel instead. The prefix removes the
          ordering dependency along with the duplicate. */}
      {canEditStaff ? (
        <StaffPanel
          key={`staff-${org.id}`}
          gymId={org.id}
          privileges={privileges}
          orgType={org.orgType}
          readOnly={readOnly}
        />
      ) : null}

      {!canEditGym && !canEditStaff ? (
        /* REACHABLE BY TYPING THE ADDRESS, and that is the only way here — the
           nav does not draw this tab for somebody holding neither power, because
           every section on it would answer them with a refusal. Somebody who
           arrives anyway is TOLD, rather than shown an empty screen that reads as
           a gym with no staff and no name. */
        <ConsoleCard>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            Only the gym&apos;s owner can change these settings.
          </p>
        </ConsoleCard>
      ) : null}

      <p className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
        Your join codes are on{' '}
        <Link to={`/console/${orgSlug}`} style={{ color: '#FF8A1F' }}>
          your gym&apos;s main screen
        </Link>
        .
      </p>
    </div>
  );
}
