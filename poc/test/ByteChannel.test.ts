import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ByteChannel } from "../dist/ByteChannel.js";
import { MockTransport } from "./MockTransport.ts";

const fastChannel = (transport: MockTransport) => new ByteChannel(transport, 50, 10);

describe("ByteChannel", () => {
  it("assembles exact-count reads from arbitrarily split chunks", async () => {
    const transport = new MockTransport([
      { expect: [0x3f], reply: [[1, 2], [3], [4, 5, 6]] },
    ]);
    const channel = fastChannel(transport);
    const reply = await channel.exchange([0x3f], 6);
    assert.deepEqual(Array.from(reply), [1, 2, 3, 4, 5, 6]);
  });

  it("keeps surplus bytes buffered for the next read", async () => {
    const transport = new MockTransport([
      { expect: [0x01], reply: [[0xaa, 0xbb, 0xcc]] },
      { expect: [0x02] },
    ]);
    const channel = fastChannel(transport);
    assert.deepEqual(Array.from(await channel.exchange([0x01], 1)), [0xaa]);
    assert.deepEqual(Array.from(await channel.exchange([0x02], 2)), [0xbb, 0xcc]);
  });

  it("times out with a diagnostic when the device stays silent", async () => {
    const transport = new MockTransport([{ expect: [0x3f], reply: [[1]] }]);
    const channel = fastChannel(transport);
    await assert.rejects(channel.exchange([0x3f], 5), /Timed out waiting for 5 bytes \(got 1\)/);
  });

  it("serializes concurrent transactions in order", async () => {
    const transport = new MockTransport([
      { expect: [1], reply: [[11]] },
      { expect: [2], reply: [[22]] },
    ]);
    const channel = fastChannel(transport);
    const [first, second] = await Promise.all([
      channel.exchange([1], 1),
      channel.exchange([2], 1),
    ]);
    assert.deepEqual(transport.written, [[1], [2]]);
    assert.deepEqual(Array.from(first), [11]);
    assert.deepEqual(Array.from(second), [22]);
  });

  it("keeps the queue alive after a failed transaction", async () => {
    const transport = new MockTransport([
      { expect: [1] }, // no reply: times out
      { expect: [2], reply: [[22]] },
    ]);
    const channel = fastChannel(transport);
    await assert.rejects(channel.exchange([1], 1), /Timed out/);
    assert.deepEqual(Array.from(await channel.exchange([2], 1)), [22]);
  });

  it("drains stale bytes so later reads stay aligned", async () => {
    const transport = new MockTransport([
      { expect: [0x65, 0x55], reply: [[0x55]] },
    ]);
    transport.deliver(Uint8Array.from([0x30, 0x30])); // stale replies from a confused device
    const channel = fastChannel(transport);
    await channel.drain();
    const reply = await channel.exchange([0x65, 0x55], 1);
    assert.deepEqual(Array.from(reply), [0x55]);
  });
});
