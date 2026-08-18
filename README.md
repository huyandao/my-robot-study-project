# robot-learning

myCobot 280 M5 的本地控制与学习项目。主程序支持：

- Chrome/Edge 跨平台读取雷神 G30S 手柄（Windows XInput，macOS/Linux WebUSB）；
- 可在游戏手柄和电脑键盘之间选择输入设备；
- 可在六关节控制与末端 XYZ 跟随之间切换；
- 网页 WebGL 实时显示 MuJoCo 控制的 myCobot 280，并保留可选原生 Viewer；
- 串口连接真实 myCobot（需要主动切换到真机模式）。

## 项目结构

```text
my-robot-study-project/
├── run.py                         # 唯一主入口
├── start_windows.bat              # Windows 一键创建环境并启动
├── start_macos_linux.sh           # macOS/Linux 一键创建环境并启动
├── requirements.txt               # 主程序固定版本依赖
├── mycobot_app/                   # 当前应用代码
│   ├── server.py                  # HTTP API 和网页静态文件服务
│   ├── mujoco_model.py            # MuJoCo 模型控制、仿真、原生 Viewer
│   ├── real_robot.py              # 真实机械臂串口通信
│   └── static/
│       ├── index.html             # 网页结构
│       ├── app.js                 # 页面交互
│       ├── gamepad.js             # G30S 跨平台识别、通信和输入解析
│       ├── keyboard.js            # 键盘六关节控制和失焦安全释放
│       ├── mujoco_viewer.js        # 网页 WebGL 机械臂实时视图
│       └── styles.css             # 页面样式
├── models/mycobot_280/            # MuJoCo 模型和网格资源
│   ├── scene.xml                  # 本项目实际加载的模型入口
│   └── upstream/                  # Elephant Robotics 上游模型资源
├── mac_hw_sandbox/                # 真机安全脚本和公共安全限制
├── legacy/                        # 已退出主流程的旧方案，仅供参考
├── docs/                          # 学习与环境配置文档
├── ros2_ws/                       # ROS 2 工作区
├── isaac_ws/                      # Isaac Sim / Isaac Lab 资料
└── requirements-mac.txt           # 额外学习/旧版工具依赖
```

日常使用只需要先看 `run.py` 和 `mycobot_app/`。`legacy/` 不参与网页控制。

## 换电脑后启动

不要复制或提交某台电脑生成的 `.venv`：里面包含操作系统相关二进制和本机绝对路径。
仓库提供固定依赖和一键脚本，每台电脑会自动生成自己的 `.venv`。首次启动需要联网
下载依赖，并且需要预先安装 Python 3.11。

Windows：

```bat
git clone https://github.com/huyandao/my-robot-study-project.git
cd my-robot-study-project
start_windows.bat
```

也可以在资源管理器里双击 `start_windows.bat`。G30S 请使用 XInput/Xbox 模式，
浏览器建议使用 Chrome 或 Edge。

macOS/Linux：

```bash
git clone https://github.com/huyandao/my-robot-study-project.git
cd my-robot-study-project
./start_macos_linux.sh
```

脚本首次运行会创建 `.venv` 并安装 `requirements.txt`，以后会直接启动。服务启动后
打开 <http://127.0.0.1:8000>。

如果希望手动安装：

```bash
python3.11 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
python -m pip install -r requirements.txt
python run.py
```

## G30S 与 MuJoCo

雷神 G30S 接收器在当前模式下以 Xbox 360 兼容设备 `045e:028e` 出现。
网页点击“检测并连接手柄”后，由 `mycobot_app/static/gamepad.js` 读取输入。
Windows 使用浏览器 Gamepad API 读取 XInput，macOS/Linux 保留 WebUSB，
并且只把手柄指令发给 MuJoCo 仿真，不会发给真实机械臂。

网页控制顺序固定为：

1. 选择“游戏手柄”或“电脑键盘”；
2. 选择“机械臂六个轴”或“机械臂末端位置”；
3. 点击“启动手柄控制”或“启动键盘控制”。

第三步会在需要时自动连接后端 MuJoCo，网页中央的 WebGL 窗口随即显示并同步机械臂。

手柄面板提供两种控制方式：

- `六关节控制`：保持原有 J1-J6 映射；
- `末端 XYZ 跟随`：左摇杆控制世界坐标 X/Y，右摇杆上下控制 Z。后端积分目标点，
  使用 TCP Jacobian 和阻尼最小二乘逆运动学驱动六个位置执行器。

末端模式中按 A 会把目标点重置到当前 TCP。MuJoCo 原生 Viewer 中的红色球表示
目标坐标，绿色点表示实际 TCP。

选择“电脑键盘”和“机械臂六个轴”时：`A/D` 控制 J1，`S/W` 控制 J2，
`J/L` 控制 J3，`K/I` 控制 J4，上下方向键控制 J5，左右方向键控制 J6。每组
前一个按键是负方向，后一个按键是正方向；松开按键或切出浏览器窗口会停止增量。

选择“电脑键盘”和“机械臂末端位置”时：`A/D`、`S/W`、`K/I` 分别控制世界
坐标 X、Y、Z。游戏手柄和键盘都可以在六轴/末端两种目标之间切换。

网页中央使用 WebGL 直接加载与 MuJoCo 模型相同的 7 个 STL 网格，并按后端返回的
实际关节角度实时绘制，不使用 PNG 截图或视频流。物理、执行器和逆运动学仍由后端
MuJoCo 运行。

网页三维视图支持：

- 鼠标左键拖动：旋转视角；
- 鼠标右键或 Shift+左键拖动：平移视角；
- 滚轮：缩放视角。

如需 MuJoCo 自带的可视化菜单，仍可点击“另开 MuJoCo 原生窗口”。

更完整的按键映射和排障说明见 `mycobot_app/README.md`。代码职责、模块依赖和
完整运行链路见 `docs/project_architecture.md`。

## 运行测试

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'  # Windows 使用 .venv\Scripts\python
```

如果系统安装了 Node.js，还可以测试 G30S 报告解析：

```bash
node tests/gamepad_report_test.mjs
```

## 真机安全

真实机械臂模式会通过串口发送动作指令。保持机械臂无负载、周围无人和障碍物，
先低速、小角度测试，并随时准备断电。浏览器手柄控制被限制在仿真模式。
