import PlaceLink from './PlaceLink';
import { sentencePlace } from '../../pages/console/consolePlaces';
import { viewerPrivileges } from '../../pages/console/consoleView';

// WHAT GOES UNDER A SENTENCE THAT NEEDS SOMETHING DONE IN ANOTHER PLACE (ROADMAP 23d-ii):
// the button to that place for whoever can open it, and who can for anybody else.
// `kind` is a key of `consolePlaces.js`'s list; with none, nothing is drawn.

export default function SentencePlace({ kind, gym, guard = false, className }) {
  const found = sentencePlace(kind, gym?.slug, viewerPrivileges(gym), gym?.orgType);
  if (found === null) return null;
  if (found.to === null) return <span className="c-s14 c-t2">{found.ask}</span>;
  return (
    <PlaceLink to={found.to} guard={guard} {...(className ? { className } : {})}>
      {found.button}
    </PlaceLink>
  );
}
