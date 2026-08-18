import { G30SController } from "./gamepad.js";
import { KeyboardController } from "./keyboard.js";
import { MujocoWebViewer } from "./mujoco_viewer.js";

const joints = Array.from({ length: 6 }, (_, index) => ({
  name: `J${index + 1}`,
  value: 0,
  min: -180,
  max: 180,
}));

let selectedJoint = 1;
let connected = false;
let mode = "sim";
let endEffector = null;
let cartesianTarget = null;
let gamepadControlMode = "joint";
let inputControlSource = "gamepad";
let lastGamepadUiUpdate = 0;
let lastGamepadState = null;
let lastKeyboardState = null;

const els = {
  simModeBtn: document.querySelector("#simModeBtn"),
  realModeBtn: document.querySelector("#realModeBtn"),
  modeHint: document.querySelector("#modeHint"),
  portSelect: document.querySelector("#portSelect"),
  baudInput: document.querySelector("#baudInput"),
  refreshPortsBtn: document.querySelector("#refreshPortsBtn"),
  connectBtn: document.querySelector("#connectBtn"),
  disconnectBtn: document.querySelector("#disconnectBtn"),
  readAnglesBtn: document.querySelector("#readAnglesBtn"),
  sendAnglesBtn: document.querySelector("#sendAnglesBtn"),
  homeBtn: document.querySelector("#homeBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  releaseBtn: document.querySelector("#releaseBtn"),
  speedInput: document.querySelector("#speedInput"),
  speedOutput: document.querySelector("#speedOutput"),
  jointList: document.querySelector("#jointList"),
  jointPicker: document.querySelector("#jointPicker"),
  tcpReadout: document.querySelector("#tcpReadout"),
  badge: document.querySelector("#connectionBadge"),
  message: document.querySelector("#message"),
  webUsbConnectBtn: document.querySelector("#webUsbConnectBtn"),
  webUsbDisconnectBtn: document.querySelector("#webUsbDisconnectBtn"),
  webUsbStatus: document.querySelector("#webUsbStatus"),
  webUsbHold: document.querySelector("#webUsbHold"),
  webUsbAxes: document.querySelector("#webUsbAxes"),
  inputControlTitle: document.querySelector("#inputControlTitle"),
  inputControlCopy: document.querySelector("#inputControlCopy"),
  inputControlSource: document.querySelector("#inputControlSource"),
  gamepadControlMode: document.querySelector("#gamepadControlMode"),
  gamepadMappingHint: document.querySelector("#gamepadMappingHint"),
  mujocoCanvas: document.querySelector("#mujocoCanvas"),
  mujocoWebStatus: document.querySelector("#mujocoWebStatus"),
  openNativeViewerBtn: document.querySelector("#openNativeViewerBtn"),
  nativeViewerStatus: document.querySelector("#nativeViewerStatus"),
};

function setMessage(text, isError = false) {
  els.message.textContent = text;
  els.message.style.color = isError ? "#b42318" : "#697386";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "请求失败");
  }
  return payload.data ?? payload;
}

function renderJoints() {
  els.jointList.innerHTML = "";
  joints.forEach((joint, index) => {
    const row = document.createElement("div");
    row.className = "joint-row";
    row.innerHTML = `
      <div class="joint-name">${joint.name}</div>
      <input type="range" min="${joint.min}" max="${joint.max}" step="0.1" value="${joint.value}" data-index="${index}" />
      <input class="joint-value" type="number" min="${joint.min}" max="${joint.max}" step="0.1" value="${joint.value.toFixed(1)}" data-index="${index}" />
    `;
    els.jointList.append(row);
  });

  els.jointList.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", (event) => {
      const target = event.currentTarget;
      joints[Number(target.dataset.index)].value = Number(target.value);
      renderJoints();
    });
  });
}

function renderJointPicker() {
  els.jointPicker.innerHTML = "";
  joints.forEach((joint, index) => {
    const button = document.createElement("button");
    button.className = `joint-tab${selectedJoint === index + 1 ? " active" : ""}`;
    button.textContent = joint.name;
    button.addEventListener("click", () => {
      selectedJoint = index + 1;
      renderJointPicker();
    });
    els.jointPicker.append(button);
  });
}

function renderTcp() {
  if (!Array.isArray(endEffector)) {
    els.tcpReadout.textContent = "TCP: --";
    return;
  }
  const actual = endEffector.map((value) => value.toFixed(3)).join(", ");
  const target = gamepadControlMode === "cartesian" && Array.isArray(cartesianTarget)
    ? ` · 目标: ${cartesianTarget.map((value) => value.toFixed(3)).join(", ")} m`
    : "";
  els.tcpReadout.textContent = `TCP: ${actual} m${target}`;
}

function renderGamepadControlMode() {
  const keyboardSelected = inputControlSource === "keyboard";
  els.inputControlSource.value = inputControlSource;
  els.inputControlSource.disabled = mode !== "sim";
  els.gamepadControlMode.value = gamepadControlMode;
  els.gamepadControlMode.disabled = mode !== "sim";
  els.webUsbConnectBtn.textContent = keyboardSelected ? "第 3 步 · 启动键盘控制" : "第 3 步 · 启动手柄控制";
  els.webUsbDisconnectBtn.textContent = keyboardSelected ? "停用键盘" : "断开手柄";
  els.inputControlTitle.textContent = keyboardSelected
    ? `电脑键盘 · ${gamepadControlMode === "cartesian" ? "末端位置控制" : "六关节控制"}`
    : "雷神 G30S · 跨平台手柄";
  els.inputControlCopy.textContent = keyboardSelected
    ? "按住按键连续控制关节，松开即停止增量；键盘输入仅发送到 MuJoCo 仿真。"
    : "Windows 使用 XInput/Gamepad API，macOS/Linux 使用 WebUSB；仅控制 MuJoCo 仿真。";
  els.gamepadMappingHint.textContent = keyboardSelected
    ? gamepadControlMode === "cartesian"
      ? "世界坐标：A/D 控制 X · S/W 控制 Y · K/I 控制 Z"
      : "J1 A/D · J2 S/W · J3 J/L · J4 K/I · J5 ↓/↑ · J6 ←/→（前键为负方向，后键为正方向）"
    : gamepadControlMode === "cartesian"
      ? "世界坐标：左摇杆 X/Y · 右摇杆上下 Z · A 将目标重置到当前 TCP · B 保持/恢复 · Start 停止"
      : "左摇杆 J1/J2 · 右摇杆 J3/J4 · 十字键 J5/J6 · A 回零 · B 保持/恢复 · Start 停止";

  const inputState = keyboardSelected ? lastKeyboardState : lastGamepadState;
  if (inputState) renderInputState(inputState);
}

function setMode(nextMode) {
  if (connected && nextMode !== mode) {
    setMessage("请先断开当前连接，再切换模式。", true);
    return;
  }
  mode = nextMode;
  els.simModeBtn.classList.toggle("active", mode === "sim");
  els.realModeBtn.classList.toggle("active", mode === "real");
  els.modeHint.textContent = mode === "sim" ? "当前不会连接真实机械臂。" : "真实机械臂模式会通过串口发送指令。";
  document.querySelector(".control-strip").classList.toggle("real-mode", mode === "real");
  [els.portSelect, els.baudInput, els.refreshPortsBtn].forEach((element) => {
    element.disabled = mode !== "real";
  });
  els.connectBtn.textContent = mode === "sim" ? "连接模拟器" : "连接真机";
  els.releaseBtn.style.display = mode === "real" ? "" : "none";
  els.openNativeViewerBtn.disabled = !connected || mode !== "sim";
  renderGamepadControlMode();
}

function applyStatus(status) {
  connected = Boolean(status.connected);
  mode = status.mode || mode;
  endEffector = status.end_effector;
  if (Object.hasOwn(status, "cartesian_target")) {
    cartesianTarget = status.cartesian_target;
  }
  if (status.gamepad_control_mode === "joint" || status.gamepad_control_mode === "cartesian") {
    gamepadControlMode = status.gamepad_control_mode;
  }
  if (Array.isArray(status.limits)) {
    status.limits.forEach(([min, max], index) => {
      joints[index].min = min;
      joints[index].max = max;
    });
  }
  if (Array.isArray(status.angles)) {
    status.angles.forEach((angle, index) => {
      joints[index].value = Number(angle);
    });
  }
  els.badge.textContent = connected ? "已连接" : "未连接";
  els.badge.className = `badge ${connected ? "online" : "offline"}`;
  [els.disconnectBtn, els.readAnglesBtn, els.sendAnglesBtn, els.homeBtn, els.stopBtn, els.releaseBtn].forEach((button) => {
    button.disabled = !connected;
  });
  setMode(mode);
  renderJoints();
  renderJointPicker();
  renderTcp();
  renderGamepadControlMode();
  webViewer.update(status);
}

async function refreshPorts() {
  const { ports } = await api("/api/ports");
  els.portSelect.innerHTML = "";
  if (ports.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "未发现串口";
    els.portSelect.append(option);
    return;
  }
  ports.forEach((port) => {
    const option = document.createElement("option");
    option.value = port;
    option.textContent = port;
    els.portSelect.append(option);
  });
}

async function loadStatus() {
  applyStatus(await api("/api/status"));
}

async function connectRobot() {
  const requestedGamepadMode = gamepadControlMode;
  const port = els.portSelect.value;
  if (mode === "real" && !port) {
    throw new Error("没有可连接的串口。请插好机械臂 USB 数据线后刷新。");
  }
  const status = await api("/api/connect", {
    method: "POST",
    body: JSON.stringify({ mode, port, baud: Number(els.baudInput.value) }),
  });
  applyStatus(status);
  if (mode === "sim" && requestedGamepadMode !== gamepadControlMode) {
    await setGamepadControlMode(requestedGamepadMode);
  }
  setMessage(mode === "sim" ? "MuJoCo 模拟器已连接。" : `已连接 ${port}。`);
}

async function setGamepadControlMode(nextMode) {
  if (nextMode !== "joint" && nextMode !== "cartesian") {
    throw new Error("未知的手柄控制方式。");
  }
  const previousMode = gamepadControlMode;
  gamepadControlMode = nextMode;
  renderGamepadControlMode();
  gamepad.refreshState();
  keyboard.refreshState();
  if (!connected || mode !== "sim") {
    return;
  }
  try {
    const status = await api("/api/gamepad/mode", {
      method: "POST",
      body: JSON.stringify({ mode: nextMode }),
    });
    applyGamepadSimulation(status);
    setMessage(nextMode === "cartesian"
      ? "已切换到末端 XYZ 跟随，目标点从当前 TCP 开始。"
      : "已切换到六关节控制。", false);
  } catch (error) {
    gamepadControlMode = previousMode;
    renderGamepadControlMode();
    gamepad.refreshState();
    keyboard.refreshState();
    throw error;
  }
}

async function setInputControlSource(nextSource) {
  if (nextSource !== "gamepad" && nextSource !== "keyboard") {
    throw new Error("未知的输入设备。");
  }
  const previousSource = inputControlSource;
  inputControlSource = nextSource;
  renderGamepadControlMode();
  try {
    if (nextSource === "keyboard") {
      await gamepad.disconnect("手柄控制已停用");
      setMessage("已选择电脑键盘。选择控制目标后，点击第 3 步启动。", false);
    } else {
      keyboard.disable();
      gamepad.refreshState();
      setMessage("已选择游戏手柄。选择控制目标后，点击第 3 步启动。", false);
    }
    renderGamepadControlMode();
  } catch (error) {
    inputControlSource = previousSource;
    keyboard.disable();
    renderGamepadControlMode();
    throw error;
  }
}

async function readAngles() {
  applyStatus(await api("/api/angles"));
  setMessage("角度已更新。");
}

async function sendAngles() {
  if (mode === "real" && !confirm("确认发送当前 6 个关节角度？请确保机械臂周围没有障碍物。")) {
    return;
  }
  const status = await api("/api/send_angles", {
    method: "POST",
    body: JSON.stringify({ angles: joints.map((joint) => joint.value), speed: Number(els.speedInput.value) }),
  });
  applyStatus(status);
  setMessage("目标角度已发送。");
}

async function jog(delta) {
  const status = await api("/api/jog", {
    method: "POST",
    body: JSON.stringify({ joint: selectedJoint, delta, speed: Number(els.speedInput.value) }),
  });
  applyStatus(status);
  setMessage(`${joints[selectedJoint - 1].name} 点动 ${delta}° 已发送。`);
}

async function postAction(path, message) {
  if (mode === "real" && path === "/api/home" && !confirm("确认回零位？这个动作可能移动多个关节。")) {
    return;
  }
  if (mode === "real" && path === "/api/release_servos" && !confirm("确认释放舵机？机械臂可能下垂。")) {
    return;
  }
  const status = await api(path, {
    method: "POST",
    body: JSON.stringify({ speed: Number(els.speedInput.value) }),
  });
  applyStatus(status);
  setMessage(message);
}

function applyNativeViewerStatus(status) {
  const running = Boolean(status.running);
  els.nativeViewerStatus.textContent = running ? "MuJoCo 原生窗口运行中" : "原生窗口未打开";
  els.openNativeViewerBtn.textContent = running ? "原生窗口已打开" : "打开 MuJoCo 原生窗口";
  els.openNativeViewerBtn.disabled = running || !connected || mode !== "sim";
}

async function loadNativeViewerStatus() {
  applyNativeViewerStatus(await api("/api/viewer/status"));
}

async function openNativeViewer() {
  if (!connected || mode !== "sim") {
    throw new Error("请先连接 MuJoCo 模拟器。");
  }
  const status = await api("/api/viewer/open", {
    method: "POST",
    body: JSON.stringify({ server_url: window.location.origin }),
  });
  applyNativeViewerStatus(status);
  setMessage(status.already_running ? "MuJoCo 原生窗口已经打开。" : "MuJoCo 原生窗口已启动。");
}

function renderInputState(state) {
  els.webUsbStatus.textContent = state.statusText;
  els.webUsbHold.textContent = inputControlSource === "keyboard"
    ? state.hold ? "等待按键" : "关节运动中"
    : state.hold ? "保持" : "运动已启用";
  els.webUsbConnectBtn.disabled = state.running || !state.supported || mode !== "sim";
  els.webUsbDisconnectBtn.disabled = !state.running;
  const command = state.commandVelocity || state.velocity;
  els.webUsbAxes.textContent = state.controlMode === "cartesian"
    ? command.map((value, index) => `${["X", "Y", "Z"][index]} ${value >= 0 ? "+" : ""}${value.toFixed(2)}`).join(" · ")
    : command.map((value, index) => `J${index + 1} ${value >= 0 ? "+" : ""}${value.toFixed(index < 4 ? 2 : 0)}`).join(" · ");
}

function applyGamepadState(state) {
  lastGamepadState = state;
  if (inputControlSource === "gamepad") renderInputState(state);
}

function applyKeyboardState(state) {
  lastKeyboardState = state;
  if (inputControlSource === "keyboard") renderInputState(state);
}

function applyGamepadSimulation(status) {
  if (Array.isArray(status.angles)) {
    status.angles.forEach((angle, index) => {
      joints[index].value = Number(angle);
    });
  }
  endEffector = status.end_effector;
  if (Object.hasOwn(status, "cartesian_target")) {
    cartesianTarget = status.cartesian_target;
  }
  if (status.gamepad_control_mode === "joint" || status.gamepad_control_mode === "cartesian") {
    gamepadControlMode = status.gamepad_control_mode;
  }
  webViewer.update(status);
  const now = performance.now();
  if (now - lastGamepadUiUpdate >= 500) {
    renderJoints();
    renderTcp();
    renderGamepadControlMode();
    lastGamepadUiUpdate = now;
  }
}

const webViewer = new MujocoWebViewer(els.mujocoCanvas, els.mujocoWebStatus);

const gamepad = new G30SController({
  api,
  getSpeed: () => Number(els.speedInput.value),
  getControlMode: () => gamepadControlMode,
  isSimulationAllowed: () => !connected || mode === "sim",
  ensureSimulation: async () => {
    if (!connected) {
      setMode("sim");
      await connectRobot();
    }
  },
  onState: applyGamepadState,
  onSimulation: applyGamepadSimulation,
  onMessage: setMessage,
});

const keyboard = new KeyboardController({
  api,
  getSpeed: () => Number(els.speedInput.value),
  getControlMode: () => gamepadControlMode,
  isSimulationAllowed: () => !connected || mode === "sim",
  ensureSimulation: async () => {
    if (!connected) {
      setMode("sim");
      await connectRobot();
    }
  },
  onState: applyKeyboardState,
  onSimulation: applyGamepadSimulation,
  onMessage: setMessage,
});

async function startSelectedInput() {
  if (inputControlSource === "keyboard") {
    await keyboard.enable();
    setMessage("MuJoCo 和键盘控制已启动。", false);
  } else {
    await gamepad.connect();
  }
  renderGamepadControlMode();
}

async function stopSelectedInput() {
  if (inputControlSource === "keyboard") {
    keyboard.disable();
    setMessage("键盘控制已停用。", false);
  } else {
    await gamepad.disconnect();
  }
  renderGamepadControlMode();
}

function wireEvents() {
  els.simModeBtn.addEventListener("click", () => setMode("sim"));
  els.realModeBtn.addEventListener("click", () => setMode("real"));
  els.refreshPortsBtn.addEventListener("click", () => refreshPorts().catch((error) => setMessage(error.message, true)));
  els.connectBtn.addEventListener("click", () => connectRobot().catch((error) => setMessage(error.message, true)));
  els.disconnectBtn.addEventListener("click", () => postAction("/api/disconnect", "已断开。").catch((error) => setMessage(error.message, true)));
  els.readAnglesBtn.addEventListener("click", () => readAngles().catch((error) => setMessage(error.message, true)));
  els.sendAnglesBtn.addEventListener("click", () => sendAngles().catch((error) => setMessage(error.message, true)));
  els.homeBtn.addEventListener("click", () => postAction("/api/home", "已发送回零位。").catch((error) => setMessage(error.message, true)));
  els.stopBtn.addEventListener("click", () => postAction("/api/stop", "已发送停止。").catch((error) => setMessage(error.message, true)));
  els.releaseBtn.addEventListener("click", () => postAction("/api/release_servos", "已释放舵机。").catch((error) => setMessage(error.message, true)));
  document.querySelectorAll(".jog").forEach((button) => {
    button.addEventListener("click", () => jog(Number(button.dataset.delta)).catch((error) => setMessage(error.message, true)));
  });
  els.speedInput.addEventListener("input", () => {
    els.speedOutput.value = els.speedInput.value;
  });
  els.webUsbConnectBtn.addEventListener("click", () => startSelectedInput().catch((error) => setMessage(error.message, true)));
  els.webUsbDisconnectBtn.addEventListener("click", () => stopSelectedInput().catch((error) => setMessage(error.message, true)));
  els.inputControlSource.addEventListener("change", (event) => {
    setInputControlSource(event.currentTarget.value).catch((error) => setMessage(error.message, true));
  });
  els.gamepadControlMode.addEventListener("change", (event) => {
    setGamepadControlMode(event.currentTarget.value).catch((error) => setMessage(error.message, true));
  });
  els.openNativeViewerBtn.addEventListener("click", () => openNativeViewer().catch((error) => setMessage(error.message, true)));
}

async function init() {
  wireEvents();
  renderJoints();
  renderJointPicker();
  renderTcp();
  applyStatus({ connected: false });
  await gamepad.detectAuthorization();
  await refreshPorts();
  await loadStatus();
  await loadNativeViewerStatus();
  setMode("sim");
  window.setInterval(() => loadNativeViewerStatus().catch(() => {}), 2000);
}

init().catch((error) => setMessage(error.message, true));
