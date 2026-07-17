# Isaac Sim and Isaac Lab Notes

## First Isaac Sim Milestone

- Launch Isaac Sim successfully on Ubuntu.
- Open an official robot articulation example.
- Confirm GPU usage with `nvidia-smi`.
- Enable ROS 2 Bridge.
- Confirm ROS 2 messages move between Isaac Sim and ROS 2 Jazzy.

## myCobot Import Checklist

- Joint names match ROS 2 driver names.
- Joint axes are correct.
- Joint limits match the real arm.
- Collision bodies are simple and stable.
- Base frame orientation is documented.

## First Training Task

Task: end-effector reaches a target point.

- Observation: joint positions, joint velocities, target position, end-effector position.
- Action: joint position delta or joint velocity.
- Reward: distance reduction, final distance, smooth action, joint-limit penalty.
- Done: timeout, target reached, unsafe state.

## Sim-to-Real Gate

Do not run a policy on hardware until:

- It succeeds in simulation at least 100 consecutive attempts.
- It passes randomized target positions.
- Its action output stays within the hardware safety filter.
- A human can stop the robot immediately during first hardware tests.

