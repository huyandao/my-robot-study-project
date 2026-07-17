from __future__ import annotations

import unittest

from mycobot_app.mujoco_model import MODEL_PATH, MujocoModel, NativeViewer


class MujocoModelTest(unittest.TestCase):
    def setUp(self) -> None:
        self.sim = MujocoModel()
        self.sim.connect()

    def tearDown(self) -> None:
        self.sim.disconnect()

    def test_model_loads_and_reports_six_joints(self) -> None:
        status = self.sim.read_angles()
        self.assertTrue(MODEL_PATH.is_file())
        self.assertTrue(status["connected"])
        self.assertEqual(len(status["angles"]), 6)
        self.assertEqual(len(status["end_effector"]), 3)

    def test_gamepad_velocity_moves_and_stays_bounded(self) -> None:
        status = self.sim.apply_gamepad([0.5, 0, 0, 0, 1, 0], 0.04, 15)
        self.assertGreater(status["angles"][0], 0)
        self.assertGreater(status["angles"][4], 0)
        self.assertLessEqual(status["angles"][0], status["limits"][0][1])

    def test_invalid_gamepad_packet_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            self.sim.apply_gamepad([0, 0], 0.04, 15)

    def test_viewer_rejects_remote_sync_url(self) -> None:
        with self.assertRaises(ValueError):
            NativeViewer().open("https://example.com")


if __name__ == "__main__":
    unittest.main()
