# Mac First Lesson

Goal: use the MacBook as the first development and hardware-control environment.

## 1. Activate Python

```bash
cd /Users/meng/Documents/robot/robot-learning
source .venv/bin/activate
export MPLCONFIGDIR="$PWD/.matplotlib-cache"
```

Confirm imports:

```bash
python -c "import pymycobot, serial, numpy, matplotlib, jupyter; print('imports OK')"
```

## 2. Connect myCobot

Plug the myCobot 280 M5 into the Mac with USB, then list serial devices:

```bash
ls /dev/cu.*
```

Look for a device similar to:

```text
/dev/cu.usbserial-XXXX
```

Bluetooth devices are not the arm serial port.

## 3. Read Angles First

Reading angles is the first real-arm experiment because it does not command motion:

```bash
python mac_hw_sandbox/read_angles.py --port /dev/cu.usbserial-XXXX
```

Expected result: a list of six joint angles.

## 4. Only Then Move Slowly

After reading angles works, clear the workspace and run a small motion:

```bash
python mac_hw_sandbox/single_joint_jog.py --port /dev/cu.usbserial-XXXX --joint 1 --delta 3 --speed 10 --yes
```

If the motion direction is surprising, stop and do not continue.

Return to the conservative home pose only when the workspace is clear:

```bash
python mac_hw_sandbox/safe_home.py --port /dev/cu.usbserial-XXXX --speed 10 --yes
```

Emergency stop attempt over serial:

```bash
python mac_hw_sandbox/emergency_stop.py --port /dev/cu.usbserial-XXXX
```

The physical power switch is still the real emergency stop.

