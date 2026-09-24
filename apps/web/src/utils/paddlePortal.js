import { orgService } from '../api/orgsApi';

// Paddle's own page for a gym's paid plan (ROADMAP Stage 3 item 1c-i): change the card,
// cancel, invoices. The server hands a link that signs its holder in for a short while,
// so it is used at once and never kept.

/** Open the gym's Paddle page in a new tab. The tab is opened on the press itself,
 *  before the link is asked for, so a pop-up blocker lets it through; it is closed again
 *  if no link comes back. Without a tab (blocked anyway) this page goes there instead. */
export async function openPaddlePortal(gymId, openTab = () => window.open('', '_blank')) {
  const tab = openTab();
  try {
    const res = await orgService.openBillingPortal(gymId);
    const { url } = res.data;
    if (tab) {
      tab.opener = null;
      tab.location.replace(url);
    } else {
      window.location.assign(url);
    }
  } catch (err) {
    tab?.close();
    throw err;
  }
}
