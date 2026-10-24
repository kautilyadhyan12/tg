import { AGREEMENT_WORDS } from '@app/shared';
import { agreementBoxWords } from './console/agreementView';

// The words of the page an emailed link to sign opens (ROADMAP 18u-ii-b), worked out from what
// the server sent (`agreementLinkResponseSchema`). Pure.

/** The token after "#" in the link, or null where it is not one of ours. */
export function linkTokenFromHash(hash) {
  if (typeof hash !== 'string') return null;
  const token = hash.startsWith('#') ? hash.slice(1) : hash;
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

/** The page's words for the one signing: no "hand this screen over", they are the reader. */
export function linkSignerWords(personName, signer, minor) {
  const name = personName === '' ? 'this person' : personName;
  const { nameLabel, agree } = agreementBoxWords(personName, signer, minor);
  const lead = minor === true ? `${name} is under 18, so a parent or guardian signs this agreement for them.` : null;
  return { lead, nameLabel, agree };
}

/** What a closed link's page says. */
export function linkClosedLine(page) {
  if (page.state === 'signed') return `This agreement has already been signed. If you need a copy, ask ${page.gymName}.`;
  if (page.reason === 'expired') return AGREEMENT_WORDS.link_expired(page.gymName);
  if (page.reason === 'not_signable') return `This membership is over, cancelled or frozen, so there is nothing to sign. If you have a question, contact ${page.gymName}.`;
  return AGREEMENT_WORDS.agreement_not_in_use(page.gymName);
}

/** What the page says once signed, by what became of the copy. */
export function linkSignedLine(emailed, gymName) {
  if (emailed === 'sent') return 'A copy was emailed to you.';
  return `Your copy could not be emailed. Ask ${gymName} for one.`;
}
