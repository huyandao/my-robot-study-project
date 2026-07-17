"""Control the downloaded myCobot 280 MuJoCo model with a gamepad.

Default mapping (Xbox / PlayStation-style controllers):

* left stick X/Y: joint 1 / joint 2
* right stick X/Y: joint 3 / joint 4
* D-pad up/down: joint 5
* D-pad left/right: joint 6
* A / Cross: move target to the zero home pose
* B / Circle: toggle hold mode
* Start / Options: quit

This program controls simulation only. It never connects to a real robot.
"""

from __future__ import annotations

import argparse
import math
import os
import platform
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import mujoco
import mujoco.viewer

try:
    import pygame
except ImportError as exc:  # pragma: no cover - exercised on a missing dependency
    raise SystemExit(
        "pygame is required for gamepad input. Install project dependencies with:\n"
        "  python -m pip install -r requirements-mac.txt"
    ) from exc


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL = ROOT / "models" / "mycobot_280" / "scene.xml"
JOINT_NAMES = (
    "joint2_to_joint1",
    "joint3_to_joint2",
    "joint4_to_joint3",
    "joint5_to_joint4",
    "joint6_to_joint5",
    "joint7_to_joint6",
)


@dataclass(frozen=True)
class PadCommand:
    joint_velocity: tuple[float, float, float, float, float, float]
    home_pressed: bool = False
    hold_pressed: bool = False
    quit_pressed: bool = False


def _deadzone(value: float, radius: float) -> float:
    """Remove stick drift while keeping the remaining range smooth."""
    magnitude = abs(value)
    if magnitude <= radius:
        return 0.0
    return math.copysign((magnitude - radius) / (1.0 - radius), value)


class Gamepad:
    """Small pygame joystick wrapper with hot-plug support."""

    def __init__(
        self,
        device_index: int,
        deadzone: float,
        axis_map: tuple[int, int, int, int],
    ) -> None:
        pygame.init()
        pygame.joystick.init()
        self.device_index = device_index
        self.deadzone = deadzone
        self.axis_map = axis_map
        self.joystick: pygame.joystick.JoystickType | None = None
        self._connect_if_available(announce=True)

    def _connect_if_available(self, *, announce: bool = False) -> None:
        if self.joystick is not None and self.joystick.get_init():
            return
        self.joystick = None
        pygame.joystick.quit()
        pygame.joystick.init()
        count = pygame.joystick.get_count()
        if self.device_index >= count:
            if announce:
                print(
                    f"Waiting for gamepad index {self.device_index} "
                    f"({count} detected). Connect one to continue."
                )
            return
        joystick = pygame.joystick.Joystick(self.device_index)
        joystick.init()
        self.joystick = joystick
        print(
            f"Connected: {joystick.get_name()} "
            f"({joystick.get_numaxes()} axes, {joystick.get_numbuttons()} buttons, "
            f"{joystick.get_numhats()} hats)"
        )

    def _axis(self, index: int) -> float:
        joystick = self.joystick
        if joystick is None or index >= joystick.get_numaxes():
            return 0.0
        return _deadzone(float(joystick.get_axis(index)), self.deadzone)

    def poll(self) -> PadCommand:
        home_pressed = False
        hold_pressed = False
        quit_pressed = False

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                quit_pressed = True
            elif event.type == pygame.JOYDEVICEREMOVED:
                if self.joystick is not None:
                    print("Gamepad disconnected; holding the current target.")
                self.joystick = None
            elif event.type == pygame.JOYDEVICEADDED:
                self._connect_if_available(announce=False)
            elif event.type == pygame.JOYBUTTONDOWN:
                # SDL's common Xbox/PlayStation button numbering.
                home_pressed |= event.button == 0
                hold_pressed |= event.button == 1
                quit_pressed |= event.button in (7, 9)

        self._connect_if_available(announce=False)
        joystick = self.joystick
        if joystick is None:
            return PadCommand((0.0,) * 6, home_pressed, hold_pressed, quit_pressed)

        hat_x, hat_y = (0, 0)
        if joystick.get_numhats() > 0:
            hat_x, hat_y = joystick.get_hat(0)

        # Y axes are inverted so pushing a stick forward gives positive motion.
        left_x, left_y, right_x, right_y = self.axis_map
        velocity = (
            self._axis(left_x),
            -self._axis(left_y),
            self._axis(right_x),
            -self._axis(right_y),
            float(hat_y),
            float(hat_x),
        )
        return PadCommand(velocity, home_pressed, hold_pressed, quit_pressed)

    def close(self) -> None:
        if self.joystick is not None:
            self.joystick.quit()
        pygame.quit()


def _joint_limits(model: mujoco.MjModel) -> tuple[list[int], list[tuple[float, float]]]:
    joint_ids: list[int] = []
    limits: list[tuple[float, float]] = []
    for name in JOINT_NAMES:
        joint_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name)
        if joint_id < 0:
            raise ValueError(f"Model is missing required joint: {name}")
        joint_ids.append(joint_id)
        lower, upper = model.jnt_range[joint_id]
        limits.append((float(lower), float(upper)))
    return joint_ids, limits


def list_gamepads() -> int:
    pygame.init()
    pygame.joystick.init()
    count = pygame.joystick.get_count()
    if count == 0:
        print("No gamepads detected.")
    for index in range(count):
        joystick = pygame.joystick.Joystick(index)
        joystick.init()
        print(f"{index}: {joystick.get_name()} (GUID {joystick.get_guid()})")
        joystick.quit()
    pygame.quit()
    return 0


def _parse_axis_map(value: str) -> tuple[int, int, int, int]:
    try:
        axes = tuple(int(item.strip()) for item in value.split(","))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("axis map must contain four integers") from exc
    if len(axes) != 4 or any(axis < 0 for axis in axes):
        raise argparse.ArgumentTypeError("axis map must be four non-negative indices")
    return axes[0], axes[1], axes[2], axes[3]


def run(args: argparse.Namespace) -> int:
    model_path = Path(args.model).expanduser().resolve()
    if not model_path.is_file():
        raise SystemExit(f"MuJoCo model not found: {model_path}")

    model = mujoco.MjModel.from_xml_path(str(model_path))
    if model.nu != len(JOINT_NAMES):
        raise SystemExit(
            f"Expected {len(JOINT_NAMES)} position actuators, model has {model.nu}. "
            "Load models/mycobot_280/scene.xml rather than the raw upstream XML."
        )
    data = mujoco.MjData(model)
    joint_ids, limits = _joint_limits(model)

    home = [0.0] * len(JOINT_NAMES)
    target = home.copy()
    for index, joint_id in enumerate(joint_ids):
        data.qpos[model.jnt_qposadr[joint_id]] = home[index]
    data.ctrl[:] = home
    mujoco.mj_forward(model, data)

    pad = Gamepad(args.device_index, args.deadzone, args.axis_map)
    radians_per_second = math.radians(args.joint_speed_deg)
    frame_period = 1.0 / args.frequency
    hold = False
    last_frame = time.monotonic()
    last_status = 0.0

    print("Controls: sticks=J1-J4, D-pad=J5/J6, A=home, B=hold, Start=quit")
    try:
        with mujoco.viewer.launch_passive(model, data) as viewer:
            while viewer.is_running():
                frame_start = time.monotonic()
                dt = min(frame_start - last_frame, 0.05)
                last_frame = frame_start
                command = pad.poll()

                if command.quit_pressed:
                    break
                if command.hold_pressed:
                    hold = not hold
                    print(f"Hold mode: {'ON' if hold else 'OFF'}")
                if command.home_pressed:
                    target[:] = home
                    hold = False
                    print("Target set to zero home pose.")

                if not hold:
                    for index, direction in enumerate(command.joint_velocity):
                        proposed = target[index] + direction * radians_per_second * dt
                        lower, upper = limits[index]
                        target[index] = min(max(proposed, lower), upper)

                data.ctrl[:] = target
                physics_steps = max(1, round(frame_period / model.opt.timestep))
                mujoco.mj_step(model, data, nstep=physics_steps)
                viewer.sync()

                if frame_start - last_status >= 0.5:
                    degrees = " ".join(f"J{i + 1}:{math.degrees(q):6.1f}" for i, q in enumerate(target))
                    print(f"\r{degrees} deg  {'[HOLD]' if hold else '      '}", end="", flush=True)
                    last_status = frame_start

                remaining = frame_period - (time.monotonic() - frame_start)
                if remaining > 0:
                    time.sleep(remaining)
    finally:
        print()
        pad.close()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=str(DEFAULT_MODEL), help="MJCF scene path")
    parser.add_argument("--device-index", type=int, default=0, help="pygame gamepad index")
    parser.add_argument("--deadzone", type=float, default=0.12, help="stick deadzone (0 to <1)")
    parser.add_argument(
        "--axis-map",
        type=_parse_axis_map,
        default=(0, 1, 2, 3),
        metavar="LX,LY,RX,RY",
        help="raw pygame axis indices for the two sticks (default: 0,1,2,3)",
    )
    parser.add_argument(
        "--joint-speed-deg",
        type=float,
        default=35.0,
        help="maximum target speed in degrees/second",
    )
    parser.add_argument("--frequency", type=float, default=60.0, help="control loop rate in Hz")
    parser.add_argument("--list-gamepads", action="store_true", help="list detected gamepads and exit")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not 0.0 <= args.deadzone < 1.0:
        parser.error("--deadzone must be in [0, 1)")
    if args.joint_speed_deg <= 0.0:
        parser.error("--joint-speed-deg must be positive")
    if args.frequency <= 0.0:
        parser.error("--frequency must be positive")
    if args.list_gamepads:
        return list_gamepads()
    if platform.system() == "Darwin" and "MJPYTHON_BIN" not in os.environ:
        print(
            "macOS note: if the MuJoCo viewer reports a launch error, run this script "
            "with .venv/bin/mjpython.",
            file=sys.stderr,
        )
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
