from __future__ import annotations

import argparse
import math

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import JointState

from mycobot_driver.simulated_joint_driver import JOINT_NAMES


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Publish one myCobot joint command.")
    parser.add_argument(
        "--degrees",
        nargs=6,
        type=float,
        metavar=("J1", "J2", "J3", "J4", "J5", "J6"),
        required=True,
        help="Six joint targets in degrees.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rclpy.init()
    node = Node("send_joint_command")
    publisher = node.create_publisher(JointState, "joint_command", 10)

    msg = JointState()
    msg.header.stamp = node.get_clock().now().to_msg()
    msg.name = JOINT_NAMES
    msg.position = [math.radians(value) for value in args.degrees]

    for _ in range(5):
        publisher.publish(msg)
        rclpy.spin_once(node, timeout_sec=0.1)

    node.get_logger().info(f"Published joint command in degrees: {args.degrees}")
    node.destroy_node()
    rclpy.shutdown()


if __name__ == "__main__":
    main()

