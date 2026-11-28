// Made by voice-cut (packages/movement/scripts/voice-cut.ts) from the coach's lines (packages/movement/voice/lines.json,
// version 2) and Kd's recording, every clip read back saying its own words: never edited by hand.
import clip_go_lower_1 from "../../assets/voice/go_lower_1.m4a";
import clip_go_lower_2 from "../../assets/voice/go_lower_2.m4a";
import clip_go_lower_3 from "../../assets/voice/go_lower_3.m4a";
import clip_sit_up_higher_1 from "../../assets/voice/sit_up_higher_1.m4a";
import clip_sit_up_higher_2 from "../../assets/voice/sit_up_higher_2.m4a";
import clip_hips_higher_1 from "../../assets/voice/hips_higher_1.m4a";
import clip_hips_higher_2 from "../../assets/voice/hips_higher_2.m4a";
import clip_whole_body_1 from "../../assets/voice/whole_body_1.m4a";
import clip_whole_body_2 from "../../assets/voice/whole_body_2.m4a";
import clip_chest_up_1 from "../../assets/voice/chest_up_1.m4a";
import clip_chest_up_2 from "../../assets/voice/chest_up_2.m4a";
import clip_chest_up_3 from "../../assets/voice/chest_up_3.m4a";
import clip_knees_out_1 from "../../assets/voice/knees_out_1.m4a";
import clip_knees_out_2 from "../../assets/voice/knees_out_2.m4a";
import clip_knees_out_3 from "../../assets/voice/knees_out_3.m4a";
import clip_halfway_1 from "../../assets/voice/halfway_1.m4a";
import clip_halfway_2 from "../../assets/voice/halfway_2.m4a";
import clip_two_more_1 from "../../assets/voice/two_more_1.m4a";
import clip_two_more_2 from "../../assets/voice/two_more_2.m4a";
import clip_last_one_1 from "../../assets/voice/last_one_1.m4a";
import clip_last_one_2 from "../../assets/voice/last_one_2.m4a";
import clip_set_complete_1 from "../../assets/voice/set_complete_1.m4a";
import clip_set_complete_2 from "../../assets/voice/set_complete_2.m4a";
import clip_lost_1 from "../../assets/voice/lost_1.m4a";
import clip_lost_2 from "../../assets/voice/lost_2.m4a";
import clip_phone_still_1 from "../../assets/voice/phone_still_1.m4a";
import clip_phone_still_2 from "../../assets/voice/phone_still_2.m4a";
import clip_counts_now_1 from "../../assets/voice/counts_now_1.m4a";
import clip_counts_now_2 from "../../assets/voice/counts_now_2.m4a";
import clip_better_1 from "../../assets/voice/better_1.m4a";
import clip_better_2 from "../../assets/voice/better_2.m4a";
import clip_get_ready_1 from "../../assets/voice/get_ready_1.m4a";
import clip_rest_1 from "../../assets/voice/rest_1.m4a";
import clip_rest_2 from "../../assets/voice/rest_2.m4a";
import clip_next_exercise_1 from "../../assets/voice/next_exercise_1.m4a";
import clip_workout_complete_1 from "../../assets/voice/workout_complete_1.m4a";
import clip_workout_complete_2 from "../../assets/voice/workout_complete_2.m4a";

/** The lines file's version the clips were recorded for. */
export const VOICE_CLIPS_VERSION = 2;

/** Each line's clips, one a wording, in the line's own order, by the line's id. */
export const VOICE_CLIPS: Readonly<Record<string, readonly number[]>> = {
  go_lower: [clip_go_lower_1, clip_go_lower_2, clip_go_lower_3],
  sit_up_higher: [clip_sit_up_higher_1, clip_sit_up_higher_2],
  hips_higher: [clip_hips_higher_1, clip_hips_higher_2],
  whole_body: [clip_whole_body_1, clip_whole_body_2],
  chest_up: [clip_chest_up_1, clip_chest_up_2, clip_chest_up_3],
  knees_out: [clip_knees_out_1, clip_knees_out_2, clip_knees_out_3],
  halfway: [clip_halfway_1, clip_halfway_2],
  two_more: [clip_two_more_1, clip_two_more_2],
  last_one: [clip_last_one_1, clip_last_one_2],
  set_complete: [clip_set_complete_1, clip_set_complete_2],
  lost: [clip_lost_1, clip_lost_2],
  phone_still: [clip_phone_still_1, clip_phone_still_2],
  counts_now: [clip_counts_now_1, clip_counts_now_2],
  better: [clip_better_1, clip_better_2],
  get_ready: [clip_get_ready_1],
  rest: [clip_rest_1, clip_rest_2],
  next_exercise: [clip_next_exercise_1],
  workout_complete: [clip_workout_complete_1, clip_workout_complete_2],
};
