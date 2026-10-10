import { membersReportResponseSchema } from '@app/shared';
import authApi from './authApi';

// THE CONSOLE'S REPORTS PAGE (spec Part 3 §16.5; ROADMAP 21a-i): for staff holding
// `reports.read`. The server refuses anyone else whatever a screen shows. The answer is read
// through its contract, so a body this screen cannot read is an error, never a page of zeros.
function contractError(what) {
  const err = new Error(`response for ${what} did not match its contract`);
  err.isContractError = true;
  return err;
}

export const reportsService = {
  /** The members figures: counts of the gym's list and its leads. */
  members: async (gymId) => {
    const res = await authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/reports/members`);
    const parsed = membersReportResponseSchema.safeParse(res.data);
    if (!parsed.success) throw contractError('the members report');
    return parsed.data.report;
  },
};
