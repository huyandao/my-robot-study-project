# myCobot 网页控制应用

## 启动

从项目根目录运行唯一入口：

```bash
cd /Users/meng/Documents/robot/robot-learning
.venv/bin/python run.py
```

在桌面版 Google Chrome 打开 <http://127.0.0.1:8000>。

## 每个文件负责什么

| 文件 | 职责 |
| --- | --- |
| `server.py` | HTTP API、静态网页服务、仿真/真机模式切换 |
| `mujoco_model.py` | MuJoCo 模型加载、关节运动、原生 Viewer |
| `real_robot.py` | 串口发现和真实 myCobot 通信 |
| `static/gamepad.js` | G30S 识别、WebUSB 连接、20 字节报告解析、手柄指令上传 |
| `static/app.js` | 页面按钮、状态、关节数据显示 |
| `static/index.html` | 页面结构 |
| `static/styles.css` | 页面样式 |

MuJoCo 模型入口是 `models/mycobot_280/scene.xml`，模型网格在同目录的
`upstream/` 中。

## 雷神 G30S

接收器当前以 Xbox 360/XInput 兼容设备 `045e:028e` 工作。WebUSB 仅在
MuJoCo 模式可用，输入不会转发给真实机械臂。

连接步骤：

1. 点击“授权并连接手柄”。
2. 在 Chrome 设备选择器中选择 `USB Controller`。
3. 授权后，页面会在需要时自动连接 MuJoCo。
4. 小幅推动摇杆，确认网页 J1-J6 数值变化。

按键映射：

| 输入 | 仿真动作 |
| --- | --- |
| 左摇杆 X / Y | J1 / J2 |
| 右摇杆 X / Y | J3 / J4 |
| 十字键上 / 下 | J5 |
| 十字键左 / 右 | J6 |
| A | 回零位 |
| B | 保持 / 恢复运动 |
| Start | 停止并保持 |

浏览器使用 `0.12` 摇杆死区。后端把速度限制到 `[-1, 1]`，把单次时间间隔
限制到 `0.1 s`，并把目标角度限制在模型执行器范围内。

## MuJoCo 原生 Viewer

网页不传输 PNG 图片。连接模拟器后点击“打开 MuJoCo 原生窗口”，后端会在
macOS 上通过 `mjpython` 启动 `mujoco_model.py`，以 25 Hz 从网页服务同步六个
关节角度。

- 左键拖动旋转；
- 右键拖动平移；
- 滚轮缩放；
- Viewer 侧边栏可调整渲染和可视化选项。

关闭原生窗口不会关闭网页服务或断开 WebUSB。

## WebUSB 排障

- 使用桌面版 Chrome，并通过 `http://127.0.0.1:8000` 或 `localhost` 访问。
- 如果设备忙，关闭占用手柄的其他网页或程序，再重新插拔接收器。
- WebUSB 授权必须由用户点击触发，不能从命令行自动完成。
- 页面占用设备期间，pygame/HID 命令行工具通常无法同时读取它。
