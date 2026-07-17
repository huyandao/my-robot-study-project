# myCobot 280 gamepad control

This controller moves only the MuJoCo simulation. It does not open a serial
port and cannot command the physical robot.

## Setup

The Elephant Robotics model is stored unchanged in
`models/mycobot_280/upstream/`. The wrapper scene
`models/mycobot_280/scene.xml` adds position actuators, a floor,
and lights.

Install dependencies in the project virtual environment:

```bash
cd robot-learning
source .venv/bin/activate
python -m pip install -r requirements-mac.txt
```

Connect a USB or Bluetooth gamepad and check that pygame can see it:

```bash
python legacy/pygame_gamepad/gamepad_control.py --list-gamepads
```

On macOS, launch the interactive MuJoCo viewer with `mjpython`:

```bash
.venv/bin/mjpython legacy/pygame_gamepad/gamepad_control.py
```

On Linux or Windows, use the virtual environment's normal Python executable:

```bash
python legacy/pygame_gamepad/gamepad_control.py
```

## Default mapping

| Input | Action |
| --- | --- |
| Left stick X / Y | Joint 1 / Joint 2 |
| Right stick X / Y | Joint 3 / Joint 4 |
| D-pad up / down | Joint 5 |
| D-pad left / right | Joint 6 |
| A / Cross | Return the target to the zero home pose |
| B / Circle | Toggle hold mode |
| Start / Options | Quit |

The controller applies a stick deadzone and clamps every target to the joint
limits declared by the model. Tune it if needed:

```bash
.venv/bin/mjpython legacy/pygame_gamepad/gamepad_control.py \
  --deadzone 0.16 \
  --joint-speed-deg 25
```

Raw pygame axis numbering can vary on unusual controllers. The default mapping
targets the standard four-axis layout used by common Xbox and PlayStation-style
gamepads. If your right stick is reported as axes 3 and 4, for example, run:

```bash
.venv/bin/mjpython legacy/pygame_gamepad/gamepad_control.py --axis-map 0,1,3,4
```
