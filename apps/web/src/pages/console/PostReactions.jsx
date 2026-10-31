import { useRef, useState } from 'react';
import { BicepsFlexed, Flame, Heart, ThumbsUp } from 'lucide-react';
import { errorText } from '../../api/orgsApi';
import { reactionButtons, reactorsMore, reactorsTitle } from '../../components/gym/postsView';

const REACTION_ICONS = { like: ThumbsUp, love: Heart, strong: BicepsFlexed, fire: Flame };

/** The reactions on a post or a comment as members see them, each one's icon and how many. A press
 *  on one shows staff who gave it; members are never shown that. `readWho(reaction)` reads the names;
 *  `quiet`: says nothing when there are none. */
export default function PostReactions({ thing, readWho, quiet = false }) {
  const reactions = reactionButtons(thing).filter((r) => r.count > 0);
  const [open, setOpen] = useState(null);
  const [state, setState] = useState({ loading: false, error: null, who: null });
  const asked = useRef(null);

  const show = (id) => {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    asked.current = id;
    setState({ loading: true, error: null, who: null });
    readWho(id).then(
      (who) => asked.current === id && setState({ loading: false, error: null, who }),
      (err) => asked.current === id && setState({ loading: false, error: errorText(err, "We couldn't load who reacted."), who: null }),
    );
  };

  if (reactions.length === 0) {
    return quiet ? null : (
      <p className="c-s13 c-t2" data-testid="reactions">
        No reactions yet
      </p>
    );
  }
  const shown = reactions.find((r) => r.id === open) ?? null;
  const more = state.who === null ? null : reactorsMore(state.who);
  return (
    <div className="flex flex-col gap-3" data-testid="reactions">
      <div className="flex flex-wrap items-center gap-2">
        {reactions.map((r) => {
          const Icon = REACTION_ICONS[r.id];
          return (
            <button
              key={r.id}
              type="button"
              aria-expanded={open === r.id}
              aria-label={`${r.label}. See who`}
              title={`${r.word}: see who`}
              onClick={() => show(r.id)}
              className={open === r.id ? 'c-chip c-chip-on' : 'c-chip'}
            >
              <Icon aria-hidden="true" className="w-[18px] h-[18px]" style={{ color: 'var(--accent)', fill: 'var(--accent)' }} />
              <span className="c-num c-w6">{r.count.toLocaleString('en')}</span>
            </button>
          );
        })}
      </div>
      {shown !== null ? (
        <div role="region" aria-label={`Who reacted ${shown.word}`} className="rounded-[14px] p-4 flex flex-col gap-2" style={{ background: 'var(--raise)' }}>
          <div className="flex items-center gap-3">
            {/* Once the names have arrived the number is theirs, so the two always agree. */}
            <p className="c-s14 c-w6 c-t1 flex-grow">{reactorsTitle({ word: shown.word, count: state.who?.total ?? shown.count })}</p>
            <button type="button" onClick={() => setOpen(null)} className="c-btn c-btn-quiet c-s14">
              Close
            </button>
          </div>
          {state.loading ? <p className="c-s14 c-t2">Loading…</p> : null}
          {state.error !== null ? (
            <p className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
              {state.error}
            </p>
          ) : null}
          {state.who !== null ? (
            <>
              <ul className="flex flex-col gap-1.5">
                {state.who.people.map((person, i) => (
                  // A list that is read once and never reordered: its position is its key.
                  <li key={i} className={person.name === null ? 'c-s14 c-t2' : 'c-s14 c-t1'}>
                    {person.name ?? 'No name yet'}
                  </li>
                ))}
              </ul>
              {more !== null ? <p className="c-s13 c-t2">{more}</p> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
