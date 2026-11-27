import { useEffect } from 'react';

/** A panel's Save pressed with something wrong: the first field marked `data-bad` is brought
 *  into view and given the keys, so the red line is never left out of sight above the foot.
 *  `tries` goes up by one at each press. */
export function useFirstProblem(formRef, tries) {
  useEffect(() => {
    if (!tries) return;
    const bad = formRef.current?.querySelector('[data-bad="true"]');
    if (!bad) return;
    const field = bad.closest('.c-field, fieldset') ?? bad;
    field.scrollIntoView?.({ block: 'center' });
    field.querySelector?.('input:not([type="hidden"]):not(:disabled)')?.focus({ preventScroll: true });
  }, [formRef, tries]);
}

/** What the panel's foot says while a field is marked: the reason is beside the field. */
export const FIX_ABOVE = 'Fix what is marked in red above.';

/** A form's draft without the count of Save presses: what "not saved" compares. */
export const draftKey = (draft) => JSON.stringify({ ...draft, pressed: 0 });
