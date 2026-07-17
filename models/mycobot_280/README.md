# myCobot 280 MuJoCo 模型

- `scene.xml`：应用实际加载的 MJCF 入口，加入了位置执行器、地面和相机。
- `upstream/`：Elephant Robotics 的原始模型、URDF 和网格资源。

应用中的模型路径统一定义在 `mycobot_app/mujoco_model.py`。修改模型行为时优先
编辑 `scene.xml`，不要随意改动 `upstream/`，便于以后和上游版本比较。
