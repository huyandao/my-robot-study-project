# Ubuntu Desktop Setup

Target machine: Windows desktop with RTX 2060, dual-boot Ubuntu 24.04.

## 1. Install Ubuntu

- Back up important Windows files.
- Shrink the Windows partition and leave free disk space for Ubuntu.
- Install Ubuntu 24.04 Desktop x86_64.
- During installation, keep Windows boot entry.

## 2. NVIDIA Driver Check

Install the recommended proprietary NVIDIA driver from "Additional Drivers", reboot, then verify:

```bash
nvidia-smi
```

You should see the RTX 2060 and driver version.

## 3. ROS 2 Jazzy

Use the official ROS 2 Jazzy Ubuntu installation guide, then verify:

```bash
source /opt/ros/jazzy/setup.bash
ros2 run demo_nodes_cpp talker
```

In another terminal:

```bash
source /opt/ros/jazzy/setup.bash
ros2 run demo_nodes_py listener
```

## 4. Developer Tools

```bash
sudo apt update
sudo apt install -y git python3-pip python3-venv python3-colcon-common-extensions python3-rosdep
sudo rosdep init
rosdep update
```

## 5. VS Code Remote SSH

From the MacBook, connect to the Ubuntu desktop with VS Code Remote SSH. Keep the repo in one location on Ubuntu and use Git to sync with the Mac.

## 6. Isaac Sim and Isaac Lab

Install Isaac Sim only after NVIDIA driver and ROS 2 are confirmed. Start with the official Isaac Sim examples before importing myCobot.

For RTX 2060, keep scenes small:

- Low render resolution.
- Few sensors.
- Low number of parallel environments.
- Simple reaching tasks before grasping.

