from __future__ import annotations

import argparse

from mycobot_safe import (
    SAFE_HOME_DEGREES,
    add_connection_args,
    add_motion_args,
    connect,
    require_motion_confirmation,
    send_angles_and_wait,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Move myCobot 280 M5 to a conservative home pose.")
    add_connection_args(parser)
    add_motion_args(parser)
    args = parser.parse_args()

    require_motion_confirmation(args, f"move to {SAFE_HOME_DEGREES}")
    mc = connect(args)
    send_angles_and_wait(mc, SAFE_HOME_DEGREES, args.speed)


if __name__ == "__main__":
    main()

