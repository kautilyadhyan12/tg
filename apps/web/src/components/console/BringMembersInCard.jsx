import { Link } from 'react-router-dom';
import { Upload, UserPlus } from 'lucide-react';
import { orgWords } from '@app/shared';
import { ConsoleCard } from './ConsoleStates';

// Where the join code used to be (ROADMAP 3c; spec Part 3 §10.6): a gym brings people in
// through its list and an emailed invitation. Both buttons open Members with Import or
// Add already open. Drawn only for staff who may keep the list (`members.confirm`).
export default function BringMembersInCard({ orgSlug, orgType, readOnly = false }) {
  const words = orgWords(orgType);
  const button = 'rounded-xl px-4 py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2';
  const actions = [
    { open: 'import', label: `Import ${words.people}`, Icon: Upload, style: { background: 'rgba(255,255,255,0.08)', color: '#fff' } },
    { open: 'add', label: `Add ${words.person}`, Icon: UserPlus, style: { background: 'linear-gradient(135deg,#FF8A1F,#FFB347)', color: '#0A0908' } },
  ];
  return (
    <ConsoleCard>
      <div data-testid="bring-members-in">
        <h2 className="font-semibold" style={{ color: '#fff' }}>
          Bring your {words.people} in
        </h2>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Import your {words.person} list from a spreadsheet or your old software, or add people one at a
          time. Then tick them and press Invite: each person gets an email and joins the app with that
          email address.
        </p>
        <div className="grid grid-cols-2 gap-2 mt-4 sm:flex">
          {actions.map(({ open, label, Icon, style }) =>
            readOnly ? (
              <button key={open} type="button" disabled className={`${button} opacity-50 cursor-not-allowed`} style={style}>
                <Icon aria-hidden="true" className="w-4 h-4" />
                {label}
              </button>
            ) : (
              <Link key={open} to={`/console/${orgSlug}/members?open=${open}`} className={button} style={style}>
                <Icon aria-hidden="true" className="w-4 h-4" />
                {label}
              </Link>
            ),
          )}
        </div>
      </div>
    </ConsoleCard>
  );
}
