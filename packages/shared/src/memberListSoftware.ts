// "Which software is your list in?" (spec Part 3 §11.7; ROADMAP 5c). Each product's
// own steps for downloading its member list, in plain words, and the help page they
// were read on. A product is here only if its OWN help page was opened and read
// (RULINGS 2026-10-01): another company's page about it does not count.
//
// No product carries a column matching yet. None of them publishes the headings of
// its export, and §11.7 allows a matching only from a real file or the vendor's own
// template, so a product's matching is added with the first real file from it.

export interface MemberListSoftwareSource {
  /** The help page's own title. */
  title: string;
  url: string;
  /** The day the page was read, YYYY-MM-DD. */
  read: string;
}

export interface MemberListSoftware {
  id: string;
  name: string;
  steps: readonly string[];
  /** Said under the steps where the product's page warns of something. */
  tip: string | null;
  sources: readonly MemberListSoftwareSource[];
}

const READ = "2026-10-01";

/** By name, as a gym looks for its own. */
export const MEMBER_LIST_SOFTWARE: readonly MemberListSoftware[] = [
  {
    id: "glofox",
    name: "Glofox",
    steps: [
      "On your Glofox dashboard, open Manage, then the Clients tab.",
      "Leave the filters empty to get everybody.",
      "Click Actions on the right, then Download. A CSV file downloads.",
    ],
    tip: null,
    sources: [
      {
        title: "How to Download a Client List",
        url: "https://support.glofox.com/hc/en-us/articles/46433498252564-How-to-Download-a-Client-List",
        read: READ,
      },
    ],
  },
  {
    id: "gym-insight",
    name: "Gym Insight",
    steps: [
      "Click Accounts on the left, then Member List at the bottom of that page.",
      "Under Statuses and Types, tick the members you want, then click Update.",
      "Click the export button at the bottom of the report, then Download when it's ready.",
    ],
    tip: null,
    sources: [
      { title: "Get a List of Your Members", url: "https://help.gyminsight.com/article/109-get-a-list-of-your-members", read: READ },
      { title: "Export Report Data", url: "https://help.gyminsight.com/article/106-export-report-data", read: READ },
    ],
  },
  {
    id: "gymdesk",
    name: "Gymdesk",
    steps: ["Open the Members tab.", "Export the list as a CSV file."],
    tip: "The list opens on your active members. Frozen and Canceled members are on their own tabs, so export those too if you want them here.",
    sources: [{ title: "Member list", url: "https://docs.gymdesk.com/en/help/docs/member-list", read: READ }],
  },
  {
    id: "gymmaster",
    name: "GymMaster",
    steps: [
      "Go to Report & Till, then Standard Reports.",
      "Choose Members, then the report that lists the members you want.",
      "Click Show Report, then Export to CSV.",
    ],
    tip: null,
    sources: [
      { title: "Run Standard Report", url: "https://www.gymmaster.com/user-manual/manual_reports_standard_run/", read: READ },
      { title: "Standard Report Options", url: "https://www.gymmaster.com/user-manual/manual_reports_standard_options/", read: READ },
    ],
  },
  {
    id: "mindbody",
    name: "Mindbody",
    steps: [
      "Click Insights, then Reports, and open Mailing Lists (under Clients).",
      "At the top left, choose Email List. In List Clients, choose who to include, and choose Clients Only.",
      "Click Generate, then Export to Excel.",
    ],
    tip: "Use Export to Excel, not the box of addresses at the top: that box stops at 10,000. If the file you get ends in .xls, open it in Excel and save it as .xlsx or CSV first.",
    sources: [
      {
        title: "Export client email or mailing addresses",
        url: "https://support.mindbodyonline.com/s/article/205027717-Export-client-email-or-mailing-addresses?language=en_US",
        read: READ,
      },
    ],
  },
  {
    id: "teamup",
    name: "TeamUp",
    steps: [
      "Go to Customers, then Customer List.",
      "Clear the filters to get everybody: the download keeps whatever the list is filtered by.",
      "Click Export Filtered List, then Export to CSV/Excel.",
    ],
    tip: null,
    sources: [{ title: "Other customer reports", url: "https://support.goteamup.com/en/articles/9327492-other-customer-reports", read: READ }],
  },
  {
    id: "wellnessliving",
    name: "WellnessLiving",
    steps: [
      "Click the App Drawer, then View All, then Clients.",
      "Filter the list to the clients you want.",
      "Click Export and choose CSV or Excel.",
    ],
    tip: null,
    sources: [{ title: "Export the client list", url: "https://help.wellnessliving.com/en/articles/11055902-export-the-client-list", read: READ }],
  },
  {
    id: "wodify",
    name: "Wodify",
    steps: [
      "Go to People, then Clients.",
      "Choose the group of clients at the top, and tick the clients you want.",
      "Click the three-dot icon, then Export. An Excel file downloads.",
    ],
    tip: null,
    sources: [{ title: "Export Client Data", url: "https://help.wodify.com/hc/en-us/articles/360060021574-Export-Client-Data", read: READ }],
  },
];

/** Not a product: the gym's own spreadsheet, and software not on the list. */
export const MEMBER_LIST_SPREADSHEET_STEPS: readonly string[] = [
  "Upload the file as it is, Excel or CSV.",
  "Or copy the rows with their headings and use Paste rows.",
];
export const MEMBER_LIST_OTHER_SOFTWARE_STEPS: readonly string[] = [
  "Open the member or client list in your software.",
  "Look for Export or Download. It's often under Actions, Reports or a ⋯ menu.",
  "Choose CSV or Excel, and upload that file here.",
];

/** Under every product's steps: the steps are as its page said on the day it was read. */
export const MEMBER_LIST_STEPS_MAY_CHANGE_WORDS = "Software changes its menus from time to time. If a step looks different, its help page has the latest steps.";

/** What no file brings, whichever software it came from (§11.7). */
export const MEMBER_LIST_NOT_IN_A_FILE_WORDS = "Saved cards, visit history, documents and photos don't come across in this file.";
