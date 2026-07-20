import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HexCodec } from "../dist/HexCodec.js";

describe("HexCodec", () => {
  it("encodes bytes as uppercase space-separated hex", () => {
    assert.equal(HexCodec.encode([0x9f, 0x00, 0xff]), "9F 00 FF");
    assert.equal(HexCodec.encode(Uint8Array.from([0x0a])), "0A");
    assert.equal(HexCodec.encode([]), "");
  });

  it("decodes whitespace- and comma-separated hex", () => {
    assert.deepEqual(HexCodec.decode("9F 00 ff"), [0x9f, 0x00, 0xff]);
    assert.deepEqual(HexCodec.decode(" 12,34 ,56 "), [0x12, 0x34, 0x56]);
    assert.deepEqual(HexCodec.decode("0x48 0X10"), [0x48, 0x10]);
    assert.deepEqual(HexCodec.decode(""), []);
  });

  it("rejects tokens that are not hex bytes", () => {
    assert.throws(() => HexCodec.decode("zz"), /"zz" is not a hex byte/);
    assert.throws(() => HexCodec.decode("100"), /not a hex byte/);
    assert.throws(() => HexCodec.decode("-1"), /not a hex byte/);
  });
});
