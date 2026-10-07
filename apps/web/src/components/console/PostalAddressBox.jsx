import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { GYM_POSTAL_ADDRESS_MAX_CHARS } from '@app/shared';
import { orgService, errorText } from '../../api/orgsApi';
import { refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';

// THE GYM'S POSTAL ADDRESS, TYPED WHERE IT IS ASKED FOR (ROADMAP 23d, from Kd's
// click-through). A gym cannot invite anybody until it has one. Whoever may change the
// gym's details types it on the page that asked and saves: nobody leaves that page, and
// nothing ticked on it is lost. It is the address Settings → Gym details holds, saved by
// the same route; the server refuses anybody who may not change it.
//
// `onSaved` runs once the server has it, so the page can count or ask again.

export default function PostalAddressBox({ gymId, onSaved }) {
  const id = useId();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const typed = text.trim();

  const save = async (e) => {
    e.preventDefault();
    if (typed === '' || saving) return;
    setSaving(true);
    setError(null);
    try {
      await orgService.updateOrg(gymId, { postalAddress: typed });
      // The rest of the console reads the gym again, so Settings shows the address too.
      refreshConsoleOrgsAfterChange();
      onSaved();
    } catch (err) {
      setError(errorText(err, "We couldn't save the address. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-2 w-full" style={{ maxWidth: 420 }} data-testid="postal-address-box">
      <label className="c-label" htmlFor={id}>
        Postal address
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={GYM_POSTAL_ADDRESS_MAX_CHARS}
        rows={3}
        disabled={saving}
        placeholder={'12 High Street\nLeeds LS1 1AA'}
        className="c-area"
      />
      {error !== null ? (
        <p className="c-s14 c-t1 m-0" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={typed === '' || saving} className="c-btn c-btn-p self-start">
        {saving ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
        Save address
      </button>
    </form>
  );
}
