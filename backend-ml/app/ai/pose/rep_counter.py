from collections import deque
import time


class RepCounter:
    """
    Counts repetitions for an exercise based on joint angle thresholds.
    Uses a state machine: UP → DOWN → UP = 1 rep.
    """

    # Angle thresholds for each exercise
    # (joint, up_angle, down_angle)
    EXERCISE_CONFIG = {
        "squat": {
            "joint":     "left_knee",
            "up_angle":  160,   # Standing straight
            "down_angle": 100,  # Squatted down
            "direction": "down_to_up",  # Rep counted on the way up
        },
        # Jump squat: same joint and direction as regular squat.
        # down_angle is 130 (rather than 100) since the loading phase for an
        # explosive jump squat is intentionally shallower than a regular squat
        # -- going below parallel reduces force production for the jump
        # (Influence of Squatting Depth on Jumping Performance, multiple
        # sources). The up_angle uses 160 (same as squat) since a jump rep
        # completes on return to standing after landing. This means the rep
        # counter counts a valid rep whenever the person: stands (>160°),
        # descends to at least a quarter squat (< 130°), and returns to
        # standing. The airborne phase between descent and return is not
        # directly gated here (that's handled by form_analyzer checking
        # hip_elevation during the cycle) -- rep_counter just counts the
        # squat cycle; form_analyzer evaluates the quality of each cycle.
        "jump_squat": {
            "joint":      "left_knee",
            "up_angle":   160,
            "down_angle": 130,
            "direction":  "down_to_up",
        },
        "jump_squats": {
            "joint":      "left_knee",
            "up_angle":   160,
            "down_angle": 130,
            "direction":  "down_to_up",
        },
        "chair_squat": {
            "joint":     "left_knee",
            # down_angle 110: a rep counts once the knee descends past 110 deg,
            # which sits between the full chair-height depth target (~90-95 deg)
            # and the too-shallow cutoff (120 deg) used by the form scorer, so a
            # genuine sit-to-stand attempt is counted while a tiny dip is not.
            # up_angle 155: must return to near-standing to complete the rep
            # (matches CHAIR_STANDING_KNEE_MIN in form_analyzer). Validated
            # against real demo footage bottoming at ~62 and ~71-90 deg.
            "up_angle":  155,
            "down_angle": 110,
            "direction": "down_to_up",
        },
        "chair_squats": {
            "joint":     "left_knee",
            "up_angle":  155,
            "down_angle": 110,
            "direction": "down_to_up",
        },
        "push_up": {
            "joint":     "left_elbow",
            "up_angle":  160,   # Arms extended
            "down_angle": 90,   # Chest near floor
            "direction": "down_to_up",
        },
        "lunge": {
            "joint":     "left_knee",
            "up_angle":  160,
            "down_angle": 100,
            "direction": "down_to_up",
        },
        "plank": {
            "joint":     "left_hip",
            "up_angle":  160,   # Hips level (good plank)
            "down_angle": 130,  # Hips dropped (bad plank)
            "direction": "hold",  # Not rep-based, time-based
        },
        "bicep_curl": {
            "joint":     "left_elbow",
            "up_angle":  150,
            "down_angle": 60,
            "direction": "down_to_up",
        },
        "bicep_curls": {
            "joint":     "left_elbow",
            "up_angle":  150,
            "down_angle": 60,
            "direction": "down_to_up",
        },
        "shoulder_press": {
            "joint":     "left_elbow",
            "up_angle":  160,
            "down_angle": 90,
            "direction": "down_to_up",
        },
        "arnold_shoulder_press": {
            "joint":     "left_elbow",
            "up_angle":  160,
            "down_angle": 90,
            "direction": "down_to_up",
        },
        "default": {
            "joint":     "left_knee",
            "up_angle":  160,
            "down_angle": 100,
            "direction": "down_to_up",
        },
    }

    def __init__(self, exercise_name="default"):
        exercise_key = exercise_name.lower().replace(" ", "_").replace("-", "_")
        self.config  = self.EXERCISE_CONFIG.get(
            exercise_key, self.EXERCISE_CONFIG["default"]
        )
        print(f"RepCounter: exercise='{exercise_key}', config={self.config}")
        self.state        = "up"    # Current state: "up" or "down"
        self.rep_count    = 0
        self.angle_buffer = deque(maxlen=7)   # Smooth angles over 7 frames
        self.other_buffer = deque(maxlen=7)   # Smoothed angle of the OTHER
                                              # side (non-primary knee), used
                                              # only to confirm bilateral motion

        # Anti-jitter / anti-phantom-rep guards
        self._frames_in_down = 0      # how many consecutive frames we've been "down"
        self._frames_in_up   = 0      # consecutive frames clearly "up"
        self._min_down_frames = 3     # must stay down ≥3 frames to count as a real squat
        self._min_up_frames   = 2     # must be clearly "up" ≥2 frames before a rep counts
                                      # (symmetric with down — a single flickery
                                      # frame above the threshold no longer counts)
        self._reached_bottom  = False # did we actually reach a deep-enough bottom?

        # For knee-based reps (squat/lunge): the OTHER knee must be at least
        # this bent for a rep to count. A straight standing leg sits ~170-180°,
        # while both knees in a real squat reach ~80-110°, so 150° cleanly
        # rejects one-legged movements (raising a knee while standing) without
        # affecting genuine two-leg squats. Only applied when BOTH knees are
        # visible; if one leg is occluded we fall back to single-knee counting.
        self._bilateral_engage_angle = 150

        # A real rep cannot happen faster than this many seconds. If jittery
        # keypoints make the smoothed angle cross both thresholds rapidly, this
        # caps the rate so a whole set can't be "filled" in a second or two.
        # 0.45s is well below any human rep cadence, so genuine reps are kept.
        self._min_rep_interval = 0.45
        self._last_rep_time    = 0.0

    def update(self, angles: dict) -> dict:
        """
        Feed current joint angles, get back rep count and state.
        Returns dict with rep_count, state, current_angle.
        """
        joint       = self.config["joint"]
        up_angle    = self.config["up_angle"]
        down_angle  = self.config["down_angle"]
        direction   = self.config["direction"]

        current_angle = angles.get(joint)
        if current_angle is None:
            right_joint   = joint.replace("left_", "right_")
            current_angle = angles.get(right_joint)

        if current_angle is None:
            # No usable angle this frame — DON'T change state or count.
            # Returning the existing count prevents resets when the person
            # is partially out of frame (e.g. stepping close to the camera).
            return {
                "rep_count":     self.rep_count,
                "state":         self.state,
                "current_angle": None,
                "is_active":     False,
            }

        # Smooth the angle over several frames to kill per-frame jitter
        self.angle_buffer.append(current_angle)
        smoothed = sum(self.angle_buffer) / len(self.angle_buffer)

        # ── Bilateral gate for lower-body reps ────────────────────────────
        # A real squat/lunge bends BOTH knees; standing on one leg and raising
        # the other bends only one knee through the same angle range, which was
        # being miscounted as a rep. For a knee-based exercise, when BOTH knees
        # are visible, require the OTHER knee to also be clearly bent before we
        # allow entry into the "down" state. If the other knee is occluded we
        # leave this open (single-knee fallback) so a hidden leg never blocks a
        # genuine rep, and non-knee exercises (push-ups, curls) are unaffected.
        both_knees_required = ("knee" in joint) and direction != "hold"
        other_engaged = True
        if both_knees_required:
            l = angles.get("left_knee")
            r = angles.get("right_knee")
            if l is not None and r is not None:
                other_angle = r if joint.startswith("left_") else l
                self.other_buffer.append(other_angle)
                other_smoothed = sum(self.other_buffer) / len(self.other_buffer)
                other_engaged = other_smoothed < self._bilateral_engage_angle

        if direction == "hold":
            self.state = "good" if smoothed >= up_angle else "dropped"
        else:
            # Hysteresis state machine with a "must reach bottom and hold" rule.
            # A rep only counts when:
            #   1. The person goes clearly DOWN (below down_angle),
            #   2. stays down for at least _min_down_frames (not a flicker),
            #   3. then returns clearly UP (above up_angle).
            if smoothed < down_angle and other_engaged:
                self._frames_in_down += 1
                self._frames_in_up    = 0
                if self.state == "up" and self._frames_in_down >= self._min_down_frames:
                    self.state = "down"
                    self._reached_bottom = True
            elif smoothed > up_angle:
                self._frames_in_up   += 1
                self._frames_in_down  = 0
                now = time.monotonic()
                if (
                    self.state == "down"
                    and self._reached_bottom
                    and self._frames_in_up >= self._min_up_frames
                    and (now - self._last_rep_time) >= self._min_rep_interval
                ):
                    # Completed a full, validated rep: reached bottom, held the
                    # top for ≥_min_up_frames, and not faster than a human can move.
                    self.state = "up"
                    self.rep_count += 1
                    self._reached_bottom = False
                    self._last_rep_time  = now
            else:
                # In the dead-zone between thresholds — hold state, reset the
                # short-lived frame counters so brief wobbles don't accumulate.
                self._frames_in_down = 0
                self._frames_in_up   = 0

        # ── Active-movement flag ──────────────────────────────────────────
        # True when the person is actually mid-exercise this frame, as opposed
        # to standing idle in frame between reps/sets. Used by the session to
        # accumulate "active effort" time (for calories and the active-time
        # display) rather than crediting all on-screen time as exercise.
        #
        # For rep-based exercises: active means the primary joint is bent past
        # the standing threshold (smoothed < up_angle) — i.e. they're somewhere
        # in a rep (descending, at the bottom, or ascending), not standing
        # fully extended. This reuses the SAME up_angle the rep state machine
        # already uses, so there's no separate invented threshold.
        # For hold exercises (plank): active whenever a usable angle is present,
        # since the effort is continuous rather than rep-cyclical.
        if direction == "hold":
            is_active = True
        else:
            is_active = smoothed < up_angle

        return {
            "rep_count":     self.rep_count,
            "state":         self.state,
            "current_angle": round(smoothed, 1),
            "is_active":     is_active,
        }

    def reset(self):
        self.state     = "up"
        self.rep_count = 0
        self.angle_buffer.clear()
        self.other_buffer.clear()
        self._frames_in_down = 0
        self._frames_in_up   = 0
        self._reached_bottom = False
        self._last_rep_time  = 0.0