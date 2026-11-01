// A person's profile, in words: the browser's rules (apps/web/src/components/gym/PersonProfile.jsx). Pure, so tested alone.
import type { GymPost, GymPostsResponse, LeaderboardPeriod, LeaderboardProfileResponse, PersonGymPostsResponse } from "@app/shared";
import { BOARD_TABS, PERIODS, ordinal, valueText } from "./leaderboardView";

export const personPlacesPath = (gymId: string, userId: string, period: LeaderboardPeriod) =>
  `/v1/orgs/${encodeURIComponent(gymId)}/leaderboard/people/${encodeURIComponent(userId)}?period=${period}`;
export const personPostsPath = (gymId: string, userId: string, before?: string) =>
  `/v1/orgs/${encodeURIComponent(gymId)}/posts/people/${encodeURIComponent(userId)}${before === undefined ? "" : `?before=${encodeURIComponent(before)}`}`;

export interface ProfilePerson {
  userId: string;
  name: string;
  initials: string;
}

/** The person a post's name opens, as the profile names them. */
export function personOf(post: Pick<GymPost, "author" | "authorId">): ProfilePerson {
  const named = post.author.name !== null && post.author.initials !== "";
  return { userId: post.authorId ?? "", name: post.author.name ?? "A member", initials: named ? post.author.initials : "M" };
}

export interface ProfileStat {
  key: string;
  number: string;
  label: string;
  under: string | null;
}

/** "1 post" reads as "1" over "Post". */
export function postsStat(total: number | null): ProfileStat {
  return { key: "posts", number: total === null ? "–" : total.toLocaleString("en"), label: total === 1 ? "Post" : "Posts", under: null };
}

/** One number for each board the person has a place on: a board that is not sent shows nothing. */
export function placeStats(boards: LeaderboardProfileResponse["boards"], period: LeaderboardPeriod): ProfileStat[] {
  return boards.map((b) => {
    const label = BOARD_TABS.find((t) => t.id === b.board)?.label ?? "";
    const words = PERIODS.find((p) => p.value === (b.period ?? period))?.label.toLowerCase() ?? "";
    const under = b.board === "streak" ? valueText(b.value, b.board) : `${valueText(b.value, b.board)} ${words}`;
    return { key: b.board, number: b.place === null ? "–" : ordinal(b.place), label, under };
  });
}

/** What a member reads where a person has no posts to show. */
export function noPostsLine(name: string, blocked: boolean): string {
  return blocked ? `You've blocked ${name}, so their posts aren't shown.` : `${name} hasn't posted anything.`;
}

/** A page of one person's posts, in the shape Updates' list helpers work on. */
export function asFeed(page: PersonGymPostsResponse, gymId: string, gymName: string): GymPostsResponse {
  return {
    gymId,
    gymName,
    status: "shown",
    pinned: [],
    posts: page.posts,
    next: page.next,
    posting: "off",
    commenting: page.commenting,
    blockedCount: page.blockedCount,
    supportEmail: null,
  };
}
