from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description() -> LaunchDescription:
    return LaunchDescription(
        [
            Node(
                package="mycobot_driver",
                executable="simulated_joint_driver",
                name="simulated_joint_driver",
                output="screen",
            )
        ]
    )

