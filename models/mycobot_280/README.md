# myCobot 280 MuJoCo 模型

本目录包含网页主程序实际使用的 myCobot 280 M5 模型。Python MuJoCo 和浏览器 WebGL
都以这里的资源为依据，但职责不同：MuJoCo 负责物理与控制，WebGL 只同步显示状态。

## 文件关系

- `scene.xml`：本项目实际加载的 MJCF 入口；
- `upstream/`：Elephant Robotics 上游模型、URDF 和 STL 网格资源；
- `upstream/mycobot_280_m5/`: `scene.xml` 引用的机械臂 body、joint 和 geom 定义。

`scene.xml` 在上游机械臂模型基础上加入了：

- 地面、灯光和默认相机；
- 六个关节位置执行器；
- 名为 `tcp` 的工具中心 site；
- 名为 `cartesian_target` 的 mocap 目标球。

末端控制通过 `tcp` 读取位置并计算 site Jacobian。目标球只用于显示手柄/键盘积分出的
XYZ 目标，不用刚性约束拖拽机械臂。

## 代码中的使用位置

| 使用者 | 用途 |
| --- | --- |
| `mycobot_app/mujoco_model.py` | 加载 `scene.xml`，执行仿真、DLS 和原生 Viewer |
| `mycobot_app/static/mujoco_viewer.js` | 通过 `/model-assets/` 加载 7 个 STL 并复现关节层级 |
| `tests/test_mujoco_model.py` | 验证模型加载、关节控制和末端控制边界 |

应用中的模型路径统一定义在 `mycobot_app/mujoco_model.py`。修改模型行为时优先
编辑 `scene.xml`，不要随意改动 `upstream/`，便于以后和上游版本比较。若改变 body、
joint、geom 或网格路径，还必须同步检查 `mujoco_viewer.js` 中的显示层级。

## 修改后的最低检查

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
node tests/gamepad_report_test.mjs
```

还应在网页中检查零位、六关节运动、TCP 绿点与目标红点是否和原生 Viewer 一致。
