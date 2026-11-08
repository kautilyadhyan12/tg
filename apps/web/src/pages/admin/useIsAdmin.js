import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { adminService } from '../../api/adminApi';

// Whether the signed-in account is the admin, asked once for each account while the page is
// open: the console's menu shows its Admin line on a yes. Any failure is a no, so nobody else
// ever sees the line; the server refuses everybody else whatever the screen shows.
const asked = new Map();

function askOnce(userId) {
  if (!asked.has(userId)) {
    asked.set(
      userId,
      adminService.isAdmin().catch(() => {
        asked.delete(userId);
        return false;
      }),
    );
  }
  return asked.get(userId);
}

/** null while asking, then true or false. */
export function useIsAdmin() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [answer, setAnswer] = useState({ userId: null, admin: null });
  useEffect(() => {
    if (userId === null) return undefined;
    let cancelled = false;
    askOnce(userId).then((admin) => {
      if (!cancelled) setAnswer({ userId, admin });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  if (userId === null) return false;
  return answer.userId === userId ? answer.admin : null;
}

/** For tests: forget every answer. */
export function forgetAdminAnswers() {
  asked.clear();
}
