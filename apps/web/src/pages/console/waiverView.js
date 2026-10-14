import { WAIVER_AGREE_LABEL, WAIVER_MAX_CHARS, cleanWaiverText, waiverSaveAsks } from '@app/shared';

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
  return waiverSaveAsks({ savedText: data.waiver?.text ?? null, inUse: data.inUse, draft, people: data.people, signed: data.signed });
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
  const parts = waiverLineParts(member, when);
  return parts.label + parts.rest;
}

/** `waiverLine` in two parts, so the page can draw the state as a coloured label: the
 *  label's words, its tone (`good`, `warn`, `plain`), and the rest of the sentence.
 *
 *  ON AN EMAIL A FAMILY SHARES the page is one person's record and the signature may be
 *  another's, so it is never said that this record signed: the label is plain and names
 *  who typed the signature. */
export function waiverLineParts(member, when) {
  const signed = member.waiverSigned ?? null;
  if (signed === null) return { tone: 'warn', label: 'Waiver not signed', rest: '' };
  const day = when(signed.at);
  const on = day === '' ? '' : ` on ${day}`;
  if (member.sharedEmail === true) {
    return { tone: 'plain', label: `Signed as ${signed.name}`, rest: `${on}. This email address is shared, so we can't tell which of them signed.` };
  }
  return { tone: 'good', label: 'Waiver signed', rest: `${on} as ${signed.name}` };
}

// ── At the desk (3e-ii) ──

/** Whether somebody in the app whose record this certainly is has signed: their own
 *  signature, not one on an email a family shares. */
export function signedInApp(entry) {
  return (entry?.members ?? []).some((member) => member.waiverSigned != null && member.sharedEmail !== true);
}

/** The Waiver card's label and sentence for a record signed at the desk, or not signed. */
export function deskWaiverParts(entry, when) {
  const desk = entry?.waiverDesk ?? null;
  const name = entry?.fullName === '' || entry?.fullName == null ? 'This person' : entry.fullName;
  if (desk === null) {
    const inApp = (entry?.members ?? []).length > 0;
    return { tone: 'warn', label: 'Waiver not signed', rest: `${name} can sign it here at the desk, or in the app${inApp ? '' : ' when they join'}.` };
  }
  const day = when(desk.at);
  const on = day === '' ? '' : ` on ${day}`;
  return desk.signer === 'guardian'
    ? { tone: 'good', label: 'Waiver signed', rest: `at the desk${on} by ${desk.name}, parent or guardian` }
    : { tone: 'good', label: 'Waiver signed', rest: `at the desk${on} as ${desk.name}` };
}

/** Who signs in the desk's box: the person, or their parent or guardian. `minor` is the
 *  record's own answer (null where it holds no date of birth); `picked` is the box's. */
export function deskSigner(minor, picked) {
  if (minor === true) return 'guardian';
  if (minor === false) return 'person';
  return picked;
}

/** The desk box's words for the one signing. */
export function deskBoxWords(personName, signer, minor) {
  const name = personName === '' ? 'this person' : personName;
  if (signer === 'guardian') {
    return {
      handOver: minor === true
        ? `${name} is under 18. Hand this screen to their parent or guardian, who reads the waiver and signs it for them.`
        : `Hand this screen to ${name}'s parent or guardian. They read the waiver and sign it for ${name}.`,
      nameLabel: "Parent or guardian's full name",
      agree: `I am ${name}'s parent or guardian. I have read this waiver and I agree to it for them.`,
    };
  }
  return {
    handOver: `Hand this screen to ${name}. They read the waiver and sign it themselves.`,
    nameLabel: 'Your full name',
    agree: WAIVER_AGREE_LABEL,
  };
}

/** What the card says once the box has signed. */
export function deskSignedLine(personName) {
  return `Signed. ${personName === '' ? 'The' : `${personName}'s`} waiver is kept with ${personName === '' ? 'this' : 'their'} record.`;
}
