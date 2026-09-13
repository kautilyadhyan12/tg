import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ORG_TYPES_PHRASE } from '@app/shared';
import JoinGymPanel from '../components/gym/JoinGymPanel';
import { forgetJoinCode } from './landingRoute';

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
// This address needs a signed-in, set-up person. Anyone else is sent to sign in
// or into setup, and `CarryJoinCode` keeps the code for them on the way: signing
// in lands a set-up person back here with it, and setup puts it first. Arriving
// here is where a kept code was headed, so it is forgotten now — the address
// holds it from here on.

export default function JoinGym() {
  const [params] = useSearchParams();
  const code = params.get('code') ?? '';

  useEffect(() => {
    forgetJoinCode();
  }, []);

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
