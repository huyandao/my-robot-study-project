# Learning Roadmap

## Week 1: Mac Python + Real Arm Basics

- Create and activate `.venv`.
- Install `requirements-mac.txt`.
- Read joint angles from myCobot.
- Run low-speed home and single-joint jog scripts.
- Keep a short experiment log.

## Week 2: Ubuntu 24.04 + ROS 2 Jazzy

- Dual-boot the Windows desktop into Ubuntu 24.04.
- Install NVIDIA driver and confirm `nvidia-smi`.
- Install ROS 2 Jazzy.
- Learn `ros2 topic`, `service`, `action`, `launch`, `param`, and `bag`.
- Build and run the starter `mycobot_driver` package.

## Weeks 3-4: URDF, RViz2, tf2, MoveIt 2

- Add or import a myCobot 280 M5 URDF/Xacro.
- Validate joint axes and limits in RViz2.
- Configure MoveIt 2 for virtual planning.
- Keep the same state and command interfaces for simulation and hardware.

## Weeks 5-6: Isaac Sim

- Install Isaac Sim on Ubuntu.
- Run official examples first.
- Import the myCobot model.
- Enable ROS 2 Bridge.
- Drive the simulated arm from ROS 2.

## Weeks 7-9: Isaac Lab Policy Training

- Start with end-effector target reaching.
- Use small environments and low parallelism on RTX 2060.
- Export a policy only after repeated stable simulation runs.

## Week 10+: Sim-to-Real

- Insert a safety filter between policy output and hardware.
- Test with low speed, no payload, and small target changes.
- Record command and state data with rosbag.

