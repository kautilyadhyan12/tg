// What a gym's own page says (ROADMAP 20c-iv-a).
import { describe, expect, it } from 'vitest';
import { EMPTY_ENQUIRY, embedCode, enquiryBody, enquiryProblem, facilityLines, gymPageUrl, hoursView } from './gymPublicView';

// Wednesday 30 September 2026, 10:00 in London.
const NOW = new Date('2026-09-30T09:00:00.000Z');
const WEEK = [
  { weekday: 1, sessions: [{ opensMinute: 360, closesMinute: 1320 }] },
  { weekday: 3, sessions: [{ opensMinute: 360, closesMinute: 720 }, { opensMinute: 960, closesMinute: 1320 }] },
];
const hours = (over = {}) => ({ mode: 'scheduled', timezone: 'Europe/London', clockFormat: '24h', week: WEEK, savedWeek: [], closures: [], ...over });

describe('the facilities', () => {
  it('lists the ticked ones in words, then the gym\'s own line', () => {
    expect(facilityLines({ facilities: ['showers', 'free_weights'], otherFacilities: ' Boxing ring ' })).toEqual([
      'Showers',
      'Free weights',
      'Boxing ring',
    ]);
    expect(facilityLines({ facilities: [], otherFacilities: '' })).toEqual([]);
  });
});

describe('the opening hours, on the gym\'s own clock', () => {
  it('says today\'s hours and marks today in the week', () => {
    const view = hoursView(hours(), NOW);
    expect(view.headline).toBe('Open today 06:00 – 12:00, 16:00 – 22:00');
    expect(view.week.find((d) => d.today)).toEqual({ label: 'Wednesday', today: true, line: '06:00 – 12:00, 16:00 – 22:00' });
    expect(view.week.find((d) => d.label === 'Tuesday').line).toBe('Closed');
  });

  it('says closed today on a weekday with no hours', () => {
    expect(hoursView(hours({ week: [WEEK[0]] }), NOW).headline).toBe('Closed today');
  });

  it('a day the gym closed wins over the week, with its reason', () => {
    const view = hoursView(hours({ closures: [{ day: '2026-09-30', note: 'Deep clean' }] }), NOW);
    expect(view.headline).toBe('Closed today · Deep clean');
    expect(view.week.find((d) => d.today).line).toBe('Closed today');
  });

  it('uses the gym\'s day, not the visitor\'s: 23:30 in London is already Thursday in Kolkata', () => {
    const late = new Date('2026-09-30T22:30:00.000Z');
    expect(hoursView(hours({ timezone: 'Europe/London' }), late).week.find((d) => d.today).label).toBe('Wednesday');
    expect(hoursView(hours({ timezone: 'Asia/Kolkata' }), late).week.find((d) => d.today).label).toBe('Thursday');
  });

  it('a 24-hour gym lists no week; a gym that never said lists nothing at all', () => {
    expect(hoursView(hours({ mode: 'open_24h' }), NOW)).toEqual({ headline: 'Open 24 hours', week: [] });
    expect(hoursView(hours({ mode: 'unset' }), NOW)).toBeNull();
  });

  it('twelve-hour gyms read as twelve-hour', () => {
    expect(hoursView(hours({ clockFormat: '12h' }), NOW).headline).toBe('Open today 6:00 AM – 12:00 PM, 4:00 PM – 10:00 PM');
  });
});

describe('the form', () => {
  const form = (over = {}) => ({ ...EMPTY_ENQUIRY, fullName: 'Asha Rao', email: 'asha@example.com', ...over });

  it('asks for a name, and an email or a phone, and an email for the tick', () => {
    expect(enquiryProblem(form())).toBeNull();
    expect(enquiryProblem(form({ fullName: '  ' }))).toBe('Add your name.');
    expect(enquiryProblem(form({ email: '' }))).toBe('Add your email address or phone number, so they can reach you.');
    expect(enquiryProblem(form({ email: '', phone: '07700 900456' }))).toBeNull();
    expect(enquiryProblem(form({ email: '', phone: '07700 900456', mayEmail: true }))).toBe('Add your email address to hear from them by email.');
  });

  it('sends only what was filled in', () => {
    expect(enquiryBody(form({ fullName: ' Asha Rao ', message: '  ' }), 'tok')).toEqual({ fullName: 'Asha Rao', email: 'asha@example.com', robotToken: 'tok' });
    expect(
      enquiryBody(form({ phone: '07700 900456', source: 'social', message: 'Evening classes?', mayEmail: true }), 'tok'),
    ).toEqual({
      fullName: 'Asha Rao',
      email: 'asha@example.com',
      phone: '07700 900456',
      source: 'social',
      message: 'Evening classes?',
      mayEmail: true,
      robotToken: 'tok',
    });
  });

  it('passes on the hidden field when a robot filled it, so the server can drop it', () => {
    expect(enquiryBody(form({ fax: '555' }), 'tok').fax).toBe('555');
  });
});

describe('the link and the code for a gym\'s website', () => {
  it('points at the page, and the form alone for the website', () => {
    expect(gymPageUrl('https://app.example', 'canal-gym')).toBe('https://app.example/gyms/canal-gym');
    expect(embedCode('https://app.example', 'canal-gym', 'Canal Gym')).toBe(
      '<iframe src="https://app.example/gyms/canal-gym?embed=1" title="Get in touch with Canal Gym" width="100%" height="900" style="border:0;max-width:560px" loading="lazy"></iframe>',
    );
  });

  it('a gym name with quotes or a bracket cannot break out of the code', () => {
    const code = embedCode('https://app.example', 'joes', 'Joe\'s "Best" <Gym> & Co');
    expect(code).toContain('title="Get in touch with Joe\'s &quot;Best&quot; &lt;Gym> &amp; Co"');
    // Six attributes, two quote marks each: the name adds none.
    expect(code.match(/"/g)).toHaveLength(12);
  });
});
