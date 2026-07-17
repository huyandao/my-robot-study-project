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


class MujocoModel:
    """Thread-safe MuJoCo state used by the HTTP API."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._model: Any | None = None
        self._data: Any | None = None
        self._mujoco: Any | None = None
        self.connected_at: float | None = None
        self.sim_error: str | None = None

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
            self.connected_at = time.time()
            self.sim_error = None
        return self.status(SAFE_HOME_DEGREES)

    def disconnect(self) -> dict[str, Any]:
        with self._lock:
            self._model = None
            self._data = None
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
            }

    def _current_angles_unlocked(self) -> list[float]:
        _, _, data = self.require_sim()
        return [round(math.degrees(float(data.qpos[index])), 2) for index in range(JOINT_COUNT)]

    def _end_effector_unlocked(self) -> list[float]:
        mujoco, model, data = self.require_sim()
        site_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_SITE, "tcp")
        return [round(float(value), 4) for value in data.site_xpos[site_id]]

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

    def stop(self) -> dict[str, Any]:
        with self._lock:
            _, _, data = self.require_sim()
            data.ctrl[:] = data.qpos[:JOINT_COUNT]
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


def fetch_angles(server_url: str) -> list[float] | None:
    request = Request(f"{server_url.rstrip('/')}/api/status", headers={"Accept": "application/json"})
    with urlopen(request, timeout=0.25) as response:
        payload = json.load(response)
    angles = payload.get("angles")
    if not payload.get("connected") or not isinstance(angles, list) or len(angles) != JOINT_COUNT:
        return None
    return [float(angle) for angle in angles]


def run_native_viewer(server_url: str) -> None:
    import mujoco
    import mujoco.viewer

    model = mujoco.MjModel.from_xml_path(str(MODEL_PATH))
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)
    target = [0.0] * JOINT_COUNT
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
                    angles = fetch_angles(server_url)
                    if angles is not None:
                        target = angles
                except Exception as exc:
                    if now - last_warning >= 2:
                        print(f"MuJoCo viewer waiting for web server: {exc}")
                        last_warning = now
                last_fetch = now

            with viewer.lock():
                radians = [math.radians(angle) for angle in target]
                data.qpos[:JOINT_COUNT] = radians
                data.ctrl[:JOINT_COUNT] = radians
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
