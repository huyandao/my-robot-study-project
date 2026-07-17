from __future__ import annotations

import argparse

from mycobot_safe import add_connection_args, connect, get_angles_or_exit


def main() -> None:
    parser = argparse.ArgumentParser(description="Read myCobot 280 M5 joint angles without commanding motion.")
    add_connection_args(parser)
    args = parser.parse_args()

    mc = connect(args)
    print(get_angles_or_exit(mc))


if __name__ == "__main__":
    main()

