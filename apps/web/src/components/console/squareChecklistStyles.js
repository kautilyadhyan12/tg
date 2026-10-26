// The Square Point of Sale checklist's colours and button looks (ROADMAP 18d-iii-b-i), shared by its box and
// Members in Square's line (18d-iii-b-ii-b-i).
export const labelStyle = { color: 'rgba(255,255,255,0.85)' };
export const softStyle = { color: 'rgba(255,255,255,0.55)' };
export const strongStyle = { color: '#fff', fontWeight: 600 };
export const boxStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' };
export const lineStyle = { borderTop: '1px solid rgba(255,255,255,0.08)' };
export const mainButton = (on) => ({
  background: on ? 'linear-gradient(135deg,#FF8A1F,#FFB347)' : 'rgba(255,255,255,0.08)',
  color: on ? '#0A0908' : 'rgba(255,255,255,0.35)',
});
export const plainButton = { background: 'rgba(255,255,255,0.07)', color: '#fff' };
export const linkButton = 'self-start text-sm font-semibold underline underline-offset-2 min-h-11';
