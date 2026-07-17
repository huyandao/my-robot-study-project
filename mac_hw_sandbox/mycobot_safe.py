from __future__ import annotations

import argparse
import sys
import time
from dataclasses import dataclass
from typing import Iterable, Sequence

JOINT_COUNT = 6
DEFAULT_BAUD = 115200
DEFAULT_SPEED = 15
SAFE_HOME_DEGREES = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
CONSERVATIVE_LIMITS_DEGREES = [
    (-160.0, 160.0),
    (-80.0, 80.0),
    (-150.0, 150.0),
    (-160.0, 160.0),
    (-100.0, 100.0),
    (-175.0, 175.0),
]


@dataclass(frozen=True)
class ConnectionArgs:
    port: str
    baud: int = DEFAULT_BAUD


def add_connection_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--port", required=True, help="Serial device, for example /dev/cu.usbserial-XXXX")
    parser.add_argument("--baud", type=int, default=DEFAULT_BAUD, help=f"Serial baud rate. Default: {DEFAULT_BAUD}")


def add_motion_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--speed", type=int, default=DEFAULT_SPEED, help=f"myCobot speed 1-100. Default: {DEFAULT_SPEED}")
    parser.add_argument("--yes", action="store_true", help="Confirm that you are ready for real robot motion")


def connect(args: argparse.Namespace):
    try:
        from pymycobot import MyCobot280
    except ImportError as exc:
        raise SystemExit("pymycobot is not installed. Run: python -m pip install -r requirements-mac.txt") from exc

    return MyCobot280(args.port, args.baud)


def require_motion_confirmation(args: argparse.Namespace, description: str) -> None:
    if args.yes:
        return
    print(f"This command can move the real arm: {description}")
    print("Rerun with --yes after checking the workspace and power-off path.")
    raise SystemExit(2)


def validate_speed(speed: int) -> int:
    if not 1 <= speed <= 30:
        raise SystemExit("For early learning, keep speed between 1 and 30.")
    return speed


def validate_angles(angles: Sequence[float]) -> list[float]:
    if len(angles) != JOINT_COUNT:
        raise SystemExit(f"Expected {JOINT_COUNT} joint angles, got {len(angles)}.")

    checked: list[float] = []
    for index, (angle, (low, high)) in enumerate(zip(angles, CONSERVATIVE_LIMITS_DEGREES), start=1):
        value = float(angle)
        if value < low or value > high:
            raise SystemExit(f"Joint {index} angle {value:.1f} is outside conservative limit [{low}, {high}].")
        checked.append(value)
    return checked


def get_angles_or_exit(mc) -> list[float]:
    angles = mc.get_angles()
    if not angles or len(angles) != JOINT_COUNT:
        raise SystemExit(f"Could not read {JOINT_COUNT} joint angles. Received: {angles!r}")
    return [float(angle) for angle in angles]


def send_angles_and_wait(mc, angles: Iterable[float], speed: int, seconds: float = 3.0) -> None:
    checked = validate_angles(list(angles))
    checked_speed = validate_speed(speed)
    print(f"Sending angles={checked} speed={checked_speed}")
    mc.send_angles(checked, checked_speed)
    time.sleep(seconds)
    print(f"Current angles: {get_angles_or_exit(mc)}")


def stop_robot(mc) -> None:
    # pymycobot exposes pause/stop APIs differently across versions; try the safest known calls.
    for method_name in ("stop", "pause"):
        method = getattr(mc, method_name, None)
        if callable(method):
            method()
            print(f"Called mc.{method_name}()")
            return
    print("No stop/pause method found in this pymycobot version.", file=sys.stderr)

