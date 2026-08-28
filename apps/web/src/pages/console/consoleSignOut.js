import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/** SIGNING OUT OF THE CONSOLE — one implementation, two callers.
 *
 *  **THE WAY OUT IS SIGN OUT, NOT A LINK INTO THE MEMBER APP** (Kd ruling
 *  2026-08-19): the login page's two doors are the only crossing in either
 *  direction, and `logout()` clears the door choice as well as the session,
 *  which is what keeps a gym's shared front-desk browser honest.
 *
 *  **IT EXISTS AS A HOOK BECAUSE THE UNSKIPPABLE PROMPT NEEDED THE SAME BUTTON**
 *  (2026-08-28). The shell's rail and phone bar are BEHIND that overlay, so the
 *  prompt carries its own Sign out — and the gym-created screen draws the prompt
 *  outside the shell entirely. Copying three lines into each would be three
 *  sign-out paths, which is exactly the shape :1239 records: a guarantee that
 *  depends on every copy remembering something is a guarantee waiting for the
 *  copy that forgets.
 *
 *  `signingOut` is FEEDBACK, NOT A GUARD (T3 round 1, L8 on the shell): the
 *  console has no transition overlay, so without a pending state a press on a
 *  slow connection looks like a dead button and invites a second press. */
export function useConsoleSignOut() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    await logout();
    navigate('/login');
  };

  return { signingOut, signOut };
}
