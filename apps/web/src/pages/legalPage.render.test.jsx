// KWAZO's three documents on the website (ROADMAP Stage 5 21b-i).
//
// THE WORST THING THESE PAGES COULD DO: say something to a person that is not what the app does. The
// words are held to the code in apps/api/test/legal.unit.test.ts; here, that each page shows ALL of its
// words, who runs KWAZO and how to reach us, and that each page can reach the other two.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LEGAL_OWNER, LEGAL_PATHS, privacyPolicy, termsOfUse, washingtonHealthDataPolicy } from '@app/shared';
import LegalPage from './LegalPage';

afterEach(cleanup);

function open(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={LEGAL_PATHS.privacy} element={<LegalPage which="privacy" />} />
        <Route path={LEGAL_PATHS.terms} element={<LegalPage which="terms" />} />
        <Route path={LEGAL_PATHS.washington} element={<LegalPage which="washington" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Every line of words a document holds, as the page must show it. */
function linesOf(doc) {
  return doc.sections.flatMap((s) => [
    s.heading,
    ...s.blocks.flatMap((b) =>
      b.kind === 'p' || b.kind === 'h3' || b.kind === 'strong' ? [b.text] : b.kind === 'list' ? b.items : b.kind === 'links' ? b.items.map((i) => i.label) : b.rows.flat(),
    ),
  ]);
}

describe.each([
  ['the Privacy Policy', LEGAL_PATHS.privacy, privacyPolicy()],
  ['the Terms of Use', LEGAL_PATHS.terms, termsOfUse()],
  ['Washington\'s page', LEGAL_PATHS.washington, washingtonHealthDataPolicy()],
])('%s', (_name, path, doc) => {
  it('shows its title, its date and every one of its lines', () => {
    open(path);
    expect(screen.getByRole('heading', { level: 1, name: doc.title })).toBeTruthy();
    expect(screen.getByText(/^Last updated \d{1,2} [A-Z][a-z]+ \d{4}$/)).toBeTruthy();
    const page = document.body.textContent ?? '';
    expect(linesOf(doc).filter((line) => !page.includes(line))).toEqual([]);
  });

  it('opens the other two documents', () => {
    open(path);
    const footer = screen.getByRole('contentinfo');
    const links = within(footer).getAllByRole('link').map((a) => a.getAttribute('href'));
    const others = Object.values(LEGAL_PATHS).filter((p) => p !== path);
    expect(others.filter((p) => !links.includes(p))).toEqual([]);
  });
});

describe('who runs KWAZO, and the parts for each kind of person', () => {
  it('the Privacy Policy names its owner and gives the support address (21a-ii)', () => {
    open(LEGAL_PATHS.privacy);
    const who = document.getElementById('who-we-are');
    expect(who?.textContent).toContain(`KWAZO is owned and operated by ${LEGAL_OWNER}, a sole proprietor based in India`);
    expect(who?.textContent).toContain('Our contact email address is support@getkwazo.com.');
  });

  it('each kind of person has a part, and the list at the top opens it', () => {
    open(LEGAL_PATHS.privacy);
    for (const id of ['on-your-own', 'members', 'businesses', 'added-by-a-business']) {
      expect(document.getElementById(id)).not.toBeNull();
      expect(document.querySelector(`a[href="#${id}"]`)).not.toBeNull();
    }
  });

  it('a member reads what their business can never see, the health answer among it', () => {
    open(LEGAL_PATHS.privacy);
    const members = document.getElementById('members');
    expect(members?.textContent).toContain('Your response to the health-related screening question.');
    expect(members?.textContent).toContain('Your recorded running routes.');
  });
});

describe('somebody whose old sign-in has run out', () => {
  it('still reads the three pages: a failed sign-in never sends them to /login from here', async () => {
    const { isSignedOutPage } = await import('../api/authApi');
    expect(Object.values(LEGAL_PATHS).filter((p) => !isSignedOutPage(p))).toEqual([]);
    expect(['/privacy/', '/terms/'].filter((p) => !isSignedOutPage(p))).toEqual([]);
    expect(isSignedOutPage('/dashboard')).toBe(false);
  });
});
