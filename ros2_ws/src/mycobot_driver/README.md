# mycobot_driver

Starter ROS 2 package for learning the interface before connecting real hardware.

## Build

```bash
cd robot-learning/ros2_ws
source /opt/ros/jazzy/setup.bash
rosdep install --from-paths src --ignore-src -r -y
colcon build --symlink-install
source install/setup.bash
```

## Run

```bash
ros2 launch mycobot_driver simulated_driver.launch.py
```

Publish a command in radians:

```bash
ros2 topic pub --once /joint_command sensor_msgs/msg/JointState "{name: [joint1, joint2, joint3, joint4, joint5, joint6], position: [0.1, 0.0, 0.0, 0.0, 0.0, 0.0]}"
```

Or publish a command in degrees:

```bash
ros2 run mycobot_driver send_joint_command --degrees 5 0 0 0 0 0
```

Read state:

```bash
ros2 topic echo /joint_states
```
