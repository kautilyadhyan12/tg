// Download member list, inside the plan box a gym with no plan cannot skip (ROADMAP Stage 4
// item 14). A gym that stops paying keeps the right to take a copy of its own list: the
// emails before its list is deleted say to sign in and press this. Everyone on the list,
// current and past, in the Members page's own file. Shown only to staff who may read the
// list, and only when there is somebody on it. A list deleted because the gym had no plan
// and no sign-in for six months says so here instead, as the Members page does.
import { useEffect, useState } from 'react';
import { orgWords } from '@app/shared';
import { Download, Loader2 } from 'lucide-react';
import { orgService, errorText, blobError } from '../../api/orgsApi';
import { viewerPrivileges } from '../../pages/console/consoleView';
import { goneForGoodLine } from '../../pages/console/memberListPeople';
import { saveFile } from '../../pages/console/saveFile';

export default function ListDownload({ org }) {
  const words = orgWords(org?.orgType);
  const gymId = org?.id ?? null;
  const mayRead = viewerPrivileges(org).includes('members.confirm');
  const [people, setPeople] = useState(0);
  const [gone, setGone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  useEffect(() => {
    if (gymId === null || !mayRead) return undefined;
    let live = true;
    Promise.resolve()
      .then(() => orgService.getMemberList(gymId))
      .then((res) => {
        const list = res.data?.list;
        if (!live) return;
        setPeople((list?.counts?.entries ?? 0) + (list?.counts?.former ?? 0));
        setGone(goneForGoodLine(list, org?.timezone, words.it));
      })
      .catch(() => {
        if (live) setPeople(0);
      });
    return () => {
      live = false;
    };
  }, [gymId, mayRead, org?.timezone, words.it]);

  if (gymId === null || !mayRead) return null;
  if (people === 0) {
    return gone === null ? null : (
      <p className="text-sm mt-4" data-testid="plan-gone-for-good" style={{ color: 'rgba(255,255,255,0.75)' }}>
        {gone}
      </p>
    );
  }

  const download = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const filter = { records: 'all' };
      const res = await orgService.selectAllMembers(gymId, filter);
      const file = await orgService.downloadMembersCsv(gymId, { kind: 'all', filter, ...res.data.selection });
      saveFile(file.blob, file.filename);
      setNote(`Your ${words.person} list was downloaded.`);
    } catch (raw) {
      setNote(errorText(await blobError(raw), "We couldn't download the file. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 flex flex-col gap-2">
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className="w-full rounded-xl px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
        style={{ background: 'rgba(255,255,255,0.06)', color: '#fff', minHeight: 44 }}
      >
        {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Download aria-hidden="true" className="w-4 h-4" />}
        Download {words.person} list
      </button>
      {note !== null ? (
        <p className="text-sm" role="status" style={{ color: 'rgba(255,255,255,0.6)' }}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
