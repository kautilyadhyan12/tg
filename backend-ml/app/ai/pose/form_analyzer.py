"""
Rule-based form analyzer.

This is the ONLY source of form feedback in the app — there is no ML model
in this path anymore. Both `form_score` (0-100) and `form_correct` (bool)
are derived from the same set of weighted checks below, so they can never
disagree with each other: form_correct is simply form_score crossing a pass
threshold with zero severe-fault checks active.

Squat checks are view-aware. A camera that isn't fixed means a frame can be
front-on, side-on, or somewhere in between, and a 2D rule built for one view
can misfire badly when applied to the other (e.g. front-view "knee angle"
depth is unreliable due to foreshortening; side-view can't see knee valgus
at all). `angles.get_squat_geometry` classifies the view per frame and the
rules below branch on it.

── Sourcing for squat thresholds ───────────────────────────────────────────
All squat numbers below come from cited biomechanics research/consensus
(not guessed), cross-checked against two labeled reference clips run through
the project's own MediaPipe extraction notebook (front-view bodyweight squat
bottoming at ~90° knee angle / ~12° trunk lean; side-view ATG squat bottoming
at ~37-55° knee angle / ~47-53° trunk lean). Both were confirmed as
legitimate squats, which is why depth is scored on a continuous scale rather
than a single fixed target — but trunk lean is gated by an absolute ceiling
regardless of depth, per explicit product decision.

  Depth (knee angle, INTERIOR convention: 180=straight leg, decreasing as
  you bend — this is the opposite convention from "flexion angle". Source
  conversion: parallel squat ≈ 90° knee flexion ≈ 90° interior angle;
  below-parallel/deep squat ≈ 110-130°+ flexion ≈ 50-70° interior angle).
    - Standing:        155-180° interior (knees not bent)
    - Shallow/partial: 130-155° interior (above parallel — insufficient depth)
    - Parallel:        ~100-130° interior (ramping toward acceptable depth)
    - Below parallel:  <100° interior (good — deeper is not penalized)
    - Locked knees at top: >178° interior (hyperextension risk)

  Trunk forward lean (from vertical, 0=upright):
    - Below ~45°: acceptable regardless of depth (individual variation in
      forward lean is normal and expected — see femur/torso ratio, ankle
      mobility literature)
    - Above ~45°: flagged — center of gravity is moving outside a
      recoverable base, regardless of how deep the squat is

  Knee valgus (front view only — side view cannot see medial/lateral knee
  position): measured as a DELTA from this person's own standing stance,
  not an absolute cutoff, because absolute knee-to-ankle offset depends on
  stance width, which varies legitimately person to person. A delta of
  ~0.15-0.20 hip-widths inward during the descent is used as the flag
  threshold — small enough to catch real collapse, large enough to not
  fire on normal frame-to-frame jitter (MediaPipe landmark noise is
  typically under ~0.05 hip-widths at rest).

  NOT implemented in v1 (explicitly, not an oversight): foot turnout angle
  and stance width (no consensus numeric range exists — sources disagree
  from 0-45°), and heel-rise (needs heel-vs-ankle y-tracking not yet
  isolated in the keypoint pipeline). Both have clean extension points
  below if/when reliable thresholds + calibration data are available.
"""

from app.ai.pose.angles import get_joint_angles, get_squat_geometry


# ─────────────────────────────────────────────────────────────────────────────
# Squat thresholds (degrees, interior-angle convention unless noted)
# ─────────────────────────────────────────────────────────────────────────────
SQUAT_STANDING_KNEE_MIN   = 155   # below this, person is no longer "standing"
SQUAT_LOCKOUT_KNEE_MAX    = 178   # above this, knees are hyperextended/locked
SQUAT_PARALLEL_KNEE       = 100   # acceptable minimum depth (slightly above
                                   # strict 90 deg parallel, for camera/landmark
                                   # noise tolerance)
SQUAT_SHALLOW_KNEE        = 130   # above this at the bottom of a rep = clearly
                                   # insufficient depth, not just "a bit high"

SQUAT_TRUNK_LEAN_MAX      = 45    # forward lean ceiling, regardless of depth

SQUAT_VALGUS_DELTA_FLAG   = 0.15  # hip-widths of inward knee drift from this
                                   # person's own standing baseline
SQUAT_VALGUS_DELTA_SEVERE = 0.30



# ─────────────────────────────────────────────────────────────────────────────
# Chair squat (sit-to-stand) thresholds. A chair squat differs from a regular
# squat in one fundamental way: it has a DEFINED TARGET DEPTH (the chair seat),
# not "deeper is better". The standardized clinical protocol uses a 45 cm seat
# where the knee reaches ~90 deg flexion at the seated bottom position (Chair
# squat performance study, PMC9936124).
#
# ADAPTIVE DEPTH: Rather than fixing the target at 90 deg (which assumes a
# standard 45 cm seat), the analyzer accepts an optional session-specific
# target from standing_ref["chair_depth_target"], set by _ChairDepthCalibration
# in pose_ws.py after observing the first couple of reps. This makes the check
# chair-height agnostic: a taller chair user who naturally bottoms at 105 deg
# has 105 deg as their session target; a standard chair user has ~90 deg.
# The CHAIR_FALLBACK_TARGET is used until calibration fires (early reps) or
# when the exercise is run outside a WS session (e.g. unit tests).
# ─────────────────────────────────────────────────────────────────────────────
CHAIR_STANDING_KNEE_MIN  = 155   # below this = no longer standing (same as squat)
CHAIR_FALLBACK_TARGET    = 100   # used before session calibration fires; looser
                                  # than the strict 95 used before, to avoid
                                  # penalising tall-chair users in early reps
CHAIR_SHALLOW_MARGIN     = 25    # a rep is "too shallow" if knee never reaches
                                  # within this many degrees of the session target
                                  # e.g. target=90 → shallow if knee stays > 115
                                  #      target=105 → shallow if knee stays > 130
# Tolerance window: give full credit within this many degrees of the target,
# to absorb rep-to-rep natural variation and landmark noise.
CHAIR_DEPTH_TOLERANCE    = 10    # e.g. target=90 → full credit at ≤ 100

# Trunk lean: deliberately conservative. Real chair-squat footage shows 30-40
# deg of forward lean during the descent as NORMAL and necessary -- a sit-to-
# stand moves the center of mass forward to rise (normal subjects reach ~49 deg
# trunk flexion from horizontal in the momentum phase, Sibella et al. 2003).
# An absolute fault at 40 deg would wrongly flag every correct rep. So we only
# flag clearly-excessive lean (> 50 deg) AND only when the trunk is leaning
# substantially MORE than the shin (the relative check, same principle used for
# jump squat) -- this isolates a genuine torso-collapse from the inherent
# forward lean the movement requires.
CHAIR_TRUNK_LEAN_ABSOLUTE = 50   # below this absolute lean = never a fault
CHAIR_TRUNK_SHIN_DELTA    = 20   # trunk must exceed shin by this much to fault


def _score_chair_depth(knee_angle, session_target=None):
    """
    Adaptive depth score for a chair squat, 0-100.

    session_target: the minimum knee angle this person reached in their first
    calibration reps (set by _ChairDepthCalibration and passed in via
    standing_ref["chair_depth_target"]). If None, falls back to
    CHAIR_FALLBACK_TARGET. This makes the scorer chair-height agnostic --
    a taller chair that puts the knee at 105 deg is treated the same as a
    standard chair at 90 deg, as long as the user reaches their own target.

    Scoring zones (all relative to the session target):
      <= target + TOLERANCE (e.g. ≤ target+10)  → 100  (at or near chair depth)
      between tolerance and shallow margin        → partial credit (40–99)
      > target + SHALLOW_MARGIN (too shallow)     → low credit (0–39)
      >= CHAIR_STANDING_KNEE_MIN                  → None (person is standing)
    """
    if knee_angle is None or knee_angle >= CHAIR_STANDING_KNEE_MIN:
        return None

    target   = session_target if session_target is not None else CHAIR_FALLBACK_TARGET
    full_at  = target + CHAIR_DEPTH_TOLERANCE      # e.g. target=90 → full at ≤100
    shallow_at = target + CHAIR_SHALLOW_MARGIN     # e.g. target=90 → shallow at >115

    if knee_angle <= full_at:
        return 100.0
    if knee_angle >= shallow_at:
        # Too shallow relative to this person's own target
        span = CHAIR_STANDING_KNEE_MIN - shallow_at
        if span <= 0:
            return 0.0
        progress = (CHAIR_STANDING_KNEE_MIN - knee_angle) / span
        return round(max(0.0, 40 * progress), 1)
    # Partial depth: between the tolerance window and the shallow cutoff
    span = shallow_at - full_at
    progress = (shallow_at - knee_angle) / span
    return round(40 + 60 * progress, 1)


def _score_depth(knee_angle):
    """
    Continuous depth score, 0-100, from the knee interior angle at the
    current frame. Standing (no bend) returns None — depth only means
    something once a person is actually mid-squat. Shallow squats score
    low; parallel and below score progressively higher, plateauing rather
    than rewarding extra depth forever (no extra credit, but no penalty
    either — matches the product decision that deep/ATG squats are valid).
    """
    if knee_angle >= SQUAT_STANDING_KNEE_MIN:
        return None
    if knee_angle >= SQUAT_SHALLOW_KNEE:
        span = SQUAT_STANDING_KNEE_MIN - SQUAT_SHALLOW_KNEE
        progress = (SQUAT_STANDING_KNEE_MIN - knee_angle) / span
        return round(30 * progress, 1)
    if knee_angle >= SQUAT_PARALLEL_KNEE:
        span = SQUAT_SHALLOW_KNEE - SQUAT_PARALLEL_KNEE
        progress = (SQUAT_SHALLOW_KNEE - knee_angle) / span
        return round(30 + 70 * progress, 1)
    return 100.0


def _score_trunk_lean(trunk_incline_deg):
    if trunk_incline_deg is None:
        return None
    if trunk_incline_deg <= SQUAT_TRUNK_LEAN_MAX:
        return 100.0
    over = trunk_incline_deg - SQUAT_TRUNK_LEAN_MAX
    return round(max(0.0, 100 - (over / 30) * 100), 1)


def _score_valgus(delta):
    """
    delta: valgus_delta_l or _delta_r — current valgus minus this person's
    standing baseline. Negative values mean the knee has drifted toward the
    body midline relative to standing (valgus). Positive (knees drifting
    outward) is not penalized.
    """
    if delta is None or delta >= 0:
        return 100.0
    inward = abs(delta)
    if inward <= SQUAT_VALGUS_DELTA_FLAG:
        return 100.0
    if inward >= SQUAT_VALGUS_DELTA_SEVERE:
        return 0.0
    span = SQUAT_VALGUS_DELTA_SEVERE - SQUAT_VALGUS_DELTA_FLAG
    progress = (inward - SQUAT_VALGUS_DELTA_FLAG) / span
    return round(100 - 100 * progress, 1)


def _analyze_squat(keypoints, standing_ref=None):
    """
    View-aware squat analysis. Returns the same shape as analyze_form(),
    plus 'view' and 'geometry' for debugging/telemetry.
    """
    angles   = get_joint_angles(keypoints)
    geometry = get_squat_geometry(keypoints, standing_ref=standing_ref)
    view     = geometry.get("view", "unknown")

    knee_candidates = [a for a in [angles.get("left_knee"), angles.get("right_knee")] if a is not None]

    if not knee_candidates:
        return {
            "form_correct": False,
            "form_score":   0,
            "corrections":  ["Cannot see your legs clearly — step back so your full body is in frame"],
            "angles":       angles,
            "view":         view,
        }

    knee_angle = sum(knee_candidates) / len(knee_candidates)

    component_scores = {}
    severe_faults     = []  # forces form_correct=False regardless of score
    corrections       = []

    # ── Depth (usable from both views — distinguishing standing vs squatted
    #    is robust even though front-view fine precision is noisier) ────────
    depth_score = _score_depth(knee_angle)
    if depth_score is not None:
        component_scores["depth"] = depth_score
        if depth_score < 50:
            corrections.append("Squat lower — aim to get your hips level with your knees")

    # ── Trunk lean (both views; most reliable from the side, but a gross
    #    forward collapse is still visible from the front) ──────────────────
    trunk_incline = geometry.get("trunk_incline_deg")
    lean_score = _score_trunk_lean(trunk_incline)
    if lean_score is not None:
        component_scores["trunk_lean"] = lean_score
        if trunk_incline > SQUAT_TRUNK_LEAN_MAX:
            corrections.append("Keep your chest up — you're leaning too far forward")
            if trunk_incline > SQUAT_TRUNK_LEAN_MAX + 15:
                severe_faults.append("trunk_lean")

    # ── Knee valgus (front view ONLY — side view cannot see medial/lateral
    #    knee position) ───────────────────────────────────────────────────
    if view == "front":
        valgus_deltas = [geometry.get("valgus_delta_l"), geometry.get("valgus_delta_r")]
        valgus_deltas = [v for v in valgus_deltas if v is not None]
        if valgus_deltas:
            worst = min(valgus_deltas)  # most negative = most inward drift
            valgus_score = _score_valgus(worst)
            component_scores["valgus"] = valgus_score
            if worst < -SQUAT_VALGUS_DELTA_FLAG:
                corrections.append("Push your knees out — don't let them cave inward")
                if worst < -SQUAT_VALGUS_DELTA_SEVERE:
                    severe_faults.append("valgus")

    if not component_scores:
        # Standing between reps, or missing landmarks for everything but
        # the knee — neutral, not a penalty.
        form_score = 80
    else:
        form_score = round(sum(component_scores.values()) / len(component_scores))

    form_correct = form_score >= 70 and len(severe_faults) == 0

    seen = set()
    deduped = []
    for c in corrections:
        if c not in seen:
            deduped.append(c)
            seen.add(c)

    return {
        "form_correct": form_correct,
        "form_score":   int(form_score),
        "corrections":  deduped[:2],
        "angles":       angles,
        "view":         view,
        "geometry":     geometry,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Non-squat exercises — unchanged rule format from before. These still use
# the simple (joint, min_angle, max_angle, message) rule list. Squat has been
# pulled out into its own view-aware function above; everything else keeps
# the original mechanism until each exercise gets the same treatment (one
# at a time, as planned).
# ─────────────────────────────────────────────────────────────────────────────
FORM_RULES = {
    "push_up": [
        ("left_elbow",    70,  110, "Lower your chest closer to the floor"),
        ("right_elbow",   70,  110, "Lower your chest closer to the floor"),
        ("left_shoulder", 40,   90, "Keep your body in a straight line"),
        ("left_hip",      160, 180, "Don't let your hips sag"),
    ],
    "lunge": [
        ("left_knee",  80,  100, "Bend your front knee to 90 degrees"),
        ("right_knee", 80,  100, "Bend your back knee toward the floor"),
        ("left_hip",   160, 180, "Keep your torso upright"),
    ],
    "plank": [
        ("left_hip",  160, 180, "Raise your hips — keep body straight"),
        ("right_hip", 160, 180, "Don't let your hips drop"),
        ("left_elbow", 85,  95, "Keep elbows directly under shoulders"),
    ],
    "bicep_curl": [
        ("left_elbow",  50,  160, "Full range of motion — curl all the way up"),
        ("right_elbow", 50,  160, "Full range of motion — curl all the way up"),
    ],
    "bicep_curls": [
        ("left_elbow",  50,  160, "Full range of motion — curl all the way up"),
        ("right_elbow", 50,  160, "Full range of motion — curl all the way up"),
    ],
    "shoulder_press": [
        ("left_elbow",  80,  170, "Press all the way up"),
        ("right_elbow", 80,  170, "Press all the way up"),
    ],
    "arnold_shoulder_press": [
        ("left_elbow",  80,  170, "Press all the way up"),
        ("right_elbow", 80,  170, "Press all the way up"),
    ],
    "default": [],
}


def _analyze_jump_squat(keypoints, standing_ref=None):
    """
    View-aware jump squat form analysis.

    Checks three faults, all matched to your listed common mistakes, all
    thresholds grounded in peer-reviewed sources:

    ── 1. STIFF LANDING (landing with straight knees) ─────────────────────
    Source: Devita & Skelly (1992), Med Sci Sports Exerc 24(1):108-115.
    Defined "stiff" landing as knees as straight as possible (average 77°
    of flexion = interior angle ~103°), and "soft" landing as > 90° of
    flexion (interior angle < 90°). Stiff landings show significantly
    higher ground reaction forces, increased quadriceps contraction and
    ACL strain. We flag a landing fault when knee interior angle > 130°
    after the person has descended through the jump cycle (i.e. after a
    confirmed airborne phase). This gives a clear margin over Devita &
    Skelly's "stiff" mean of 103° while leaving a reasonable buffer for
    the range of safe-but-imperfect landings. Requires hip_elevation data
    (from standing calibration + get_squat_geometry) to confirm that a
    real jump happened before checking landing knee angle.

    ── 2. INSUFFICIENT LOADING DEPTH ──────────────────────────────────────
    Source: Multiple jump-squat biomechanics papers including Influence of
    Squatting Depth on Jumping Performance (ResearchGate). Jump squats need
    enough knee flexion during loading to generate power, but going deeper
    than parallel reduces force production compared to quarter-to-parallel
    depth, unlike regular squats where deeper = better. We require at least
    a moderate loading depth (knee interior angle < 140°, i.e. > 40° of
    flexion) to confirm the person isn't jumping from an almost-straight-
    knee position. We do NOT penalize going to 90-100°; unlike the regular
    squat scorer, depth beyond parallel is not rewarded extra here.
    Only evaluated when the rep counter signals the person is in the down
    phase (state == 'down'), not during the airborne or standing phases.

    ── 3. EXCESSIVE FORWARD LEAN ──────────────────────────────────────────
    Source: NASM certification material (NASM CPT podcast, ep.10): "40
    degrees is a bit excessive" for trunk lean. This refers to ABSOLUTE
    trunk angle from vertical. However, jump squats naturally require
    more forward lean than a standing squat during the loading phase --
    your own side-view data showed 35-44° as the NORMAL loaded position,
    consistent with the tibia-torso parallel principle NASM describes
    (if the tibia is at ~35°, the torso at ~37° is not excessive).
    We therefore only flag trunk lean as a fault when trunk_incline_deg
    exceeds 50° AND the shin_incline_deg is available AND trunk is > 15°
    MORE inclined than the shin (confirming the extra lean is relative to
    the shin position, not just inherent body mechanics). If shin_incline
    is unavailable (front view), we only flag at 55° absolute -- a higher
    bar to avoid false positives from front-view foreshortening. Trunk lean
    is only checked during the loaded (down) phase, not airborne.

    ── AIRBORNE DETECTION ─────────────────────────────────────────────────
    The hip_elevation signal comes from get_squat_geometry when
    standing_ref contains hip_y_baseline/ankle_y_baseline/torso_height,
    set by _StandingCalibration. Threshold: hip_elevation > 0.15 (confirmed
    on real footage: your non-jump standing frames had hip_elevation max
    0.048, while real jump peaks reached 0.80-0.84 -- the gap between noise
    floor and real signal is enormous, a threshold of 0.15 is conservative
    and robust). This is used to gate the landing-knee check: we only check
    for stiff landing if we've actually seen an airborne phase this rep.
    """
    from collections import deque

    angles   = get_joint_angles(keypoints)
    geometry = get_squat_geometry(keypoints, standing_ref=standing_ref)
    view     = geometry.get("view", "unknown")

    knee_candidates = [a for a in [angles.get("left_knee"), angles.get("right_knee")] if a is not None]

    if not knee_candidates:
        return {
            "form_correct": False,
            "form_score":   0,
            "corrections":  ["Cannot see your legs clearly — step back so your full body is in frame"],
            "angles":       angles,
            "view":         view,
        }

    knee_angle = sum(knee_candidates) / len(knee_candidates)

    # ── Thresholds (all sourced above) ─────────────────────────────────────
    AIRBORNE_HIP_ELEVATION    = 0.15   # Devita & Skelly + your real footage
    STIFF_LANDING_KNEE        = 130    # Interior angle: > 130 = < 50° flex = stiff
    LOADING_DEPTH_MIN         = 140    # Must reach < 140° interior (> 40° flex)
    LEAN_FAULT_ABSOLUTE_SIDE  = 50     # Side view: >50° absolute + shin comparison
    LEAN_FAULT_SHIN_DELTA     = 15     # Side view: trunk > shin + 15° = lean fault
    LEAN_FAULT_ABSOLUTE_FRONT = 55     # Front view only: higher bar (foreshortening)

    component_scores = {}
    severe_faults    = []
    corrections      = []

    hip_elevation = geometry.get("hip_elevation")
    currently_airborne = (
        hip_elevation is not None and hip_elevation > AIRBORNE_HIP_ELEVATION
    )

    # ── Loading depth (checked while in squat/loading position) ────────────
    # Only score depth when the person is actually loading (not standing idle
    # or airborne). "Loading" means knee angle is below standing but we
    # haven't left the ground yet.
    is_loading = knee_angle < 160 and not currently_airborne
    if is_loading:
        if knee_angle >= LOADING_DEPTH_MIN:
            # Not squatting deep enough to generate jump power
            component_scores["depth"] = 40
            corrections.append("Squat lower before jumping — reach at least a quarter squat")
        else:
            # Adequate loading depth — score on a linear scale from
            # LOADING_DEPTH_MIN down to ~90° (very deep, still OK for jump squat)
            depth_score = min(100, round(100 - max(0, (knee_angle - 90) / (LOADING_DEPTH_MIN - 90)) * 60))
            component_scores["depth"] = depth_score

    # ── Landing knee flexion (checked at/just after landing) ───────────────
    # We detect "just landed" as: hip_elevation dropping from positive back
    # toward zero, AND knee_angle is still relatively extended. Only flag if
    # elevation data is available (requires standing calibration to have run).
    just_landed = (
        hip_elevation is not None
        and 0 < hip_elevation < AIRBORNE_HIP_ELEVATION * 2   # elevation still positive but falling
        and knee_angle > STIFF_LANDING_KNEE
    )
    if just_landed:
        component_scores["landing"] = 30
        corrections.append("Bend your knees as you land — absorb the impact with soft knees")
        severe_faults.append("stiff_landing")
    elif hip_elevation is not None and 0 < hip_elevation < AIRBORNE_HIP_ELEVATION * 2:
        # Landed with good knee flexion
        component_scores["landing"] = 100

    # ── Trunk lean (loading phase only) ────────────────────────────────────
    if is_loading:
        trunk = geometry.get("trunk_incline_deg")
        shin  = geometry.get("shin_incline_deg")

        if trunk is not None:
            lean_fault = False
            if view == "side" and shin is not None:
                # Relative check: trunk should not lean much more than the shin
                lean_fault = trunk > LEAN_FAULT_ABSOLUTE_SIDE and (trunk - shin) > LEAN_FAULT_SHIN_DELTA
            elif trunk > LEAN_FAULT_ABSOLUTE_FRONT:
                lean_fault = True

            if lean_fault:
                component_scores["trunk_lean"] = 40
                corrections.append("Keep your chest up — you're leaning too far forward")
                if view == "side" and trunk > LEAN_FAULT_ABSOLUTE_SIDE + 10:
                    severe_faults.append("trunk_lean")
            else:
                component_scores["trunk_lean"] = 100

    # ── Knee valgus (front view only — same check as regular squat) ─────────
    if view == "front" and is_loading:
        valgus_deltas = [geometry.get("valgus_delta_l"), geometry.get("valgus_delta_r")]
        valgus_deltas = [v for v in valgus_deltas if v is not None]
        if valgus_deltas:
            worst = min(valgus_deltas)
            if worst < -0.15:   # same thresholds as squat (validated)
                valgus_score = max(0, round(100 + worst * 200))
                component_scores["valgus"] = valgus_score
                corrections.append("Push your knees out — don't let them cave inward")
                if worst < -0.25:
                    severe_faults.append("valgus")
            else:
                component_scores["valgus"] = 100

    if not component_scores:
        # Standing between reps, airborne, or landing with no elevation data —
        # neutral, not a penalty.
        form_score = 80
    else:
        form_score = round(sum(component_scores.values()) / len(component_scores))

    form_correct = form_score >= 70 and len(severe_faults) == 0

    seen = set()
    deduped = []
    for c in corrections:
        if c not in seen:
            deduped.append(c)
            seen.add(c)

    return {
        "form_correct": form_correct,
        "form_score":   int(form_score),
        "corrections":  deduped[:2],
        "angles":       angles,
        "view":         view,
        "geometry":     geometry,
    }


def _analyze_chair_squat(keypoints, standing_ref=None):
    """
    View-aware chair squat (sit-to-stand) form analysis. Same output shape as
    analyze_form(), plus 'view' and 'geometry'.

    A chair squat is a sit-to-stand: lower under control until the glutes
    lightly touch a chair seat, then stand. It differs from a regular squat in
    that it has a DEFINED TARGET DEPTH (the seat) rather than "deeper is
    better". Three faults are checked, each grounded in the research and
    validated against real demo footage (two clips, bottoming at ~62 and
    ~71-90 deg knee angle, both correct chair squats):

    ── 1. DEPTH — reaching the chair (primary check) ───────────────────────
    Source: standardized clinical chair-squat protocol uses a 45 cm seat where
    the knee reaches ~90 deg flexion at the seated bottom (Chair squat
    performance study, PMC9936124). We give full credit for reaching ~95 deg
    or below (chair height, with landmark-noise tolerance), partial credit
    between there and ~120 deg, and flag clearly-insufficient depth above
    ~120 deg. Chair squats are explicitly a progression exercise, so a partial
    rep gets partial credit rather than a discouraging hard fail. We do NOT
    reward going deeper than chair height -- unlike a regular squat, there is a
    target, not an open-ended "lower is better".

    ── 2. KNEE VALGUS (front view only) ────────────────────────────────────
    Same biomechanics and same validated thresholds as the regular squat:
    inward knee drift measured as a delta from THIS person's own standing
    baseline (so a naturally wide/narrow stance isn't misread). Only
    meaningful from the front; side view can't see medial/lateral knee
    position.

    ── 3. EXCESSIVE FORWARD LEAN (deliberately conservative) ───────────────
    Source: sit-to-stand requires meaningful forward lean to move the center
    of mass forward and rise -- normal subjects reach ~49 deg trunk flexion
    from horizontal during the momentum phase (Sibella et al. 2003). Our own
    two demo clips showed 30-40 deg of forward lean as the NORMAL descent
    position. So an absolute lean fault (e.g. at 40 deg) would wrongly flag
    every correct rep. We therefore only flag clearly-excessive lean: trunk
    incline > 50 deg from vertical AND trunk leaning more than 20 deg beyond
    the shin (the relative check, same principle as jump squat). This isolates
    a genuine torso collapse from the inherent forward lean the movement
    requires. From the front view (where trunk-shin comparison foreshortens),
    we do not flag lean at all, to avoid false positives.

    Heels-lifting and momentum/"plopping" faults are documented for chair
    squats but are NOT checked here -- 2D pose estimation can't measure them
    reliably, and an unreliable check is worse than an omitted one.
    """
    angles   = get_joint_angles(keypoints)
    geometry = get_squat_geometry(keypoints, standing_ref=standing_ref)
    view     = geometry.get("view", "unknown")

    knee_candidates = [a for a in [angles.get("left_knee"), angles.get("right_knee")] if a is not None]

    if not knee_candidates:
        return {
            "form_correct": False,
            "form_score":   0,
            "corrections":  ["Cannot see your legs clearly — step back so your full body is in frame"],
            "angles":       angles,
            "view":         view,
        }

    knee_angle = sum(knee_candidates) / len(knee_candidates)

    component_scores = {}
    severe_faults    = []
    corrections      = []

    # ── Depth: reaching the chair (adaptive to this session's chair height) ──
    # Pull the session-specific target if _ChairDepthCalibration has fired;
    # otherwise the scorer uses CHAIR_FALLBACK_TARGET so early reps and
    # out-of-WS uses still work sensibly.
    session_target = standing_ref.get("chair_depth_target") if standing_ref else None
    depth_score = _score_chair_depth(knee_angle, session_target=session_target)
    if depth_score is not None:
        component_scores["depth"] = depth_score
        shallow_at = (session_target or CHAIR_FALLBACK_TARGET) + CHAIR_SHALLOW_MARGIN
        if knee_angle >= shallow_at:
            if session_target is not None:
                corrections.append(
                    "You're not reaching your usual depth — sit back further"
                )
            else:
                corrections.append(
                    "Lower down further — sit back until you nearly touch the chair"
                )

    # ── Trunk lean: conservative, relative-to-shin, side view only ──────────
    trunk = geometry.get("trunk_incline_deg")
    shin  = geometry.get("shin_incline_deg")
    if trunk is not None and view == "side" and shin is not None:
        # Only score lean when actually descending (knee bent past standing);
        # a fully upright standing frame shouldn't contribute a lean score.
        if knee_angle < CHAIR_STANDING_KNEE_MIN:
            if trunk > CHAIR_TRUNK_LEAN_ABSOLUTE and (trunk - shin) > CHAIR_TRUNK_SHIN_DELTA:
                component_scores["trunk_lean"] = 40
                corrections.append("Keep your chest up — you're leaning too far forward")
                if trunk > CHAIR_TRUNK_LEAN_ABSOLUTE + 10:
                    severe_faults.append("trunk_lean")
            else:
                component_scores["trunk_lean"] = 100

    # ── Knee valgus (front view only — identical thresholds to squat) ───────
    if view == "front" and knee_angle < CHAIR_STANDING_KNEE_MIN:
        valgus_deltas = [geometry.get("valgus_delta_l"), geometry.get("valgus_delta_r")]
        valgus_deltas = [v for v in valgus_deltas if v is not None]
        if valgus_deltas:
            worst = min(valgus_deltas)  # most negative = most inward drift
            valgus_score = _score_valgus(worst)
            component_scores["valgus"] = valgus_score
            if worst < -SQUAT_VALGUS_DELTA_FLAG:
                corrections.append("Push your knees out — don't let them cave inward")
                if worst < -SQUAT_VALGUS_DELTA_SEVERE:
                    severe_faults.append("valgus")

    if not component_scores:
        # Standing between reps, or missing landmarks for everything but the
        # knee — neutral, not a penalty (same convention as squat/jump squat).
        form_score = 80
    else:
        form_score = round(sum(component_scores.values()) / len(component_scores))

    form_correct = form_score >= 70 and len(severe_faults) == 0

    seen = set()
    deduped = []
    for c in corrections:
        if c not in seen:
            deduped.append(c)
            seen.add(c)

    return {
        "form_correct": form_correct,
        "form_score":   int(form_score),
        "corrections":  deduped[:2],
        "angles":       angles,
        "view":         view,
        "geometry":     geometry,
    }


def _analyze_generic(keypoints, exercise_key):
    angles = get_joint_angles(keypoints)

    if not angles:
        return {
            "form_correct": False,
            "form_score":   0,
            "corrections":  ["Cannot detect full body — step back"],
            "angles":       {},
        }

    rules = FORM_RULES.get(exercise_key, FORM_RULES["default"])

    if not rules:
        return {
            "form_correct": True,
            "form_score":   80,
            "corrections":  [],
            "angles":       angles,
        }

    violations = []
    rules_met  = 0

    for rule in rules:
        joint, min_a, max_a, message = rule
        angle = angles.get(joint)

        if angle is None:
            continue

        violation = False
        if min_a is not None and angle < min_a:
            violation = True
        if max_a is not None and angle > max_a:
            violation = True

        if violation:
            violations.append(message)
        else:
            rules_met += 1

    total_rules  = max(len(rules), 1)
    form_score   = int((rules_met / total_rules) * 100)
    form_correct = form_score >= 70 and len(violations) == 0

    seen        = set()
    corrections = []
    for v in violations:
        if v not in seen:
            corrections.append(v)
            seen.add(v)

    return {
        "form_correct": form_correct,
        "form_score":   form_score,
        "corrections":  corrections[:2],
        "angles":       angles,
    }


def analyze_form(keypoints, exercise_name="default", standing_ref=None) -> dict:
    """
    Analyze form for a single frame. This is the single source of truth for
    both form_score and form_correct — callers must not derive a verdict
    from any other signal (e.g. a separate ML classifier), or the two could
    disagree.

    Returns:
        form_correct: bool
        form_score:   0-100
        corrections:  list of correction strings (max 2)
        angles:       dict of joint angles
        view:         'front' | 'side' | 'unknown' (squat only, for now)
    """
    if keypoints is None or len(keypoints) == 0:
        return {
            "form_correct": False,
            "form_score":   0,
            "corrections":  ["Cannot detect full body — step back"],
            "angles":       {},
        }

    exercise_key = exercise_name.lower().replace(" ", "_").replace("-", "_")
    if exercise_key not in ("squat", "jump_squat", "chair_squat") and exercise_key.endswith("s"):
        singular = exercise_key[:-1]
        if singular in ("squat", "jump_squat", "chair_squat") or singular in FORM_RULES:
            exercise_key = singular

    if exercise_key == "squat":
        return _analyze_squat(keypoints, standing_ref=standing_ref)

    if exercise_key == "jump_squat":
        return _analyze_jump_squat(keypoints, standing_ref=standing_ref)

    if exercise_key == "chair_squat":
        return _analyze_chair_squat(keypoints, standing_ref=standing_ref)

    return _analyze_generic(keypoints, exercise_key)
