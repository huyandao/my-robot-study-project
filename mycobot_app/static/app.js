import { G30SController } from "./gamepad.js";

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
let lastGamepadUiUpdate = 0;

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
  els.tcpReadout.textContent = Array.isArray(endEffector)
    ? `TCP: ${endEffector.map((value) => value.toFixed(3)).join(", ")} m`
    : "TCP: --";
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
}

function applyStatus(status) {
  connected = Boolean(status.connected);
  mode = status.mode || mode;
  endEffector = status.end_effector;
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
  const port = els.portSelect.value;
  if (mode === "real" && !port) {
    throw new Error("没有可连接的串口。请插好机械臂 USB 数据线后刷新。");
  }
  const status = await api("/api/connect", {
    method: "POST",
    body: JSON.stringify({ mode, port, baud: Number(els.baudInput.value) }),
  });
  applyStatus(status);
  setMessage(mode === "sim" ? "MuJoCo 模拟器已连接。" : `已连接 ${port}。`);
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

function applyGamepadState(state) {
  els.webUsbStatus.textContent = state.statusText;
  els.webUsbHold.textContent = state.hold ? "保持" : "运动已启用";
  els.webUsbConnectBtn.disabled = state.running || !state.supported;
  els.webUsbDisconnectBtn.disabled = !state.running;
  els.webUsbAxes.textContent = state.velocity
    .map((value, index) => `J${index + 1} ${value >= 0 ? "+" : ""}${value.toFixed(index < 4 ? 2 : 0)}`)
    .join(" · ");
}

function applyGamepadSimulation(status) {
  if (Array.isArray(status.angles)) {
    status.angles.forEach((angle, index) => {
      joints[index].value = Number(angle);
    });
  }
  endEffector = status.end_effector;
  const now = performance.now();
  if (now - lastGamepadUiUpdate >= 500) {
    renderJoints();
    renderTcp();
    lastGamepadUiUpdate = now;
  }
}

const gamepad = new G30SController({
  api,
  getSpeed: () => Number(els.speedInput.value),
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
  els.webUsbConnectBtn.addEventListener("click", () => gamepad.connect().catch((error) => setMessage(error.message, true)));
  els.webUsbDisconnectBtn.addEventListener("click", () => gamepad.disconnect().catch((error) => setMessage(error.message, true)));
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
