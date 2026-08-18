"""MuJoCo model, simulation control, and interactive native Viewer.

This is the single Python file responsible for the simulated myCobot 280. The
MJCF and mesh assets live separately under ``models/mycobot_280``.
"""

from __future__ import annotations

import argparse
import json
import math
import platform
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import numpy as np

from mac_hw_sandbox.mycobot_safe import (
    CONSERVATIVE_LIMITS_DEGREES,
    DEFAULT_BAUD,
    DEFAULT_SPEED,
    JOINT_COUNT,
    SAFE_HOME_DEGREES,
    validate_angles,
    validate_speed,
)


ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = ROOT / "models" / "mycobot_280" / "scene.xml"
CARTESIAN_MODES = {"joint", "cartesian"}
CARTESIAN_WORKSPACE_MIN = np.array([-0.30, -0.30, 0.04], dtype=float)
CARTESIAN_WORKSPACE_MAX = np.array([0.30, 0.30, 0.48], dtype=float)
CARTESIAN_TARGET_LEAD_METERS = 0.035
CARTESIAN_MAX_JOINT_SPEED = math.radians(25.0)
CARTESIAN_JOINT_MARGIN = math.radians(3.0)


class MujocoModel:
    """Thread-safe MuJoCo state used by the HTTP API."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._model: Any | None = None
        self._data: Any | None = None
        self._mujoco: Any | None = None
        self._tcp_site_id: int | None = None
        self._control_dof_indices: np.ndarray | None = None
        self._control_qpos_indices: np.ndarray | None = None
        self.connected_at: float | None = None
        self.sim_error: str | None = None
        self.gamepad_control_mode = "joint"
        self.cartesian_target: np.ndarray | None = None
        self.cartesian_reference_q: np.ndarray | None = None
        self.cartesian_error = 0.0
        self.cartesian_damping = 0.0
        self.cartesian_min_singular_value = 0.0

    @property
    def connected(self) -> bool:
        return self._model is not None and self._data is not None

    def connect(self) -> dict[str, Any]:
        try:
            import mujoco
        except ImportError as exc:
            self.sim_error = "mujoco is not installed. Run: python -m pip install -r requirements.txt"
            raise RuntimeError(self.sim_error) from exc

        with self._lock:
            self._mujoco = mujoco
            self._model = mujoco.MjModel.from_xml_path(str(MODEL_PATH))
            self._data = mujoco.MjData(self._model)
            self._data.ctrl[:] = 0
            mujoco.mj_forward(self._model, self._data)
            self._tcp_site_id = mujoco.mj_name2id(self._model, mujoco.mjtObj.mjOBJ_SITE, "tcp")
            if self._tcp_site_id < 0:
                raise RuntimeError("MuJoCo model does not define the tcp site.")
            actuator_joint_ids = self._model.actuator_trnid[:JOINT_COUNT, 0].astype(int)
            self._control_dof_indices = self._model.jnt_dofadr[actuator_joint_ids].astype(int)
            self._control_qpos_indices = self._model.jnt_qposadr[actuator_joint_ids].astype(int)
            self.gamepad_control_mode = "joint"
            self._reset_cartesian_target_unlocked()
            self.connected_at = time.time()
            self.sim_error = None
        return self.status(SAFE_HOME_DEGREES)

    def disconnect(self) -> dict[str, Any]:
        with self._lock:
            self._model = None
            self._data = None
            self._tcp_site_id = None
            self._control_dof_indices = None
            self._control_qpos_indices = None
            self.cartesian_target = None
            self.cartesian_reference_q = None
            self.connected_at = None
        return self.status()

    def require_sim(self) -> tuple[Any, Any, Any]:
        if self._mujoco is None or self._model is None or self._data is None:
            raise RuntimeError("MuJoCo simulator is not connected.")
        return self._mujoco, self._model, self._data

    def status(self, angles: list[float] | None = None) -> dict[str, Any]:
        with self._lock:
            tcp = self._end_effector_unlocked() if self.connected else None
            return {
                "connected": self.connected,
                "mode": "sim",
                "port": None,
                "baud": DEFAULT_BAUD,
                "connected_at": self.connected_at,
                "angles": angles,
                "limits": CONSERVATIVE_LIMITS_DEGREES,
                "speed_limit": 30,
                "default_speed": DEFAULT_SPEED,
                "sim_available": self.sim_error is None,
                "sim_error": self.sim_error,
                "end_effector": tcp,
                "gamepad_control_mode": self.gamepad_control_mode,
                "cartesian_target": (
                    [round(float(value), 4) for value in self.cartesian_target]
                    if self.cartesian_target is not None
                    else None
                ),
                "cartesian_error": round(self.cartesian_error, 5),
                "cartesian_damping": round(self.cartesian_damping, 5),
                "jacobian_min_singular_value": round(self.cartesian_min_singular_value, 6),
            }

    def _current_angles_unlocked(self) -> list[float]:
        _, _, data = self.require_sim()
        return [round(math.degrees(float(data.qpos[index])), 2) for index in range(JOINT_COUNT)]

    def _end_effector_unlocked(self) -> list[float]:
        return [round(float(value), 4) for value in self._tcp_position_unlocked()]

    def _tcp_position_unlocked(self) -> np.ndarray:
        _, _, data = self.require_sim()
        if self._tcp_site_id is None:
            raise RuntimeError("TCP site is not initialized.")
        return data.site_xpos[self._tcp_site_id].copy()

    def _reset_cartesian_target_unlocked(self) -> None:
        _, _, data = self.require_sim()
        if self._control_qpos_indices is None:
            raise RuntimeError("Controlled joint indices are not initialized.")
        self.cartesian_target = self._tcp_position_unlocked()
        self.cartesian_reference_q = data.qpos[self._control_qpos_indices].copy()
        self.cartesian_error = 0.0

    def set_gamepad_control_mode(self, control_mode: str) -> dict[str, Any]:
        normalized = str(control_mode).strip().lower()
        if normalized not in CARTESIAN_MODES:
            raise ValueError("Gamepad control mode must be joint or cartesian.")
        with self._lock:
            self.require_sim()
            self.gamepad_control_mode = normalized
            self._reset_cartesian_target_unlocked()
            angles = self._current_angles_unlocked()
        return self.status(angles)

    def reset_cartesian_target(self) -> dict[str, Any]:
        with self._lock:
            self.require_sim()
            self._reset_cartesian_target_unlocked()
            angles = self._current_angles_unlocked()
        return self.status(angles)

    def read_angles(self) -> dict[str, Any]:
        with self._lock:
            angles = self._current_angles_unlocked()
        return self.status(angles)

    def send_angles(self, angles: list[float], speed: int) -> dict[str, Any]:
        checked = validate_angles(angles)
        checked_speed = validate_speed(int(speed))
        steps = max(10, checked_speed * 4)
        target = [math.radians(angle) for angle in checked]

        with self._lock:
            mujoco, model, data = self.require_sim()
            start = data.ctrl.copy()
            for step in range(1, steps + 1):
                ratio = step / steps
                data.ctrl[:] = [
                    (1 - ratio) * start[index] + ratio * target[index]
                    for index in range(JOINT_COUNT)
                ]
                mujoco.mj_step(model, data)
            self._reset_cartesian_target_unlocked()
            current = self._current_angles_unlocked()
        return self.status(current) | {"target_angles": checked, "speed": checked_speed}

    def jog(self, joint: int, delta: float, speed: int) -> dict[str, Any]:
        if not 1 <= joint <= JOINT_COUNT:
            raise ValueError("Joint must be between 1 and 6.")
        if abs(float(delta)) > 5:
            raise ValueError("Jog delta is limited to +/-5 degrees.")
        with self._lock:
            angles = self._current_angles_unlocked()
        angles[joint - 1] += float(delta)
        return self.send_angles(angles, speed)

    def apply_gamepad(self, velocity: list[float], dt: float, speed_degrees: float) -> dict[str, Any]:
        if len(velocity) != JOINT_COUNT:
            raise ValueError(f"Expected {JOINT_COUNT} gamepad axes, got {len(velocity)}.")
        directions = [float(value) for value in velocity]
        if not all(math.isfinite(value) and -1 <= value <= 1 for value in directions):
            raise ValueError("Gamepad axes must be finite values between -1 and 1.")

        checked_dt = min(max(float(dt), 0.001), 0.1)
        checked_speed = min(max(float(speed_degrees), 1.0), 60.0)
        radians_per_second = math.radians(checked_speed)

        with self._lock:
            mujoco, model, data = self.require_sim()
            self.gamepad_control_mode = "joint"
            target = data.ctrl.copy()
            for index, direction in enumerate(directions):
                proposed = float(target[index]) + direction * radians_per_second * checked_dt
                lower, upper = model.actuator_ctrlrange[index]
                target[index] = min(max(proposed, float(lower)), float(upper))
            data.ctrl[:] = target
            mujoco.mj_step(model, data, nstep=max(1, round(checked_dt / model.opt.timestep)))
            angles = self._current_angles_unlocked()
        return self.status(angles) | {
            "target_angles": [round(math.degrees(float(value)), 2) for value in target],
            "gamepad_speed": checked_speed,
        }

    def apply_cartesian_gamepad(
        self,
        linear_velocity: list[float],
        dt: float,
        linear_speed: float,
    ) -> dict[str, Any]:
        if len(linear_velocity) != 3:
            raise ValueError(f"Expected 3 Cartesian axes, got {len(linear_velocity)}.")
        direction = np.asarray(linear_velocity, dtype=float)
        if not np.all(np.isfinite(direction)) or np.any(np.abs(direction) > 1):
            raise ValueError("Cartesian axes must be finite values between -1 and 1.")

        direction_norm = float(np.linalg.norm(direction))
        if direction_norm > 1:
            direction /= direction_norm
        checked_dt = min(max(float(dt), 0.001), 0.1)
        checked_speed = min(max(float(linear_speed), 0.005), 0.08)

        with self._lock:
            mujoco, model, data = self.require_sim()
            if self._tcp_site_id is None or self._control_dof_indices is None or self._control_qpos_indices is None:
                raise RuntimeError("Cartesian controller is not initialized.")
            if self.gamepad_control_mode != "cartesian" or self.cartesian_target is None:
                self.gamepad_control_mode = "cartesian"
                self._reset_cartesian_target_unlocked()

            current_position = self._tcp_position_unlocked()
            self.cartesian_target += direction * checked_speed * checked_dt
            self.cartesian_target[:] = np.clip(
                self.cartesian_target,
                CARTESIAN_WORKSPACE_MIN,
                CARTESIAN_WORKSPACE_MAX,
            )

            target_delta = self.cartesian_target - current_position
            target_distance = float(np.linalg.norm(target_delta))
            if target_distance > CARTESIAN_TARGET_LEAD_METERS:
                self.cartesian_target[:] = (
                    current_position
                    + target_delta * (CARTESIAN_TARGET_LEAD_METERS / target_distance)
                )

            error = self.cartesian_target - current_position
            jac_pos = np.zeros((3, model.nv), dtype=float)
            jac_rot = np.zeros((3, model.nv), dtype=float)
            mujoco.mj_jacSite(model, data, jac_pos, jac_rot, self._tcp_site_id)
            jacobian = jac_pos[:, self._control_dof_indices]

            singular_values = np.linalg.svd(jacobian, compute_uv=False)
            sigma_min = float(singular_values[-1]) if singular_values.size else 0.0
            singular_threshold = 0.06
            singular_ratio = max(0.0, 1.0 - sigma_min / singular_threshold)
            damping = 0.02 + 0.08 * singular_ratio * singular_ratio

            desired_tcp_velocity = direction * checked_speed + 4.0 * error
            desired_norm = float(np.linalg.norm(desired_tcp_velocity))
            if desired_norm > 0.08:
                desired_tcp_velocity *= 0.08 / desired_norm

            system = jacobian @ jacobian.T + damping**2 * np.eye(3)
            dls_inverse = jacobian.T @ np.linalg.solve(system, np.eye(3))
            joint_velocity = dls_inverse @ desired_tcp_velocity

            current_q = data.qpos[self._control_qpos_indices]
            if self.cartesian_reference_q is not None:
                nullspace = np.eye(JOINT_COUNT) - dls_inverse @ jacobian
                joint_velocity += nullspace @ (0.25 * (self.cartesian_reference_q - current_q))
            joint_velocity = np.clip(
                joint_velocity,
                -CARTESIAN_MAX_JOINT_SPEED,
                CARTESIAN_MAX_JOINT_SPEED,
            )

            target_q = data.ctrl[:JOINT_COUNT].copy() + joint_velocity * checked_dt
            for index in range(JOINT_COUNT):
                lower, upper = model.actuator_ctrlrange[index]
                safe_lower = float(lower) + CARTESIAN_JOINT_MARGIN
                safe_upper = float(upper) - CARTESIAN_JOINT_MARGIN
                target_q[index] = np.clip(target_q[index], safe_lower, safe_upper)
            data.ctrl[:JOINT_COUNT] = target_q
            mujoco.mj_step(
                model,
                data,
                nstep=max(1, round(checked_dt / model.opt.timestep)),
            )

            self.cartesian_error = float(
                np.linalg.norm(self.cartesian_target - self._tcp_position_unlocked())
            )
            self.cartesian_damping = damping
            self.cartesian_min_singular_value = sigma_min
            angles = self._current_angles_unlocked()
        return self.status(angles) | {
            "linear_speed": checked_speed,
            "cartesian_command": [round(float(value), 4) for value in direction],
        }

    def stop(self) -> dict[str, Any]:
        with self._lock:
            _, _, data = self.require_sim()
            data.ctrl[:] = data.qpos[:JOINT_COUNT]
            self._reset_cartesian_target_unlocked()
            angles = self._current_angles_unlocked()
        return self.status(angles)

    def release_servos(self) -> dict[str, Any]:
        raise RuntimeError("Release servos is only available for the real robot.")


class NativeViewer:
    """Own the separate interactive MuJoCo Viewer process."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._process: subprocess.Popen[bytes] | None = None

    def status(self) -> dict[str, Any]:
        with self._lock:
            running = self._process is not None and self._process.poll() is None
            return {"running": running, "pid": self._process.pid if running else None}

    def open(self, server_url: str) -> dict[str, Any]:
        parsed = urlparse(server_url)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("Native viewer may only synchronize with a local HTTP server.")

        with self._lock:
            if self._process is not None and self._process.poll() is None:
                return {"running": True, "pid": self._process.pid, "already_running": True}

            executable = ROOT / ".venv" / "bin" / "mjpython" if platform.system() == "Darwin" else Path(sys.executable)
            if not executable.is_file():
                raise RuntimeError(f"MuJoCo Python launcher not found: {executable}")
            self._process = subprocess.Popen(
                [str(executable), "-m", "mycobot_app.mujoco_model", "--server-url", server_url],
                cwd=str(ROOT),
            )
            time.sleep(0.2)
            if self._process.poll() is not None:
                code = self._process.returncode
                self._process = None
                raise RuntimeError(f"MuJoCo viewer exited during startup (code {code}).")
            return {"running": True, "pid": self._process.pid, "already_running": False}

    def close(self) -> None:
        with self._lock:
            if self._process is None or self._process.poll() is not None:
                return
            self._process.terminate()
            try:
                self._process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self._process.kill()
            self._process = None


def fetch_state(server_url: str) -> dict[str, Any] | None:
    request = Request(f"{server_url.rstrip('/')}/api/status", headers={"Accept": "application/json"})
    with urlopen(request, timeout=0.25) as response:
        payload = json.load(response)
    if not payload.get("connected"):
        return None
    return payload


def run_native_viewer(server_url: str) -> None:
    import mujoco
    import mujoco.viewer

    model = mujoco.MjModel.from_xml_path(str(MODEL_PATH))
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)
    target = [0.0] * JOINT_COUNT
    cartesian_target: list[float] | None = None
    gamepad_control_mode = "joint"
    target_body_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, "cartesian_target")
    target_mocap_id = int(model.body_mocapid[target_body_id]) if target_body_id >= 0 else -1
    last_fetch = 0.0
    last_warning = 0.0

    with mujoco.viewer.launch_passive(model, data) as viewer:
        with viewer.lock():
            viewer.cam.lookat[:] = [0.0, 0.0, 0.25]
            viewer.cam.distance = 0.65
            viewer.cam.azimuth = 135.0
            viewer.cam.elevation = -25.0

        while viewer.is_running():
            now = time.monotonic()
            if now - last_fetch >= 0.04:
                try:
                    state = fetch_state(server_url)
                    if state is not None:
                        angles = state.get("angles")
                        if isinstance(angles, list) and len(angles) == JOINT_COUNT:
                            target = [float(angle) for angle in angles]
                        next_target = state.get("cartesian_target")
                        cartesian_target = (
                            [float(value) for value in next_target]
                            if isinstance(next_target, list) and len(next_target) == 3
                            else None
                        )
                        gamepad_control_mode = str(state.get("gamepad_control_mode", "joint"))
                except Exception as exc:
                    if now - last_warning >= 2:
                        print(f"MuJoCo viewer waiting for web server: {exc}")
                        last_warning = now
                last_fetch = now

            with viewer.lock():
                radians = [math.radians(angle) for angle in target]
                data.qpos[:JOINT_COUNT] = radians
                data.ctrl[:JOINT_COUNT] = radians
                if target_mocap_id >= 0:
                    data.mocap_pos[target_mocap_id] = (
                        cartesian_target
                        if gamepad_control_mode == "cartesian" and cartesian_target is not None
                        else [0.0, 0.0, -1.0]
                    )
                mujoco.mj_forward(model, data)
            viewer.sync()
            time.sleep(1 / 60)


def main() -> None:
    parser = argparse.ArgumentParser(description="Interactive myCobot 280 MuJoCo Viewer")
    parser.add_argument("--server-url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    run_native_viewer(args.server_url)


if __name__ == "__main__":
    main()
