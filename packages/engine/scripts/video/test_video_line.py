"""The Python half's own checks. GitHub has no mediapipe, so these run on the laptop:
    python packages/engine/scripts/video/test_video_line.py
Videos are made here from nothing; no real video is needed."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import video_line as vl  # noqa: E402

MODEL = r"D:\vidoe referene\tools\pose_landmarker_heavy.task"


def make_video(path, fps=30, seconds=2, size=(320, 180), extra=()):
    raw = path + ".raw.mp4"
    w = cv2.VideoWriter(raw, cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    for i in range(int(fps * seconds)):
        w.write(np.full((size[1], size[0], 3), i % 255, np.uint8))
    w.release()
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, *extra, path], check=True)
    os.remove(raw)


class Point:
    def __init__(self, x=0.5, vis=0.9):
        self.x, self.y, self.z, self.visibility = x, 0.5, 0.1, vis


class Sampling(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = os.path.join(self.dir.name, "v.mp4")

    def times(self, fps):
        cap = cv2.VideoCapture(self.path)
        out = [t for t, _ in vl.sampled_frames(cap, fps)]
        cap.release()
        return out

    def test_thirty_a_second_is_cut_to_fifteen(self):
        make_video(self.path)
        t = self.times(15)
        self.assertEqual(t[0], 0)
        self.assertAlmostEqual((len(t) - 1) / (t[-1] / 1000), 15, delta=0.5)

    def test_a_slow_video_keeps_every_frame(self):
        make_video(self.path, fps=10)
        self.assertEqual(len(self.times(15)), 20)

    def test_uneven_timing_keeps_the_videos_own_clock(self):
        # The second half plays at half speed: the clock must say so.
        make_video(self.path, extra=["-vf", "setpts='if(lt(N,30),PTS,PTS*2-30/30/TB)'", "-vsync", "vfr"])
        t = self.times(1000)
        self.assertGreater(t[-1], 2500)

    def test_sampling_gives_the_same_times_twice(self):
        make_video(self.path, fps=24)
        self.assertEqual(self.times(15), self.times(15))

    def test_a_video_stored_sideways_has_the_shape_a_person_sees(self):
        make_video(self.path, extra=["-c", "copy", "-metadata:s:v", "rotate=90"])
        cap = cv2.VideoCapture(self.path)
        _, img = cap.read()
        self.assertAlmostEqual(vl.picture_shape(cap, img), 180 / 320, places=3)
        cap.release()

    def test_stretched_pixels_are_refused(self):
        make_video(self.path, extra=["-vf", "setsar=2/1"])
        cap = cv2.VideoCapture(self.path)
        _, img = cap.read()
        with self.assertRaises(SystemExit):
            vl.picture_shape(cap, img)
        cap.release()


class Lines(unittest.TestCase):
    def test_nobody_found_stays_as_an_empty_frame(self):
        self.assertEqual(vl.frame_line(66.7, None, None), {"t": 66.7, "kp": []})

    def test_a_broken_point_decides_nothing(self):
        self.assertEqual(vl.frame_line(1, [Point(float("nan"))] * 33, None), {"t": 1, "kp": []})

    def test_a_missing_visibility_reads_as_the_app_reads_it(self):
        self.assertEqual(vl.frame_line(1, [Point(vis=None)] * 33, None)["kp"][0][3], 1.0)

    def test_world_points_sit_beside_the_picture_points(self):
        line = vl.frame_line(1, [Point()] * 33, [Point()] * 33)
        self.assertEqual(len(line["wkp"]), 33)
        self.assertEqual(len(line["wkp"][0]), 3)


class Pictures(unittest.TestCase):
    """The draw step, on a plain picture and on a video, with a small report."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.out = self.tmp.name
        kp = [[0.5, 0.5, 0.0, 0.9]] * 33
        self.frames = [{"t": 0.0, "kp": kp}, {"t": 66.7, "kp": []}]
        self.report = {
            "label": "x", "aspect": 0.5, "times": [0.0, 66.7],
            "signals": {"knee_L": [97.5, None]}, "ranges": {"knee_L": {"min": 97.5, "max": 97.5}},
            "rules": {"exercise": "squat", "metric": "knee_L", "upAt": 160, "downAt": 130, "otherKneeUnder": 150,
                      "reps": [{"endFrame": 1}], "summary": {"reps": 1},
                      "decisions": [{"repCount": 0, "phase": "descent", "view": "side", "metric": 101.2},
                                    {"repCount": 1, "phase": "top", "view": "side"}]},
            "moments": [{"frame": 0, "t": 0.0, "why": "bottom of rep 1"},
                        {"frame": 1, "t": 66.7, "why": "nobody seen from here"}],
        }
        self.write("report.json", json.dumps(self.report))
        self.write("t.jsonl", "{}\n" + "".join(json.dumps(f) + "\n" for f in self.frames))

    def write(self, name, text):
        with open(os.path.join(self.out, name), "w", encoding="utf-8") as f:
            f.write(text)

    def draw(self, video=None):
        args = [sys.executable, vl.__file__, "draw", "--report", os.path.join(self.out, "report.json"),
                "--trace", os.path.join(self.out, "t.jsonl"), "--out", self.out]
        if video:
            args += ["--video", video, "--fps", "15"]
        return subprocess.run(args, capture_output=True, text=True)

    def test_someone_elses_numbered_photo_survives(self):
        self.write(vl.MARKER, json.dumps({"source": "s", "pictures": ["01_old.jpg"]}))
        self.write("01_old.jpg", "ours")
        self.write("19_mum_birthday.jpg", "theirs")
        r = self.draw()
        self.assertEqual(r.returncode, 0, r.stderr)
        files = os.listdir(self.out)
        self.assertNotIn("01_old.jpg", files)
        self.assertIn("19_mum_birthday.jpg", files)
        self.assertIn("01_bottom_of_rep_1.jpg", files)
        self.assertIn("02_nobody_seen_from_here.jpg", files)
        self.assertIn("all.jpg", files)
        self.assertIn("chart.png", files)
        with open(os.path.join(self.out, vl.MARKER), encoding="utf-8") as f:
            self.assertEqual(len(json.load(f)["pictures"]), 2)

    def test_a_folder_the_tool_did_not_make_is_refused(self):
        self.write("19_mum_birthday.jpg", "theirs")
        self.assertNotEqual(self.draw().returncode, 0)
        self.assertNotIn("all.jpg", os.listdir(self.out))

    def test_the_wrong_video_changes_nothing(self):
        self.write(vl.MARKER, json.dumps({"source": "s", "pictures": ["01_old.jpg"]}))
        self.write("01_old.jpg", "ours")
        video = os.path.join(self.out, "v.mp4")
        make_video(video, seconds=0.04)
        r = self.draw(video)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("same video", r.stderr)
        self.assertIn("01_old.jpg", os.listdir(self.out))

    def test_a_picture_says_the_engines_numbers(self):
        text = "\n".join(vl.moment_lines(self.report, self.report["moments"][0]))
        for part in ("bottom of rep 1", "count 0", "phase descent", "steadied 101.2", "down<130", "up>160",
                     "other knee under 150", "knee_L 97.5"):
            self.assertIn(part, text)

    def test_nobody_in_view_still_draws(self):
        img = np.zeros((100, 100, 3), np.uint8)
        lines = vl.moment_lines(self.report, self.report["moments"][1])
        self.assertIn("count 1", "\n".join(lines))
        self.assertIsNotNone(vl.draw_moment(img, [], lines))


@unittest.skipUnless(os.path.exists(MODEL), "the pose model is not on this laptop")
class WholeRun(unittest.TestCase):
    def test_a_video_of_nobody_gives_empty_frames_and_no_path(self):
        with tempfile.TemporaryDirectory() as d:
            video, out = os.path.join(d, "secret-name.mp4"), os.path.join(d, "t.jsonl")
            make_video(video)
            subprocess.run([sys.executable, vl.__file__, "trace", "--video", video, "--out", out,
                            "--exercise", "squat", "--label", "empty", "--fps", "15", "--reps", "-1",
                            "--view", "unknown", "--model", MODEL, "--engine", "1.1.0", "--defs", "7"],
                           check=True, capture_output=True)
            with open(out, encoding="utf-8") as f:
                text = f.read()
            self.assertNotIn("secret-name", text)
            self.assertNotIn(d.replace("\\", "/"), text.replace("\\\\", "/"))
            lines = [json.loads(x) for x in text.splitlines()]
            self.assertEqual(lines[0]["provider"]["model"], "pose_landmarker_heavy")
            self.assertAlmostEqual(lines[0]["aspect"], 320 / 180, places=3)
            self.assertTrue(all(f["kp"] == [] for f in lines[1:]))


if __name__ == "__main__":
    unittest.main()
