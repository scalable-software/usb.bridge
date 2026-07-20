import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReportChannel } from "../dist/ReportChannel.js";
import { MockTransport } from "./MockTransport.ts";

// A 64-byte report with the given leading bytes.
const report = (...bytes: number[]): number[] => {
  const full = new Array(64).fill(0);
  bytes.forEach((byte, index) => (full[index] = byte));
  return full;
};

describe("ReportChannel", () => {
  it("pads commands to 64 bytes and pairs each with one response", async () => {
    const transport = new MockTransport([
      { expect: report(0x10), reply: [report(0x10, 0x00, 0x01)] },
    ]);
    const channel = new ReportChannel(transport, 50);
    const reply = await channel.exchange([0x10]);
    assert.equal(transport.written[0].length, 64);
    assert.deepEqual(Array.from(reply.subarray(0, 3)), [0x10, 0x00, 0x01]);
  });

  it("times out with a diagnostic naming the command", async () => {
    const transport = new MockTransport([{ expect: report(0x42, 1, 0, 0, 0xaa) }]);
    const channel = new ReportChannel(transport, 30);
    await assert.rejects(channel.exchange([0x42, 1, 0, 0, 0xaa]), /Timed out waiting for a response to command 0x42/);
  });

  it("discards a late reply so the next exchange pairs correctly", async () => {
    const transport = new MockTransport([
      { expect: report(0x10) }, // no reply: times out
      { expect: report(0x41), reply: [report(0x41, 0x00)] },
    ]);
    const channel = new ReportChannel(transport, 30);
    await assert.rejects(channel.exchange([0x10]), /Timed out/);
    transport.deliver(Uint8Array.from(report(0x10, 0x00))); // the late reply arrives after all
    const reply = await channel.exchange([0x41]);
    assert.equal(reply[0], 0x41); // not the stale 0x10 reply
  });

  it("serializes concurrent transactions in order", async () => {
    const transport = new MockTransport([
      { expect: report(1), reply: [report(1, 0)] },
      { expect: report(2), reply: [report(2, 0)] },
    ]);
    const channel = new ReportChannel(transport, 50);
    const [first, second] = await Promise.all([channel.exchange([1]), channel.exchange([2])]);
    assert.deepEqual(
      transport.written.map((w) => w[0]),
      [1, 2],
    );
    assert.equal(first[0], 1);
    assert.equal(second[0], 2);
  });
});
