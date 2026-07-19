import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReportChannel } from "../dist/ReportChannel.js";
import { Mcp2210Bridge } from "../dist/Mcp2210Bridge.js";
import { MockTransport, type Exchange } from "./MockTransport.ts";

// A 64-byte report with the given leading bytes.
const report = (...bytes: number[]): number[] => {
  const full = new Array(64).fill(0);
  bytes.forEach((byte, index) => (full[index] = byte));
  return full;
};

// Chip-settings reply: GP designations at offsets 4-12.
const chipSettingsReply = (gp4: number): number[] => {
  const reply = report(0x20, 0x00);
  for (let pin = 0; pin <= 8; pin++) reply[4 + pin] = 0x00;
  reply[4 + 4] = gp4;
  return reply;
};

// The expected Set SPI Transfer Settings command for 1 MHz, mode 0, GP4 CS.
const spiSettingsCommand = (transactionBytes: number): number[] => {
  const command = report(0x40);
  command[4] = 0x40; // 1,000,000 little-endian
  command[5] = 0x42;
  command[6] = 0x0f;
  command[7] = 0x00;
  command[8] = 0xff; // idle CS 0x1ff
  command[9] = 0x01;
  command[10] = 0xef; // active CS 0x1ef: GP4 low
  command[11] = 0x01;
  command[18] = transactionBytes & 0xff;
  command[19] = transactionBytes >> 8;
  command[20] = 0x00; // mode 0
  return command;
};

const bridgeOver = (script: Exchange[]) => {
  const transport = new MockTransport(script);
  return { transport, bridge: new Mcp2210Bridge(new ReportChannel(transport, 50), "MCP2210 USB to SPI Master") };
};

describe("Mcp2210Bridge", () => {
  it("initializes on open: designates the CS pin and applies SPI settings", async () => {
    const expectedChipSettings = report(0x21, 0, 0, 0);
    expectedChipSettings[4 + 4] = 0x01; // GP4 -> chip select, others preserved
    const { transport, bridge } = bridgeOver([
      { expect: report(0x20), reply: [chipSettingsReply(0x00)] }, // GP4 not yet CS
      { expect: expectedChipSettings, reply: [report(0x21, 0x00)] },
      { expect: spiSettingsCommand(2), reply: [report(0x40, 0x00)] },
    ]);
    await bridge.open();
    assert.equal(transport.written.length, 3);
    assert.equal(transport.connected, true);
  });

  it("skips the chip-settings write when the CS pin is already designated", async () => {
    const { transport, bridge } = bridgeOver([
      { expect: report(0x20), reply: [chipSettingsReply(0x01)] }, // GP4 already CS
      { expect: spiSettingsCommand(2), reply: [report(0x40, 0x00)] },
    ]);
    await bridge.open();
    assert.equal(transport.written.length, 2);
  });

  it("verifies the link with a status round-trip", async () => {
    const { bridge } = bridgeOver([
      { expect: report(0x10), reply: [report(0x10, 0x00, 0x01, 0x00)] },
    ]);
    await bridge.verifyLink();
  });

  it("parses status from the three chip queries", async () => {
    const spiReply = report(0x41, 0x00, 0x11, 0x00, 0x40, 0x42, 0x0f, 0x00, 0xff, 0x01, 0xef, 0x01);
    spiReply[18] = 4;
    spiReply[20] = 2;
    const { bridge } = bridgeOver([
      { expect: report(0x10), reply: [report(0x10, 0x00, 0x01, 0x02, 0x05, 0x01)] },
      { expect: report(0x41), reply: [spiReply] },
      { expect: report(0x20), reply: [chipSettingsReply(0x01)] },
    ]);
    const status = await bridge.status();
    assert.equal(status.product, "MCP2210 USB to SPI Master");
    assert.equal(status.busOwner, "external master");
    assert.equal(status.busReleaseRequested, false);
    assert.equal(status.passwordAttempts, 5);
    assert.equal(status.passwordGuessed, true);
    assert.equal(status.bitRate, 1_000_000);
    assert.equal(status.spiMode, 2);
    assert.equal(status.bytesPerTransaction, 4);
    assert.equal(status.csPinDesignated, true);
  });

  it("runs a small transfer: settings for the length, then the 0x42 engine", async () => {
    const { bridge } = bridgeOver([
      { expect: spiSettingsCommand(2), reply: [report(0x40, 0x00)] },
      { expect: report(0x42, 2, 0, 0, 0x0a, 0x00), reply: [report(0x42, 0x00, 2, 0x10, 0xde, 0xad)] },
    ]);
    const reply = await bridge.transfer([0x0a, 0x00]);
    assert.deepEqual(Array.from(reply), [0xde, 0xad]);
  });

  it("collects a transfer that finishes across several engine polls", async () => {
    const { bridge } = bridgeOver([
      { expect: spiSettingsCommand(3), reply: [report(0x40, 0x00)] },
      { expect: report(0x42, 3, 0, 0, 1, 2, 3), reply: [report(0x42, 0x00, 0, 0x20)] }, // started, nothing yet
      { expect: report(0x42, 0), reply: [report(0x42, 0x00, 2, 0x30, 0xaa, 0xbb)] }, // partial data
      { expect: report(0x42, 0), reply: [report(0x42, 0x00, 1, 0x10, 0xcc)] }, // finished
    ]);
    const reply = await bridge.transfer([1, 2, 3]);
    assert.deepEqual(Array.from(reply), [0xaa, 0xbb, 0xcc]);
  });

  it("retries the same chunk while the engine reports busy", async () => {
    const { transport, bridge } = bridgeOver([
      { expect: spiSettingsCommand(1), reply: [report(0x40, 0x00)] },
      { expect: report(0x42, 1, 0, 0, 0x55), reply: [report(0x42, 0xf8)] }, // busy
      { expect: report(0x42, 1, 0, 0, 0x55), reply: [report(0x42, 0x00, 1, 0x10, 0x99)] },
    ]);
    const reply = await bridge.transfer([0x55]);
    assert.deepEqual(Array.from(reply), [0x99]);
    assert.equal(transport.written.length, 3);
  });

  it("reports an externally owned bus distinctly", async () => {
    const { bridge } = bridgeOver([
      { expect: spiSettingsCommand(1), reply: [report(0x40, 0x00)] },
      { expect: report(0x42, 1, 0, 0, 0x55), reply: [report(0x42, 0xf7)] },
    ]);
    await assert.rejects(bridge.transfer([0x55]), /SPI bus not available: an external master owns it/);
  });

  it("reuses the transaction length across equal-sized transfers", async () => {
    const { transport, bridge } = bridgeOver([
      { expect: spiSettingsCommand(1), reply: [report(0x40, 0x00)] },
      { expect: report(0x42, 1, 0, 0, 0x01), reply: [report(0x42, 0x00, 1, 0x10, 0x11)] },
      { expect: report(0x42, 1, 0, 0, 0x02), reply: [report(0x42, 0x00, 1, 0x10, 0x22)] }, // no settings write
    ]);
    await bridge.transfer([0x01]);
    await bridge.transfer([0x02]);
    assert.equal(transport.written.length, 3);
  });
});
