"""
WebSocket handler for pose data — Phase 3 (rule-based only).

The browser runs MediaPipe and sends only keypoints; the server's rule-based
analyzer (app.ai.pose.form_analyzer) is the sole source of form_score and
form_correct.

Message received from browser:
    {"keypoints": [[x,y,z,vis], ...33 items...], "exercise": "squat"}
    or {"type": "reset_reps"}

Message sent to browser (schema unchanged, but keypoints are no longer echoed
back — the frontend renders its own local MediaPipe keypoints and explicitly
strips the server copy, so echoing them only wasted bandwidth/battery):
    {person_detected, keypoints: [], form_correct, form_score, corrections,
     angles, view, rep_count, state, current_angle, is_active, exercise}

Production hardening in this revision (analysis logic untouched):
  * FIXED crash: rep_result was read by the chair-depth calibration block
    before rep_counter.update() assigned it → NameError killed the socket on
    the first chair-squat frame. Rep counting now runs first.
  * Bounded session store with TTL eviction (was: unbounded memory growth).
  * Keypoint shape validation (was: malformed frame → exception → dead socket).
  * Per-connection processing cap (~30 fps analyzed; excess frames answered
    with the last result) so one misbehaving client can't monopolize CPU.
  * Auth failure: accept-then-close so the 4001 reason actually reaches the
    client; logging instead of print().
"""

import asyncio
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from jose import jwt, JWTError

from app.config import get_settings
from app.core.logging import get_logger
from app.ai.pose.form_analyzer import analyze_form
from app.ai.pose.rep_counter import RepCounter

settings = get_settings()
log = get_logger(__name__)
router = APIRouter()

# ── Bounded, TTL-evicted session store ───────────────────────────────────────
# Counters/calibrations persist across reconnects (StrictMode double-mount,
# network blips) but must not accumulate forever.
_SESSION_TTL_SECONDS = 2 * 60 * 60   # forget a user's set state after 2h idle
_SESSION_MAX_ENTRIES = 5000          # absolute cap as a second line of defense

# key -> (object, last_used_monotonic)
active_sessions: dict[str, tuple[object, float]] = {}


def _session_get_or_create(key: str, factory):
    now = time.monotonic()
    entry = active_sessions.get(key)
    if entry is not None:
        obj = entry[0]
    else:
        obj = factory()
    active_sessions[key] = (obj, now)
    return obj


def _evict_stale_sessions() -> None:
    """Called on each new connection — cheap, keeps memory bounded."""
    now = time.monotonic()
    stale = [k for k, (_, ts) in active_sessions.items()
             if now - ts > _SESSION_TTL_SECONDS]
    for k in stale:
        active_sessions.pop(k, None)
    # Hard cap: drop oldest entries if something pathological happened
    if len(active_sessions) > _SESSION_MAX_ENTRIES:
        oldest = sorted(active_sessions.items(), key=lambda kv: kv[1][1])
        for k, _ in oldest[: len(active_sessions) - _SESSION_MAX_ENTRIES]:
            active_sessions.pop(k, None)


def _touch(key: str) -> None:
    entry = active_sessions.get(key)
    if entry is not None:
        active_sessions[key] = (entry[0], time.monotonic())


# ── Input validation ─────────────────────────────────────────────────────────
def _valid_keypoints(kps) -> bool:
    """33 MediaPipe keypoints, each [x, y, z, visibility] of finite numbers."""
    if not isinstance(kps, list) or len(kps) != 33:
        return False
    for kp in kps:
        if not isinstance(kp, (list, tuple)) or len(kp) < 4:
            return False
        for v in kp[:4]:
            if not isinstance(v, (int, float)) or v != v:  # NaN check
                return False
    return True


def verify_ws_token(token: str):
    try:
        payload = jwt.decode(token, settings.ml_jwt_secret, algorithms=["HS256"])
        return payload.get("id")
    except JWTError:
        return None


class _StandingCalibration:
    """
    Captures this person's own standing-stance baselines at the start of a
    session, used by two different form checks:

    1. Valgus baseline (front view): the person's natural knee-over-ankle
       position while standing, so the front-view valgus check measures a
       DELTA from their own natural stance rather than an absolute cutoff.

    2. Hip/ankle y-baseline and torso height (both views): the person's
       vertical position while standing upright, used to compute
       hip_elevation and ankle_elevation per frame. These are the airborne-
       detection signals for jump squat: positive elevation = risen above
       standing = jump is happening. Captured from both views (not just
       front-only) since jump squats may be performed from either angle.

    Calibration triggers automatically the first time we see several
    consecutive near-standing frames (knee angle high — legs straight),
    regardless of view. Held for the lifetime of the session (same lifetime
    as the RepCounter). No separate "calibration mode" the user has to invoke.
    """

    REQUIRED_STABLE_FRAMES = 8
    STANDING_KNEE_MIN      = 160

    def __init__(self):
        self.baseline   = None   # dict set once calibration is complete
        self._buffer_l  = []     # valgus left, front-view only
        self._buffer_r  = []     # valgus right, front-view only
        self._hip_buf   = []     # raw hip y-position (avg of L+R)
        self._ankle_buf = []     # raw ankle y-position (avg of L+R)
        self._sh_buf    = []     # shoulder y (for torso height)

    def maybe_update(self, geometry: dict, knee_angle, keypoints=None):
        if self.baseline is not None:
            return  # already calibrated for this session
        if knee_angle is None or knee_angle < self.STANDING_KNEE_MIN:
            self._buffer_l.clear()
            self._buffer_r.clear()
            self._hip_buf.clear()
            self._ankle_buf.clear()
            self._sh_buf.clear()
            return

        view = geometry.get("view")

        # ── Valgus baseline (front view only) ─────────────────────────────
        if view == "front":
            vl, vr = geometry.get("valgus_l"), geometry.get("valgus_r")
            if vl is not None and vr is not None:
                self._buffer_l.append(vl)
                self._buffer_r.append(vr)

        # ── Vertical position baseline (both views) ────────────────────────
        if keypoints is not None and len(keypoints) >= 29:
            from app.ai.pose.angles import KP, is_visible
            def _y(kp): return kp[1]
            lh, rh = keypoints[KP["left_hip"]], keypoints[KP["right_hip"]]
            la, ra = keypoints[KP["left_ankle"]], keypoints[KP["right_ankle"]]
            ls, rs = keypoints[KP["left_shoulder"]], keypoints[KP["right_shoulder"]]

            hips_vis = [k for k in [lh, rh] if is_visible(k)]
            ankles_vis = [k for k in [la, ra] if is_visible(k)]
            shs_vis = [k for k in [ls, rs] if is_visible(k)]

            if hips_vis:
                self._hip_buf.append(sum(_y(k) for k in hips_vis) / len(hips_vis))
            if ankles_vis:
                self._ankle_buf.append(sum(_y(k) for k in ankles_vis) / len(ankles_vis))
            if shs_vis:
                self._sh_buf.append(sum(_y(k) for k in shs_vis) / len(shs_vis))

        # ── Lock in baseline once we have enough stable standing frames ─────
        enough_vertical = len(self._hip_buf) >= self.REQUIRED_STABLE_FRAMES
        enough_valgus = (len(self._buffer_l) >= self.REQUIRED_STABLE_FRAMES
                         if view == "front" else True)

        if enough_vertical and enough_valgus:
            self.baseline = {}
            # Valgus baseline (front view; may be absent if calibration
            # happened entirely from a side-view session)
            if self._buffer_l:
                self.baseline["valgus_l_baseline"] = (
                    sum(self._buffer_l) / len(self._buffer_l)
                )
                self.baseline["valgus_r_baseline"] = (
                    sum(self._buffer_r) / len(self._buffer_r)
                )
            # Vertical baselines (both views)
            self.baseline["hip_y_baseline"]   = (
                sum(self._hip_buf) / len(self._hip_buf)
            )
            self.baseline["ankle_y_baseline"] = (
                sum(self._ankle_buf) / len(self._ankle_buf)
            ) if self._ankle_buf else None
            # Torso height for normalizing elevation
            if self._sh_buf and self._ankle_buf:
                avg_sh  = sum(self._sh_buf)   / len(self._sh_buf)
                avg_an  = sum(self._ankle_buf) / len(self._ankle_buf)
                self.baseline["torso_height"] = abs(avg_an - avg_sh)

    def reset(self):
        self.baseline = None
        self._buffer_l.clear()
        self._buffer_r.clear()
        self._hip_buf.clear()
        self._ankle_buf.clear()
        self._sh_buf.clear()


class _ChairDepthCalibration:
    """
    Learns this person's chair height from their first few reps rather than
    assuming a fixed 45 cm seat.  After watching CALIBRATION_REPS complete
    reps it writes chair_depth_target into the standing_ref dict so that
    _analyze_chair_squat can score depth relative to *this* chair, not some
    canonical one.

    Also tracks consecutive shallow reps so the form analyzer can flag
    fatigue/form-breakdown only when it's persistent (3+ reps in a row),
    not on a single slightly-short rep.
    """
    CALIBRATION_REPS   = 2    # reps to observe before locking in the target
    SHALLOW_STREAK_MAX = 3    # consecutive shallow reps before flagging

    def __init__(self):
        self._rep_min_angles  = []   # min knee angle seen in each calibration rep
        self._current_rep_min = None
        self._in_rep          = False
        self.target           = None  # locked in after CALIBRATION_REPS
        self.shallow_streak   = 0     # consecutive reps shallower than target+margin

    def update(self, knee_angle, rep_state, standing_ref):
        """
        Call once per frame with the current knee angle, the rep counter's
        state ('up'/'down'), and the shared standing_ref dict (written in
        place when the target is locked).

        rep_state transitions:
          up  → down : rep started, begin tracking the minimum angle
          down → up  : rep completed, record the minimum and maybe lock target
        """
        if knee_angle is None:
            return

        # Track the minimum angle reached during the current rep
        if rep_state == "down":
            self._in_rep = True
            if self._current_rep_min is None or knee_angle < self._current_rep_min:
                self._current_rep_min = knee_angle

        elif rep_state == "up" and self._in_rep:
            # Rep just completed
            self._in_rep = False
            if self._current_rep_min is not None:
                if self.target is None:
                    # Still calibrating: collect this rep's bottom angle
                    self._rep_min_angles.append(self._current_rep_min)
                    if len(self._rep_min_angles) >= self.CALIBRATION_REPS:
                        # Use the median of calibration reps (robust to one
                        # unusually deep or shallow early rep)
                        sorted_angles = sorted(self._rep_min_angles)
                        mid = len(sorted_angles) // 2
                        raw_target = sorted_angles[mid]
                        # Add a small buffer so natural rep-to-rep variation
                        # doesn't immediately trigger a shallow warning
                        self.target = raw_target + 5
                        standing_ref["chair_depth_target"] = self.target
                else:
                    # Already calibrated: track whether this rep was shallow
                    shallow_threshold = self.target + 25  # CHAIR_SHALLOW_MARGIN
                    if self._current_rep_min > shallow_threshold:
                        self.shallow_streak += 1
                    else:
                        self.shallow_streak = 0  # reset on any good rep

            self._current_rep_min = None

    @property
    def persistent_shallow(self):
        """True when the user has done 3+ consecutive shallow reps."""
        return self.shallow_streak >= self.SHALLOW_STREAK_MAX

    def reset(self):
        self._rep_min_angles  = []
        self._current_rep_min = None
        self._in_rep          = False
        self.target           = None
        self.shallow_streak   = 0


# Max frames analyzed per second per connection. The browser sends ~15 fps;
# anything wildly above that is a bug or abuse and gets the cached result.
_MAX_ANALYZED_FPS = 30
_MIN_FRAME_INTERVAL = 1.0 / _MAX_ANALYZED_FPS


@router.websocket("/ws/pose")
async def pose_websocket(
    websocket: WebSocket,
    token:     str = Query(...),
    exercise:  str = Query("squat"),
):
    user_id = verify_ws_token(token)
    if not user_id:
        # Accept first so the close code/reason actually reaches the client
        await websocket.accept()
        await websocket.close(code=4001, reason="Invalid token")
        return

    await websocket.accept()
    log.info("Pose WS connected: user=%s exercise=%s", user_id, exercise)

    _evict_stale_sessions()

    # Persistent RepCounter across reconnects (StrictMode double-mount, network
    # blips, phase changes all reconnect the WS). A fresh counter each time would
    # reset reps mid-set. Keyed by user+exercise; zeroed via {"type":"reset_reps"}.
    session_key = f"{user_id}:{exercise}"
    rep_counter = _session_get_or_create(
        session_key, lambda: RepCounter(exercise_name=exercise)
    )
    calibration = _session_get_or_create(
        f"{session_key}:calib", _StandingCalibration
    )
    chair_depth_cal = _session_get_or_create(
        f"{session_key}:chair_depth", _ChairDepthCalibration
    )

    # IMPORTANT: seed rep_count from the (possibly reused) counter's CURRENT
    # value, NOT 0. This RepCounter persists across reconnects and across
    # workouts, so on a fresh connection it may already hold a leftover count.
    # If we reported 0 here and the first frame had no person in it, the client
    # would lock that 0 in as its per-set baseline — then the real leftover
    # value would surface on the next frame and instantly "complete" the set.
    # Reporting the true current count keeps the client's baseline correct.
    last_result = {
        "person_detected": False,
        "keypoints":       [],
        "form_correct":    False,
        "form_score":      0,
        "corrections":     [],
        "angles":          {},
        "view":            None,
        "rep_count":       rep_counter.rep_count,
        "state":           rep_counter.state,
        "current_angle":   None,
        "is_active":       False,
        "exercise":        exercise,
    }

    stopped = False
    last_analyzed_at = 0.0

    try:
        while not stopped:
            # ── Receive keypoints JSON from browser ───────────────────────────
            try:
                data = await asyncio.wait_for(
                    websocket.receive_json(),
                    timeout=5.0,
                )
            except asyncio.TimeoutError:
                # No message — send keepalive so browser knows we're alive
                try:
                    await websocket.send_json({"type": "keepalive"})
                except Exception:
                    stopped = True
                continue
            except ValueError:
                # Non-JSON payload — ignore the frame rather than dying
                continue

            if not isinstance(data, dict):
                continue

            # ── Control messages ──────────────────────────────────────────────
            if data.get("type") == "reset_reps":
                rep_counter.reset()
                calibration.reset()
                chair_depth_cal.reset()
                _touch(session_key)
                try:
                    await websocket.send_json(
                        {**last_result, "rep_count": 0, "state": "up"}
                    )
                except Exception:
                    stopped = True
                continue

            keypoints    = data.get("keypoints", [])
            msg_exercise = data.get("exercise", exercise)
            if not isinstance(msg_exercise, str) or len(msg_exercise) > 64:
                msg_exercise = exercise

            # ── Flood guard: cap analysis rate per connection ─────────────────
            now = time.monotonic()
            flooded = (now - last_analyzed_at) < _MIN_FRAME_INTERVAL

            # ── Angles + rep counting + rule-based form (single source) ──────
            if not flooded and _valid_keypoints(keypoints):
                last_analyzed_at = now
                _touch(session_key)

                form_result = analyze_form(
                    keypoints,
                    exercise_name=msg_exercise,
                    standing_ref=calibration.baseline,
                )

                # Rep counting MUST run before chair-depth calibration below,
                # which consumes rep_result["state"]. (Previously this ran
                # after it — a NameError that killed the socket on the first
                # chair-squat frame.)
                rep_result = rep_counter.update(form_result["angles"])

                # Opportunistically calibrate this person's standing-stance
                # baseline using the same angles/geometry form_result just
                # computed — no second pass over keypoints. Runs for both
                # squat variants since chair squats also use valgus + elevation.
                normalized = msg_exercise.lower().replace(" ", "_").replace("-", "_")
                is_squat_variant = normalized in (
                    "squat", "chair_squat", "chair_squats",
                )
                if is_squat_variant and calibration.baseline is None:
                    knee_angles = [
                        form_result["angles"].get("left_knee"),
                        form_result["angles"].get("right_knee"),
                    ]
                    knee_angles = [a for a in knee_angles if a is not None]
                    knee_avg = sum(knee_angles) / len(knee_angles) if knee_angles else None
                    calibration.maybe_update(
                        form_result.get("geometry", {}), knee_avg,
                        keypoints=keypoints,
                    )

                # Chair-depth adaptive calibration: learn this chair's height
                # from the first few reps, then track shallow-rep streaks.
                is_chair = normalized in ("chair_squat", "chair_squats")
                if is_chair and calibration.baseline is not None:
                    knee_angles = [
                        form_result["angles"].get("left_knee"),
                        form_result["angles"].get("right_knee"),
                    ]
                    valid = [k for k in knee_angles if k]
                    knee_avg = sum(valid) / len(valid) if valid else None
                    chair_depth_cal.update(
                        knee_angle=knee_avg,
                        rep_state=rep_result["state"],
                        standing_ref=calibration.baseline,
                    )
                    # Inject persistent-shallow correction into this frame's
                    # result when the streak threshold is reached — this fires
                    # in addition to (not instead of) the per-frame depth score.
                    if chair_depth_cal.persistent_shallow:
                        existing = form_result.get("corrections", [])
                        shallow_msg = "Keep it consistent — you're repeatedly not reaching your usual depth"
                        if shallow_msg not in existing:
                            form_result["corrections"] = (existing + [shallow_msg])[:2]

                last_result = {
                    "person_detected": True,
                    # Do NOT echo keypoints back: the frontend renders its own
                    # local MediaPipe keypoints and strips this field. Echoing
                    # 33 points at 15 fps only burned bandwidth and battery.
                    "keypoints":       [],
                    "form_correct":    form_result["form_correct"],
                    "form_score":      form_result["form_score"],
                    "corrections":     form_result["corrections"],
                    "angles":          form_result["angles"],
                    "view":            form_result.get("view"),
                    "rep_count":       rep_result["rep_count"],
                    "state":           rep_result["state"],
                    "current_angle":   rep_result["current_angle"],
                    "is_active":       rep_result.get("is_active", False),
                    "exercise":        msg_exercise,
                }
            elif flooded:
                # Over the rate cap: answer with the last computed result so
                # the client stays responsive, but skip the CPU work.
                pass
            else:
                # No person detected or malformed keypoints
                last_result = {
                    **last_result,
                    "person_detected": False,
                    "keypoints":       [],
                    "corrections":     ["Stand in front of the camera"],
                }

            # ── Send result back to browser ───────────────────────────────────
            try:
                await websocket.send_json(last_result)
            except Exception:
                stopped = True

    except WebSocketDisconnect:
        log.info("Pose WS disconnected: user=%s", user_id)
    except Exception:
        log.exception("Pose WS error for user=%s", user_id)
    finally:
        stopped = True
        # Keep the persistent counter/calibration across reconnects (reset
        # per set instead, via the reset_reps message).
        try:
            await websocket.close()
        except Exception:
            pass
        log.info("Pose WS cleaned up: user=%s", user_id)
