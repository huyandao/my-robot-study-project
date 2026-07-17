from __future__ import annotations

import argparse

from mycobot_safe import (
    JOINT_COUNT,
    add_connection_args,
    add_motion_args,
    connect,
    get_angles_or_exit,
    require_motion_confirmation,
    send_angles_and_wait,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Jog one myCobot joint by a small delta in degrees.")
    add_connection_args(parser)
    add_motion_args(parser)
    parser.add_argument("--joint", type=int, required=True, help="1-based joint index, 1 through 6")
    parser.add_argument("--delta", type=float, required=True, help="Delta in degrees. Limited to +/-5 for early tests")
    args = parser.parse_args()

    if not 1 <= args.joint <= JOINT_COUNT:
        raise SystemExit(f"--joint must be between 1 and {JOINT_COUNT}")
    if abs(args.delta) > 5.0:
        raise SystemExit("--delta is limited to +/-5 degrees for early learning")

    require_motion_confirmation(args, f"jog joint {args.joint} by {args.delta} degrees")
    mc = connect(args)
    angles = get_angles_or_exit(mc)
    angles[args.joint - 1] += args.delta
    send_angles_and_wait(mc, angles, args.speed)


if __name__ == "__main__":
    main()

