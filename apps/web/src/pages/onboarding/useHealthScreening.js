// The health answer, as the server holds it (ROADMAP Stage 1 item 4b-i). Its
// own hook because it is its own table behind its own route (3b): the wizard's
// PATCH /onboarding never carries it, and Settings changes it without touching
// the fitness profile.
//
// A save shows at once and is stored in turn, the way the wizard's answers are:
// the tap is laid over the server's answer through `deriveHealthFlags` — THE
// one rule, shared with the server, never a second copy of it — and the
// server's own reply replaces it when it lands. A save that fails puts the
// stored answer back, so the screen never keeps a yes the server refused.
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { deriveHealthFlags } from '@app/shared';
import { errorText } from '../../api/orgsApi';
import { healthService } from '../../api/healthApi';

const LOAD_FAILED = "Couldn't load your health answer. Check your connection and try again.";
const SAVE_FAILED = "Couldn't save that answer. Please try again.";

export function useHealthScreening() {
  const [state, setState] = useState({
    status: 'loading',
    first: null, // the answer as it stood on arrival: where the person lands
    screening: null,
    saving: false,
    error: null,
  });

  // What the SERVER last said, which a failed save falls back to. A ref, not
  // the state itself: reading state inside an updater to stash it would be a
  // side effect in a function React may run more than once.
  const stored = useRef(null);

  const load = useCallback(async () => {
    try {
      const { healthScreening } = (await healthService.get()).data;
      stored.current = healthScreening;
      setState((s) => ({
        ...s,
        status: 'ready',
        first: s.first ?? healthScreening,
        screening: healthScreening,
        error: null,
      }));
    } catch (err) {
      setState((s) => ({ ...s, status: 'failed', error: errorText(err, LOAD_FAILED) }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** One answer. Resolves true when the server stored it — the caller re-reads
   *  the plan then, because a yes moves the daily number. */
  const save = useCallback(async (body) => {
    const optimistic = {
      answered: true,
      hasCondition: body.hasCondition,
      checkFirst: body.checkFirst ?? null,
      ...deriveHealthFlags({ hasCondition: body.hasCondition, checkFirst: body.checkFirst ?? null }),
      updatedAt: null,
    };
    setState((s) => ({ ...s, screening: optimistic, saving: true }));
    try {
      const { healthScreening } = (await healthService.put(body)).data;
      stored.current = healthScreening;
      setState((s) => ({ ...s, screening: healthScreening, saving: false }));
      return true;
    } catch (err) {
      setState((s) => ({ ...s, screening: stored.current, saving: false }));
      toast.error(errorText(err, SAVE_FAILED));
      return false;
    }
  }, []);

  return {
    status: state.status,
    error: state.error,
    first: state.first,
    screening: state.screening,
    saving: state.saving,
    save,
    retry: () => {
      setState((s) => ({ ...s, status: 'loading', error: null }));
      void load();
    },
  };
}
