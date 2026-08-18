# 项目代码说明与运行逻辑

本文解释当前主程序的代码职责、模块依赖，以及键盘或手柄指令进入 MuJoCo、再同步
到网页 WebGL 的完整过程。主程序入口只有根目录的 `run.py`。

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
              ├── keyboard.js
              ├── mujoco_viewer.js
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
- 通过 `/model-assets/` 安全地发送 myCobot 280 STL 给网页 WebGL；
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
- 把 XYZ 目标速度积分为空间目标点；
- 用 TCP 平动 Jacobian 和 DLS 逆运动学计算关节速度；
- 实施工作空间、目标距离、关节速度、关节限位和奇异性保护；
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
- 末端模式调用 `/api/gamepad/cartesian`，发送世界坐标 XYZ 速度；
- 处理设备拔出、读取停止和 USB 释放。

### `mycobot_app/static/app.js`

页面控制器，负责 UI、输入控制器调度和 HTTP 通信：

- 连接/断开仿真或真机；
- 管理“输入设备 -> 控制目标 -> 启动”的三步选择；
- 显示六关节角度和 TCP 坐标；
- 发送角度、点动、回零、停止；
- 打开 Viewer、显示 Viewer 状态；
- 创建并互斥启停 `G30SController` 与 `KeyboardController`；
- 创建 `MujocoWebViewer`，把后端状态同步到网页三维视图。

### `mycobot_app/static/keyboard.js`

键盘六关节控制器：

- 把 `A/D`、`S/W`、`J/L`、`K/I`、上下和左右方向键映射为 J1-J6；
- 多键同时按下时组合六维速度，相反方向同时按下时互相抵消；
- 每隔约 40 ms 复用 `/api/gamepad` 发送关节速度；
- 松键、窗口失焦或页面隐藏时清空输入；
- 忽略输入框、下拉框和文本编辑区域中的按键。

末端模式下将 `A/D`、`S/W`、`K/I` 映射为世界坐标 X、Y、Z，并调用与手柄相同
的笛卡尔控制接口。

### `mycobot_app/static/mujoco_viewer.js`

网页实时三维视图：

- 通过 `/model-assets/` 加载 `scene.xml` 使用的 7 个 STL；
- 在 WebGL2 中复现 MJCF body/joint/geom 层级变换；
- 使用后端 MuJoCo 返回的实际关节角绘制机械臂；
- 显示实际 TCP 绿点和笛卡尔目标红点；
- 提供旋转、平移和缩放视角交互。

它不在网页重复运行物理引擎；Python MuJoCo 是唯一物理与 IK 状态源，WebGL 只负责
把这份状态实时显示出来，因此无需传输 PNG 或视频帧。

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
  -> server.py 返回 index.html、app.js、gamepad.js、keyboard.js、mujoco_viewer.js、styles.css
  -> app.js 读取当前状态、串口列表和 Viewer 状态
```

初始模式是 MuJoCo 仿真，但模型在用户手动连接，或完成第三步启动键盘/手柄控制时
才真正加载。

## 4. 输入设备控制 MuJoCo 的运行链路

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

末端 XYZ 模式使用平行链路：

```text
左摇杆 X/Y + 右摇杆上下 Z
  -> gamepad.js 映射为世界坐标 linear_velocity
  -> POST /api/gamepad/cartesian
  -> 积分 cartesian_target
  -> mj_jacSite() 计算 tcp 平动 Jacobian
  -> DLS: Jᵀ(JJᵀ + λ²I)⁻¹
  -> 关节速度/限位/奇异性保护
  -> data.ctrl + mj_step()
  -> 返回实际 TCP、目标坐标和 Jacobian 状态
```

切换到末端模式或按 A 时，目标点从当前 TCP 重新初始化，因此不会因历史目标产生跳变。
完整算法说明见 [`cartesian_ik_dls.md`](cartesian_ik_dls.md)。

键盘模式复用同一套后端控制链路：

```text
用户选择“电脑键盘”与控制目标，然后点击第 3 步启动
  -> app.js 停用 G30S，并启用 KeyboardController
  -> keyboard.js 监听六组按键
  -> 六关节模式生成 [J1, J2, J3, J4, J5, J6] 并 POST /api/gamepad
     末端模式生成 [X, Y, Z] 并 POST /api/gamepad/cartesian
  -> 与手柄对应模式共用限速、限位、DLS 和 mj_step()
```

`/api/gamepad` 这个名称来自最早的手柄版本。键盘关节控制也复用它，因为后端接收的是
与设备无关的六维方向量；它不表示后端只支持游戏手柄。

## 5. 网页 WebGL 与原生 Viewer

网页 WebGL 是默认显示方式：

```text
app.js 定期或在控制响应后得到 /api/status
  -> 读取 angles、tcp、cartesian_target 和控制模式
  -> mujoco_viewer.js 根据 angles 计算 MJCF 关节层级变换
  -> 绘制 7 个 STL、TCP 绿点和目标红点
```

这里没有第二套动力学，也没有 PNG 截图流。`mujoco_viewer.js` 只复现显示所需的模型
层级，所有物理、执行器和逆运动学状态都来自 Python MuJoCo。

原生 Viewer 是可选的独立显示进程：

```text
网页点击“打开 MuJoCo 原生窗口”
  -> POST /api/viewer/open
  -> NativeViewer 启动 mjpython 子进程
  -> 子进程创建 MuJoCo 原生 OpenGL 窗口
  -> 每 40 ms GET /api/status
  -> 把六个角度写入 Viewer 的 qpos 和 ctrl
  -> mj_forward() + viewer.sync()
```

网页服务维护的是控制仿真，原生 Viewer 是交互显示进程。关闭原生 Viewer 不会关闭
网页、仿真状态或浏览器输入控制器。

## 6. 主要 HTTP 接口

| 接口 | 用途 |
| --- | --- |
| `GET /api/status` | 当前模式、连接状态、关节角、TCP、末端目标 |
| `GET /api/ports` | 可用串口 |
| `POST /api/connect` | 连接 MuJoCo 或真实机械臂 |
| `POST /api/gamepad` | 与输入设备无关的六关节速度指令 |
| `POST /api/gamepad/mode` | 切换关节/末端控制模式 |
| `POST /api/gamepad/cartesian` | 末端 XYZ 速度指令 |
| `POST /api/gamepad/cartesian/reset` | 把末端目标重置为当前 TCP |
| `POST /api/send_angles`、`/api/jog` | 页面角度命令和单关节点动 |
| `POST /api/stop`、`/api/home` | 停止和回零 |
| `POST /api/viewer/open` | 打开 MuJoCo 原生 Viewer |

`server.py` 还通过 `/model-assets/` 提供限定目录内的 STL 文件。接口的请求字段和边界
校验以 `server.py` 为准。

## 7. 真机运行链路

```text
网页切换“真实机械臂”并选择串口
  -> POST /api/connect { mode: "real", port, baud }
  -> ControlSession 选择 RealRobotSession
  -> pymycobot 连接串口
  -> 后续角度/点动请求经过安全范围检查
  -> 向真实机械臂发送命令
```

切换模式前必须先断开现有连接。真机回零、释放舵机等高风险动作在页面还有二次确认。

## 8. 修改代码时去哪里

| 想修改的内容 | 文件 |
| --- | --- |
| G30S Windows/XInput、VID/PID、报告格式、按键映射 | `mycobot_app/static/gamepad.js` |
| 键盘映射、按键循环和失焦释放 | `mycobot_app/static/keyboard.js` |
| 页面按钮、模式选择、数据显示、API 调用 | `mycobot_app/static/app.js` |
| 页面布局 | `mycobot_app/static/index.html`、`styles.css` |
| 网页三维模型层级、相机和交互 | `mycobot_app/static/mujoco_viewer.js` |
| MuJoCo 关节运动、DLS 和原生 Viewer | `mycobot_app/mujoco_model.py` |
| 末端跟踪、Jacobian 和 DLS 学习说明 | `docs/cartesian_ik_dls.md` |
| 机械臂几何、执行器、灯光、地面 | `models/mycobot_280/scene.xml` |
| HTTP API | `mycobot_app/server.py` |
| 真机串口通信 | `mycobot_app/real_robot.py` |
| 通用真机角度/速度安全限制 | `mac_hw_sandbox/mycobot_safe.py` |
| Python 控制器测试 | `tests/test_mujoco_model.py` |
| JavaScript 输入与视图测试 | `tests/gamepad_report_test.mjs` |

## 9. 测试

运行 Python 模型测试：

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
# Windows 使用 .venv\Scripts\python
```

运行 JavaScript 测试（需要 Node.js，覆盖 G30S 报告、键盘映射、末端请求和 WebGL
模型逻辑）：

```bash
node tests/gamepad_report_test.mjs
```

浏览器 Gamepad/WebUSB 设备发现和原生 OpenGL 窗口依赖真实桌面与设备，最终仍需在 Chrome/Edge 中
各点击一次确认。
