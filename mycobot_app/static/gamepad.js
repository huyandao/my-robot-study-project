/**
 * Thunderobot G30S browser driver and backend communication.
 *
 * Windows normally exposes the receiver through XInput, so Windows uses the
 * standard Gamepad API. Other desktop systems keep the raw WebUSB path for the
 * Xbox 360-compatible 045e:028e receiver. Both transports produce the same
 * six-axis command and send it to /api/gamepad.
 */

const VENDOR_ID = 0x045e;
const PRODUCT_ID = 0x028e;
const SEND_INTERVAL_MS = 40;
const DEADZONE = 0.12;

export class G30SController {
  constructor({ api, getSpeed, isSimulationAllowed, ensureSimulation, onState, onSimulation, onMessage }) {
    this.api = api;
    this.getSpeed = getSpeed;
    this.isSimulationAllowed = isSimulationAllowed;
    this.ensureSimulation = ensureSimulation;
    this.onState = onState;
    this.onSimulation = onSimulation;
    this.onMessage = onMessage;

    this.device = null;
    this.interfaceNumber = null;
    this.endpointNumber = null;
    this.gamepadIndex = null;
    this.transport = null;
    this.packetSize = 32;
    this.running = false;
    this.hold = true;
    this.previousButtons = 0;
    this.lastPost = 0;
    this.postInFlight = false;
    this.statusText = this.supported ? this.idleStatus : "此浏览器不支持手柄读取";
    this.velocity = [0, 0, 0, 0, 0, 0];

    if (this.webUsbSupported) {
      navigator.usb.addEventListener("disconnect", (event) => {
        if (event.device === this.device) {
          void this.disconnect("USB 连接已移除");
        }
      });
    }
    if (this.gamepadApiSupported) {
      window.addEventListener("gamepadconnected", (event) => {
        if (!this.running && G30SController.matchesStandardGamepad(event.gamepad)) {
          this.emitState(`已检测到 ${event.gamepad.id}，点击连接`);
        }
      });
      window.addEventListener("gamepaddisconnected", (event) => {
        if (this.transport === "gamepad" && event.gamepad.index === this.gamepadIndex) {
          void this.disconnect("Windows 手柄已断开");
        }
      });
    }
    this.emitState();
  }

  get supported() {
    return this.webUsbSupported || this.gamepadApiSupported;
  }

  get webUsbSupported() {
    return typeof navigator !== "undefined" && "usb" in navigator;
  }

  get gamepadApiSupported() {
    return typeof navigator !== "undefined" && typeof navigator.getGamepads === "function";
  }

  get isWindows() {
    const platform = navigator.userAgentData?.platform || navigator.platform || "";
    return /windows|win32|win64/i.test(platform);
  }

  get idleStatus() {
    return this.isWindows
      ? "Windows：请按手柄任意键，然后点击连接"
      : "尚未授权";
  }

  emitState(statusText = null) {
    if (statusText !== null) {
      this.statusText = statusText;
    }
    this.onState({
      supported: this.supported,
      running: this.running,
      hold: this.hold,
      transport: this.transport,
      statusText: this.statusText,
      velocity: this.velocity,
    });
  }

  async detectAuthorization() {
    if (!this.supported) {
      this.emitState("此浏览器不支持 WebUSB 或 Gamepad API");
      return;
    }

    const gamepad = G30SController.findStandardGamepad();
    if (this.isWindows) {
      this.emitState(gamepad
        ? `Windows XInput 已检测到 ${gamepad.id}，点击连接`
        : "Windows：请按手柄任意键，然后点击连接");
      return;
    }

    const device = this.webUsbSupported
      ? (await navigator.usb.getDevices()).find(G30SController.matches)
      : null;
    this.emitState(device
      ? "WebUSB 已授权，点击连接"
      : gamepad
        ? `已检测到 ${gamepad.id}，点击连接`
        : "尚未授权");
  }

  async connect() {
    if (!this.isSimulationAllowed()) {
      throw new Error("请先断开真实机械臂；G30S 只允许控制 MuJoCo 仿真。");
    }
    if (!this.supported) {
      throw new Error("当前浏览器不支持手柄读取，请使用桌面版 Google Chrome 或 Microsoft Edge。");
    }

    if (this.isWindows) {
      const gamepad = G30SController.findStandardGamepad();
      if (!gamepad) {
        throw new Error("Windows 尚未发现手柄。请确认 G30S 处于 XInput 模式，按任意键后再点击连接。");
      }
      await this.connectStandardGamepad(gamepad);
      return;
    }

    if (this.webUsbSupported) {
      await this.connectWebUsb();
      return;
    }

    const gamepad = G30SController.findStandardGamepad();
    if (!gamepad) {
      throw new Error("未发现兼容手柄。请按任意键后重新连接。");
    }
    await this.connectStandardGamepad(gamepad);
  }

  async connectWebUsb() {
    const authorized = await navigator.usb.getDevices();
    const device = authorized.find(G30SController.matches) || await navigator.usb.requestDevice({
      filters: [{ vendorId: VENDOR_ID, productId: PRODUCT_ID }],
    });

    try {
      await device.open();
      if (!device.configuration) {
        await device.selectConfiguration(1);
      }
      const { interfaceInfo, alternate, endpoint } = G30SController.findInputEndpoint(device);
      await device.claimInterface(interfaceInfo.interfaceNumber);
      if (interfaceInfo.alternate.alternateSetting !== alternate.alternateSetting) {
        await device.selectAlternateInterface(interfaceInfo.interfaceNumber, alternate.alternateSetting);
      }

      this.device = device;
      this.interfaceNumber = interfaceInfo.interfaceNumber;
      this.endpointNumber = endpoint.endpointNumber;
      this.packetSize = endpoint.packetSize || 32;
      this.transport = "webusb";
      this.running = true;
      this.hold = false;
      this.previousButtons = 0;
      this.lastPost = performance.now();
      await this.ensureSimulation();
      this.emitState(`${device.productName || "USB Controller"} 已通过 WebUSB 连接`);
      this.onMessage("G30S 已通过 WebUSB 连接，输入只会发送到 MuJoCo 仿真。", false);
      void this.readUsbLoop();
    } catch (error) {
      if (device.opened) {
        await device.close().catch(() => {});
      }
      this.reset("连接失败");
      throw error;
    }
  }

  async connectStandardGamepad(gamepad) {
    await this.ensureSimulation();
    this.gamepadIndex = gamepad.index;
    this.transport = "gamepad";
    this.running = true;
    this.hold = false;
    this.previousButtons = 0;
    this.lastPost = performance.now();
    this.emitState(`${gamepad.id} 已通过 Windows XInput 连接`);
    this.onMessage("G30S 已通过 Windows Gamepad API 连接，输入只会发送到 MuJoCo 仿真。", false);
    void this.pollStandardGamepad();
  }

  async disconnect(message = "手柄已断开") {
    const device = this.device;
    const interfaceNumber = this.interfaceNumber;
    const transport = this.transport;
    this.reset(message);

    if (transport !== "webusb" || !device || !device.opened) {
      return;
    }
    if (interfaceNumber !== null) {
      await device.releaseInterface(interfaceNumber).catch(() => {});
    }
    await device.close().catch(() => {});
  }

  reset(message) {
    this.running = false;
    this.hold = true;
    this.device = null;
    this.interfaceNumber = null;
    this.endpointNumber = null;
    this.gamepadIndex = null;
    this.transport = null;
    this.velocity = [0, 0, 0, 0, 0, 0];
    this.emitState(message);
  }

  async readUsbLoop() {
    try {
      while (this.running && this.transport === "webusb" && this.device && this.endpointNumber !== null) {
        const result = await this.device.transferIn(this.endpointNumber, this.packetSize);
        if (result.status === "stall") {
          await this.device.clearHalt("in", this.endpointNumber);
          continue;
        }
        if (result.status !== "ok" || !result.data) {
          continue;
        }
        const report = G30SController.parseReport(result.data);
        if (!report) {
          continue;
        }
        this.velocity = report.velocity;
        this.handleButtons(report.buttons);
        this.emitState();
        this.sendVelocity(report.velocity);
      }
    } catch (error) {
      if (this.running) {
        this.onMessage(`WebUSB 读取停止：${error.message}`, true);
      }
    } finally {
      if (this.running) {
        await this.disconnect("读取已停止");
      }
    }
  }

  async pollStandardGamepad() {
    while (this.running && this.transport === "gamepad" && this.gamepadIndex !== null) {
      const gamepad = navigator.getGamepads()[this.gamepadIndex];
      if (!gamepad) {
        await this.disconnect("Windows 手柄已断开");
        return;
      }
      const report = G30SController.parseStandardGamepad(gamepad);
      if (report) {
        this.velocity = report.velocity;
        this.handleButtons(report.buttons);
        this.emitState();
        this.sendVelocity(report.velocity);
      }
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    }
  }

  handleButtons(buttons) {
    const newlyPressed = buttons & ~this.previousButtons;
    this.previousButtons = buttons;

    if (newlyPressed & 0x1000) {
      void this.sendAction("/api/home", "手柄 A：已发送仿真回零位。");
    }
    if (newlyPressed & 0x2000) {
      this.hold = !this.hold;
      this.emitState();
      this.onMessage(this.hold ? "手柄 B：保持当前位置。" : "手柄 B：恢复运动控制。", false);
    }
    if (newlyPressed & 0x0010) {
      this.hold = true;
      this.emitState();
      void this.sendAction("/api/stop", "手柄 Start：仿真已停止并保持。");
    }
  }

  async sendAction(path, message) {
    try {
      const status = await this.api(path, {
        method: "POST",
        body: JSON.stringify({ speed: this.getSpeed() }),
      });
      this.onSimulation(status);
      this.onMessage(message, false);
    } catch (error) {
      this.hold = true;
      this.emitState();
      this.onMessage(error.message, true);
    }
  }

  sendVelocity(velocity) {
    const now = performance.now();
    if (this.postInFlight || now - this.lastPost < SEND_INTERVAL_MS) {
      return;
    }
    const dt = Math.min((now - this.lastPost) / 1000, 0.1);
    this.lastPost = now;
    this.postInFlight = true;
    const safeVelocity = this.hold ? [0, 0, 0, 0, 0, 0] : velocity;
    void this.api("/api/gamepad", {
      method: "POST",
      body: JSON.stringify({ velocity: safeVelocity, dt, speed: this.getSpeed() }),
    })
      .then(this.onSimulation)
      .catch((error) => {
        this.hold = true;
        this.emitState();
        this.onMessage(`手柄控制已保持：${error.message}`, true);
      })
      .finally(() => {
        this.postInFlight = false;
      });
  }

  static matches(device) {
    return device.vendorId === VENDOR_ID && device.productId === PRODUCT_ID;
  }

  static matchesStandardGamepad(gamepad) {
    if (!gamepad) {
      return false;
    }
    const id = String(gamepad.id || "").toLowerCase();
    return (id.includes("045e") && id.includes("028e"))
      || id.includes("xbox")
      || id.includes("x-box")
      || id.includes("xinput")
      || id.includes("g30")
      || id.includes("thunderobot")
      || (gamepad.mapping === "standard" && /controller|gamepad|joystick/.test(id));
  }

  static findStandardGamepad() {
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
      return null;
    }
    return Array.from(navigator.getGamepads() || [])
      .filter(Boolean)
      .find(G30SController.matchesStandardGamepad) || null;
  }

  static findInputEndpoint(device) {
    for (const interfaceInfo of device.configuration.interfaces) {
      for (const alternate of interfaceInfo.alternates) {
        const endpoint = alternate.endpoints.find((candidate) => candidate.direction === "in");
        if (endpoint) {
          return { interfaceInfo, alternate, endpoint };
        }
      }
    }
    throw new Error("G30S 没有可读取的 USB IN endpoint。");
  }

  static parseReport(view) {
    if (view.byteLength < 14 || view.getUint8(0) !== 0x00) {
      return null;
    }
    const buttons0 = view.getUint8(2);
    const buttons1 = view.getUint8(3);
    const axis = (offset) => {
      const value = view.getInt16(offset, true);
      const normalized = value < 0 ? value / 32768 : value / 32767;
      const magnitude = Math.abs(normalized);
      return magnitude <= DEADZONE
        ? 0
        : Math.sign(normalized) * ((magnitude - DEADZONE) / (1 - DEADZONE));
    };
    const joint5 = Number(Boolean(buttons0 & 0x01)) - Number(Boolean(buttons0 & 0x02));
    const joint6 = Number(Boolean(buttons0 & 0x08)) - Number(Boolean(buttons0 & 0x04));
    return {
      buttons: buttons0 | (buttons1 << 8),
      velocity: [axis(6), axis(8), axis(10), axis(12), joint5, joint6],
    };
  }

  static parseStandardGamepad(gamepad) {
    if (!gamepad || !Array.isArray(gamepad.axes) || gamepad.axes.length < 4) {
      return null;
    }
    const normalizeAxis = (value) => {
      const normalized = Math.max(-1, Math.min(1, Number(value) || 0));
      const magnitude = Math.abs(normalized);
      return magnitude <= DEADZONE
        ? 0
        : Math.sign(normalized) * ((magnitude - DEADZONE) / (1 - DEADZONE));
    };
    const pressed = (index) => {
      const button = gamepad.buttons?.[index];
      return typeof button === "number" ? button > 0.5 : Boolean(button?.pressed || button?.value > 0.5);
    };
    const dpadVertical = Number(pressed(12)) - Number(pressed(13));
    const dpadHorizontal = Number(pressed(15)) - Number(pressed(14));
    let buttons = 0;
    if (pressed(0)) buttons |= 0x1000; // A
    if (pressed(1)) buttons |= 0x2000; // B
    if (pressed(9)) buttons |= 0x0010; // Start
    return {
      buttons,
      velocity: [
        normalizeAxis(gamepad.axes[0]),
        normalizeAxis(gamepad.axes[1]),
        normalizeAxis(gamepad.axes[2]),
        normalizeAxis(gamepad.axes[3]),
        dpadVertical,
        dpadHorizontal,
      ],
    };
  }
}
