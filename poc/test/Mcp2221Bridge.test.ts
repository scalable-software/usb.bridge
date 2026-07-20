import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReportChannel } from "../dist/ReportChannel.js";
import { Mcp2221Bridge } from "../dist/Mcp2221Bridge.js";
import { MockTransport, type Exchange } from "./MockTransport.ts";

// A 64-byte report with the given leading bytes.
const report = (...bytes: number[]): number[] => {
  const full = new Array(64).fill(0);
  bytes.forEach((byte, index) => (full[index] = byte));
  return full;
};

// Status reply with a given engine state (byte 8) and transfer counters.
const statusReply = (engine: number, requested = 0, transferred = 0): number[] => {
  const reply = report(0x10, 0x00);
  reply[8] = engine;
  reply[9] = requested & 0xff;
  reply[10] = requested >> 8;
  reply[11] = transferred & 0xff;
  reply[12] = transferred >> 8;
  reply[14] = 117; // divider for 100 kHz
  reply[22] = 1;
  reply[23] = 1;
  reply[46] = 0x41; // 'A'
  reply[47] = 0x36; // '6'
  reply[48] = 0x31; // '1'
  reply[49] = 0x32; // '2'
  return reply;
};

const SET_SPEED_100 = report(0x10, 0, 0, 0x20, 117);
const speedAccepted = (): number[] => {
  const reply = report(0x10, 0x00);
  reply[3] = 0x20;
  reply[4] = 117;
  return reply;
};

const bridgeOver = (script: Exchange[]) => {
  const transport = new MockTransport(script);
  return { transport, bridge: new Mcp2221Bridge(new ReportChannel(transport, 50), "MCP2221 USB-I2C/UART") };
};

describe("Mcp2221Bridge", () => {
  it("opens without cancelling when the engine is already idle", async () => {
    const { transport, bridge } = bridgeOver([
      { expect: report(0x10), reply: [statusReply(0x00)] }, // idle: NO cancel may follow
      { expect: SET_SPEED_100, reply: [speedAccepted()] },
    ]);
    await bridge.open();
    // The wedge-avoidance invariant: exactly status + set-speed, no cancel.
    assert.deepEqual(
      transport.written.map((w) => [w[0], w[2]]),
      [
        [0x10, 0],
        [0x10, 0],
      ],
    );
  });

  it("cancels a non-idle engine before configuring", async () => {
    const { transport, bridge } = bridgeOver([
      { expect: report(0x10), reply: [statusReply(0x62)] }, // wedged-looking
      { expect: report(0x10, 0, 0x10), reply: [report(0x10, 0x00, 0x10)] }, // cancel
      { expect: report(0x10), reply: [statusReply(0x00)] }, // now idle
      { expect: SET_SPEED_100, reply: [speedAccepted()] },
    ]);
    await bridge.open();
    assert.equal(transport.written.length, 4);
  });

  it("resets the chip when the engine never recovers", async () => {
    const script: Exchange[] = [];
    for (let i = 0; i < 4; i++) {
      script.push({ expect: report(0x10), reply: [statusReply(0x62)] });
      script.push({ expect: report(0x10, 0, 0x10), reply: [report(0x10, 0x00, 0x10)] });
    }
    script.push({ expect: report(0x70, 0xab, 0xcd, 0xef), reply: [report(0x70, 0x00)] });
    const { bridge } = bridgeOver(script);
    await assert.rejects(bridge.open(), /chip reset issued/);
  });

  it("parses status including the divider-derived speed and revisions", async () => {
    const { bridge } = bridgeOver([{ expect: report(0x10), reply: [statusReply(0x00, 4, 2)] }]);
    const status = await bridge.status();
    assert.equal(status.product, "MCP2221 USB-I2C/UART");
    assert.equal(status.speedKhz, 100);
    assert.equal(status.requestedBytes, 4);
    assert.equal(status.transferredBytes, 2);
    assert.equal(status.busFree, true);
    assert.equal(status.hardwareRevision, "A6");
    assert.equal(status.firmwareRevision, "12");
  });

  it("writes with shifted address and confirms completion via status", async () => {
    const { bridge } = bridgeOver([
      { expect: report(0x90, 2, 0, 0x90, 0xaa, 0xbb), reply: [report(0x90, 0x00)] }, // 0x48 << 1
      { expect: report(0x10), reply: [statusReply(0x00, 2, 2)] }, // 2 of 2 on the wire
    ]);
    await bridge.write(0x48, [0xaa, 0xbb]);
  });

  it("cancels and reports NACK when written bytes never reach the wire", async () => {
    const script: Exchange[] = [{ expect: report(0x90, 1, 0, 0x90, 0x55), reply: [report(0x90, 0x00)] }];
    for (let i = 0; i < 40; i++) {
      script.push({ expect: report(0x10), reply: [statusReply(0x25, 1, 0)] }); // never transfers
    }
    script.push({ expect: report(0x10, 0, 0x10), reply: [report(0x10, 0x00, 0x10)] }); // cancel
    const { bridge } = bridgeOver(script);
    await assert.rejects(bridge.write(0x48, [0x55]), /Device 0x48 did not acknowledge \(transfer cancelled\)/);
  });

  it("reads with the R bit set and pumps data via Get I2C Data", async () => {
    const { bridge } = bridgeOver([
      { expect: report(0x91, 2, 0, 0x91), reply: [report(0x91, 0x00)] }, // (0x48 << 1) | 1
      { expect: report(0x40), reply: [report(0x40, 0x00, 0, 2, 0xde, 0xad)] },
    ]);
    const reply = await bridge.read(0x48, 2);
    assert.deepEqual(Array.from(reply), [0xde, 0xad]);
  });

  it("retries busy commands until the engine accepts them", async () => {
    const { transport, bridge } = bridgeOver([
      { expect: report(0x91, 1, 0, 0x91), reply: [report(0x91, 0x01)] }, // busy
      { expect: report(0x91, 1, 0, 0x91), reply: [report(0x91, 0x00)] },
      { expect: report(0x40), reply: [report(0x40, 0x00, 0, 1, 0x77)] },
    ]);
    const reply = await bridge.read(0x48, 1);
    assert.deepEqual(Array.from(reply), [0x77]);
    assert.equal(transport.written.length, 3);
  });

  it("joins write and read with no-STOP and repeated-START commands", async () => {
    const { bridge } = bridgeOver([
      { expect: report(0x94, 1, 0, 0x90, 0x10), reply: [report(0x94, 0x00)] }, // write no stop
      { expect: report(0x10), reply: [statusReply(0x00, 1, 1)] },
      { expect: report(0x93, 2, 0, 0x91), reply: [report(0x93, 0x00)] }, // read repeated start
      { expect: report(0x40), reply: [report(0x40, 0x00, 0, 2, 0xbe, 0xef)] },
    ]);
    const reply = await bridge.writeRead(0x48, [0x10], 2);
    assert.deepEqual(Array.from(reply), [0xbe, 0xef]);
  });

  it("scans by probing each address and reports the ACKing ones", async () => {
    const acked = new Set([0x48, 0x50]);
    const script: Exchange[] = [];
    for (let address = 0x08; address <= 0x77; address++) {
      script.push({ expect: report(0x91, 1, 0, (address << 1) | 1), reply: [report(0x91, 0x00)] });
      if (acked.has(address)) {
        script.push({ expect: report(0x40), reply: [report(0x40, 0x00, 0, 1, 0x42)] });
      } else {
        for (let poll = 0; poll < 8; poll++) {
          script.push({ expect: report(0x40), reply: [report(0x40, 0x41, 0, 127)] }); // no data
        }
        script.push({ expect: report(0x10, 0, 0x10), reply: [report(0x10, 0x00, 0x10)] }); // cancel
      }
    }
    const { bridge } = bridgeOver(script);
    assert.deepEqual(await bridge.scan(), [0x48, 0x50]);
  });
});
