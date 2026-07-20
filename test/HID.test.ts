import { describe, it, expect, beforeEach } from "vitest";
import { HID } from "../src/HID.js";
import { FakeHid, FakeDevice, installNavigator } from "./FakeNavigator.ts";

describe("HID", () => {
  let fake: FakeHid;
  let hid: HID;

  beforeEach(() => {
    fake = new FakeHid();
    installNavigator({ hid: fake });
    hid = new HID();
  });

  it("reports supported only when navigator.hid exists", () => {
    expect(hid.supported()).toBe(true);
    installNavigator({}); // a browser without WebHID
    expect(hid.supported()).toBe(false);
  });

  it("translates the neutral filter to WebHID's vendorId/productId", async () => {
    await hid.requestPermission([{ vendor: 0x04d8, product: 0x00de }]);
    expect(fake.lastOptions).toEqual({ filters: [{ vendorId: 0x04d8, productId: 0x00de }] });
  });

  it("passes an empty filter list when none is given", async () => {
    await hid.requestPermission();
    expect(fake.lastOptions).toEqual({ filters: [] });
  });

  it("returns the first granted device from the picker", async () => {
    const device = await hid.requestPermission([{ vendor: 0x04d8, product: 0x00de }]);
    expect(device).toBe(fake.nextDevices[0]);
  });

  it("returns null when the picker is cancelled (empty array)", async () => {
    fake.nextDevices = [];
    expect(await hid.requestPermission([{ vendor: 0x04d8 }])).toBeNull();
  });

  it("returns null when requestDevice rejects", async () => {
    fake.rejectRequest = true;
    expect(await hid.requestPermission([{ vendor: 0x04d8 }])).toBeNull();
  });

  it("lists already-granted devices without a picker", async () => {
    fake.devices = [new FakeDevice("MCP2210"), new FakeDevice("MCP2221")];
    expect(await hid.granted()).toEqual(fake.devices);
  });

  it("forgets a device by delegating to its forget()", async () => {
    const device = new FakeDevice();
    await hid.forget(device as unknown as HIDDevice);
    expect(device.forgotten).toBe(true);
  });

  it("registers a connect handler that receives the device from event.device", () => {
    const seen: unknown[] = [];
    hid.onconnect = (device) => seen.push(device);
    expect(fake.listenerCount("connect")).toBe(1);
    const device = new FakeDevice();
    fake.emit("connect", { device });
    expect(seen).toEqual([device]);
  });

  it("registers a disconnect handler that receives the device from event.device", () => {
    const seen: unknown[] = [];
    hid.ondisconnect = (device) => seen.push(device);
    const device = new FakeDevice();
    fake.emit("disconnect", { device });
    expect(seen).toEqual([device]);
  });

  it("unregisters the handler when assigned null", () => {
    hid.ondisconnect = () => {};
    expect(fake.listenerCount("disconnect")).toBe(1);
    hid.ondisconnect = null;
    expect(fake.listenerCount("disconnect")).toBe(0);
  });

  it("replaces the previous handler on reassignment", () => {
    const calls: string[] = [];
    hid.ondisconnect = () => calls.push("first");
    hid.ondisconnect = () => calls.push("second");
    expect(fake.listenerCount("disconnect")).toBe(1); // old wrapper removed
    fake.emit("disconnect", { device: new FakeDevice() });
    expect(calls).toEqual(["second"]);
  });
});
