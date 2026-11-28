import { Link } from 'react-router-dom';
import { Upload, UserPlus } from 'lucide-react';
import { orgWords } from '@app/shared';

// Where the join code used to be (ROADMAP 3c; spec Part 3 §10.6): a gym brings people in
// through its list and an emailed invitation. Both buttons open Members with Import or
// Add already open. Drawn only for staff who may keep the list (`members.confirm`).
export default function BringMembersInCard({ orgSlug, orgType, readOnly = false }) {
  const words = orgWords(orgType);
  const actions = [
    { open: 'import', label: `Import ${words.people}`, Icon: Upload, cls: 'c-btn c-btn-s' },
    { open: 'add', label: `Add ${words.person}`, Icon: UserPlus, cls: 'c-btn c-btn-p' },
  ];
  return (
    <section className="c-card p-5 flex flex-col gap-3" data-testid="bring-members-in" aria-label={`Bring your ${words.people} in`}>
      <h2 className="c-h2">Bring your {words.people} in</h2>
      <p className="c-s14 c-t2">
        Import your {words.person} list from a spreadsheet or your old software, or add people one at a
        time. Then tick them and press Invite: each person gets an email and joins the app with that
        email address.
      </p>
      <div className="flex flex-wrap gap-2">
        {actions.map(({ open, label, Icon, cls }) =>
          readOnly ? (
            <button key={open} type="button" disabled className={cls}>
              <Icon aria-hidden="true" size={16} />
              {label}
            </button>
          ) : (
            <Link key={open} to={`/console/${orgSlug}/members?open=${open}`} className={cls}>
              <Icon aria-hidden="true" size={16} />
              {label}
            </Link>
          ),
        )}
      </div>
    </section>
  );
}
