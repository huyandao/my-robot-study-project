from __future__ import annotations

from typing import Iterable

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import JointState

JOINT_NAMES = [
    "joint1",
    "joint2",
    "joint3",
    "joint4",
    "joint5",
    "joint6",
]
MAX_STEP_RAD = 0.08


def clamp_step(current: Iterable[float], target: Iterable[float]) -> list[float]:
    next_positions: list[float] = []
    for now, desired in zip(current, target):
        delta = desired - now
        if delta > MAX_STEP_RAD:
            delta = MAX_STEP_RAD
        elif delta < -MAX_STEP_RAD:
            delta = -MAX_STEP_RAD
        next_positions.append(now + delta)
    return next_positions


class SimulatedJointDriver(Node):
    """Hardware-free driver used to learn ROS 2 interfaces before touching the arm."""

    def __init__(self) -> None:
        super().__init__("simulated_joint_driver")
        self.positions = [0.0] * len(JOINT_NAMES)
        self.target_positions = [0.0] * len(JOINT_NAMES)
        self.publisher = self.create_publisher(JointState, "joint_states", 10)
        self.subscription = self.create_subscription(JointState, "joint_command", self.on_joint_command, 10)
        self.timer = self.create_timer(0.05, self.publish_state)
        self.get_logger().info("Simulated myCobot joint driver started.")

    def on_joint_command(self, msg: JointState) -> None:
        if msg.name and list(msg.name) != JOINT_NAMES:
            self.get_logger().warn(f"Ignoring command with unexpected joint names: {list(msg.name)}")
            return
        if len(msg.position) != len(JOINT_NAMES):
            self.get_logger().warn(f"Ignoring command with {len(msg.position)} positions.")
            return
        self.target_positions = [float(value) for value in msg.position]

    def publish_state(self) -> None:
        self.positions = clamp_step(self.positions, self.target_positions)

        msg = JointState()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.name = JOINT_NAMES
        msg.position = self.positions
        msg.velocity = [0.0] * len(JOINT_NAMES)
        msg.effort = [0.0] * len(JOINT_NAMES)
        self.publisher.publish(msg)


def main() -> None:
    rclpy.init()
    node = SimulatedJointDriver()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()

