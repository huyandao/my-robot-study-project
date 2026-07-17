from __future__ import annotations

import argparse

from mycobot_safe import add_connection_args, connect, stop_robot


def main() -> None:
    parser = argparse.ArgumentParser(description="Try to stop/pause myCobot motion over serial.")
    add_connection_args(parser)
    args = parser.parse_args()

    mc = connect(args)
    stop_robot(mc)


if __name__ == "__main__":
    main()

