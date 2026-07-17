# Legacy 旧方案

这里保存已经退出主流程、但仍可用于对照的代码：

- `pygame_gamepad/`：通过 pygame 直接读取手柄并控制 MuJoCo；
- `models/mycobot_280_m5_simple.xml`：早期简化模型。

当前项目请从根目录运行 `run.py`。网页端手柄实现位于
`mycobot_app/static/gamepad.js`，MuJoCo 实现位于 `mycobot_app/mujoco_model.py`。
