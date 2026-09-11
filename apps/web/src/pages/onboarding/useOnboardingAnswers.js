// The wizard's answers, as the server stores them, with the taps still on
// their way laid over the top. Every save goes through ONE queue, so the last
// tap is always the answer stored; the plan and the missing list are always
// the server's reply to the newest save that landed.
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { errorText } from '../../api/orgsApi';
import { onboardingService, refusedFinish } from '../../api/onboardingApi';
import { createSaveQueue, settleEdits } from './onboardingModel';

const LOAD_FAILED = "Couldn't load your answers. Check your connection and try again.";

/** `onSaved`, if given, hears the answers as the server holds them each time
 *  a save lands: the page's moment to pass one on to the rest of the app. */
export function useOnboardingAnswers({ onSaved } = {}) {
  const [state, setState] = useState({
    status: 'loading',
    first: null, // the answers as they stood on arrival: where the person lands
    server: null,
    plan: null,
    missing: [],
    edits: {},
    error: null,
  });

  // The newest `onSaved`, for a queue made once.
  const heard = useRef(onSaved);
  useEffect(() => {
    heard.current = onSaved;
  });

  const [queue] = useState(() => {
    const q = createSaveQueue({
      send: async (patch) => (await onboardingService.patch(patch)).data,
      onSaved: (data, sent) => {
        setState((s) => ({
          ...s,
          server: data.answers,
          plan: data.plan,
          missing: data.missing,
          edits: settleEdits(s.edits, sent),
        }));
        heard.current?.(data.answers);
      },
      onFailed: (err, sent) => {
        // The tap goes back to what the server last said…
        setState((s) => ({ ...s, edits: settleEdits(s.edits, sent) }));
        if (Object.keys(sent).length === 0) return;
        toast.error(errorText(err, "Couldn't save that answer. Please try again."));
        // …and what the server holds NOW is read back, in turn with any other
        // save: a save whose reply was lost may still have landed.
        q.save({});
      },
    });
    return q;
  });

  const load = useCallback(async () => {
    try {
      const res = await onboardingService.get();
      setState((s) => ({
        ...s,
        status: 'ready',
        first: s.first ?? res.data.answers,
        server: res.data.answers,
        plan: res.data.plan,
        missing: res.data.missing,
      }));
    } catch (err) {
      setState((s) => ({ ...s, status: 'failed', error: errorText(err, LOAD_FAILED) }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading', error: null }));
    void load();
  }, [load]);

  /** One screen's answer: shown at once, stored in turn. */
  const save = useCallback(
    (patch) => {
      setState((s) => ({ ...s, edits: { ...s.edits, ...patch } }));
      queue.save(patch);
    },
    [queue],
  );

  /** Finish: every save answered first, then the server decides. A refusal
   *  comes back as the list of questions still open; success, with the
   *  answers as stored (the name among them, for the rest of the app). */
  const finish = useCallback(
    async (extra) => {
      if (!(await queue.settled())) return { ok: false, missing: null };
      try {
        const res = await onboardingService.patch({ ...extra, onboardingCompleted: true });
        setState((s) => ({
          ...s,
          server: res.data.answers,
          plan: res.data.plan,
          missing: res.data.missing,
          edits: settleEdits(s.edits, extra),
        }));
        return { ok: true, missing: null, answers: res.data.answers };
      } catch (err) {
        const missing = refusedFinish(err);
        if (missing === null) toast.error(errorText(err, "Couldn't finish just now. Please try again."));
        // Read back what is stored, so the panel and the list agree with it.
        queue.save({});
        return { ok: false, missing };
      }
    },
    [queue],
  );

  return {
    status: state.status,
    error: state.error,
    first: state.first,
    answers: { ...(state.server ?? {}), ...state.edits },
    plan: state.plan,
    missing: state.missing,
    save,
    settled: queue.settled,
    finish,
    retry,
  };
}
