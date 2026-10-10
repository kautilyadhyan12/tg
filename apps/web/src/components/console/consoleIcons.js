import { BarChart3, CalendarClock, CalendarHeart, ClipboardCheck, Dumbbell, LayoutDashboard, Medal, Megaphone, Settings, Tags, Trophy, UserSearch, Users } from 'lucide-react';

/** Each console page's icon, the same in the menu, the phone's tabs and More. */
export const PAGE_ICONS = {
  overview: LayoutDashboard,
  members: Users,
  memberships: Tags,
  leads: UserSearch,
  attendance: ClipboardCheck,
  classes: CalendarClock,
  training: Dumbbell,
  updates: Megaphone,
  events: CalendarHeart,
  leaderboard: Trophy,
  challenges: Medal,
  reports: BarChart3,
  settings: Settings,
};
