import { G30SWebUSBController } from "../mycobot_app/static/gamepad.js";

const bytes = new Uint8Array(20);
bytes[0] = 0x00;
bytes[2] = 0x09; // D-pad up + right
bytes[3] = 0x10; // A

const view = new DataView(bytes.buffer);
view.setInt16(6, 16384, true);
view.setInt16(8, -16384, true);

const report = G30SWebUSBController.parseReport(view);
if (!report) throw new Error("G30S report was not recognized");
if (report.velocity[0] <= 0 || report.velocity[1] >= 0) throw new Error("Stick axes were parsed incorrectly");
if (report.velocity[4] !== 1 || report.velocity[5] !== 1) throw new Error("D-pad was parsed incorrectly");
if ((report.buttons & 0x1000) === 0) throw new Error("A button was parsed incorrectly");

console.log("G30S report parser test passed");
