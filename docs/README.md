# 项目文档导航

这里集中说明哪些文档对应当前可运行代码，哪些属于后续学习路线。第一次接触项目时，
建议先运行网页主程序，再按下面顺序阅读。

## 推荐阅读顺序

1. [根 README](../README.md)：安装、启动、控制方式和项目范围。
2. [网页控制应用说明](../mycobot_app/README.md)：手柄/键盘映射、WebGL 和排障。
3. [项目代码说明与运行逻辑](project_architecture.md)：模块边界、API 和完整数据流。
4. [末端位置跟踪与 DLS 逆运动学](cartesian_ik_dls.md)：从目标点到关节指令的算法推导。
5. [MuJoCo 模型资源说明](../models/mycobot_280/README.md)：MJCF、TCP、执行器和网格。

## 当前主程序文档

| 文档 | 内容 | 与当前代码关系 |
| --- | --- | --- |
| [项目架构](project_architecture.md) | 文件职责、启动过程、输入与显示链路 | 当前实现 |
| [DLS 逆运动学](cartesian_ik_dls.md) | TCP Jacobian、阻尼、零空间和保护 | 当前实现及后续扩展 |
| [应用说明](../mycobot_app/README.md) | 网页操作、按键映射、Viewer 和排障 | 当前实现 |
| [模型说明](../models/mycobot_280/README.md) | `scene.xml` 与上游资源的关系 | 当前实现 |

## 真机与环境资料

| 文档 | 用途 |
| --- | --- |
| [真机安全检查表](safety_checklist.md) | 向真实机械臂发送指令前必须检查 |
| [macOS 第一次真机实验](mac_first_lesson.md) | 读取角度、小角度运动和停止 |
| [Ubuntu 桌面环境配置](ubuntu_desktop_setup.md) | Linux 学习环境准备 |

真实机械臂脚本位于 `mac_hw_sandbox/`，它们和网页仿真主链路彼此独立。开始动作实验
前，应先运行只读的 `read_angles.py`。

## 长期学习路线

| 文档或目录 | 状态 |
| --- | --- |
| [机器人学习路线](learning_roadmap.md) | 长期学习建议，不是启动说明 |
| [Isaac Lab 笔记](isaac_lab_notes.md) | Isaac 方向资料，尚未接入主程序 |
| `../ros2_ws/` | 可独立运行的 ROS 2 学习工作区 |
| `../isaac_ws/` | 预留工作区 |
| `../policies/` | 策略导出预留目录 |

## 文档维护约定

- 项目的唯一常规入口保持为根目录 `run.py`；
- 当前网页实现变化时，同步更新根 README、应用说明和项目架构；
- 末端控制公式或安全参数变化时，同步更新 DLS 文档；
- 实验性内容必须注明“学习”“预留”或“历史”，避免与当前主线混淆；
- 文档中的命令尽量从仓库根目录执行，不写某台电脑的绝对路径。
