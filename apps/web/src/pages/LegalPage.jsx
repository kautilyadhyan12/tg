import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LEGAL_FACTS,
  LEGAL_PATHS,
  LEGAL_UPDATED_ON,
  legalDayText,
  privacyPolicy,
  termsOfUse,
  washingtonHealthDataPolicy,
} from '@app/shared';
import { ACCENT, INK, LINE, MUTED } from './GymPublicPage';

// KWAZO's own documents (ROADMAP Stage 5 21b-i): the Privacy Policy, the Terms of Use and Washington's
// page, at the addresses in LEGAL_PATHS. Public, no sign-in, in the light look of a gym's public page.
// The words live once, in @app/shared's legal.ts; the phone opens these same pages.

const DOCUMENTS = {
  privacy: privacyPolicy,
  terms: termsOfUse,
  washington: washingtonHealthDataPolicy,
};

const OTHERS = [
  { key: 'privacy', label: 'Privacy Policy' },
  { key: 'terms', label: 'Terms of Use' },
  { key: 'washington', label: 'Washington Consumer Health Data Privacy Policy' },
  { key: 'deleteAccount', label: 'Account Deletion' },
];

/** A line of words, with the support address as a link where it appears. */
function Words({ text }) {
  const email = LEGAL_FACTS.supportEmail;
  if (email === null || !text.includes(email)) return text;
  const parts = text.split(email);
  return parts.map((part, i) => (
    <span key={i}>
      {part}
      {i < parts.length - 1 ? (
        <a href={`mailto:${email}`} style={{ color: ACCENT }} className="underline">
          {email}
        </a>
      ) : null}
    </span>
  ));
}

export function LegalBlock({ block }) {
  if (block.kind === 'h3') {
    return (
      <h3 className="text-[17px] font-semibold leading-snug mt-2" style={{ color: INK }}>
        {block.text}
      </h3>
    );
  }
  if (block.kind === 'strong') {
    return <p className="text-[15px] leading-7 font-semibold">{block.text}</p>;
  }
  if (block.kind === 'p') {
    return (
      <p className="text-[15px] leading-7 break-words">
        <Words text={block.text} />
      </p>
    );
  }
  if (block.kind === 'list') {
    return (
      <ul className="list-disc pl-5 flex flex-col gap-2 text-[15px] leading-7">
        {block.items.map((item) => (
          <li key={item}>
            <Words text={item} />
          </li>
        ))}
      </ul>
    );
  }
  if (block.kind === 'links') {
    return (
      <ul className="flex flex-col gap-2 text-[15px] leading-7">
        {block.items.map((item) =>
          item.to.startsWith('#') ? (
            <li key={item.to}>
              <a href={item.to} style={{ color: ACCENT }} className="underline">
                {item.label}
              </a>
            </li>
          ) : (
            <li key={item.to}>
              <Link to={item.to} style={{ color: ACCENT }} className="underline">
                {item.label}
              </Link>
            </li>
          ),
        )}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl" style={{ border: `1px solid ${LINE}` }}>
      <table className="w-full text-left text-[14px] leading-6">
        <thead style={{ background: '#F1EFEA' }}>
          <tr>
            {block.head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-semibold align-top">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row[0]} style={{ borderTop: `1px solid ${LINE}` }}>
              {row.map((cell, i) => (
                <td key={i} className={i === 0 ? 'px-3 py-2 align-top font-semibold' : 'px-3 py-2 align-top'}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LegalPage({ which }) {
  const doc = DOCUMENTS[which]();
  const { hash } = useLocation();

  useEffect(() => {
    document.title = `${doc.title} · KWAZO`;
  }, [doc.title]);

  // A link to one part ("#members") opens at that part, as a browser does for a page drawn on arrival.
  useEffect(() => {
    if (hash === '') {
      window.scrollTo(0, 0);
      return;
    }
    document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash, which]);

  return (
    <div className="min-h-screen px-4 py-8 sm:py-12" style={{ background: '#F6F5F2', color: INK }}>
      <main className="mx-auto w-full max-w-[720px] min-w-0 flex flex-col gap-8">
        <header className="min-w-0 flex flex-col gap-2">
          <p className="text-sm font-bold tracking-wide" style={{ color: ACCENT }}>
            KWAZO
          </p>
          <h1 className="text-[28px] sm:text-[34px] font-bold leading-tight" style={{ color: INK }}>{doc.title}</h1>
          <p className="text-sm" style={{ color: MUTED }}>
            Last updated {legalDayText(LEGAL_UPDATED_ON)}
          </p>
          {doc.lead.map((para) => (
            <p key={para} className="text-[16px] leading-7 mt-2">
              {para}
            </p>
          ))}
        </header>

        {doc.sections.map((section) => (
          <section key={section.id} id={section.id} className="min-w-0 flex flex-col gap-3 scroll-mt-6">
            <h2 className="text-[20px] font-bold leading-snug" style={{ color: INK }}>{section.heading}</h2>
            {section.blocks.map((block, i) => (
              <LegalBlock key={i} block={block} />
            ))}
          </section>
        ))}

        <footer className="flex flex-col gap-2 pt-6 text-sm" style={{ borderTop: `1px solid ${LINE}`, color: MUTED }}>
          {OTHERS.filter((o) => o.key !== which).map((o) => (
            <Link key={o.key} to={LEGAL_PATHS[o.key]} style={{ color: ACCENT }} className="underline">
              {o.label}
            </Link>
          ))}
          <Link to="/login" style={{ color: MUTED }} className="underline">
            Back to KWAZO
          </Link>
        </footer>
      </main>
    </div>
  );
}
