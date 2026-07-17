# myCobot Safety Checklist

Use this before every real-arm run.

## Before Power On

- The arm is unloaded unless the task explicitly needs a payload.
- The workspace is clear.
- The USB cable is secure and not tangled with the arm.
- You know how to cut power immediately.
- The script has the expected serial port and baud rate.

## Before Motion

- Start with read-only scripts first.
- Use low speed: `10` to `20` for first tests.
- Use small joint deltas: `5` degrees or less for first tests.
- Keep joint commands within conservative limits.
- Keep your hands outside the reachable workspace.

## After Motion

- Record what command was sent and what happened.
- Stop immediately if motion direction differs from expectation.
- Do not run learned policies on hardware until they pass repeated simulation tests.

