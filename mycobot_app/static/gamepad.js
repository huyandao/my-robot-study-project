/**
 * Thunderobot G30S WebUSB driver and backend communication.
 *
 * The receiver identifies as an Xbox 360-compatible 045e:028e device. This
 * file owns discovery, USB report parsing, hot unplug handling, hold/home/stop
 * buttons, and velocity messages sent to /api/gamepad.
 */

const VENDOR_ID = 0x045e;
const PRODUCT_ID = 0x028e;
const SEND_INTERVAL_MS = 40;
const DEADZONE = 0.12;

export class G30SWebUSBController {
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
    this.packetSize = 32;
    this.running = false;
    this.hold = true;
    this.previousButtons = 0;
    this.lastPost = 0;
    this.postInFlight = false;
    this.statusText = this.supported ? "尚未授权" : "此浏览器不支持 WebUSB";
    this.velocity = [0, 0, 0, 0, 0, 0];

    if (this.supported) {
      navigator.usb.addEventListener("disconnect", (event) => {
        if (event.device === this.device) {
          void this.disconnect("USB 连接已移除");
        }
      });
    }
    this.emitState();
  }

  get supported() {
    return "usb" in navigator;
  }

  emitState(statusText = null) {
    if (statusText !== null) {
      this.statusText = statusText;
    }
    this.onState({
      supported: this.supported,
      running: this.running,
      hold: this.hold,
      statusText: this.statusText,
      velocity: this.velocity,
    });
  }

  async detectAuthorization() {
    if (!this.supported) {
      this.emitState("此浏览器不支持 WebUSB");
      return;
    }
    const device = (await navigator.usb.getDevices()).find(G30SWebUSBController.matches);
    this.emitState(device ? "已授权，点击连接" : "尚未授权");
  }

  async connect() {
    if (!this.supported) {
      throw new Error("当前浏览器不支持 WebUSB，请使用桌面版 Google Chrome。");
    }
    if (!this.isSimulationAllowed()) {
      throw new Error("请先断开真实机械臂；G30S 只允许控制 MuJoCo 仿真。");
    }

    const authorized = await navigator.usb.getDevices();
    const device = authorized.find(G30SWebUSBController.matches) || await navigator.usb.requestDevice({
      filters: [{ vendorId: VENDOR_ID, productId: PRODUCT_ID }],
    });

    try {
      await device.open();
      if (!device.configuration) {
        await device.selectConfiguration(1);
      }
      const { interfaceInfo, alternate, endpoint } = G30SWebUSBController.findInputEndpoint(device);
      await device.claimInterface(interfaceInfo.interfaceNumber);
      if (interfaceInfo.alternate.alternateSetting !== alternate.alternateSetting) {
        await device.selectAlternateInterface(interfaceInfo.interfaceNumber, alternate.alternateSetting);
      }

      this.device = device;
      this.interfaceNumber = interfaceInfo.interfaceNumber;
      this.endpointNumber = endpoint.endpointNumber;
      this.packetSize = endpoint.packetSize || 32;
      this.running = true;
      this.hold = false;
      this.previousButtons = 0;
      this.lastPost = performance.now();
      await this.ensureSimulation();
      this.emitState(`${device.productName || "USB Controller"} 已连接`);
      this.onMessage("G30S 已连接，输入只会发送到 MuJoCo 仿真。", false);
      void this.readLoop();
    } catch (error) {
      if (device.opened) {
        await device.close().catch(() => {});
      }
      this.reset("连接失败");
      throw error;
    }
  }

  async disconnect(message = "手柄已断开") {
    const device = this.device;
    const interfaceNumber = this.interfaceNumber;
    this.reset(message);

    if (!device || !device.opened) {
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
    this.velocity = [0, 0, 0, 0, 0, 0];
    this.emitState(message);
  }

  async readLoop() {
    try {
      while (this.running && this.device && this.endpointNumber !== null) {
        const result = await this.device.transferIn(this.endpointNumber, this.packetSize);
        if (result.status === "stall") {
          await this.device.clearHalt("in", this.endpointNumber);
          continue;
        }
        if (result.status !== "ok" || !result.data) {
          continue;
        }
        const report = G30SWebUSBController.parseReport(result.data);
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
        this.onMessage(`WebUSB 控制已保持：${error.message}`, true);
      })
      .finally(() => {
        this.postInFlight = false;
      });
  }

  static matches(device) {
    return device.vendorId === VENDOR_ID && device.productId === PRODUCT_ID;
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
}
