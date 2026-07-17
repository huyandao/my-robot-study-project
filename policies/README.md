# Policies

Store exported policies here after Isaac Lab training.

Do not send a policy directly to hardware. First route policy output through a safety filter that limits:

- Joint position.
- Joint velocity.
- Per-step action delta.
- Workspace bounds.
- Emergency stop behavior.

