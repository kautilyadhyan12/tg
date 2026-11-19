import { countText } from '../../pages/console/attentionView';

/** A count beside a page in the menu, on a phone's tab or on More (V1-d): how many wait there,
 *  red, gold or plain, and what that means to a screen reader. */
export default function MenuCount({ count }) {
  return (
    <>
      <span className={`c-count${count.tone === 'plain' ? '' : ` c-count-${count.tone}`}`} aria-hidden="true" data-testid="menu-count">
        {countText(count.count)}
      </span>
      <span className="sr-only">{`, ${String(count.count)} waiting`}</span>
    </>
  );
}
