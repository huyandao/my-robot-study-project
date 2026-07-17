import { G30SController } from "../mycobot_app/static/gamepad.js";

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

console.log("G30S WebUSB and Windows Gamepad API parser tests passed");
