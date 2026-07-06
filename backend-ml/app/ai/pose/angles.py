import numpy as np


# MediaPipe BlazePose keypoint indices (33 keypoints)
# Replaces the old COCO-17 YOLOv8 index mapping.
KP = {
    # Face
    "nose":              0,
    "left_eye_inner":    1,
    "left_eye":          2,
    "left_eye_outer":    3,
    "right_eye_inner":   4,
    "right_eye":         5,
    "right_eye_outer":   6,
    "left_ear":          7,
    "right_ear":         8,
    "mouth_left":        9,
    "mouth_right":       10,
    # Arms
    "left_shoulder":     11,
    "right_shoulder":    12,
    "left_elbow":        13,
    "right_elbow":       14,
    "left_wrist":        15,
    "right_wrist":       16,
    "left_pinky":        17,
    "right_pinky":       18,
    "left_index":        19,
    "right_index":       20,
    "left_thumb":        21,
    "right_thumb":       22,
    # Legs — these were COCO 11-16; now at 23-28
    "left_hip":          23,
    "right_hip":         24,
    "left_knee":         25,
    "right_knee":        26,
    "left_ankle":        27,
    "right_ankle":       28,
    "left_heel":         29,
    "right_heel":        30,
    "left_foot":         31,
    "right_foot":        32,
}


def calculate_angle(a, b, c):
    """
    Calculate the angle at point B formed by points A-B-C.
    Returns angle in degrees (0-180).
    a, b, c: each is [x, y, ...] — only x and y are used.
    """
    a = np.array(a[:2], dtype=float)
    b = np.array(b[:2], dtype=float)
    c = np.array(c[:2], dtype=float)

    ba = a - b
    bc = c - b

    cosine = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-8)
    cosine = np.clip(cosine, -1.0, 1.0)
    angle  = np.degrees(np.arccos(cosine))
    return round(float(angle), 1)


def is_visible(kp, threshold=0.3):
    """
    Check if a keypoint is visible (confidence above threshold).

    MediaPipe keypoints are [x, y, z, visibility] — confidence is at index 3.
    Accepts both 3-element (legacy) and 4-element keypoints for safety.
    """
    if len(kp) >= 4:
        return float(kp[3]) >= threshold
    if len(kp) >= 3:
        return float(kp[2]) >= threshold
    return True  # No confidence score — assume visible


def get_joint_angles(keypoints):
    """
    Given a list of 33 MediaPipe keypoints [[x, y, z, visibility], ...],
    return a dict of named joint angles relevant to exercise form.
    Only includes angles where all 3 keypoints are visible.
    """
    if keypoints is None or len(keypoints) < 29:
        # Need at least through right_ankle (index 28)
        return {}

    kps    = keypoints
    angles = {}

    # ── Left arm ──────────────────────────────────────────────────────────────
    ls = kps[KP["left_shoulder"]]
    le = kps[KP["left_elbow"]]
    lw = kps[KP["left_wrist"]]
    if all(is_visible(k) for k in [ls, le, lw]):
        angles["left_elbow"] = calculate_angle(ls, le, lw)

    # ── Right arm ─────────────────────────────────────────────────────────────
    rs = kps[KP["right_shoulder"]]
    re = kps[KP["right_elbow"]]
    rw = kps[KP["right_wrist"]]
    if all(is_visible(k) for k in [rs, re, rw]):
        angles["right_elbow"] = calculate_angle(rs, re, rw)

    # ── Left leg ──────────────────────────────────────────────────────────────
    lh = kps[KP["left_hip"]]
    lk = kps[KP["left_knee"]]
    la = kps[KP["left_ankle"]]
    if all(is_visible(k) for k in [lh, lk, la]):
        angles["left_knee"] = calculate_angle(lh, lk, la)

    # ── Right leg ─────────────────────────────────────────────────────────────
    rh = kps[KP["right_hip"]]
    rk = kps[KP["right_knee"]]
    ra = kps[KP["right_ankle"]]
    if all(is_visible(k) for k in [rh, rk, ra]):
        angles["right_knee"] = calculate_angle(rh, rk, ra)

    # ── Hip angle (back straightness) ─────────────────────────────────────────
    if all(is_visible(k) for k in [ls, lh, lk]):
        angles["left_hip"] = calculate_angle(ls, lh, lk)
    if all(is_visible(k) for k in [rs, rh, rk]):
        angles["right_hip"] = calculate_angle(rs, rh, rk)

    # ── Shoulder angle ────────────────────────────────────────────────────────
    if all(is_visible(k) for k in [le, ls, lh]):
        angles["left_shoulder"] = calculate_angle(le, ls, lh)
    if all(is_visible(k) for k in [re, rs, rh]):
        angles["right_shoulder"] = calculate_angle(re, rs, rh)

    # ── Trunk angle (spine alignment) ─────────────────────────────────────────
    nose = kps[KP["nose"]]
    if all(is_visible(k) for k in [nose, lh, la]):
        angles["trunk_left"] = calculate_angle(nose, lh, la)

    return angles


# ─────────────────────────────────────────────────────────────────────────────
# Squat-specific geometry
#
# Everything below is additive to the generic joint-angle vocabulary above.
# It exists because correct squat-form checking needs more than the interior
# knee/hip angles: it needs to know which way the camera is pointed, how far
# the torso is leaning, and whether the knees are tracking over the ankles.
# Definitions and conventions here mirror the extraction notebook used to
# validate thresholds against real squat footage (see form_analyzer.py for
# the sourcing notes on each threshold).
# ─────────────────────────────────────────────────────────────────────────────

def _xy(kp):
    return np.array(kp[:2], dtype=float)


def incline_from_vertical(p_top, p_bottom):
    """
    Angle between the vector p_top->p_bottom and the vertical (down) axis.
    0 deg = perfectly vertical (upright). 90 deg = horizontal.
    Image y-axis points down, so "vertical" is (0, 1).
    """
    p_top    = _xy(p_top)
    p_bottom = _xy(p_bottom)
    v        = p_bottom - p_top
    vertical = np.array([0.0, 1.0])
    denom    = (np.linalg.norm(v) * np.linalg.norm(vertical)) + 1e-8
    cosang   = np.clip(np.dot(v, vertical) / denom, -1.0, 1.0)
    return round(float(np.degrees(np.arccos(cosang))), 1)


def detect_view(keypoints):
    """
    Classify the camera angle as 'front', 'side', or 'unknown' from a single
    frame's keypoints.

    Signal: shoulder width and hip width, normalized by torso height (so it's
    distance-from-camera invariant). A front-on torso presents a wide
    shoulder/hip span; a side-on torso collapses that span toward zero because
    the left/right landmarks project almost on top of each other.

    Thresholds were checked against labeled front/side reference clips:
    front-view shoulder_width_norm ~0.33-0.47, hip_width_norm ~0.22-0.28;
    side-view shoulder_width_norm ~0.00-0.07, hip_width_norm ~0.02-0.10.
    The two clusters don't overlap, so the midpoint thresholds below have
    margin on both sides rather than being a tight guess.
    """
    if keypoints is None or len(keypoints) < 29:
        return "unknown"

    kps = keypoints
    ls, rs = kps[KP["left_shoulder"]], kps[KP["right_shoulder"]]
    lh, rh = kps[KP["left_hip"]], kps[KP["right_hip"]]
    la     = kps[KP["left_ankle"]]

    if not all(is_visible(k) for k in [ls, rs, lh, rh, la]):
        return "unknown"

    # Torso-height reference (shoulder to ankle), used to normalize widths so
    # the classifier doesn't depend on how far the person stands from camera.
    torso_height = abs(_xy(la)[1] - _xy(ls)[1])
    if torso_height < 1e-4:
        return "unknown"

    shoulder_width = abs(_xy(rs)[0] - _xy(ls)[0]) / torso_height
    hip_width      = abs(_xy(rh)[0] - _xy(lh)[0]) / torso_height

    # Side view: both widths collapse close to zero.
    if shoulder_width < 0.15 and hip_width < 0.15:
        return "side"
    # Front view (or any angle facing the camera enough to show torso width).
    if shoulder_width > 0.20 or hip_width > 0.15:
        return "front"

    return "unknown"


def get_squat_geometry(keypoints, standing_ref=None):
    """
    Compute squat-specific measurements beyond the generic joint angles.

    standing_ref: optional dict with baseline valgus values captured while
    the person was standing upright at the start of the set. Used to make
    the valgus signal relative to THIS person's own stance rather than an
    absolute cutoff (a naturally wider or narrower stance shouldn't be
    misread as valgus). If not provided, only the raw (non-relative) valgus
    values are returned.

    Returns a dict that may include:
        view              : 'front' | 'side' | 'unknown'
        trunk_incline_deg : forward lean of the torso from vertical (0=upright)
        shin_incline_deg  : forward lean of the shin from vertical (side view)
        valgus_l, valgus_r: knee-x minus ankle-x, normalized by hip width.
                             Sign is in image space (not "left/right body"
                             space) so a same-direction shift on both legs
                             toward the midline is the valgus signature.
        valgus_delta_l/r  : valgus_l/r minus this person's own standing
                             baseline, when standing_ref is available. This
                             is the value form_analyzer should actually use,
                             since it isolates the CHANGE during the squat
                             from a fixed stance-width offset.
    """
    geometry = {"view": detect_view(keypoints)}

    if keypoints is None or len(keypoints) < 29:
        return geometry

    kps = keypoints
    ls, rs = kps[KP["left_shoulder"]], kps[KP["right_shoulder"]]
    lh, rh = kps[KP["left_hip"]], kps[KP["right_hip"]]
    lk, rk = kps[KP["left_knee"]], kps[KP["right_knee"]]
    la, ra = kps[KP["left_ankle"]], kps[KP["right_ankle"]]

    # Trunk incline: shoulder -> hip vector vs vertical. Uses the side with
    # both points visible; prefers left, falls back to right.
    if all(is_visible(k) for k in [ls, lh]):
        geometry["trunk_incline_deg"] = incline_from_vertical(_xy(ls), _xy(lh))
    elif all(is_visible(k) for k in [rs, rh]):
        geometry["trunk_incline_deg"] = incline_from_vertical(_xy(rs), _xy(rh))

    # Shin incline: knee -> ankle vector vs vertical. Most meaningful from
    # the side (front view foreshortens this badly), but harmless to compute
    # either way since form_analyzer decides which checks to apply per view.
    if all(is_visible(k) for k in [lk, la]):
        geometry["shin_incline_deg"] = incline_from_vertical(_xy(lk), _xy(la))
    elif all(is_visible(k) for k in [rk, ra]):
        geometry["shin_incline_deg"] = incline_from_vertical(_xy(rk), _xy(ra))

    # Knee valgus signal (front view only — side view can't see medial/
    # lateral knee position). Defined exactly as in the validated extraction
    # notebook: (knee_x - ankle_x) / hip_width, per leg.
    if all(is_visible(k) for k in [lh, rh]):
        hip_width = abs(_xy(rh)[0] - _xy(lh)[0]) + 1e-6

        if all(is_visible(k) for k in [lk, la]):
            geometry["valgus_l"] = round((_xy(lk)[0] - _xy(la)[0]) / hip_width, 4)
        if all(is_visible(k) for k in [rk, ra]):
            geometry["valgus_r"] = round((_xy(rk)[0] - _xy(ra)[0]) / hip_width, 4)

        if standing_ref:
            if "valgus_l" in geometry and "valgus_l_baseline" in standing_ref:
                geometry["valgus_delta_l"] = round(
                    geometry["valgus_l"] - standing_ref["valgus_l_baseline"], 4
                )
            if "valgus_r" in geometry and "valgus_r_baseline" in standing_ref:
                geometry["valgus_delta_r"] = round(
                    geometry["valgus_r"] - standing_ref["valgus_r_baseline"], 4
                )

            # Elevation above the calibrated standing baseline, normalized by
            # the person's torso height if available. Positive = risen above
            # standing (airborne candidate). Used only by jump squat analysis.
            # hip_y_baseline / ankle_y_baseline and torso_height are set by
            # _StandingCalibration when it runs for the first time this session.
            torso_h = standing_ref.get("torso_height")
            if torso_h and torso_h > 0:
                hip_y_base = standing_ref.get("hip_y_baseline")
                if hip_y_base is not None and all(is_visible(k) for k in [lh, rh]):
                    curr_hip_y = (_xy(lh)[1] + _xy(rh)[1]) / 2
                    geometry["hip_elevation"] = round(
                        (hip_y_base - curr_hip_y) / torso_h, 4
                    )
                ankle_y_base = standing_ref.get("ankle_y_baseline")
                if ankle_y_base is not None and all(is_visible(k) for k in [la, ra]):
                    curr_ankle_y = (_xy(la)[1] + _xy(ra)[1]) / 2
                    geometry["ankle_elevation"] = round(
                        (ankle_y_base - curr_ankle_y) / torso_h, 4
                    )

    return geometry