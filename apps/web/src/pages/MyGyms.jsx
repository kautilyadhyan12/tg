import { Link } from 'react-router-dom';
import { Building2, Loader2 } from 'lucide-react';
import { useMyGyms } from '../hooks/useMyGyms';
import GymHoursNote from '../components/gym/GymHoursNote';
import AttendancePanel from '../components/gym/AttendancePanel';

// MY GYMS — Kd's ruling of 2026-09-02, in his words: *"whenever a user joins a
// gym and gym approves them a new option will appear besides the other option
// in left called my gyms where the other features will be there ... it will
// appear only after a gym approves a memebr joining"*.
//
// **IT IS NOT THE `My Gym` THAT WAS REMOVED, and the difference is the whole
// point.** The item Kd deleted on 2026-08-19 (:11616) pointed at `/console` —
// it was a shortcut into the GYM OWNER's console, and that crossing stays shut
// in both directions with the login page's two doors the only way across. This
// points at a member screen about the member's own gym. Nothing here links to
// the console, and `loginDoorCrossing.render.test.jsx` is where that is pinned.
//
// **JOINING STILL HAPPENS IN SETTINGS**, also his ruling: the code box and the
// waiting / refused / removed states live on Settings → Gym beside
// `GymMembershipCard`, and this section is what appears on the far side of a
// gym's approval. So a person who is still waiting sees exactly what they saw
// before, in the place they already know, and nothing was moved out from under
// them.
//
// WHAT LIVES HERE IS EVERY GYM-MEMBER FEATURE AS IT ARRIVES. Today that is the
// gym's opening times (:26684 §2) and attendance (:26469, :27900). The owner's
// side of attendance — who came, by session — is the console's own section
// (:28107) and is not reachable from here.

export default function MyGyms() {
  const { loading, error, gyms, reload } = useMyGyms();

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#fff' }}>
          My gyms
        </h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
          Your gym, when it&apos;s open, and telling it you&apos;re here.
        </p>
      </div>

      {/* FOUR STATES AND THEY ARE ALL DIFFERENT SENTENCES. Loading, failed and
          "you are not in a gym" look identical in the data and must never look
          identical on screen: telling a member of three gyms that they belong
          to none, because one request dropped, is the empty-vs-failed defect
          this project has shipped once and now tests for (:8267/:8343). */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading your gyms…
        </div>
      ) : error !== null ? (
        <div
          className="rounded-2xl p-4"
          style={{ background: '#121110', border: '1px solid rgba(239,68,68,0.25)' }}
        >
          <p className="text-sm" style={{ color: '#ef4444' }}>
            {error}
          </p>
          <button
            type="button"
            onClick={reload}
            className="mt-2 rounded-xl px-3.5 py-2 text-sm font-semibold"
            style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
          >
            Try again
          </button>
        </div>
      ) : gyms.length === 0 ? (
        // REACHABLE BY TYPING THE ADDRESS, not through the nav — the item is
        // only drawn for a member. It says where joining happens rather than
        // leaving somebody on an empty screen, and it points at the ONE place
        // that door lives (Kd: the code box stays in Settings).
        <div
          className="rounded-2xl p-4"
          style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <p className="text-sm" style={{ color: '#fff' }}>
            You&apos;re not a member of a gym yet.
          </p>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Your gym gives you a code. Enter it in Settings and this fills in once
            they confirm you.
          </p>
          <Link
            to="/settings"
            className="text-sm font-medium inline-block mt-2"
            style={{ color: '#FF8A1F' }}
          >
            Go to Settings
          </Link>
        </div>
      ) : (
        gyms.map((gym) => (
          // KEYED BY THE GYM'S OWN ID, AND THAT IS LOAD-BEARING RATHER THAN
          // ROUTINE (T3 round 2, F4). React throws the card away when the gym
          // changes, so `AttendancePanel` cannot carry ANY state from one gym to
          // the next — the taps it is holding, the history it read, and every
          // field somebody adds later, **without that future field's author
          // having to know this ever happened.** That is :20712's ruling: the
          // class fix is the key, never a per-field reset inside the panel.
          // A key changed to a position or a constant re-arms the whole class
          // silently, which is why `myGyms.render.test.jsx` now pins it.
          <div
            key={`my-gym-${gym.id}`}
            className="rounded-2xl p-4"
            style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(255,138,31,0.15)' }}
              >
                <Building2 className="w-4 h-4" style={{ color: '#FF8A1F' }} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate" style={{ color: '#fff' }}>
                  {gym.name}
                </p>
                {/* The same reader ~~the member's dashboard card and~~ the
                    owner's Settings panel uses, so no two screens can disagree
                    about when a gym is open. **STRUCK 2026-09-04:** `:33091`
                    took the membership row off the dashboard and the hours ride
                    on that row, so this screen and Settings → Gym are the only
                    two places they are drawn now. It draws nothing until the gym
                    has answered — "nobody has set hours" is not "closed"
                    (:26736). */}
                <GymHoursNote gymId={gym.id} />
                <AttendancePanel gym={gym} />
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
