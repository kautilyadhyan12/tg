// What a gym's own page says (ROADMAP 20c-iv-a; spec Part 3 §16.3), worked out apart
// from the screen so each line can be tested. Every day and time is the gym's own,
// never the visitor's browser's.
import { ENQUIRY_WORDS, GYM_FACILITY_WORDS } from '@app/shared';
import { WEEKDAYS, dayLine, gymToday, isoWeekdayOfDay } from './console/hoursView';

/** The facilities the gym ticked, as words, then the ones it added itself: one list. */
export function facilityLines(page) {
  const lines = (page?.facilities ?? []).map((facility) => GYM_FACILITY_WORDS[facility]).filter(Boolean);
  return [...lines, ...(page?.ownFacilities ?? [])];
}

/** The opening hours: a headline for today and, for a gym with a weekly pattern, the
 *  week with today marked. Null when the gym has not said when it is open. */
export function hoursView(hours, now = new Date()) {
  if (hours?.mode !== 'open_24h' && hours?.mode !== 'scheduled') return null;
  const today = gymToday(hours.timezone, now);
  const todayIso = isoWeekdayOfDay(today);
  const clockFormat = hours.clockFormat ?? '24h';
  const closedToday = (hours.closures ?? []).find((closure) => closure.day === today) ?? null;
  const note = closedToday?.note?.trim() ?? '';
  const todaySessions = hours.week?.find((d) => d.weekday === todayIso)?.sessions ?? [];
  let headline;
  if (closedToday !== null) headline = note === '' ? 'Closed today' : `Closed today · ${note}`;
  else if (hours.mode === 'open_24h') headline = 'Open 24 hours';
  else if (todaySessions.length === 0) headline = 'Closed today';
  else headline = `Open today ${dayLine(todaySessions, clockFormat)}`;
  const week =
    hours.mode === 'scheduled'
      ? WEEKDAYS.map((day) => ({
          label: day.label,
          today: day.iso === todayIso,
          line:
            day.iso === todayIso && closedToday !== null
              ? 'Closed today'
              : dayLine(hours.week?.find((d) => d.weekday === day.iso)?.sessions, clockFormat),
        }))
      : [];
  return { headline, week };
}

export const EMPTY_ENQUIRY = { fullName: '', email: '', phone: '', source: '', message: '', mayEmail: false, trap: '' };

/** What stops the form being sent, in the words the server would use; null when it
 *  may go. The server checks it all again. */
export function enquiryProblem(form) {
  if (form.fullName.trim() === '') return ENQUIRY_WORDS.needs_name;
  const email = form.email.trim();
  if (email === '' && form.phone.trim() === '') return ENQUIRY_WORDS.needs_contact;
  if (form.mayEmail && email === '') return ENQUIRY_WORDS.needs_email;
  return null;
}

/** The request for the form, with empty fields left out. */
export function enquiryBody(form, robotToken) {
  const body = { fullName: form.fullName.trim(), robotToken };
  const email = form.email.trim();
  const phone = form.phone.trim();
  const message = form.message.trim();
  if (email !== '') body.email = email;
  if (phone !== '') body.phone = phone;
  if (form.source !== '') body.source = form.source;
  if (message !== '') body.message = message;
  if (form.mayEmail) body.mayEmail = true;
  if (form.trap !== '') body.trap = form.trap;
  return body;
}

/** The page's own address, for the link a gym shares. */
export function gymPageUrl(origin, slug) {
  return `${origin}/gyms/${encodeURIComponent(slug)}`;
}

/** The code a gym pastes into its own website: the form alone, in a frame. */
export function embedCode(origin, slug, gymName) {
  const title = `Get in touch with ${gymName}`.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<iframe src="${gymPageUrl(origin, slug)}?embed=1" title="${title}" width="100%" height="900" style="border:0;max-width:560px" loading="lazy"></iframe>`;
}
