import { G30SController } from "../mycobot_app/static/gamepad.js";
import { KeyboardController } from "../mycobot_app/static/keyboard.js";
import { computeWebTcp, parseBinaryStl } from "../mycobot_app/static/mujoco_viewer.js";

const bytes = new Uint8Array(20);
bytes[0] = 0x00;
bytes[2] = 0x09; // D-pad up + right
bytes[3] = 0x10; // A

const view = new DataView(bytes.buffer);
view.setInt16(6, 16384, true);
view.setInt16(8, -16384, true);

const report = G30SController.parseReport(view);
if (!report) throw new Error("G30S report was not recognized");
if (report.velocity[0] <= 0 || report.velocity[1] >= 0) throw new Error("Stick axes were parsed incorrectly");
if (report.velocity[4] !== 1 || report.velocity[5] !== 1) throw new Error("D-pad was parsed incorrectly");
if ((report.buttons & 0x1000) === 0) throw new Error("A button was parsed incorrectly");

const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
buttons[0] = { pressed: true, value: 1 }; // A
buttons[1] = { pressed: true, value: 1 }; // B
buttons[9] = { pressed: true, value: 1 }; // Start
buttons[12] = { pressed: true, value: 1 }; // D-pad up
buttons[15] = { pressed: true, value: 1 }; // D-pad right
const windowsGamepad = {
  id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)",
  mapping: "standard",
  axes: [0.5, -0.5, 0.25, -0.25],
  buttons,
};
if (!G30SController.matchesStandardGamepad(windowsGamepad)) throw new Error("Windows XInput device was not recognized");
const windowsReport = G30SController.parseStandardGamepad(windowsGamepad);
if (!windowsReport) throw new Error("Windows Gamepad API report was not recognized");
if (windowsReport.velocity[0] <= 0 || windowsReport.velocity[1] >= 0) throw new Error("Windows stick axes were parsed incorrectly");
if (windowsReport.velocity[4] !== 1 || windowsReport.velocity[5] !== 1) throw new Error("Windows D-pad was parsed incorrectly");
if ((windowsReport.buttons & 0x1000) === 0) throw new Error("Windows A button was parsed incorrectly");
if ((windowsReport.buttons & 0x2000) === 0) throw new Error("Windows B button was parsed incorrectly");
if ((windowsReport.buttons & 0x0010) === 0) throw new Error("Windows Start button was parsed incorrectly");

const cartesianVelocity = G30SController.mapCartesianVelocity(windowsReport.velocity);
if (cartesianVelocity[0] <= 0 || cartesianVelocity[1] <= 0 || cartesianVelocity[2] <= 0) {
  throw new Error("Cartesian X/Y/Z mapping was parsed incorrectly");
}

const keyboardVelocity = KeyboardController.velocityForCodes(new Set([
  "KeyD",
  "KeyW",
  "KeyJ",
  "KeyI",
  "ArrowLeft",
  "ArrowUp",
]));
const expectedKeyboardVelocity = [1, 1, -1, 1, 1, -1];
if (keyboardVelocity.some((value, index) => value !== expectedKeyboardVelocity[index])) {
  throw new Error("Keyboard J1-J6 mapping was parsed incorrectly");
}
const cancelledKeyboardVelocity = KeyboardController.velocityForCodes(new Set(["KeyA", "KeyD"]));
if (cancelledKeyboardVelocity[0] !== 0) {
  throw new Error("Opposite keyboard inputs should cancel each other");
}
const keyboardCartesianVelocity = KeyboardController.mapCartesianVelocity(keyboardVelocity);
if (keyboardCartesianVelocity.some((value, index) => value !== [1, 1, 1][index])) {
  throw new Error("Keyboard Cartesian X/Y/Z mapping was parsed incorrectly");
}

const stl = new ArrayBuffer(134);
const stlView = new DataView(stl);
stlView.setUint32(80, 1, true);
stlView.setFloat32(92, 0, true);
stlView.setFloat32(96, 0, true);
stlView.setFloat32(100, 0, true);
stlView.setFloat32(104, 1, true);
stlView.setFloat32(108, 0, true);
stlView.setFloat32(112, 0, true);
stlView.setFloat32(116, 0, true);
stlView.setFloat32(120, 1, true);
stlView.setFloat32(124, 0, true);
const parsedStl = parseBinaryStl(stl);
if (parsedStl.positions.length !== 9 || parsedStl.normals.length !== 9) {
  throw new Error("WebGL binary STL parser failed");
}
const webTcp = computeWebTcp([0, 0, 0, 0, 0, 0]);
const expectedTcp = [0.0806, -0.0646, 0.4361];
if (webTcp.some((value, index) => Math.abs(value - expectedTcp[index]) > 0.001)) {
  throw new Error(`WebGL MJCF hierarchy mismatch: ${webTcp.join(", ")}`);
}
const posedTcp = computeWebTcp([20, -30, 40, -25, 35, 15].map((value) => value * Math.PI / 180));
const expectedPosedTcp = [0.120222, 0.024186, 0.400309];
if (posedTcp.some((value, index) => Math.abs(value - expectedPosedTcp[index]) > 0.00001)) {
  throw new Error(`WebGL posed hierarchy mismatch: ${posedTcp.join(", ")}`);
}

console.log("G30S, Cartesian, keyboard, and WebGL STL tests passed");
