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
