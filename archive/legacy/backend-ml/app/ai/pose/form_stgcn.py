"""
ST-GCN squat form classifier — STUBBED FOR PHASE 2.

In Phase 2, form classification runs in the browser via ONNX.
The browser sends form_label and form_confidence over the WebSocket,
so this server-side classifier is no longer called.

The class and its interface are preserved so that:
  1. pose_ws.py imports do not break.
  2. Reverting to Phase 1 only requires restoring this file's contents.

FormSTGCN.update() always returns ready=False, which causes pose_ws.py
to fall back to the form_label sent from the browser (or rule-based
analyze_form if the browser sends nothing).
"""


class FormSTGCN:
    """
    No-op stub. One instance is still created per WebSocket session
    so pose_ws.py needs no structural changes.
    """

    def __init__(self, model_paths: list):
        # model_paths intentionally ignored — no models loaded in Phase 2
        if model_paths:
            print(
                "  ℹ️  FormSTGCN: Phase 2 stub active — "
                "form classification runs in the browser. "
                f"Ignoring {len(model_paths)} model path(s)."
            )

    def update(self, keypoints) -> dict:
        """
        Always returns ready=False so pose_ws.py uses the browser's
        form_label instead of this server-side result.
        """
        return {"form_label": None, "good_prob": None, "ready": False}