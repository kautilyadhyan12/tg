import { useCallback, useEffect, useState } from 'react';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import { againWords, doneWords, undoWords } from '../../pages/console/membershipWordsView';

// The member list's membership names, read and acted on (spec Part 3 §13.2; ROADMAP
// 17a-iii): what the Memberships page draws them from. All four calls need
// `members.confirm`; somebody without it gets no names, and the price list alone.

/** The list's membership names and what the gym does with them. `types` is the price
 *  list as the panel holds it: the names are read again whenever it changes, so a type
 *  added, renamed or archived is never shown as it was. */
export function useListMemberships(gymId, types) {
  const [words, setWords] = useState([]);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const load = useCallback(
    (isLive = () => true) =>
      orgService
        .getMembershipWords(gymId)
        .then((res) => {
          if (isLive()) setWords(res.data.words);
        })
        // Somebody without the tick to open a member's page sees the price list alone.
        .catch(() => {
          if (isLive()) setWords([]);
        }),
    [gymId],
  );

  useEffect(() => {
    if (types === undefined) return undefined;
    let cancelled = false;
    void load(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [load, types]);

  /** Open the box: who would get this type, for the people with this name. */
  const open = async (word, typeId) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await orgService.previewMembershipLink(gymId, { word, typeId });
      setPreview(res.data);
    } catch (err) {
      setError(errorText(err, "We couldn't work out who would get that membership. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const give = async (body) => {
    if (preview === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await orgService.linkMembershipWord(gymId, body);
      setWords(res.data.list.words);
      setDone(doneWords(res.data.given, preview.word, preview.type.name));
      setPreview(null);
    } catch (err) {
      if (errorCode(err) === 'membership_link_done') {
        // The same press had already gone through: show the list as it is now.
        setPreview(null);
        setDone(errorText(err, "This was already done, and nothing more was given. Check each person's page."));
        void load();
        return;
      }
      setError(errorText(err, "We couldn't do that. Nobody was given a membership. Please try again."));
      if (errorCode(err) === 'membership_link_changed') {
        // The box holds an older list: show the people as they are now.
        try {
          const again = await orgService.previewMembershipLink(gymId, { word: body.word, typeId: body.typeId });
          setPreview(again.data);
        } catch {
          setPreview(null);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  /** Undo "this name is this type". Nobody's membership changes. */
  const undo = async (word) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await orgService.unlinkMembershipWord(gymId, { word: word.word });
      setWords(res.data.words);
      // A name whose type was archived is set up again; any other goes back to be set up.
      setDone(word.link?.typeArchived ? againWords(word).done : undoWords(word).done);
      return true;
    } catch (err) {
      setError(errorText(err, "We couldn't change that. Please try again."));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const closeBox = () => {
    setPreview(null);
    setError(null);
  };

  return { words, preview, busy, error, done, open, give, undo, closeBox };
}
