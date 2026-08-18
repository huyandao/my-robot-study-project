# myCobot 280 末端位置跟踪与 DLS 逆运动学

本文对应当前项目中的真实实现，目标是解释“键盘或游戏手柄控制一个 XYZ 目标点，
机械臂末端跟随目标点”是怎样完成的。核心代码位于
[`mycobot_app/mujoco_model.py`](../mycobot_app/mujoco_model.py) 的
`MujocoModel.apply_cartesian_gamepad()`。

## 1. 先回答：这是逆运动学吗？

是，但它不是一次性求解目标关节角的解析逆运动学：

```text
q_target = IK(x_target)
```

当前项目使用的是基于 TCP Jacobian 的微分逆运动学，并用阻尼最小二乘法
（Damped Least Squares，DLS）计算关节速度：

```text
手柄/键盘速度
  -> 更新末端目标位置
  -> 计算目标位置与实际 TCP 的误差
  -> DLS 求六个关节速度
  -> 积分得到六个关节目标角
  -> MuJoCo 位置执行器跟随
```

这种方法适合游戏手柄或键盘连续遥操作，因为每一帧只需要求一个小的关节变化，
不需要推导 myCobot 280 的解析几何公式。

## 2. 代码中的主要变量

| 数学符号 | 代码变量 | 含义 |
| --- | --- | --- |
| `p` | `current_position` | MuJoCo 中实际 TCP 世界坐标 |
| `p_d` | `cartesian_target` | 用户控制的目标坐标，网页中显示为红点 |
| `e = p_d - p` | `error` | TCP 位置误差 |
| `J` | `jacobian` | TCP 平动 Jacobian，维度为 `3×6` |
| `v` | `desired_tcp_velocity` | 期望 TCP 世界坐标速度 |
| `q` | `current_q` | 六个关节的当前位置 |
| `q_dot` | `joint_velocity` | DLS 计算出的六个关节速度 |
| `q_ref` | `cartesian_reference_q` | 进入末端模式时记录的参考关节姿态 |
| `lambda` | `damping` | DLS 阻尼系数 |

模型在 [`models/mycobot_280/scene.xml`](../models/mycobot_280/scene.xml) 中定义了：

```xml
<site name="tcp" .../>
```

MuJoCo 使用这个 site 计算末端世界坐标和 Jacobian。

## 3. 输入不是绝对坐标，而是目标点速度

手柄或键盘发送三维归一化方向：

```text
direction = [dx, dy, dz]
```

每个分量都限制在 `[-1, 1]`。后端把方向乘以速度和时间间隔，积分成新的目标位置：

```python
self.cartesian_target += direction * checked_speed * checked_dt
```

对应数学式：

```text
p_d(k+1) = p_d(k) + direction * speed * dt
```

这样操作的含义是：

- 按住 D：目标点持续向 X 正方向移动；
- 松开 D：目标点停止移动，不会回到原点；
- 实际 TCP 如果还有误差，会继续向目标点靠近。

当前输入映射：

| 输入设备 | X | Y | Z |
| --- | --- | --- | --- |
| 游戏手柄 | 左摇杆左右 | 左摇杆上下 | 右摇杆上下 |
| 电脑键盘 | A / D | S / W | K / I |

浏览器约每 `40 ms` 调用一次 `/api/gamepad/cartesian`。输入代码分别位于：

- [`mycobot_app/static/gamepad.js`](../mycobot_app/static/gamepad.js)
- [`mycobot_app/static/keyboard.js`](../mycobot_app/static/keyboard.js)

## 4. 切换模式时为什么不会突然跳动

进入末端模式时，程序不会使用一个固定的历史目标，而是把目标初始化为当前 TCP：

```python
self.cartesian_target = self._tcp_position_unlocked()
self.cartesian_reference_q = data.qpos[self._control_qpos_indices].copy()
```

因此刚切换模式时：

```text
目标位置 = 实际 TCP 位置
初始误差 = 0
```

按手柄 A 或调用 `/api/gamepad/cartesian/reset` 也会执行同样的重置。

## 5. MuJoCo 如何计算 TCP Jacobian

项目调用：

```python
jac_pos = np.zeros((3, model.nv))
jac_rot = np.zeros((3, model.nv))

mujoco.mj_jacSite(
    model,
    data,
    jac_pos,
    jac_rot,
    self._tcp_site_id,
)
```

`jac_pos` 描述关节速度到 TCP 平动速度的关系：

```text
p_dot = J * q_dot
```

项目从 MuJoCo 全部自由度中取出六个受控关节：

```python
jacobian = jac_pos[:, self._control_dof_indices]
```

因此当前使用的 `J` 是 `3×6`：

```text
3 行：TCP 的 X、Y、Z 速度
6 列：J1～J6 的关节速度
```

`jac_rot` 虽然也由 MuJoCo 计算，但第一版位置控制没有使用它。

## 6. 期望 TCP 速度包含前馈和误差反馈

目标位置误差为：

```python
error = self.cartesian_target - current_position
```

期望 TCP 速度为：

```python
desired_tcp_velocity = direction * checked_speed + 4.0 * error
```

也就是：

```text
v = v_user + Kp * (p_d - p)
```

其中当前 `Kp = 4.0`。

- `v_user` 是用户正在推动目标点的速度前馈；
- `Kp * error` 让实际 TCP 消除跟踪误差；
- 即使输入回到零，误差反馈仍会让 TCP 继续靠近目标点。

期望 TCP 速度最终限制为最大 `0.08 m/s`，避免大误差导致突然运动。

## 7. DLS 阻尼最小二乘逆运动学

普通伪逆可以写为：

```text
q_dot = J^+ * v
```

但是接近奇异位形时，普通伪逆可能产生很大的关节速度。当前项目使用 DLS：

```text
J_DLS^+ = J^T * (J * J^T + lambda^2 * I)^(-1)
q_dot   = J_DLS^+ * v
```

代码为：

```python
system = jacobian @ jacobian.T + damping**2 * np.eye(3)
dls_inverse = jacobian.T @ np.linalg.solve(system, np.eye(3))
joint_velocity = dls_inverse @ desired_tcp_velocity
```

注意矩阵中必须是：

```text
J * J^T + lambda^2 * I
```

不是减号。阻尼项使矩阵在接近奇异位形时仍然更容易稳定求解。

代码使用 `np.linalg.solve()`，而不是显式计算矩阵逆：

```python
np.linalg.solve(system, np.eye(3))
```

这种写法通常比直接调用 `np.linalg.inv(system)` 更合适。

## 8. 自适应阻尼与奇异性保护

程序计算 Jacobian 奇异值：

```python
singular_values = np.linalg.svd(jacobian, compute_uv=False)
sigma_min = singular_values[-1]
```

`sigma_min` 是最小奇异值。它越接近零，通常表示机械臂越接近某个奇异方向。

当前阻尼为：

```python
singular_threshold = 0.06
singular_ratio = max(0.0, 1.0 - sigma_min / singular_threshold)
damping = 0.02 + 0.08 * singular_ratio * singular_ratio
```

含义是：

- 远离奇异位置：阻尼接近 `0.02`，跟踪更灵敏；
- 接近奇异位置：阻尼逐渐增大，抑制关节速度放大；
- 阻尼增大时，末端跟踪精度和响应速度会有所下降，这是稳定性与精度的权衡。

网页状态接口会返回：

```json
{
  "cartesian_damping": 0.02,
  "jacobian_min_singular_value": 0.08
}
```

可以通过 `/api/status` 观察这些值。

## 9. 为什么需要零空间控制

位置目标只有三个约束，但机械臂有六个关节，所以同一个 XYZ 位置可能对应很多组关节角。
如果只执行 DLS 主任务，肘部和手腕可能逐渐漂移。

项目在进入末端模式时记录参考姿态 `q_ref`，并增加零空间项：

```text
N = I - J_DLS^+ * J

q_dot = J_DLS^+ * v
        + N * k_posture * (q_ref - q)
```

代码为：

```python
nullspace = np.eye(6) - dls_inverse @ jacobian
joint_velocity += nullspace @ (0.25 * (self.cartesian_reference_q - current_q))
```

第二项尽量在不影响主要 XYZ 跟踪任务的方向上，把关节拉回参考姿态。当前姿态增益为
`0.25`。

这里使用的是阻尼伪逆，所以零空间投影是近似的；阻尼较大时，次任务仍可能对主任务
产生小量影响。

## 10. 从关节速度到 MuJoCo 执行器

DLS 求出的是关节速度，不是最终关节角。程序继续积分：

```python
target_q = data.ctrl[:6] + joint_velocity * checked_dt
```

然后写入六个位置执行器：

```python
data.ctrl[:6] = target_q
mujoco.mj_step(model, data, nstep=...)
```

完整关系为：

```text
末端目标位置
  -> 期望 TCP 速度
  -> DLS 求 q_dot
  -> q_target = q_target + q_dot * dt
  -> data.ctrl = q_target
  -> MuJoCo 位置执行器与动力学
  -> 新的实际 q 和 TCP 位置
```

因此这不是把 TCP 直接“瞬移”到目标点，而是让六个关节位置执行器逐步跟随 IK 产生的
目标角度。

## 11. 当前安全限制

常量位于 `mujoco_model.py` 顶部：

| 限制 | 当前值 | 作用 |
| --- | --- | --- |
| 工作空间最小值 | `[-0.30, -0.30, 0.04] m` | 限制目标点下界 |
| 工作空间最大值 | `[0.30, 0.30, 0.48] m` | 限制目标点上界 |
| 目标领先 TCP 最大距离 | `0.035 m` | 防止目标点跑得太远 |
| 最大 TCP 速度 | `0.08 m/s` | 限制末端命令速度 |
| 最大关节速度 | `25 deg/s` | 限制 DLS 输出 |
| 关节限位余量 | `3 deg` | 避免运行到执行器精确限位 |
| 单次 `dt` | `0.001～0.1 s` | 防止异常网络间隔造成大步跳变 |

目标领先限制的代码逻辑是：

```text
如果 |p_d - p| > 0.035 m
则把 p_d 拉回到以当前 TCP 为中心、半径 0.035 m 的边界
```

## 12. 当前实现没有做什么

当前模式只控制末端位置：

```text
[x, y, z]
```

它没有严格控制末端姿态：

```text
[roll, pitch, yaw]
```

零空间回归会减少关节姿态漂移，但不等于固定 TCP 姿态。也就是说，在末端移动过程中，
工具方向仍可能发生变化。

当前实现也不是：

- myCobot 专用解析 IK；
- 每帧调用非线性优化器求完整目标角；
- 任务空间力矩控制或阻抗控制；
- 带障碍物避让的运动规划器。

## 13. 下一阶段：XYZ 加固定姿态

要保持末端方向，需要在进入末端模式时记录 TCP 旋转矩阵或四元数，并计算姿态误差。
任务误差将从三维扩展到六维：

```text
task_error = [position_error, orientation_error]
```

Jacobian 也改为：

```python
jacobian = np.vstack([jac_pos, jac_rot])
```

此时：

```text
J: 6×6
v: [vx, vy, vz, wx, wy, wz]
```

仍然可以使用 DLS，但还需要正确实现旋转误差、角速度限制和姿态奇异性处理。

推荐开发顺序：

```text
当前 XYZ 位置控制
  -> XYZ + 固定进入模式时的姿态
  -> XYZ + 手柄可调姿态
  -> 关节限位回避、自碰撞和障碍物约束
```

## 14. 建议的学习实验

### 实验一：观察比例增益

把：

```python
4.0 * error
```

临时改为 `2.0 * error` 或 `6.0 * error`，观察末端跟踪速度和稳定性的变化。不要一次
改得过大。

### 实验二：观察阻尼

在网页控制机械臂接近伸直构型，同时访问 `/api/status`，观察：

```text
jacobian_min_singular_value
cartesian_damping
```

理解“最小奇异值降低、阻尼增大、运动响应变软”的关系。

### 实验三：关闭零空间项进行对比

暂时注释 `nullspace` 两行，在相同输入轨迹下观察肘部和手腕是否更容易漂移。实验完成后
恢复代码。

### 实验四：绘制误差曲线

定期记录 `/api/status` 中的：

```text
cartesian_error
```

绘制“时间—跟踪误差”曲线，比较不同 `Kp`、速度和阻尼参数。

## 15. 调试时重点查看的位置

| 学习目标 | 文件或函数 |
| --- | --- |
| TCP site 和位置执行器 | `models/mycobot_280/scene.xml` |
| 完整 DLS 控制器 | `MujocoModel.apply_cartesian_gamepad()` |
| 目标重置 | `MujocoModel._reset_cartesian_target_unlocked()` |
| 手柄 XYZ 映射 | `G30SController.mapCartesianVelocity()` |
| 键盘 XYZ 映射 | `KeyboardController.mapCartesianVelocity()` |
| HTTP 路由 | `POST /api/gamepad/cartesian` |
| 红色目标点、绿色 TCP | `mycobot_app/static/mujoco_viewer.js` |
| 自动化验证 | `tests/test_mujoco_model.py` |

学习时建议保持“输入映射、目标生成、逆运动学、执行器、显示”五层分开理解，这也是
当前项目将代码拆分成多个文件的原因。
