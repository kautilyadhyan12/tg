import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTransition } from '../../context/TransitionContext';
import { useXp } from '../../hooks/useXp';
import { formatLevel } from '../../api/gamificationApi';
import {
  LayoutDashboard, Dumbbell, Activity, Brain,
  Apple, Trophy, Settings, LogOut, Play,
  ChevronLeft, ChevronRight, Flame, Footprints,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMyGyms } from '../../hooks/useMyGyms';
// `My Gyms` — Kd, 2026-09-02. The list below is deliberately NOT moved with it:
// the removal ruling's comment and the mutation harness that guards it both
// point at this file. See `sidebarNav.js` for why the two items are different.
import { navWithMyGyms } from './sidebarNav';
// A CHEER'S ONLY ARRIVAL. Nothing in this product pushes a notification
// (:29961 §4), so `My Gyms` is where a gym's message waits — and a message
// waiting on a screen nobody opens is a message nobody gets. Same `gyms` rows
// the item itself is drawn from, so the dot cannot outlive the item.
import { hasFreshCheer } from '../gym/gymMembershipView';

const navItems = [
  { to: '/dashboard',       icon: LayoutDashboard, label: 'Dashboard'  },
  { to: '/exercises',       icon: Dumbbell,        label: 'Exercises'  },
  { to: '/workout/builder', icon: Play,            label: 'My Workout' },
  { to: '/running',         icon: Footprints,      label: 'Running'    },
  { to: '/progress',        icon: Activity,        label: 'Progress'   },
  { to: '/coach',           icon: Brain,           label: 'AI Coach'   },
  { to: '/nutrition',       icon: Apple,           label: 'Nutrition'  },
  { to: '/achievements',    icon: Trophy,          label: 'Achievements' },
  // `My Gym` USED TO LIVE HERE and was REMOVED by Kd's ruling of 2026-08-19,
  // mid-smoke on the login door. Do not put it back.
  //
  // It predates the two doors: when the console had no other entrance, a
  // sidebar link was the only way to find it. The login page now asks "I'm a
  // member" or "I run a gym", so the door IS the entrance — and :10824 had
  // already called this item a temporary door that shipped without being
  // labelled temporary. Kd's words: "why my gym in the user side profile, if
  // they want to create gym they will sign in as gym".
  //
  // The console's own "Back to the app" went in the same ruling, so the
  // crossing is closed in BOTH directions and the doors are the only way
  // between the member app and the console. Restoring either half alone is
  // worse than restoring neither: it makes the crossing work one way only.
  { to: '/settings',        icon: Settings,        label: 'Settings'   },
];

export default function Sidebar({ collapsed = false, setCollapsed = () => {} }) {
  const { user, logout } = useAuth();
  const navigate          = useNavigate();
  const { triggerTransition } = useTransition();
  // WHICH GYMS AM I IN? The shared answer to `/v1/orgs/mine`, asked once for the
  // whole session and kept — see `useMyGyms`. A failed read means no item, which
  // is the safe direction: the screen is still reachable by its address, and the
  // alternative (drawing it for everybody) would put a member's section in front
  // of people who are not in a gym.
  const { gyms } = useMyGyms();
  // Level comes from GET /v1/gamification/me, NOT from the auth user — that
  // shape has no `level` field, so the previous `user?.level || 1` rendered a
  // fabricated "Level 1" for everyone. `null` = unknown and shows an em dash.
  const { xp } = useXp();

  const handleLogout = async () => {
    triggerTransition(async () => {
      await logout();
      navigate('/login');
    });
  };

  const handleNavClick = (to) => {
    if (collapsed) setCollapsed(false);
    triggerTransition(() => navigate(to));
  };

  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : 220 }}
      transition={{ type: 'spring', damping: 28, stiffness: 220 }}
      className="fixed left-0 top-0 h-full flex flex-col z-20 overflow-hidden"
      style={{ background: '#0D0C0B', borderRight: '1px solid rgba(255,255,255,0.05)' }}
    >
      {/* ── Logo ──────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center border-b flex-shrink-0"
        style={{
          height:        68,
          padding:       collapsed ? '0 14px' : '0 20px',
          borderColor:   'rgba(255,255,255,0.05)',
        }}
      >
        <AnimatePresence mode="wait">
          {!collapsed ? (
            <motion.div
              key="full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-2.5 flex-1 min-w-0"
            >
              {/* Logo mark */}
              <div
                className="w-8 h-8 rounded-lg flex items-center
                           justify-center flex-shrink-0"
                style={{
                  background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                  boxShadow:  '0 0 16px rgba(255,138,31,0.3)',
                }}
              >
                <Dumbbell className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-white font-bold text-sm tracking-tight truncate">
                  AI Home Gym
                </p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  Smart Fitness
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="icon"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-8 h-8 rounded-lg flex items-center
                         justify-center cursor-pointer flex-shrink-0"
              style={{
                background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                boxShadow:  '0 0 16px rgba(255,138,31,0.3)',
              }}
              onClick={() => setCollapsed(false)}
            >
              <Dumbbell className="w-4 h-4 text-white" />
            </motion.div>
          )}
        </AnimatePresence>

        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="ml-auto btn-icon flex-shrink-0"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Expand chevron when collapsed ─────────────────────────────────── */}
      {collapsed && (
        <div
          className="flex justify-center py-2 border-b"
          style={{ borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <button
            onClick={() => setCollapsed(false)}
            className="btn-icon"
            title="Expand"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── User card ─────────────────────────────────────────────────────── */}
      {!collapsed ? (
        <div
          className="px-4 py-3 border-b flex-shrink-0"
          style={{ borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <div className="flex items-center gap-2.5">
            {/* Avatar */}
            <div
              className="w-8 h-8 rounded-full flex items-center
                         justify-center flex-shrink-0 font-bold text-sm"
              style={{
                background: 'rgba(255,138,31,0.15)',
                border:     '1px solid rgba(255,138,31,0.2)',
                color:      '#FF8A1F',
              }}
            >
              {user?.displayName?.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white text-xs font-semibold truncate">
                {user?.displayName}
              </p>
              <div className="flex items-center gap-1 mt-0.5">
                <Flame className="w-2.5 h-2.5" style={{ color: '#FF8A1F' }} />
                <span className="text-2xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  Level {formatLevel(xp)}
                </span>
              </div>
            </div>
            <div
              className="text-2xs px-1.5 py-0.5 rounded-md font-bold flex-shrink-0"
              style={{
                background: 'rgba(255,138,31,0.1)',
                color:      '#FFB347',
              }}
            >
              L{formatLevel(xp)}
            </div>
          </div>
        </div>
      ) : (
        <div
          className="flex justify-center py-3 border-b flex-shrink-0"
          style={{ borderColor: 'rgba(255,255,255,0.05)' }}
        >
          <div
            className="w-8 h-8 rounded-full flex items-center
                       justify-center cursor-pointer font-bold text-sm"
            style={{
              background: 'rgba(255,138,31,0.15)',
              border:     '1px solid rgba(255,138,31,0.2)',
              color:      '#FF8A1F',
            }}
            onClick={() => setCollapsed(false)}
          >
            {user?.displayName?.charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      {/* ── Navigation ────────────────────────────────────────────────────── */}
      <nav
        className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar"
        style={{ padding: collapsed ? '12px 8px' : '12px' }}
      >
        <div className="space-y-0.5">
          {navWithMyGyms(navItems, gyms.length, { dot: hasFreshCheer(gyms) }).map(({ to, icon: Icon, label, dot }) => (
            <NavLink
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              onClick={(e) => { e.preventDefault(); handleNavClick(to); }}
              className="block"
            >
              {({ isActive }) => (
                <div
                  className={`flex items-center rounded-xl text-sm
                             font-medium transition-all duration-200
                             ${collapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5'}`}
                  style={{
                    color:      isActive ? '#FF8A1F' : 'rgba(255,255,255,0.45)',
                    background: isActive ? 'rgba(255,138,31,0.08)' : 'transparent',
                    borderLeft: isActive && !collapsed
                      ? '2px solid #FF8A1F'
                      : '2px solid transparent',
                    paddingLeft: isActive && !collapsed ? 'calc(0.75rem - 2px)' : undefined,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.color = 'rgba(255,255,255,0.80)';
                      e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.color = 'rgba(255,255,255,0.45)';
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <Icon
                    className="flex-shrink-0"
                    style={{
                      width:  18,
                      height: 18,
                      color:  isActive ? '#FF8A1F' : 'inherit',
                    }}
                  />
                  {!collapsed && (
                    <span className="overflow-hidden whitespace-nowrap">
                      {label}
                    </span>
                  )}
                  {/* THE CHEER'S DOT, and it must survive a COLLAPSED rail —
                      which is where the label it would otherwise sit beside
                      does not exist. A member with the rail shut still has the
                      icon, so the dot is drawn in BOTH states, inline: it
                      follows the label when there is one and the icon when
                      there is not. No absolute positioning, deliberately —
                      that would need a `relative` on the row and would put the
                      mark outside the flow, where the collapsed rail's own
                      `overflow-hidden` could clip it away silently.

                      `aria-label` rather than a bare coloured circle: a mark
                      that carries meaning and cannot be read is a promise to
                      the sighted only (:32395's class, an icon at 16px). */}
                  {dot === true ? (
                    <span
                      className={collapsed ? '' : 'ml-auto'}
                      role="status"
                      aria-label="New from your gym"
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: '#FF8A1F',
                        flexShrink: 0,
                      }}
                    />
                  ) : null}
                </div>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* ── Sign out ──────────────────────────────────────────────────────── */}
      <div
        className="border-t flex-shrink-0"
        style={{
          borderColor: 'rgba(255,255,255,0.05)',
          padding:     collapsed ? '12px 8px' : '12px',
        }}
      >
        <button
          onClick={handleLogout}
          title={collapsed ? 'Sign out' : undefined}
          className={`flex items-center rounded-xl text-sm font-medium
                     w-full transition-all duration-200
                     ${collapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5'}`}
          style={{ color: 'rgba(255,255,255,0.35)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#f87171';
            e.currentTarget.style.background = 'rgba(239,68,68,0.08)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'rgba(255,255,255,0.35)';
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <LogOut style={{ width: 18, height: 18, flexShrink: 0 }} />
          {!collapsed && (
            <span className="whitespace-nowrap">Sign out</span>
          )}
        </button>
      </div>
    </motion.aside>
  );
}