/**
 * Six-joint keyboard controller.
 *
 * Key pairs map to J1-J6 and reuse the simulation-only /api/gamepad route.
 * Releasing keys, changing tab visibility, or losing window focus clears all
 * velocity commands so a stale key cannot keep moving a joint.
 */

const SEND_INTERVAL_MS = 40;

const KEY_BINDINGS = Object.freeze({
  KeyA: [0, -1],
  KeyD: [0, 1],
  KeyS: [1, -1],
  KeyW: [1, 1],
  KeyJ: [2, -1],
  KeyL: [2, 1],
  KeyK: [3, -1],
  KeyI: [3, 1],
  ArrowDown: [4, -1],
  ArrowUp: [4, 1],
  ArrowLeft: [5, -1],
  ArrowRight: [5, 1],
});

export class KeyboardController {
  constructor({ api, getSpeed, getControlMode, isSimulationAllowed, ensureSimulation, onState, onSimulation, onMessage }) {
    this.api = api;
    this.getSpeed = getSpeed;
    this.getControlMode = getControlMode || (() => "joint");
    this.isSimulationAllowed = isSimulationAllowed;
    this.ensureSimulation = ensureSimulation;
    this.onState = onState;
    this.onSimulation = onSimulation;
    this.onMessage = onMessage;

    this.enabled = false;
    this.pressed = new Set();
    this.velocity = [0, 0, 0, 0, 0, 0];
    this.postInFlight = false;
    this.lastPost = performance.now();
    this.timer = null;

    window.addEventListener("keydown", (event) => this.handleKeyDown(event));
    window.addEventListener("keyup", (event) => this.handleKeyUp(event));
    window.addEventListener("blur", () => this.releaseAll());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.releaseAll();
    });
    this.emitState();
  }

  async enable() {
    if (this.enabled) return;
    if (!this.isSimulationAllowed()) {
      throw new Error("请先断开真实机械臂；键盘只允许控制 MuJoCo 仿真。");
    }
    await this.ensureSimulation();
    this.enabled = true;
    this.lastPost = performance.now();
    this.timer = window.setInterval(() => this.sendVelocity(), SEND_INTERVAL_MS);
    this.emitState("键盘控制已启用");
  }

  disable() {
    this.releaseAll();
    this.enabled = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.emitState("键盘控制未启用");
  }

  emitState(statusText = null) {
    const controlMode = this.getControlMode();
    this.onState({
      supported: true,
      running: this.enabled,
      hold: this.velocity.every((value) => value === 0),
      controlMode,
      statusText: statusText || (this.enabled ? "键盘控制已启用" : "键盘控制未启用"),
      velocity: this.velocity,
      commandVelocity: controlMode === "cartesian"
        ? KeyboardController.mapCartesianVelocity(this.velocity)
        : this.velocity,
    });
  }

  refreshState() {
    this.emitState();
  }

  handleKeyDown(event) {
    if (!this.enabled || !(event.code in KEY_BINDINGS) || KeyboardController.isTypingTarget(event.target)) {
      return;
    }
    event.preventDefault();
    this.pressed.add(event.code);
    this.updateVelocity();
  }

  handleKeyUp(event) {
    if (!this.enabled || !(event.code in KEY_BINDINGS)) {
      return;
    }
    event.preventDefault();
    this.pressed.delete(event.code);
    this.updateVelocity();
  }

  releaseAll() {
    if (this.pressed.size === 0 && this.velocity.every((value) => value === 0)) {
      return;
    }
    this.pressed.clear();
    this.updateVelocity();
  }

  updateVelocity() {
    this.velocity = KeyboardController.velocityForCodes(this.pressed);
    this.emitState();
    this.sendVelocity(true);
  }

  sendVelocity(force = false) {
    if (!this.enabled || this.postInFlight) {
      return;
    }
    const now = performance.now();
    if (!force && now - this.lastPost < SEND_INTERVAL_MS - 2) {
      return;
    }
    const dt = Math.min(Math.max((now - this.lastPost) / 1000, 0.001), 0.1);
    this.lastPost = now;
    this.postInFlight = true;
    const controlMode = this.getControlMode();
    const cartesian = controlMode === "cartesian";
    const path = cartesian ? "/api/gamepad/cartesian" : "/api/gamepad";
    const body = cartesian
      ? {
          linear_velocity: KeyboardController.mapCartesianVelocity(this.velocity),
          dt,
          linear_speed: Math.min(Math.max(this.getSpeed() * 0.002, 0.005), 0.06),
        }
      : { velocity: this.velocity, dt, speed: this.getSpeed() };
    void this.api(path, {
      method: "POST",
      body: JSON.stringify(body),
    })
      .then(this.onSimulation)
      .catch((error) => {
        this.disable();
        this.onMessage(`键盘控制已停止：${error.message}`, true);
      })
      .finally(() => {
        this.postInFlight = false;
      });
  }

  static velocityForCodes(codes) {
    const velocity = [0, 0, 0, 0, 0, 0];
    for (const code of codes) {
      const binding = KEY_BINDINGS[code];
      if (binding) velocity[binding[0]] += binding[1];
    }
    return velocity.map((value) => Math.max(-1, Math.min(1, value)));
  }

  static mapCartesianVelocity(velocity) {
    if (!Array.isArray(velocity) || velocity.length < 4) return [0, 0, 0];
    return [velocity[0], velocity[1], velocity[3]];
  }

  static isTypingTarget(target) {
    if (!(target instanceof Element)) return false;
    return target.matches("input, select, textarea, [contenteditable='true']");
  }
}
