# my-robot-study-project

面向 myCobot 280 M5 的 MuJoCo 仿真、网页遥操作和机器人学习项目。当前主程序在
Python 后端运行 MuJoCo，在浏览器中显示同一机械臂模型，并支持先选择输入设备，再
选择控制目标：

- 输入设备：雷神 G30S 游戏手柄或电脑键盘；
- 控制目标：六个关节或末端世界坐标 XYZ；
- 可视化：网页 WebGL 实时视图，以及可选的 MuJoCo 原生 Viewer；
- 扩展实验：真实机械臂串口、ROS 2 和 Isaac 学习资料。

> 默认和推荐使用 MuJoCo 仿真。切换到真实机械臂会发送实际运动指令，操作前请先
> 阅读[真机安全检查表](docs/safety_checklist.md)。

## 当前项目范围

| 部分 | 状态 | 说明 |
| --- | --- | --- |
| `run.py` + `mycobot_app/` | 当前主线 | 网页控制、MuJoCo、键盘/手柄、末端 DLS 控制 |
| `models/mycobot_280/` | 当前主线 | 应用实际加载的 MJCF 和 STL 资源 |
| `tests/` | 当前主线 | Python 控制器测试和 JavaScript 输入/视图测试 |
| `mac_hw_sandbox/` | 独立实验 | 真实机械臂的保守串口测试脚本 |
| `ros2_ws/` | 学习实验 | 简单的 ROS 2 模拟驱动，不参与网页主程序 |
| `isaac_ws/`、`policies/` | 预留目录 | 后续 Isaac Lab 和策略导出方向 |
| `legacy/` | 历史代码 | 已退出主流程，仅供比较和学习 |

日常运行不需要进入 `legacy/`、`ros2_ws/` 或 `isaac_ws/`。

## 快速开始

需要 Python 3.11。首次启动需要联网安装依赖，但不应复制或提交某台电脑生成的
`.venv`，因为虚拟环境包含系统相关二进制和本机绝对路径。

Windows：

```bat
git clone https://github.com/huyandao/my-robot-study-project.git
cd my-robot-study-project
start_windows.bat
```

macOS/Linux：

```bash
git clone https://github.com/huyandao/my-robot-study-project.git
cd my-robot-study-project
./start_macos_linux.sh
```

脚本会创建 `.venv`、安装 `requirements.txt`，然后启动服务。浏览器访问
<http://127.0.0.1:8000>。

手动启动：

```bash
python3.11 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
python -m pip install -r requirements.txt
python run.py
```

## 网页控制方法

网页按固定的三步操作：

1. 选择“游戏手柄”或“电脑键盘”；
2. 选择“机械臂六个轴”或“机械臂末端位置”；
3. 点击“第 3 步 · 启动手柄控制”或“第 3 步 · 启动键盘控制”。

四种组合都可使用：

| 输入设备 | 六关节控制 | 末端 XYZ 控制 |
| --- | --- | --- |
| 游戏手柄 | 双摇杆 + 十字键控制 J1-J6 | 左摇杆控制 X/Y，右摇杆上下控制 Z |
| 键盘 | `A/D`、`S/W`、`J/L`、`K/I`、方向键控制 J1-J6 | `A/D`、`S/W`、`K/I` 控制 X/Y/Z |

G30S 在 Windows 上使用浏览器 Gamepad API 读取 XInput，在 macOS/Linux 上使用
Chrome/Edge WebUSB。手柄和键盘遥操作都被后端限制在 MuJoCo 模式，不会转发给
真实机械臂。具体映射、连接方式和排障见 [网页控制应用说明](mycobot_app/README.md)。

末端模式并不是把摇杆直接映射成绝对坐标。输入先形成目标点速度并积分为 XYZ 目标，
后端再用 TCP Jacobian 和阻尼最小二乘（DLS）逆运动学求关节速度。当前版本只控制
位置，不控制末端姿态。算法推导见[末端位置跟踪与 DLS 逆运动学](docs/cartesian_ik_dls.md)。

## 网页视图与 MuJoCo 的关系

```text
键盘 / G30S
    -> 浏览器控制器
    -> HTTP API
    -> Python MuJoCo（物理、执行器、Jacobian、DLS）
    -> 关节角、TCP 和目标点状态
    -> 浏览器 WebGL 实时绘制
```

网页中央不是 PNG、视频流，也不是另一套 MuJoCo。它加载与 MJCF 相同的 7 个 STL，
根据后端返回的真实仿真状态绘制模型；Python MuJoCo 是物理和逆运动学的唯一状态源。
需要 MuJoCo 自带菜单时，可点击“打开 MuJoCo 原生窗口”。

网页三维视角：左键拖动旋转，右键或 `Shift + 左键` 平移，滚轮缩放。

## 目录结构

```text
my-robot-study-project/
├── run.py                         # 唯一主入口
├── start_windows.bat              # Windows 一键启动
├── start_macos_linux.sh           # macOS/Linux 一键启动
├── requirements.txt               # 主程序固定版本依赖
├── requirements-mac.txt           # 可选学习工具依赖
├── mycobot_app/                   # 当前网页应用
│   ├── server.py                  # HTTP API、静态资源、模式调度
│   ├── mujoco_model.py            # 仿真、关节控制、DLS、原生 Viewer
│   ├── real_robot.py              # 真实机械臂串口通信
│   └── static/                    # HTML、CSS、输入控制器和 WebGL 视图
├── models/mycobot_280/            # scene.xml、上游 MJCF/URDF、STL
├── tests/                         # Python 与 Node.js 测试
├── docs/                          # 架构、算法、环境和学习文档
├── mac_hw_sandbox/                # 真机只读/小范围运动实验
├── ros2_ws/                       # ROS 2 学习工作区
├── isaac_ws/                      # Isaac 学习预留目录
├── policies/                      # 策略导出预留目录
└── legacy/                        # 历史实现，不参与当前运行
```

## 文档导航

完整索引和推荐阅读顺序见 [docs/README.md](docs/README.md)。核心资料：

- [项目代码说明与运行逻辑](docs/project_architecture.md)
- [末端位置跟踪与 DLS 逆运动学](docs/cartesian_ik_dls.md)
- [MuJoCo 模型资源说明](models/mycobot_280/README.md)
- [真机安全检查表](docs/safety_checklist.md)

## 测试

Python 测试：

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
# Windows 使用 .venv\Scripts\python
```

如果安装了 Node.js，还可测试 G30S 报告解析、键盘映射、末端请求和 WebGL 模型逻辑：

```bash
node tests/gamepad_report_test.mjs
```

浏览器设备授权和原生 OpenGL 窗口仍需在目标电脑上人工验证。

## 已知边界与下一步

- 末端模式当前只跟踪世界坐标 XYZ，尚未控制工具姿态；
- 网页 WebGL 是 MuJoCo 状态的实时镜像，不在浏览器中重复执行物理仿真；
- ROS 2、Isaac Lab 和策略目录尚未接入网页主程序；
- 真实机械臂功能必须先做只读验证，再从低速度、小角度动作开始。

推荐的末端控制演进路线是：`XYZ 位置控制 -> XYZ + 固定姿态 -> 完整六自由度位姿控制`。
