// One disclaimer tap (RULINGS 2026-09-07: one explicit tap at sign-up, at the
// health step and on the plan screen, stored with the time, the build and the
// words). Shared by setup's two notes and the sign-up note ("Before you start",
// ROADMAP 4d), so the three record a tap the same way.
import { useState } from 'react';
import toast from 'react-hot-toast';
import { consentService } from '../api/healthApi';
import { errorText } from '../api/orgsApi';

/** Recorded the moment it is made — so the consent log holds it whether or not
 *  the person goes on. `agreed` turns true only once the server has kept it. */
export function useDisclaimerTap(purpose) {
  const [agreed, setAgreed] = useState(false);
  const [agreeing, setAgreeing] = useState(false);
  const agree = async () => {
    setAgreeing(true);
    try {
      await consentService.record(purpose);
      setAgreed(true);
    } catch (err) {
      toast.error(errorText(err, "Couldn't record that just now. Please try again."));
    } finally {
      setAgreeing(false);
    }
  };
  return { agreed, agreeing, agree };
}
