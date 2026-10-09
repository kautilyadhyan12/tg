import { useCallback, useEffect, useRef, useState } from 'react';
import { inboxService } from '../api/inboxApi';
import { errorText } from '../api/orgsApi';

const LOADING = { loading: true, error: null, inbox: null, unread: 0 };

// ONE GYM'S INBOX, read when the gym's page opens so its tab can say how many are new
// before it is opened (ROADMAP 20a). `gymId` null reads nothing.
export function useGymInbox(gymId) {
  // What was read, and for which gym: another gym's answer is never shown as this one's.
  const [state, setState] = useState({ gymId: null, ...LOADING });
  /** The newest read asked for; an older one that answers late is dropped. */
  const asked = useRef(0);

  const load = useCallback(() => {
    if (gymId === null) return;
    const mine = ++asked.current;
    inboxService.read(gymId).then(
      (inbox) => asked.current === mine && setState({ gymId, loading: false, error: null, inbox, unread: inbox.unread }),
      (err) => asked.current === mine && setState({ gymId, loading: false, error: errorText(err, "Couldn't load your messages."), inbox: null, unread: 0 }),
    );
  }, [gymId]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = state.gymId === gymId ? state : LOADING;

  const reload = () => {
    setState({ gymId, ...LOADING });
    load();
  };

  /** Tells the server the messages shown have been seen. The list keeps its New marks
   *  until it is read again; only the count goes. A failure leaves the count as it was. */
  const read = shown.inbox;
  const unread = shown.unread;
  const markSeen = useCallback(() => {
    if (gymId === null || read === null || unread === 0) return;
    inboxService.markRead(gymId, read.asOf).then(
      (left) => setState((s) => (s.inbox === read ? { ...s, unread: left } : s)),
      () => {},
    );
  }, [gymId, read, unread]);

  return { loading: shown.loading, error: shown.error, inbox: shown.inbox, unread: shown.unread, reload, markSeen };
}
