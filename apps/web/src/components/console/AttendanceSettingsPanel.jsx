import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';
import { ConsoleSection } from './ConsoleStates';

// MARKING ATTENDANCE — the owner's on/off switch, Kd's ruling (:26469 §1.4):
// *"the owner can switch manual OFF in Settings"*.
//
// **THE SWITCH IS ON SETTINGS AND THE LIST IS NOT, AND THAT IS THE RULING
// RATHER THAN AN INCONSISTENCY** (:28107): *"Settings is where a gym CONFIGURES
// itself; a section is where it WORKS"*. Ruling 17 moved the list of who came
// out to its own section; it did not move the setting that turns the feature on.
//
// **IT DEFAULTS ON, AND THAT WAS A DELIBERATE CALL** (:26586): turning manual
// off today would leave a gym with NO way to record attendance at all, because
// the QR path is the phone app's (:26558, :26586 — *"drop the scan part
// completely from web men"*). The day the scanner ships, a gym that wants
// scan-only has this switch; until then, off means nobody can mark.
//
// IT SAVES ON ITS OWN, like the clock switch on the hours panel and for the same
// reason: a toggle that needed a Save button would be a form of one control, and
// the owner has already said what they want by flipping it. It rides
// `PATCH /v1/orgs/:gymId` — a setting ABOUT the feature, bound by nothing the
// country lock protects (no money, no day boundary, no currency).

export default function AttendanceSettingsPanel({ org, readOnly }) {
  const gymId = org.id;
  // THE SERVER'S ANSWER IS THE TRUTH AND THIS IS THE PENDING ECHO OF IT. The
  // switch draws from the kept org row, so a failed save leaves it showing what
  // the gym actually has rather than what was attempted — the one thing a
  // toggle must never get wrong.
  const enabled = org.manualAttendanceEnabled !== false;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const toggle = async () => {
    if (readOnly || saving) return;
    const next = !enabled;
    setSaving(true);
    setError(null);
    try {
      await orgService.updateOrg(gymId, { manualAttendanceEnabled: next });
      // The kept console answer feeds this panel AND the Attendance section's
      // empty state, which has to be able to say "the button is switched off"
      // rather than "nobody came" — so both must learn about this at once.
      refreshConsoleOrgsAfterChange();
    } catch (err) {
      setError(errorText(err, "We couldn't change that just now. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  // NO `forceOpen`, AND IT IS REASONED RATHER THAN FORGOTTEN — `GymDetailsPanel`'s
  // exact argument (:20338). That flag exists for a panel whose read can FAIL
  // WHILE NOBODY IS LOOKING, because a closed row over an error card says
  // nothing, which is worse than the error (:12660). This panel fetches
  // nothing — every value comes from the org row the console already holds — and
  // its one error is the consequence of a SAVE, which cannot happen unless the
  // section is already open.
  //
  // THE CLOSED HEADING STILL ANSWERS THE QUESTION (:20338): the summary says
  // which way the switch is set, so an owner learns the state without opening
  // anything. A row that made you open it to learn what the heading used to tell
  // you is worse than the wall it replaced.
  return (
    <ConsoleSection
      title="Marking attendance"
      summary={enabled ? 'Members can mark themselves in' : 'Switched off'}
    >
      <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
        When this is on, a member opening their gym in the app can tap
        &ldquo;I&apos;m here&rdquo; and you&apos;ll see them under Attendance.
      </p>

      <label className="flex items-start gap-3 mt-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={toggle}
          disabled={readOnly || saving}
          className="mt-0.5"
        />
        <span className="min-w-0">
          <span className="text-sm block" style={{ color: '#fff' }}>
            Let members mark themselves in
          </span>
          {/* SAYS WHAT SWITCHING IT OFF ACTUALLY COSTS, because today it is the
              only way in — a member cannot scan anything on the web, and staff
              marking somebody present is not built (:27900, "not now"). An owner
              turning this off is turning attendance off, and should read that
              here rather than discover it from an empty screen tomorrow. */}
          <span className="text-xs block mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Turning this off stops attendance being recorded at all — it&apos;s the
            only way in until the phone app&apos;s QR code arrives.
          </span>
        </span>
        {saving ? (
          <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: '#FF8A1F' }} />
        ) : null}
      </label>

      {error !== null ? (
        <p className="text-sm mt-2" style={{ color: '#ef4444' }}>
          {error}
        </p>
      ) : null}
    </ConsoleSection>
  );
}
