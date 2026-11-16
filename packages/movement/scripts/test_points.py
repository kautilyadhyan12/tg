"""The Python half's own checks. GitHub has no mediapipe, so these run on the laptop:
    python packages/movement/scripts/test_points.py
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
import points as pt  # noqa: E402

MODEL = r"D:\vidoe referene\tools\pose_landmarker_heavy.task"


def make_video(path, fps=30, seconds=2, size=(320, 180), extra=()):
    raw = path + ".raw.mp4"
    w = cv2.VideoWriter(raw, cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    for i in range(int(fps * seconds)):
        w.write(np.full((size[1], size[0], 3), i % 255, np.uint8))
    w.release()
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, *extra, path], check=True)
    os.remove(raw)


class Landmark:
    def __init__(self, x=0.5, visibility=0.9, presence=0.95):
        self.x, self.y, self.z, self.visibility, self.presence = x, 0.5, 0.1, visibility, presence


class Sampling(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = os.path.join(self.dir.name, "v.mp4")

    def times(self, fps):
        cap = cv2.VideoCapture(self.path)
        out = [t for t, _ in pt.sampled_frames(cap, fps)]
        cap.release()
        return out

    def gaps(self, times):
        return [round(b - a, 1) for a, b in zip(times, times[1:])]

    def test_every_frame_of_a_thirty_a_second_video_is_kept_at_thirty(self):
        make_video(self.path)
        self.assertEqual(len(self.times(30)), 60)

    def test_sixty_a_second_is_halved_with_even_gaps(self):
        make_video(self.path, fps=60)
        t = self.times(30)
        self.assertEqual(len(t), 60)
        self.assertTrue(all(abs(g - 33.3) <= 0.15 for g in self.gaps(t)), self.gaps(t))

    def test_thirty_to_fifteen_keeps_every_other_frame(self):
        make_video(self.path)
        t = self.times(15)
        self.assertEqual(len(t), 30)
        self.assertTrue(all(abs(g - 66.7) <= 0.15 for g in self.gaps(t)), self.gaps(t))

    def test_a_slow_video_keeps_every_frame(self):
        make_video(self.path, fps=10)
        self.assertEqual(len(self.times(30)), 20)

    def test_uneven_timing_keeps_the_videos_own_clock(self):
        # The second half plays at half speed: the clock must say so.
        make_video(self.path, extra=["-vf", "setpts='if(lt(N,30),PTS,PTS*2-30/30/TB)'", "-vsync", "vfr"])
        self.assertGreater(self.times(30)[-1], 2500)

    def test_sampling_gives_the_same_frames_twice(self):
        make_video(self.path, fps=24)
        self.assertEqual(self.times(30), self.times(30))

    def test_a_video_stored_sideways_has_the_shape_a_person_sees(self):
        make_video(self.path, extra=["-c", "copy", "-metadata:s:v", "rotate=90"])
        cap = cv2.VideoCapture(self.path)
        _, img = cap.read()
        self.assertEqual(pt.picture_shape(cap, img), (180, 320))
        cap.release()

    def test_stretched_pixels_are_refused(self):
        make_video(self.path, extra=["-vf", "setsar=2/1"])
        cap = cv2.VideoCapture(self.path)
        _, img = cap.read()
        with self.assertRaises(SystemExit):
            pt.picture_shape(cap, img)
        cap.release()


class People(unittest.TestCase):
    def test_a_person_keeps_both_kinds_of_sureness_and_the_3d_points(self):
        p = pt.person_entry([Landmark()] * 33, [Landmark()] * 33)
        self.assertEqual(p["points"][0], [0.5, 0.5, 0.1, 0.9, 0.95])
        self.assertEqual(p["world"][0], [0.5, 0.5, 0.1])

    def test_no_3d_points_is_said_so(self):
        self.assertIsNone(pt.person_entry([Landmark()] * 33, None)["world"])

    def test_a_broken_number_leaves_that_person_out(self):
        self.assertIsNone(pt.person_entry([Landmark(float("nan"))] * 33, None))
        self.assertIsNone(pt.person_entry([Landmark()] * 33, [Landmark(float("inf"))] * 33))
        self.assertIsNone(pt.person_entry([Landmark()] * 32, None))

    def test_sureness_the_model_does_not_give_is_never_guessed(self):
        with self.assertRaises(SystemExit):
            pt.person_entry([Landmark(visibility=None)] * 33, None)
        with self.assertRaises(SystemExit):
            pt.person_entry([Landmark(presence=None)] * 33, None)


class Pictures(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.out = self.tmp.name
        self.video = os.path.join(self.out, "v.mp4")
        make_video(self.video, seconds=0.5)
        cap = cv2.VideoCapture(self.video)
        times = [t for t, _ in pt.sampled_frames(cap, 30)]
        cap.release()
        body = [[0.5, 0.2 + i * 0.02, 0, 0.9, 0.9] for i in range(33)]
        other = [[0.2, 0.2 + i * 0.02, 0, 0.3, 0.9] for i in range(33)]
        self.look = {"frames": [{"index": 0, "t": times[0], "why": "a plain look", "people": [{"points": body}]},
                                {"index": 3, "t": times[3], "why": "2 people from here",
                                 "people": [{"points": body}, {"points": other}]},
                                {"index": 5, "t": times[5], "why": "nobody from here", "people": []}]}
        self.write("look.json", json.dumps(self.look))

    def write(self, name, text):
        with open(os.path.join(self.out, name), "w", encoding="utf-8") as f:
            f.write(text)

    def draw(self):
        return subprocess.run([sys.executable, pt.__file__, "draw", "--look", os.path.join(self.out, "look.json"),
                               "--video", self.video, "--fps", "30", "--out", self.out], capture_output=True, text=True)

    def test_each_moment_is_drawn_and_only_our_own_pictures_are_replaced(self):
        self.write(pt.MARKER, json.dumps({"source": "s", "pictures": ["01_old.jpg"]}))
        self.write("01_old.jpg", "ours")
        self.write("19_mum_birthday.jpg", "theirs")
        r = self.draw()
        self.assertEqual(r.returncode, 0, r.stderr)
        files = os.listdir(self.out)
        self.assertNotIn("01_old.jpg", files)
        self.assertIn("19_mum_birthday.jpg", files)
        for name in ("01_a_plain_look.jpg", "02_2_people_from_here.jpg", "03_nobody_from_here.jpg", "all.jpg"):
            self.assertIn(name, files)
        with open(os.path.join(self.out, pt.MARKER), encoding="utf-8") as f:
            self.assertEqual(len(json.load(f)["pictures"]), 4)

    def test_a_folder_the_tool_did_not_make_is_refused(self):
        self.assertNotEqual(self.draw().returncode, 0)
        self.assertNotIn("all.jpg", os.listdir(self.out))

    def test_another_video_is_refused_and_changes_nothing(self):
        self.write(pt.MARKER, json.dumps({"source": "s", "pictures": ["01_old.jpg"]}))
        self.write("01_old.jpg", "ours")
        self.look["frames"][1]["t"] += 5
        self.write("look.json", json.dumps(self.look))
        r = self.draw()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("same video", r.stderr)
        self.assertIn("01_old.jpg", os.listdir(self.out))


@unittest.skipUnless(os.path.exists(MODEL), "the pose model is not on this laptop")
class WholeRun(unittest.TestCase):
    def test_a_video_of_nobody_gives_empty_frames_and_no_path(self):
        with tempfile.TemporaryDirectory() as d:
            video, out = os.path.join(d, "secret-name.mp4"), os.path.join(d, "m.jsonl")
            make_video(video, fps=60)
            subprocess.run([sys.executable, pt.__file__, "measure", "--video", video, "--out", out, "--label", "empty",
                            "--fps", "30", "--people", "6", "--model", MODEL, "--tool-version", "1"],
                           check=True, capture_output=True)
            with open(out, encoding="utf-8") as f:
                text = f.read()
            self.assertNotIn("secret-name", text)
            self.assertNotIn(d.replace("\\", "/"), text.replace("\\\\", "/"))
            lines = [json.loads(x) for x in text.splitlines()]
            header = lines[0]
            self.assertEqual(header["model"], {"file": "pose_landmarker_heavy", "people": 6, "minDetection": 0.5,
                                               "minPresence": 0.5, "minTracking": 0.5})
            self.assertEqual((header["picture"], header["videoFps"], header["fps"]), ({"width": 320, "height": 180}, 60, 30))
            self.assertEqual(len(lines) - 1, 60)
            self.assertTrue(all(f["people"] == [] and f["down"] == [0, 1, 0] for f in lines[1:]))
            self.assertAlmostEqual(lines[1]["aspect"], 320 / 180)


if __name__ == "__main__":
    unittest.main()
