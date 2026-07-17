# robot-learning

myCobot 280 M5 的本地控制与学习项目。主程序支持：

- Chrome WebUSB 读取雷神 G30S 手柄；
- MuJoCo 仿真和独立原生 Viewer；
- 串口连接真实 myCobot（需要主动切换到真机模式）。

## 项目结构

```text
robot-learning/
├── run.py                         # 唯一主入口
├── mycobot_app/                   # 当前应用代码
│   ├── server.py                  # HTTP API 和网页静态文件服务
│   ├── mujoco_model.py            # MuJoCo 模型控制、仿真、原生 Viewer
│   ├── real_robot.py              # 真实机械臂串口通信
│   └── static/
│       ├── index.html             # 网页结构
│       ├── app.js                 # 页面交互
│       ├── gamepad.js             # G30S 识别、WebUSB 通信、输入解析
│       └── styles.css             # 页面样式
├── models/mycobot_280/            # MuJoCo 模型和网格资源
│   ├── scene.xml                  # 本项目实际加载的模型入口
│   └── upstream/                  # Elephant Robotics 上游模型资源
├── mac_hw_sandbox/                # 真机安全脚本和公共安全限制
├── legacy/                        # 已退出主流程的旧方案，仅供参考
├── docs/                          # 学习与环境配置文档
├── ros2_ws/                       # ROS 2 工作区
├── isaac_ws/                      # Isaac Sim / Isaac Lab 资料
└── requirements-mac.txt           # macOS Python 依赖
```

日常使用只需要先看 `run.py` 和 `mycobot_app/`。`legacy/` 不参与网页控制。

## 启动项目

首次安装：

```bash
cd /Users/meng/Documents/robot/robot-learning
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -r requirements-mac.txt
```

以后每次启动只运行：

```bash
cd /Users/meng/Documents/robot/robot-learning
.venv/bin/python run.py
```

然后用桌面版 Google Chrome 打开 <http://127.0.0.1:8000>。

## G30S 与 MuJoCo

雷神 G30S 接收器在当前模式下以 Xbox 360 兼容设备 `045e:028e` 出现。
网页点击“授权并连接手柄”后，由 `mycobot_app/static/gamepad.js` 读取输入，
并且只把手柄指令发给 MuJoCo 仿真，不会发给真实机械臂。

先点击“连接模拟器”，再点击“打开 MuJoCo 原生窗口”。原生窗口支持：

- 鼠标左键拖动：旋转视角；
- 鼠标右键拖动：平移视角；
- 滚轮：缩放视角。

更完整的按键映射和排障说明见 `mycobot_app/README.md`。代码职责、模块依赖和
完整运行链路见 `docs/project_architecture.md`。

## 运行测试

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

如果系统安装了 Node.js，还可以测试 G30S 报告解析：

```bash
node tests/gamepad_report_test.mjs
```

## 真机安全

真实机械臂模式会通过串口发送动作指令。保持机械臂无负载、周围无人和障碍物，
先低速、小角度测试，并随时准备断电。手柄 WebUSB 控制被限制在仿真模式。
