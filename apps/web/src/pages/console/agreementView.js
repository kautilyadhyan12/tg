import { AGREEMENT_AGREE_LABEL, AGREEMENT_NAME_MAX, MAIN_AGREEMENT_NAME, WAIVER_MAX_CHARS, cleanWaiverText } from '@app/shared';

// The words of the membership agreement (ROADMAP 18u-i): Settings' box, worked out from what the
// server sent (`gymAgreementResponseSchema`) and what is typed, and the box under a membership on
// a person's page (`membershipAgreementResponseSchema`). Pure.

const memberships = (n) => (n === 1 ? '1 membership' : `${String(n)} memberships`);

// ── Settings ──

/** The box's line when it is folded shut. */
export function agreementSummary(data) {
  if (data === null) return '';
  const others = data.others?.length ?? 0;
  const more = others === 0 ? '' : ` · ${others === 1 ? '1 more agreement' : `${String(others)} more agreements`}`;
  if (data.agreement === null) return others === 0 ? 'Not set up' : `Main agreement not set up${more}`;
  if (!data.inUse) return `Not in use${more}`;
  return `In use · signed for ${memberships(data.signed)}${more}`;
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

// ── Settings: the business's other agreements (18u-ii-a) ──

/** The answer with its two lists, empty where an older answer has none. */
export const withLists = (data) => ({ ...data, others: data.others ?? [], prices: data.prices ?? [] });

/** What Settings and the price list call an agreement: its own name, or the main one's. */
export const agreementTitle = (name) => (name === null || name === undefined ? MAIN_AGREEMENT_NAME : name);

/** A few names, then "and N more". */
function someNames(names, few = 3) {
  if (names.length <= few) return names.join(', ');
  return `${names.slice(0, few).join(', ')} and ${String(names.length - few)} more`;
}

/** The lines of the price list another agreement is used for. */
export const usedForNames = (data, agreementId) => data.prices.filter((p) => p.agreementId === agreementId).map((p) => p.name);

/** The line under another agreement in Settings' list. */
export function otherAgreementLine(data, other) {
  if (!other.inUse) return 'Not in use. Nobody is asked to sign it.';
  const names = usedForNames(data, other.id);
  const used = names.length === 0 ? 'Not used for any membership yet' : `Used for ${someNames(names)}`;
  return `${used} · Signed for ${memberships(other.signed)}`;
}

/** The line under the main agreement once there are others: the memberships it is for. */
export function mainAgreementLine(data) {
  const names = data.prices.filter((p) => p.agreementId === null).map((p) => p.name);
  if (names.length === 0) return 'Not used for any membership now: each is ticked on another agreement.';
  return `Used for ${someNames(names)}: every membership not ticked on another agreement.`;
}

/** What each of Settings' two boxes is, said at its top. */
export const AGREEMENTS_ABOUT = 'Signed for each membership: its price, renewal and how to cancel.';

/** The address of one of the business's other agreements in Settings, from the Settings address. */
export const otherAgreementTo = (settingsTo, agreementId) => (settingsTo === null || agreementId == null ? settingsTo : settingsTo.replace(/#.*$/, `#agreement-${agreementId}`));

/** The other agreement a Settings address names ("#agreement-<id>"), or null. */
export const agreementOfSection = (section) => (typeof section === 'string' && section.startsWith('agreement-') ? section.slice('agreement-'.length) : null);

/** A new form, or one for another agreement as saved. */
export function otherDraftFrom(data, other) {
  if (other === null) return { name: '', text: '', usedFor: [] };
  return { name: other.name, text: other.agreement.text, usedFor: data.prices.filter((p) => p.agreementId === other.id).map((p) => p.id) };
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/** What Save would do with another agreement's form: a problem to fix, nothing to save, or go. */
export function otherDraftState(data, other, draft) {
  const name = draft.name.trim();
  const text = cleanWaiverText(draft.text);
  if (name === '' || text === '') return { canSave: false, problem: null };
  if (name.length > AGREEMENT_NAME_MAX) return { canSave: false, problem: `The name can be at most ${String(AGREEMENT_NAME_MAX)} characters.` };
  const clash = name.toLowerCase() === MAIN_AGREEMENT_NAME.toLowerCase() ? MAIN_AGREEMENT_NAME : data.others.find((o) => o.id !== other?.id && o.name.toLowerCase() === name.toLowerCase())?.name;
  if (clash !== undefined) return { canSave: false, problem: `You already have an agreement called ${clash}. Give this one another name.` };
  if (text.length > WAIVER_MAX_CHARS) {
    return { canSave: false, problem: `This agreement is ${String(text.length - WAIVER_MAX_CHARS)} characters too long. The most we can keep is ${WAIVER_MAX_CHARS.toLocaleString('en-GB')}.` };
  }
  if (other === null) return { canSave: true, problem: null };
  const saved = otherDraftFrom(data, other);
  const same = saved.name === name && cleanWaiverText(saved.text) === text && sameSet(saved.usedFor, draft.usedFor);
  // The same words can still be saved while it is not in use: that starts it again.
  return { canSave: !same || !other.inUse, problem: null };
}

/** Who Save changes, said before it: each line ticked that another agreement had, each line
 *  unticked that goes back to the main one, and that signed memberships keep their words. */
export function otherSaveChanges(data, other, draft) {
  const out = [];
  const id = other?.id ?? null;
  const moving = data.prices.filter((p) => draft.usedFor.includes(p.id) && p.agreementId !== null && p.agreementId !== id);
  for (const p of moving) {
    const from = data.others.find((o) => o.id === p.agreementId);
    if (from !== undefined) out.push(`${p.name} will stop using ${from.name}.`);
  }
  const leaving = id === null ? [] : data.prices.filter((p) => p.agreementId === id && !draft.usedFor.includes(p.id)).map((p) => p.name);
  if (leaving.length > 0) out.push(`${someNames(leaving)} will use the ${MAIN_AGREEMENT_NAME.toLowerCase()}.`);
  if (other !== null && other.signed > 0 && (cleanWaiverText(draft.text) !== cleanWaiverText(other.agreement.text) || leaving.length > 0)) {
    out.push('The memberships already signed keep the agreement they were signed with.');
  }
  return out;
}

/** The Save button's words for another agreement. */
export function otherSaveLabel(other) {
  if (other === null) return 'Save agreement';
  return other.inUse ? 'Save changes' : 'Use this agreement';
}

/** What saving another agreement did, said where its form was. */
export function otherSavedLine(name, data, after) {
  const saved = after.others.find((o) => o.name.toLowerCase() === name.trim().toLowerCase());
  if (saved === undefined) return 'Saved.';
  const names = usedForNames(after, saved.id);
  return names.length === 0
    ? `Saved ${saved.name}. Tick the memberships it is for, so people who take them sign it.`
    : `Saved ${saved.name}. People who take ${someNames(names)} sign it from now on.`;
}

/** The box that asks before another agreement is stopped. */
export function otherStopWords(data, other) {
  const names = usedForNames(data, other.id);
  return {
    question: `Stop using ${other.name}?`,
    changes: names.length === 0 ? 'Nobody will be asked to sign it.' : `People who take ${someNames(names)} won't be asked to sign an agreement.`,
    kept:
      other.signed === 0
        ? 'Its words are kept here, so you can start using it again.'
        : `Its words and the ${other.signed === 1 ? '1 signed membership' : `${String(other.signed)} signed memberships`} are kept, so you can start using it again.`,
  };
}

/** On the price list: which agreement a line uses; null where the business has only its main one. */
export function priceAgreementLine(list, type) {
  if (!Array.isArray(list.agreements) || list.agreements.length === 0) return null;
  const other = type.agreementId === null ? undefined : list.agreements.find((a) => a.id === type.agreementId);
  return `Agreement: ${agreementTitle(other?.name ?? null)}`;
}
