import { orgWords } from '@app/shared';
import { placeTo } from './consolePlaces';

// OVERVIEW'S "START HERE" LIST (ROADMAP 23b): what the box says and where each button
// goes. The server sends the steps this person can do and whether each is done; nothing
// here decides either.

/** One step's words and buttons. Each button opens the page where the step is done. */
function stepWords(step, orgSlug, orgType) {
  const words = orgWords(orgType);
  const to = (place) => placeTo(orgSlug, place);
  switch (step) {
    case 'memberships':
      return {
        title: 'What you sell',
        line: `The memberships and class packs people buy from you, with their prices. You pick one of them when you add a ${words.person}.`,
        actions: [{ label: 'Set up memberships', to: to('memberships') }],
      };
    case 'members':
      return {
        title: `Bring your ${words.people} in`,
        line: `Import your ${words.person} list from a spreadsheet or your old software, or add people one at a time. Then tick them and press Invite: each person gets an email and joins the app with that email address.`,
        // Both are changes to the list, so a gym with no live plan gets them greyed, as
        // the "Bring your members in" card this step stands in for does.
        actions: [
          { label: `Import ${words.people}`, to: to('importMembers'), changes: true },
          { label: `Add ${words.person}`, to: to('addMember'), changes: true },
        ],
      };
    case 'staff':
      return {
        title: 'Invite your staff',
        line: 'Front desk, managers and trainers each sign in as themselves, and you choose what each of them can do.',
        // Members → Staff, with the form open (23c-ii). A gym with no live plan gets it
        // greyed, as the form itself would be.
        actions: [{ label: 'Invite staff', to: to('inviteStaff'), changes: true }],
      };
    case 'classes':
      return {
        title: 'Add your classes',
        line: `Add each class you run, then its time slots: the days and times it runs. It is then on your calendar for ${words.people} to book.`,
        actions: [{ label: 'Set up classes', to: to('classes') }],
      };
    case 'hours':
      return {
        title: 'Opening hours',
        line: `Say when you're open, so your ${words.people} see it in the app.`,
        actions: [{ label: 'Set opening hours', to: to('openingHours') }],
      };
    case 'contact':
      return {
        title: `How ${words.people} reach you`,
        line: `Add a phone number or an email address. Your ${words.people} see it in the app, so they can call or write to you.`,
        actions: [{ label: 'Add your phone or email', to: to('memberContact') }],
      };
    case 'frontDesk':
      return {
        title: 'Front desk check-in',
        line: 'Add a tablet or computer at your front desk and open its link on it. People then scan their pass from the app, or their key tag, as they walk in.',
        actions: [{ label: 'Set up check-in', to: to('frontDesk') }],
      };
    default:
      return null;
  }
}

/** What Overview draws of the list.
 *
 *  `show` is 'list' (the box), 'hidden' (only the line that brings it back, for whoever
 *  may) or 'none'. It is 'none' while the read is on its way or has failed, for somebody
 *  with no step of their own, and once every step is done for somebody who cannot hide
 *  the finished box. */
export function startHereView(startHere, orgSlug, orgType) {
  const none = { show: 'none', rows: [], doneCount: 0, total: 0, allDone: false, canHide: false, hasMembers: false };
  if (startHere === null || startHere === undefined || !Array.isArray(startHere.steps)) return none;
  const rows = startHere.steps
    .map((s) => {
      const words = stepWords(s.step, orgSlug, orgType);
      if (words === null) return null;
      const done = s.done === true;
      // Done means people are on the LIST. The card under this box counts who has joined
      // the app, so the line says which this is and what brings them in.
      const line =
        s.step === 'members' && done
          ? `Your ${orgWords(orgType).person} list has people on it. They join the app once you tick them on ${orgWords(orgType).peopleCap} and press Invite.`
          : words.line;
      return { step: s.step, done, ...words, line };
    })
    .filter((row) => row !== null);
  if (rows.length === 0) return none;
  const canHide = startHere.canHide === true;
  if (startHere.hidden === true) return { ...none, show: canHide ? 'hidden' : 'none', canHide };
  const doneCount = rows.filter((row) => row.done).length;
  const allDone = doneCount === rows.length;
  if (allDone && !canHide) return none;
  // The step to do next: the first one not done.
  const next = rows.find((row) => !row.done)?.step ?? null;
  return {
    show: 'list',
    rows: rows.map((row) => ({ ...row, next: row.step === next })),
    doneCount,
    total: rows.length,
    allDone,
    canHide,
    hasMembers: rows.some((row) => row.step === 'members'),
  };
}

/** "2 of 7 done". */
export function startHereCount(view) {
  return `${String(view.doneCount)} of ${String(view.total)} done`;
}
