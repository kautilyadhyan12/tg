import { useSearchParams } from 'react-router-dom';
import { ORG_TYPES_PHRASE } from '@app/shared';
import JoinGymPanel from '../components/gym/JoinGymPanel';

// `/org/join?code=…` — the address a gym's poster points at.
//
// THE SHAPE IS PART 6 §2'S, ON PURPOSE. The mobile app's deep link is
// `aihg://org/join?code=`, and a poster QR that works on a phone must work in a
// browser too, so the web path mirrors it segment for segment. Inventing a
// second entry path here is how the two halves end up disagreeing about what a
// scanned code does.
//
// The code is only PREFILLED, never submitted for the person. Applying is a
// deliberate act — it puts their name in front of a gym — and a link that
// applied on their behalf would mean a QR taped to a wall could enrol whoever
// scanned it out of curiosity.
//
// KNOWN GAP, tracked rather than papered over: this address needs you to be
// signed in. Someone who scans the poster while signed out is sent to the login
// page and the code is lost on the way, because the sign-in path decides where
// you land on its own (the two-doors ruling) and does not carry a destination.
// Fixing that touches the login door, so it is its own line on OWED.md.

export default function JoinGym() {
  const [params] = useSearchParams();
  const code = params.get('code') ?? '';

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#fff' }}>
          Join with a code
        </h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
          Enter the code your {ORG_TYPES_PHRASE} gave you.
        </p>
      </div>
      {/* T3 r1 L-5: `key` is the fix, and it belongs here rather than in the
          panel. The panel seeds its input from `initialCode` ONCE, at mount —
          which is right, or every keystroke would fight the prop — and React
          Router does NOT remount a route when only the search string changes.
          So scanning a second poster left the FIRST gym's code in the box.
          Keying on the code remounts the panel exactly when the URL names a
          different one, and leaves typing alone the rest of the time. */}
      <JoinGymPanel key={code} initialCode={code} />
    </div>
  );
}
