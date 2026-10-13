import { WAIVER_MAX_CHARS, cleanWaiverText, waiverSaveAsks } from '@app/shared';

// The words of Settings' Waiver box (ROADMAP 3e-i), worked out from what the server sent
// (`gymWaiverResponseSchema`) and what is typed. Pure.

const people = (n) => (n === 1 ? '1 person' : `${String(n)} people`);

/** The box's line when it is folded shut. */
export function waiverSummary(data) {
  if (data === null) return '';
  if (data.waiver === null) return 'Not set up';
  if (!data.inUse) return 'Not in use';
  return `In use · ${signedCount(data)}`;
}

/** "signed by 3 of 12 people in the app". */
export function signedCount(data) {
  if (data.people === 0) return 'nobody is in the app yet';
  return `signed by ${String(data.signed)} of ${people(data.people)} in the app`;
}

/** What Save would do with the words typed: nothing to save, too long, or go. */
export function waiverDraftState(data, draft) {
  const text = cleanWaiverText(draft);
  if (text === '') return { canSave: false, problem: null };
  if (text.length > WAIVER_MAX_CHARS) {
    return { canSave: false, problem: `Your waiver is ${String(text.length - WAIVER_MAX_CHARS)} characters too long. The most we can keep is ${WAIVER_MAX_CHARS.toLocaleString('en-GB')}.` };
  }
  const same = data.waiver !== null && cleanWaiverText(data.waiver.text) === text;
  // The same words can still be saved while the waiver is not in use: that starts it again.
  return { canSave: !same || !data.inUse, problem: null };
}

/** The Save button's words. */
export function waiverSaveLabel(data) {
  if (data.waiver === null) return 'Save waiver';
  return data.inUse ? 'Save changes' : 'Use this waiver';
}

/** Who saving these words asks to sign, said before Save; null where it asks nobody. */
export function waiverAsksLine(data, draft) {
  return waiverSaveAsks({ savedText: data.waiver?.text ?? null, inUse: data.inUse, draft, people: data.people });
}

/** What the save did, said beside the button. */
export function waiverSavedLine(after) {
  if (after.people === 0) return 'Saved. People will read and sign it when they join in the app.';
  const toSign = after.people - after.signed;
  if (toSign === 0) return `Saved. ${after.people === 1 ? 'The 1 person in the app has' : `All ${String(after.people)} people in the app have`} already signed these words.`;
  return `Saved. ${people(toSign)} in the app ${toSign === 1 ? 'is' : 'are'} now asked to sign it.`;
}

/** The box that asks before the waiver is stopped: who changes and who does not. */
export function waiverStopWords(data) {
  return {
    question: 'Stop using this waiver?',
    changes: 'Nobody will be asked to sign it: not people who join, and not people already in the app.',
    kept: data.signed === 0 ? 'Its words are kept here, so you can start using it again.' : `Its words and the ${data.signed === 1 ? '1 signature' : `${String(data.signed)} signatures`} you have are kept, so you can start using it again.`,
  };
}

/** A person's page, under one of the record's people in the app: whether they have signed
 *  the gym's waiver as it is today, and the name they typed. `when` writes the day. */
export function waiverLine(member, when) {
  const signed = member.waiverSigned ?? null;
  if (signed === null) return 'Waiver not signed';
  const day = when(signed.at);
  return `Waiver signed${day === '' ? '' : ` on ${day}`} as ${signed.name}`;
}

/** A person's page, for a record with nobody in the app at a gym that asks for a waiver. */
export function waiverNotInAppLine(fullName) {
  return `Not signed. ${fullName === '' ? 'This person signs' : `${fullName} signs`} your waiver when they join in the app.`;
}
