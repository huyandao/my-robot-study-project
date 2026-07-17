# 项目代码说明与运行逻辑

本文解释当前主程序的代码职责、模块依赖和一条控制指令从手柄到 MuJoCo 的完整
运行过程。主程序入口只有根目录的 `run.py`。

## 1. 总体结构

```text
run.py
  └── mycobot_app/server.py
        ├── mycobot_app/mujoco_model.py
        │     └── models/mycobot_280/scene.xml + upstream/
        ├── mycobot_app/real_robot.py
        │     └── mac_hw_sandbox/mycobot_safe.py
        └── mycobot_app/static/
              ├── index.html
              ├── app.js
              ├── gamepad.js
              └── styles.css
```

核心原则是把“输入设备”“仿真”“真机通信”“页面”“网络路由”分开。修改手柄协议
时不需要碰 MuJoCo，修改模型时也不需要碰网页 USB 代码。

## 2. 各文件职责

### `run.py`

项目唯一启动入口。它只导入并调用 `mycobot_app.server.main()`，保持启动命令稳定，
以后内部文件再调整也不影响用户运行方式。

### `mycobot_app/server.py`

轻量 HTTP 服务和总调度层：

- 把 `static/` 中的网页文件发送给 Chrome；
- 提供 `/api/connect`、`/api/status`、`/api/gamepad` 等接口；
- 用 `ControlSession` 记录当前是 MuJoCo 模式还是真机模式；
- 把请求转交给 `MujocoModel` 或 `RealRobotSession`；
- 管理独立 MuJoCo Viewer 进程。

这里不解析手柄二进制报告，也不直接实现 MuJoCo 关节运动。

### `mycobot_app/mujoco_model.py`

所有 MuJoCo 相关 Python 逻辑：

- 从 `models/mycobot_280/scene.xml` 加载模型；
- 创建和维护 `MjModel`、`MjData`；
- 读取角度、点动、回零、停止；
- 把六维手柄速度积分为关节目标角度；
- 限制时间步长、速度和执行器角度范围；
- 用 `NativeViewer` 启动独立原生 Viewer；
- Viewer 以 25 Hz 读取 `/api/status`，同步网页仿真中的六个关节。

`MujocoModel` 内部使用锁，避免网页状态请求和手柄控制请求同时改写仿真数据。

### `mycobot_app/real_robot.py`

真实机械臂串口层：

- 枚举 macOS `/dev/cu.*` 和 `/dev/tty.*` 串口；
- 通过 `pymycobot.MyCobot280` 建立连接；
- 读取/发送角度、点动、停止、释放舵机；
- 调用 `mac_hw_sandbox/mycobot_safe.py` 中的速度和角度安全限制。

手柄 API 在 `server.py` 中被明确限制为只可调用 `MujocoModel`，不会进入这个文件。

### `mycobot_app/static/gamepad.js`

雷神 G30S 的独立跨平台浏览器驱动：

- 识别 USB VID/PID `045e:028e`；
- Windows 通过标准 Gamepad API 识别并轮询 XInput 手柄；
- macOS/Linux 请求 Chrome WebUSB 授权、寻找 IN endpoint、读取数据；
- 解析 Xbox 360 兼容的 20 字节输入报告；
- 对摇杆应用 `0.12` 死区；
- 把摇杆和十字键映射成 J1-J6 六维速度；
- 处理 A 回零、B 保持/恢复、Start 停止；
- 每隔约 40 ms 调用 `/api/gamepad`；
- 处理设备拔出、读取停止和 USB 释放。

### `mycobot_app/static/app.js`

页面控制器，只负责普通 UI 和 HTTP 通信：

- 连接/断开仿真或真机；
- 显示六关节角度和 TCP 坐标；
- 发送角度、点动、回零、停止；
- 打开 Viewer、显示 Viewer 状态；
- 创建 `G30SController`，接收它的状态回调并更新页面。

### 其他资源

- `static/index.html`：网页元素和面板结构；
- `static/styles.css`：布局和视觉样式；
- `models/mycobot_280/scene.xml`：实际加载的 MJCF 入口；
- `models/mycobot_280/upstream/`：上游模型和网格；
- `legacy/`：旧 pygame 方案和简化模型，不参与主程序。

## 3. 启动过程

```text
用户运行 start_windows.bat 或 start_macos_linux.sh
  -> 首次运行创建本机 .venv 并安装 requirements.txt
  -> run.py 调用 server.main()
  -> 创建全局 ControlSession 和 NativeViewer
  -> ThreadingHTTPServer 监听 127.0.0.1:8000
  -> Chrome 打开首页
  -> server.py 返回 index.html、app.js、gamepad.js、styles.css
  -> app.js 读取当前状态、串口列表和 Viewer 状态
```

初始模式是 MuJoCo 仿真，但模型在用户点击连接或连接手柄时才真正加载。

## 4. 手柄控制 MuJoCo 的运行链路

```text
G30S 接收器
  -> Windows: Chrome/Edge Gamepad API 轮询 XInput
     macOS/Linux: Chrome WebUSB transferIn()
  -> gamepad.js 统一解析成六维输入
  -> 六维关节速度 [J1, J2, J3, J4, J5, J6]
  -> POST /api/gamepad
  -> server.py 的 ControlSession.apply_gamepad()
  -> MujocoModel.apply_gamepad()
  -> 速度 × 时间 = 本次目标角度变化
  -> 执行器范围限幅 + mj_step()
  -> 返回角度和 TCP 坐标
  -> app.js 更新网页数值
```

如果当前连接的是真实机械臂，`ControlSession.apply_gamepad()` 会直接拒绝请求。这是
手柄输入不会误发给真机的关键边界。

## 5. 原生 Viewer 同步逻辑

```text
网页点击“打开 MuJoCo 原生窗口”
  -> POST /api/viewer/open
  -> NativeViewer 启动 mjpython 子进程
  -> 子进程创建 MuJoCo 原生 OpenGL 窗口
  -> 每 40 ms GET /api/status
  -> 把六个角度写入 Viewer 的 qpos 和 ctrl
  -> mj_forward() + viewer.sync()
```

网页服务维护的是控制仿真，原生 Viewer 是交互显示进程。关闭 Viewer 不会关闭网页、
仿真状态或浏览器手柄连接。

## 6. 真机运行链路

```text
网页切换“真实机械臂”并选择串口
  -> POST /api/connect { mode: "real", port, baud }
  -> ControlSession 选择 RealRobotSession
  -> pymycobot 连接串口
  -> 后续角度/点动请求经过安全范围检查
  -> 向真实机械臂发送命令
```

切换模式前必须先断开现有连接。真机回零、释放舵机等高风险动作在页面还有二次确认。

## 7. 修改代码时去哪里

| 想修改的内容 | 文件 |
| --- | --- |
| G30S Windows/XInput、VID/PID、报告格式、按键映射 | `mycobot_app/static/gamepad.js` |
| 页面按钮、数据显示、API 调用 | `mycobot_app/static/app.js` |
| 页面布局 | `mycobot_app/static/index.html`、`styles.css` |
| MuJoCo 关节运动和 Viewer 相机默认视角 | `mycobot_app/mujoco_model.py` |
| 机械臂几何、执行器、灯光、地面 | `models/mycobot_280/scene.xml` |
| HTTP API | `mycobot_app/server.py` |
| 真机串口通信 | `mycobot_app/real_robot.py` |
| 通用真机角度/速度安全限制 | `mac_hw_sandbox/mycobot_safe.py` |

## 8. 测试

运行 Python 模型测试：

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
# Windows 使用 .venv\Scripts\python
```

运行 G30S 报告解析测试（需要 Node.js）：

```bash
node tests/gamepad_report_test.mjs
```

浏览器 Gamepad/WebUSB 设备发现和原生 OpenGL 窗口依赖真实桌面与设备，最终仍需在 Chrome/Edge 中
各点击一次确认。
