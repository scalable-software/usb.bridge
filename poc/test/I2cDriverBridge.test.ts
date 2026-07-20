import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ByteChannel } from "../dist/ByteChannel.js";
import { I2cDriverBridge } from "../dist/I2cDriverBridge.js";
import { MockTransport, type Exchange } from "./MockTransport.ts";

const ACK = 0x31; // 0b0011_0001: base 0x30 with the ACK bit set
const NACK = 0x30;
const TIMEOUT = 0x32; // TO bit

const bridgeOver = (script: Exchange[]) => {
  const transport = new MockTransport(script);
  return { transport, bridge: new I2cDriverBridge(new ByteChannel(transport, 50, 10)) };
};

describe("I2cDriverBridge", () => {
  it("encodes a write transaction: START, chunk, STOP", async () => {
    const { transport, bridge } = bridgeOver([
      { expect: [0x73, 0x90], reply: [[ACK]] }, // START write to 0x48
      { expect: [0xc1, 0x12, 0x34], reply: [[ACK]] },
      { expect: [0x70] },
    ]);
    await bridge.write(0x48, [0x12, 0x34]);
    assert.equal(transport.written.length, 3);
  });

  it("throws on NACK but still releases the bus with STOP", async () => {
    const { transport, bridge } = bridgeOver([
      { expect: [0x73, 0x90], reply: [[NACK]] },
      { expect: [0x70] },
    ]);
    await assert.rejects(bridge.write(0x48, [0x00]), /No ACK from device 0x48/);
    assert.deepEqual(transport.written.at(-1), [0x70]);
  });

  it("reports transmission timeouts distinctly", async () => {
    const { bridge } = bridgeOver([
      { expect: [0x73, 0x90], reply: [[TIMEOUT]] },
      { expect: [0x70] },
    ]);
    await assert.rejects(bridge.write(0x48, [0x00]), /Transmission to device 0x48 timed out/);
  });

  it("encodes a read transaction with NACK on the final byte", async () => {
    const { transport, bridge } = bridgeOver([
      { expect: [0x73, 0x91], reply: [[ACK]] }, // START read from 0x48
      { expect: [0x81], reply: [[0xde, 0xad]] }, // read 2, NACK last
      { expect: [0x70] },
    ]);
    const reply = await bridge.read(0x48, 2);
    assert.deepEqual(Array.from(reply), [0xde, 0xad]);
    assert.equal(transport.written.length, 3);
  });

  it("ACK-reads leading chunks of long reads, NACK only at the very end", async () => {
    const { transport, bridge } = bridgeOver([
      { expect: [0x73, 0x91], reply: [[ACK]] },
      { expect: [0x61, 64], reply: [new Array(64).fill(1)] }, // 'a' 64: ACK every byte
      { expect: [0x61, 64], reply: [new Array(64).fill(2)] },
      { expect: [0x81], reply: [[3, 3]] }, // final 2 bytes, NACK last
      { expect: [0x70] },
    ]);
    const reply = await bridge.read(0x48, 130);
    assert.equal(reply.length, 130);
    assert.deepEqual(Array.from(reply.subarray(126)), [2, 2, 3, 3]);
    assert.equal(transport.written.length, 5);
  });

  it("joins write and read with a repeated START", async () => {
    const { transport, bridge } = bridgeOver([
      { expect: [0x73, 0x90], reply: [[ACK]] },
      { expect: [0xc0, 0x10], reply: [[ACK]] },
      { expect: [0x73, 0x91], reply: [[ACK]] },
      { expect: [0x81], reply: [[0xbe, 0xef]] },
      { expect: [0x70] },
    ]);
    const reply = await bridge.writeRead(0x48, [0x10], 2);
    assert.deepEqual(Array.from(reply), [0xbe, 0xef]);
    assert.equal(transport.written.length, 5);
  });

  it("decodes a bus scan into ACKing 7-bit addresses", async () => {
    const results = new Array(112).fill(NACK);
    results[0x48 - 0x08] = ACK;
    results[0x50 - 0x08] = ACK;
    const { bridge } = bridgeOver([{ expect: [0x64], reply: [results] }]);
    assert.deepEqual(await bridge.scan(), [0x48, 0x50]);
  });

  it("encodes speed configuration as the ASCII speed commands", async () => {
    const { transport, bridge } = bridgeOver([]);
    await bridge.configure(100);
    await bridge.configure(400);
    assert.deepEqual(transport.written, [[0x31], [0x34]]);
  });

  it("reports whether a bus reset freed the lines", async () => {
    const freed = bridgeOver([{ expect: [0x78], reply: [[0b11]] }]);
    assert.equal(await freed.bridge.reset(), true);
    const held = bridgeOver([{ expect: [0x78], reply: [[0b01]] }]);
    assert.equal(await held.bridge.reset(), false);
  });

  it("verifies the link with I2C-specific recovery bytes", async () => {
    const recovery = [...new Array(66).fill(0x40), 0x20, 0x69];
    const { transport, bridge } = bridgeOver([
      { expect: recovery },
      { expect: [0x65, 0x55], reply: [[0x55]] },
      { expect: [0x65, 0xaa], reply: [[0xaa]] },
    ]);
    await bridge.verifyLink();
    assert.equal(transport.written.length, 3);
  });
});
