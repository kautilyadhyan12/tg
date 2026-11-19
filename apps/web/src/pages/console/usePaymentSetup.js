import { useCallback, useEffect, useState } from 'react';
import { orgService } from '../../api/orgsApi';
import { onConsoleChange } from '../../api/attentionApi';
import { needsPaymentSetup } from './paymentsOverviewView';

// WHETHER PAYMENTS OVERVIEW'S MENU LINE SAYS "SET UP" (ROADMAP V1-f; spec Part 3 §17.11): until
// Square is connected, read from Settings' own Payments route. Read on arrival, for another
// business, and again after a write to Square's connection from this console (connect, choose
// a location, disconnect); never on a timer. A read that fails shows no tag.

const SQUARE_WRITE = /\/payments\/square(\/|$)/;

export function usePaymentSetup(gymId, active) {
  const [state, setState] = useState({ gymId: null, setup: false });
  const on = active && typeof gymId === 'string' && gymId !== '';
  const reload = useCallback(() => {
    if (!on) return;
    // A read that throws before it is sent is a failed read too: no tag.
    Promise.resolve()
      .then(() => orgService.getGymPayments(gymId))
      .then((res) => setState({ gymId, setup: needsPaymentSetup(res.data.payments) }))
      .catch(() => undefined);
  }, [gymId, on]);
  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => {
    if (!on) return undefined;
    return onConsoleChange((kind, path) => {
      if (kind === 'change' && typeof path === 'string' && SQUARE_WRITE.test(path) && !/\/terminals(\/|$)/.test(path)) reload();
    });
  }, [on, reload]);
  return on && state.gymId === gymId && state.setup;
}
