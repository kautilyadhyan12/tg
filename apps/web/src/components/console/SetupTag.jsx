/** "Set up" beside Payments overview in the menu and on More (V1-f): until a payment provider is
 *  connected (spec Part 3 §17.11). */
export default function SetupTag() {
  return (
    <span className="c-tag c-tag-soft c-setup-tag" data-testid="setup-tag">
      Set up
    </span>
  );
}
