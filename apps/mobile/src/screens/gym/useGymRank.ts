import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { LEADERBOARD_BOARDS, leaderboardResponseSchema, type LeaderboardBoard, type LeaderboardResponse } from "@app/shared";
import type { Answer } from "../../session/calls";
import { useSession } from "../../session/SessionProvider";
import type { Read } from "../dashboard/useRead";
import { leaderboardPath } from "./Leaderboard";
import { boardInstead } from "./leaderboardView";

/** Your Rank's board at this person's first gym, read as the Leaderboard page opens: from Visits, moving on where the gym
 *  gives way to another board, each time the Dashboard is opened and when the app comes back to it. A read that fails
 *  keeps what the box already shows; an answer about another gym, or for somebody who has since signed out, is dropped. */
export function useGymRank(gymId: string | null): { read: Read<LeaderboardResponse>; again: () => void } {
  const { session, state } = useSession();
  const navigation = useNavigation();
  const me = state.kind === "in" ? state.user.id : null;
  const [read, setRead] = useState<Read<LeaderboardResponse>>({ kind: "loading" });
  const alive = useRef(true);
  // Reads are numbered as they start: only the newest may draw.
  const started = useRef(0);

  const again = useCallback(() => {
    if (me === null || gymId === null) {
      // No gym, no board: a read that failed for the one they had is no longer said.
      setRead((before) => (before.kind === "loading" ? before : { kind: "loading" }));
      return;
    }
    started.current += 1;
    const mine = started.current;
    void (async () => {
      let board: LeaderboardBoard = "gym_days";
      for (let hop = 1; hop <= LEADERBOARD_BOARDS.length; hop += 1) {
        const answer: Answer<LeaderboardResponse> = await session.signedIn({ method: "GET", path: leaderboardPath(gymId, board, "this_week") }, leaderboardResponseSchema);
        if (!alive.current || mine !== started.current) return;
        const now = session.state();
        if (now.kind !== "in" || now.user.id !== me) return;
        if (answer.kind !== "ok" || answer.data.gymId !== gymId || answer.data.board !== board) {
          setRead((before) => (before.kind === "ok" && before.data.gymId === gymId ? before : { kind: "failed" }));
          return;
        }
        const instead = boardInstead(answer.data, false);
        if (instead === null || instead === board || hop === LEADERBOARD_BOARDS.length) {
          setRead({ kind: "ok", data: answer.data });
          return;
        }
        board = instead;
      }
    })();
  }, [session, me, gymId]);

  useEffect(() => {
    alive.current = true;
    const heard = AppState.addEventListener("change", (next) => {
      if (next === "active" && navigation.isFocused()) again();
    });
    return () => {
      alive.current = false;
      heard.remove();
    };
  }, [again, navigation]);

  useFocusEffect(again);

  return { read, again };
}
