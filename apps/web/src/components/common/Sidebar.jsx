import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTransition } from '../../context/TransitionContext';
import { useXp } from '../../hooks/useXp';
import { formatLevel } from '../../api/gamificationApi';
import {
  LayoutDashboard, Dumbbell, Activity, Brain,
  Apple, Trophy, Settings, LogOut, Zap, Play,
  ChevronLeft, ChevronRight, Flame, Footprints,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const navItems = [
  { to: '/dashboard',       icon: LayoutDashboard, label: 'Dashboard'  },
  { to: '/exercises',       icon: Dumbbell,        label: 'Exercises'  },
  { to: '/workout/builder', icon: Play,            label: 'My Workout' },
  { to: '/running',         icon: Footprints,      label: 'Running'    },
  { to: '/progress',        icon: Activity,        label: 'Progress'   },
  { to: '/coach',           icon: Brain,           label: 'AI Coach'   },
  { to: '/nutrition',       icon: Apple,           label: 'Nutrition'  },
  { to: '/achievements',    icon: Trophy,          label: 'Achievements' },
  { to: '/settings',        icon: Settings,        label: 'Settings'   },
];

export default function Sidebar({ collapsed = false, setCollapsed = () => {} }) {
  const { user, logout } = useAuth();
  const navigate          = useNavigate();
  const { triggerTransition } = useTransition();
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
          {navItems.map(({ to, icon: Icon, label }) => (
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