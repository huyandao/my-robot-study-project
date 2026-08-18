# macOS 第一次真机实验

目标：先验证 macOS 与 myCobot 280 M5 的串口通信，再进行保守的小范围动作。以下命令
均从仓库根目录执行；不要把本机绝对路径写进项目文档。

## 1. 激活 Python 环境

```bash
cd my-robot-study-project
source .venv/bin/activate
export MPLCONFIGDIR="$PWD/.matplotlib-cache"
```

确认主程序依赖可以导入：

```bash
python -c "import pymycobot, serial, numpy; print('imports OK')"
```

如果 `.venv` 尚不存在，先运行 `./start_macos_linux.sh`，或按根 README 的手动安装步骤
创建环境。Matplotlib 和 Jupyter 属于 `requirements-mac.txt` 中的可选学习工具，不是
网页主程序的必需依赖。

## 2. 连接 myCobot

使用 USB 将 myCobot 280 M5 连接到 Mac，然后列出串口设备：

```bash
ls /dev/cu.*
```

查找类似下面的设备：

```text
/dev/cu.usbserial-XXXX
```

蓝牙设备不是机械臂串口。

## 3. 先只读取角度

读取角度不会主动命令机械臂运动，因此应该作为第一次真机实验：

```bash
python mac_hw_sandbox/read_angles.py --port /dev/cu.usbserial-XXXX
```

预期结果是六个关节角度组成的列表。

## 4. 确认读取正常后再低速运动

确认角度读取正常后，清空机械臂周围空间，再执行小角度动作：

```bash
python mac_hw_sandbox/single_joint_jog.py --port /dev/cu.usbserial-XXXX --joint 1 --delta 3 --speed 10 --yes
```

如果运动方向和预期不符，立即停止，不要继续。

只有在工作空间安全时，才返回保守的初始姿态：

```bash
python mac_hw_sandbox/safe_home.py --port /dev/cu.usbserial-XXXX --speed 10 --yes
```

通过串口尝试停止：

```bash
python mac_hw_sandbox/emergency_stop.py --port /dev/cu.usbserial-XXXX
```

串口停止不能替代物理急停或断电。执行动作时必须始终能够立即切断机械臂电源。完整
检查项见[真机安全检查表](safety_checklist.md)。
