import { describe, it, expect, beforeEach } from "vitest";
import { Serial } from "../src/Serial.js";
import { FakeSerial, FakePort, installNavigator } from "./FakeNavigator.ts";

describe("Serial", () => {
  let fake: FakeSerial;
  let serial: Serial;

  beforeEach(() => {
    fake = new FakeSerial();
    installNavigator({ serial: fake });
    serial = new Serial();
  });

  it("reports supported only when navigator.serial exists", () => {
    expect(serial.supported()).toBe(true);
    installNavigator({}); // a browser without Web Serial
    expect(serial.supported()).toBe(false);
  });

  it("translates the neutral filter to Web Serial's usbVendorId/usbProductId", async () => {
    await serial.requestPermission([{ vendor: 0x0403, product: 0x6015 }]);
    expect(fake.lastOptions).toEqual({ filters: [{ usbVendorId: 0x0403, usbProductId: 0x6015 }] });
  });

  it("passes an empty filter list when none is given", async () => {
    await serial.requestPermission();
    expect(fake.lastOptions).toEqual({ filters: [] });
  });

  it("returns the chosen port from the picker", async () => {
    const port = await serial.requestPermission([{ vendor: 0x0403 }]);
    expect(port).toBe(fake.nextPort);
  });

  it("returns null when the picker is cancelled (requestPort rejects)", async () => {
    fake.rejectRequest = true;
    expect(await serial.requestPermission([{ vendor: 0x0403 }])).toBeNull();
  });

  it("lists already-granted ports without a picker", async () => {
    fake.ports = [new FakePort(), new FakePort()];
    expect(await serial.granted()).toEqual(fake.ports);
  });

  it("registers a connect handler that receives the port from event.target", () => {
    const seen: unknown[] = [];
    serial.onconnect = (port) => seen.push(port);
    expect(fake.listenerCount("connect")).toBe(1);
    const port = new FakePort();
    fake.emit("connect", { target: port });
    expect(seen).toEqual([port]);
  });

  it("registers a disconnect handler that receives the port from event.target", () => {
    const seen: unknown[] = [];
    serial.ondisconnect = (port) => seen.push(port);
    const port = new FakePort();
    fake.emit("disconnect", { target: port });
    expect(seen).toEqual([port]);
  });

  it("unregisters the handler when assigned null", () => {
    serial.ondisconnect = () => {};
    expect(fake.listenerCount("disconnect")).toBe(1);
    serial.ondisconnect = null;
    expect(fake.listenerCount("disconnect")).toBe(0);
  });

  it("replaces the previous handler on reassignment", () => {
    const calls: string[] = [];
    serial.ondisconnect = () => calls.push("first");
    serial.ondisconnect = () => calls.push("second");
    expect(fake.listenerCount("disconnect")).toBe(1); // old wrapper removed
    fake.emit("disconnect", { target: new FakePort() });
    expect(calls).toEqual(["second"]);
  });
});
