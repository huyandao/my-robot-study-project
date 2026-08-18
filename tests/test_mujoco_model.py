from __future__ import annotations

import math
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

    def test_cartesian_gamepad_moves_tcp_toward_integrated_target(self) -> None:
        start = self.sim.read_angles()["end_effector"]
        mode_status = self.sim.set_gamepad_control_mode("cartesian")
        self.assertEqual(mode_status["gamepad_control_mode"], "cartesian")

        status = mode_status
        for _ in range(12):
            status = self.sim.apply_cartesian_gamepad([1, 0, 0], 0.04, 0.03)

        self.assertGreater(status["cartesian_target"][0], start[0])
        self.assertGreater(status["end_effector"][0], start[0])
        self.assertLessEqual(status["cartesian_error"], 0.0351)
        self.assertTrue(math.isfinite(status["cartesian_damping"]))
        self.assertGreater(status["jacobian_min_singular_value"], 0)

    def test_cartesian_target_reset_and_validation(self) -> None:
        self.sim.set_gamepad_control_mode("cartesian")
        self.sim.apply_cartesian_gamepad([0, 1, 0], 0.04, 0.03)
        status = self.sim.reset_cartesian_target()
        for target, actual in zip(status["cartesian_target"], status["end_effector"]):
            self.assertAlmostEqual(target, actual, places=3)
        with self.assertRaises(ValueError):
            self.sim.apply_cartesian_gamepad([0, 0], 0.04, 0.03)
        with self.assertRaises(ValueError):
            self.sim.set_gamepad_control_mode("unknown")

    def test_viewer_rejects_remote_sync_url(self) -> None:
        with self.assertRaises(ValueError):
            NativeViewer().open("https://example.com")


if __name__ == "__main__":
    unittest.main()
