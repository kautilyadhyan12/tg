import InvitationsPanel from '../components/gym/InvitationsPanel';

// What is waiting for the signed-in address: where the invitation email's link leads
// someone already signed in (Part 3 §10.2).
export default function Invitations() {
  return (
    <div className="max-w-xl mx-auto p-6 flex flex-col gap-5">
      <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'rgba(255,255,255,0.95)' }}>
        Your invitations
      </h1>
      <InvitationsPanel showEmpty />
    </div>
  );
}
