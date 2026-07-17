"""Physical myCobot 280 serial communication.

Nothing in this module is used by browser gamepad simulation control unless the user
explicitly switches the web page to real-robot mode.
"""

from __future__ import annotations

import glob
import threading
import time
from typing import Any

from mac_hw_sandbox.mycobot_safe import (
    CONSERVATIVE_LIMITS_DEGREES,
    DEFAULT_BAUD,
    DEFAULT_SPEED,
    JOINT_COUNT,
    get_angles_or_exit,
    stop_robot,
    validate_angles,
    validate_speed,
)


def list_serial_ports() -> list[str]:
    ports = sorted(set(glob.glob("/dev/cu.*") + glob.glob("/dev/tty.*")))
    return [port for port in ports if "Bluetooth-Incoming-Port" not in port]


class RealRobotSession:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._mc: Any | None = None
        self.port: str | None = None
        self.baud = DEFAULT_BAUD
        self.connected_at: float | None = None

    @property
    def connected(self) -> bool:
        return self._mc is not None

    def connect(self, port: str, baud: int) -> dict[str, Any]:
        if not port.startswith("/dev/"):
            raise ValueError("Port must be a /dev serial device.")

        from pymycobot import MyCobot280

        with self._lock:
            self._mc = MyCobot280(port, int(baud))
            self.port = port
            self.baud = int(baud)
            self.connected_at = time.time()
            angles = get_angles_or_exit(self._mc)
        return self.status(angles)

    def disconnect(self) -> dict[str, Any]:
        with self._lock:
            self._mc = None
            self.port = None
            self.connected_at = None
        return self.status()

    def require_robot(self) -> Any:
        if self._mc is None:
            raise RuntimeError("Robot is not connected.")
        return self._mc

    def status(self, angles: list[float] | None = None) -> dict[str, Any]:
        return {
            "connected": self.connected,
            "mode": "real",
            "port": self.port,
            "baud": self.baud,
            "connected_at": self.connected_at,
            "angles": angles,
            "limits": CONSERVATIVE_LIMITS_DEGREES,
            "speed_limit": 30,
            "default_speed": DEFAULT_SPEED,
            "sim_available": True,
            "sim_error": None,
            "end_effector": None,
        }

    def read_angles(self) -> dict[str, Any]:
        with self._lock:
            angles = get_angles_or_exit(self.require_robot())
        return self.status(angles)

    def send_angles(self, angles: list[float], speed: int) -> dict[str, Any]:
        checked = validate_angles(angles)
        checked_speed = validate_speed(int(speed))
        with self._lock:
            robot = self.require_robot()
            robot.send_angles(checked, checked_speed)
            time.sleep(0.2)
            current = get_angles_or_exit(robot)
        return self.status(current) | {"target_angles": checked, "speed": checked_speed}

    def jog(self, joint: int, delta: float, speed: int) -> dict[str, Any]:
        if not 1 <= joint <= JOINT_COUNT:
            raise ValueError("Joint must be between 1 and 6.")
        if abs(float(delta)) > 5:
            raise ValueError("Jog delta is limited to +/-5 degrees.")

        with self._lock:
            robot = self.require_robot()
            angles = get_angles_or_exit(robot)
            angles[joint - 1] += float(delta)
        return self.send_angles(angles, speed)

    def stop(self) -> dict[str, Any]:
        with self._lock:
            robot = self.require_robot()
            stop_robot(robot)
            angles = get_angles_or_exit(robot)
        return self.status(angles)

    def release_servos(self) -> dict[str, Any]:
        with self._lock:
            robot = self.require_robot()
            method = getattr(robot, "release_all_servos", None)
            if not callable(method):
                raise RuntimeError("This pymycobot version does not expose release_all_servos().")
            method()
        return self.status()
