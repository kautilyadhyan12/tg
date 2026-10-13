import { attendanceReportResponseSchema, membersReportResponseSchema, moneyReportResponseSchema } from '@app/shared';
import authApi from './authApi';

// THE CONSOLE'S REPORTS PAGE (spec Part 3 §16.5; ROADMAP 21a-i, 21a-ii, 21b-i, 21d-i): for staff holding
// `reports.read`. The server refuses anyone else whatever a screen shows. The answer is read
// through its contract, so a body this screen cannot read is an error, never a page of zeros.
// Each read names the period the page shows; the answer says which days that was.
function contractError(what) {
  const err = new Error(`response for ${what} did not match its contract`);
  err.isContractError = true;
  return err;
}

export const reportsService = {
  /** The members figures: counts of the gym's list and its leads. */
  members: async (gymId, period) => {
    const res = await authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/reports/members`, { params: { period } });
    const parsed = membersReportResponseSchema.safeParse(res.data);
    if (!parsed.success) throw contractError('the members report');
    return parsed.data.report;
  },
  /** The attendance figures: counts of the gym's visits and its classes. */
  attendance: async (gymId, period) => {
    const res = await authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/reports/attendance`, { params: { period } });
    const parsed = attendanceReportResponseSchema.safeParse(res.data);
    if (!parsed.success) throw contractError('the attendance report');
    return parsed.data.report;
  },
  /** The money figures, for staff who also hold `billing.members`: sums of the gym's notebook. */
  money: async (gymId, period) => {
    const res = await authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/reports/money`, { params: { period } });
    const parsed = moneyReportResponseSchema.safeParse(res.data);
    if (!parsed.success) throw contractError('the money report');
    return parsed.data.report;
  },
};
