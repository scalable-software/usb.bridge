import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ByteChannel } from "../dist/ByteChannel.js";
import { SpiDriverBridge } from "../dist/SpiDriverBridge.js";
import { MockTransport, type Exchange } from "./MockTransport.ts";

const RECORD = "[spidriver1 DO01HCRB 000000534 5.138 000 32.5 1 1 0 ffff".padEnd(79) + "]";

const bridgeOver = (script: Exchange[]) => {
  const transport = new MockTransport(script);
  return { transport, bridge: new SpiDriverBridge(new ByteChannel(transport, 50, 10)) };
};

describe("SpiDriverBridge", () => {
  it("verifies the link with recovery padding, drain, and two echoes", async () => {
    const { transport, bridge } = bridgeOver([
      { expect: new Array(66).fill(0x00) },
      { expect: [0x65, 0x55], reply: [[0x55]] },
      { expect: [0x65, 0xaa], reply: [[0xaa]] },
    ]);
    await bridge.verifyLink();
    assert.equal(transport.written.length, 3);
  });

  it("rejects a link whose echo comes back wrong", async () => {
    const { bridge } = bridgeOver([
      { expect: new Array(66).fill(0x00) },
      { expect: [0x65, 0x55], reply: [[0x30]] },
    ]);
    await assert.rejects(bridge.verifyLink(), /Echo mismatch: sent 85, received 48/);
  });

  it("parses the status record", async () => {
    const { bridge } = bridgeOver([
      { expect: [0x3f], reply: [Array.from(new TextEncoder().encode(RECORD))] },
    ]);
    const status = await bridge.status();
    assert.equal(status.product, "spidriver1");
    assert.equal(status.selected, true);
  });

  it("encodes select and deselect", async () => {
    const { transport, bridge } = bridgeOver([]);
    await bridge.select();
    await bridge.deselect();
    assert.deepEqual(transport.written, [[0x73], [0x75]]);
  });

  it("encodes a small full-duplex transfer", async () => {
    const { transport, bridge } = bridgeOver([
      { expect: [0x81, 0x12, 0x34], reply: [[0xde, 0xad]] },
    ]);
    const reply = await bridge.transfer([0x12, 0x34]);
    assert.deepEqual(Array.from(reply), [0xde, 0xad]);
    assert.deepEqual(transport.written, [[0x81, 0x12, 0x34]]);
  });

  it("chunks transfers longer than 64 bytes", async () => {
    const payload = new Array(130).fill(0).map((_, i) => i % 256);
    const { transport, bridge } = bridgeOver([
      { reply: [new Array(64).fill(1)] },
      { reply: [new Array(64).fill(2)] },
      { reply: [new Array(2).fill(3)] },
    ]);
    const reply = await bridge.transfer(payload);
    assert.equal(reply.length, 130);
    assert.deepEqual(
      transport.written.map((w) => [w[0], w.length]),
      [[0xbf, 65], [0xbf, 65], [0x81, 3]], // command byte + payload
    );
    assert.deepEqual(Array.from(reply.subarray(126)), [2, 2, 3, 3]);
  });

  it("encodes write-only transfers with no readback", async () => {
    const { transport, bridge } = bridgeOver([]);
    await bridge.write([0x12, 0x34, 0x56]);
    assert.deepEqual(transport.written, [[0xc2, 0x12, 0x34, 0x56]]);
  });

  it("reads by clocking out zero filler", async () => {
    const { transport, bridge } = bridgeOver([
      { expect: [0x81, 0x00, 0x00], reply: [[0xca, 0xfe]] },
    ]);
    const reply = await bridge.read(2);
    assert.deepEqual(Array.from(reply), [0xca, 0xfe]);
    assert.deepEqual(transport.written, [[0x81, 0x00, 0x00]]);
  });

  it("encodes mode configuration and the auxiliary outputs", async () => {
    const { transport, bridge } = bridgeOver([]);
    await bridge.configure(2);
    await bridge.setA(true);
    await bridge.setB(false);
    await bridge.detach();
    assert.deepEqual(transport.written, [[0x6d, 2], [0x61, 1], [0x62, 0], [0x78]]);
  });
});
