import { useEffect, useState } from 'react';
import { orgService, errorText } from '../../api/orgsApi';
import { findOrgBySlug } from './consoleView';

/** Resolve `/console/:orgSlug` to the org the API is keyed by.
 *
 *  Part 3 §3.1 fixes the URL scheme as `/console/:orgSlug/...`; every org route
 *  on the API takes the uuid. There is no by-slug endpoint, so the slug is
 *  matched against the caller's OWN org list — which has the useful property
 *  that a slug that does not exist and a gym the caller does not staff produce
 *  the same answer, exactly as the server's own 404-not-403 stance intends.
 *
 *  Four states, all distinguishable, because a screen that cannot tell them
 *  apart draws "you don't manage any gyms" at a gym owner whose network blipped:
 *    loading · failed (with `error` and `reload`) · notFound · resolved (`org`)
 *
 *  The effect NEVER calls setState synchronously — `loading` is the initial
 *  state and `reload` re-enters it from the click handler. That is a lint rule
 *  here (cascading renders), and it is also the clearer reading: the effect
 *  starts a request and the handlers report what came back.
 *
 *  No reset when `orgSlug` changes under a mounted hook, deliberately: nothing
 *  in the console navigates from one gym to another without passing through a
 *  screen that unmounts this. Add one and the stale-name flash becomes real. */
export function useConsoleOrg(orgSlug) {
  const [state, setState] = useState({ loading: true, error: null, org: null, notFound: false });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // NO SLUG, NO QUESTION. Added when `ConsoleLayout` began using this hook to
    // find out the viewer's role: the shell renders on `/console` and
    // `/console/new` too, where there is no gym to resolve, and without this it
    // would ask the server which gyms you run in order to answer a question
    // nobody asked. The state stays `loading`, which is the truthful answer —
    // no org has been resolved and none is being — and the shell reads only
    // `org`, so it simply draws no gym tabs.
    //
    // STRUCTURALLY UNREACHABLE FOR THE SCREENS: both page callers take the slug
    // from `/console/:orgSlug[/...]`, and react-router does not match those
    // patterns with the segment empty.
    if (typeof orgSlug !== 'string' || orgSlug === '') return undefined;
    let cancelled = false;
    orgService
      .getMine()
      .then((res) => {
        if (cancelled) return;
        const org = findOrgBySlug(res.data?.orgs, orgSlug);
        setState({ loading: false, error: null, org, notFound: org === null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: errorText(err, "We couldn't load your gyms."),
          org: null,
          notFound: false,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug, attempt]);

  const reload = () => {
    setState({ loading: true, error: null, org: null, notFound: false });
    setAttempt((n) => n + 1);
  };

  return { ...state, reload };
}
