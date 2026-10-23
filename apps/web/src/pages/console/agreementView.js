import { AGREEMENT_AGREE_LABEL, WAIVER_MAX_CHARS, cleanWaiverText } from '@app/shared';

// The words of the membership agreement (ROADMAP 18u-i): Settings' box, worked out from what the
// server sent (`gymAgreementResponseSchema`) and what is typed, and the box under a membership on
// a person's page (`membershipAgreementResponseSchema`). Pure.

const memberships = (n) => (n === 1 ? '1 membership' : `${String(n)} memberships`);

// ── Settings ──

/** The box's line when it is folded shut. */
export function agreementSummary(data) {
  if (data === null) return '';
  if (data.agreement === null) return 'Not set up';
  if (!data.inUse) return 'Not in use';
  return `In use · signed for ${memberships(data.signed)}`;
}

/** What Save would do with the words typed: nothing to save, too long, or go. */
export function agreementDraftState(data, draft) {
  const text = cleanWaiverText(draft);
  if (text === '') return { canSave: false, problem: null };
  if (text.length > WAIVER_MAX_CHARS) {
    return { canSave: false, problem: `Your agreement is ${String(text.length - WAIVER_MAX_CHARS)} characters too long. The most we can keep is ${WAIVER_MAX_CHARS.toLocaleString('en-GB')}.` };
  }
  const same = data.agreement !== null && cleanWaiverText(data.agreement.text) === text;
  // The same words can still be saved while the agreement is not in use: that starts it again.
  return { canSave: !same || !data.inUse, problem: null };
}

/** The Save button's words. */
export function agreementSaveLabel(data) {
  if (data.agreement === null) return 'Save agreement';
  return data.inUse ? 'Save changes' : 'Use this agreement';
}

/** What saving changed words does to the memberships already signed, said before Save; null
 *  where it changes nobody's. */
export function agreementAsksLine(data, draft) {
  const text = cleanWaiverText(draft);
  if (text === '' || data.agreement === null || data.signed === 0) return null;
  if (cleanWaiverText(data.agreement.text) === text) return null;
  return 'The memberships already signed keep the words they were signed with. Memberships you give from now on are signed with the new words.';
}

/** What the save did, said beside the button. */
export function agreementSavedLine(before, after) {
  if (before !== null && before.agreement !== null && !before.inUse && after.inUse && before.agreement.version === after.agreement?.version) {
    return 'Saved. It is in use again: each membership you give is signed with it.';
  }
  return before?.agreement == null ? 'Saved. Each membership you give from now on is signed with it.' : 'Saved. Memberships you give from now on are signed with these words.';
}

/** The box that asks before the agreement is stopped: who changes and who does not. */
export function agreementStopWords(data) {
  return {
    question: 'Stop using this agreement?',
    changes: 'Nobody will be asked to sign it when you give a membership.',
    kept:
      data.signed === 0
        ? 'Its words are kept here, so you can start using it again.'
        : `Its words and the ${data.signed === 1 ? '1 signed membership' : `${String(data.signed)} signed memberships`} are kept, so you can start using it again.`,
  };
}

// ── On a person's page, under one membership ──

/** The line under a membership: signed, or still to sign. Null where there is nothing to say:
 *  no agreement in use and none signed, or one over and never signed. `when` writes a day. */
export function agreementLineParts(membership, inUse, signable, when) {
  if (membership.agreement != null) {
    const day = when(membership.agreement.at);
    return { tone: 'good', label: 'Agreement signed', rest: day === '' ? '' : ` on ${day}`, signed: true };
  }
  if (inUse && signable) return { tone: 'warn', label: 'Agreement not signed', rest: '', signed: false };
  return null;
}

/** The box's words for the one signing. */
export function agreementBoxWords(personName, signer, minor) {
  const name = personName === '' ? 'this person' : personName;
  if (signer === 'guardian') {
    return {
      handOver:
        minor === true
          ? `${name} is under 18. Hand this screen to their parent or guardian, who reads the agreement and signs it for them.`
          : `Hand this screen to ${name}'s parent or guardian. They read the agreement and sign it for ${name}.`,
      nameLabel: "Parent or guardian's full name",
      agree: `I am ${name}'s parent or guardian. I have read this agreement and I agree to it for them.`,
    };
  }
  return {
    handOver: `Hand this screen to ${name}. They read the agreement and sign it themselves.`,
    nameLabel: 'Your full name',
    agree: AGREEMENT_AGREE_LABEL,
  };
}

/** What the box says once it has signed, by what became of the copy. */
export function agreementSignedLine(emailed) {
  if (emailed === 'sent') return 'Signed. A copy was emailed to them.';
  if (emailed === 'no_email') return 'Signed. There is no email address on their record, so no copy was emailed.';
  if (emailed === 'blocked') return "Signed. Their email address can't receive our emails, so no copy was sent. Check it in their details.";
  return "Signed, but the copy didn't send. Press View, then Email a copy to try again.";
}

/** Who signed, as the signed copy says it. */
export function agreementSignedBy(signed, when) {
  const day = when(signed.at);
  const on = day === '' ? '' : ` on ${day}`;
  return signed.signer === 'guardian' ? `Signed by ${signed.name}, parent or guardian,${on}.` : `Signed by ${signed.name}${on}.`;
}

/** What became of the copy, under the signed copy. */
export function agreementCopyLine(signed, hasEmail, when) {
  if (signed.emailedAt !== null) {
    const day = when(signed.emailedAt);
    return day === '' ? 'A copy was emailed to them.' : `A copy was emailed to them on ${day}.`;
  }
  return hasEmail ? 'No copy has been emailed yet.' : 'There is no email address on their record, so no copy was emailed.';
}

/** What Email a copy did. */
export function agreementResentLine(emailed) {
  if (emailed === 'sent') return 'A copy was emailed to them.';
  if (emailed === 'no_email') return 'There is no email address on their record. Add one to their details, then try again.';
  if (emailed === 'blocked') return "Their email address can't receive our emails. Check it in their details.";
  return "The copy didn't send. Try again later.";
}
