import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MicroOled, FRAME_BYTES, type OledPins } from "../dist/MicroOled.js";
import type { SpiBus } from "../dist/SpiBus.js";

// Records every bus and pin operation so tests can assert both content and
// ordering (D/C level before a write, CS framing around it).
class Rig implements SpiBus, OledPins {
  public ops: string[] = [];
  public writes: { dc: boolean | null; bytes: number[] }[] = [];
  private dc: boolean | null = null;

  public configure = (): Promise<void> => Promise.resolve();
  public transfer = (): Promise<Uint8Array> => Promise.resolve(new Uint8Array(0));
  public read = (): Promise<Uint8Array> => Promise.resolve(new Uint8Array(0));

  public select = (): Promise<void> => this.note("select");
  public deselect = (): Promise<void> => this.note("deselect");

  public write = (bytes: ArrayLike<number>): Promise<void> => {
    this.writes.push({ dc: this.dc, bytes: Array.from(bytes) });
    return this.note("write");
  };

  public dataCommand = (data: boolean): Promise<void> => {
    this.dc = data;
    return this.note(`dc:${data ? "data" : "command"}`);
  };

  public reset = (level: boolean): Promise<void> => this.note(`rst:${level ? "high" : "low"}`);

  private note = (op: string): Promise<void> => {
    this.ops.push(op);
    return Promise.resolve();
  };
}

const rigged = () => {
  const rig = new Rig();
  return { rig, oled: new MicroOled(rig, rig) };
};

describe("MicroOled", () => {
  it("pulses reset high-low-high before any SPI traffic", async () => {
    const { rig, oled } = rigged();
    await oled.initialize();
    const firstWrite = rig.ops.indexOf("write");
    assert.deepEqual(rig.ops.slice(0, 3), ["rst:high", "rst:low", "rst:high"]);
    assert.ok(firstWrite > 2);
  });

  it("sends the init sequence as commands, from display-off to display-on", async () => {
    const { rig, oled } = rigged();
    await oled.initialize();
    const init = rig.writes[0];
    assert.equal(init.dc, false);
    assert.equal(init.bytes[0], 0xae);
    assert.equal(init.bytes[init.bytes.length - 1], 0xaf);
    assert.deepEqual(init.bytes.slice(1, 5), [0xd5, 0x80, 0xa8, 47]);
  });

  it("clears all 8 RAM pages across all 128 columns after init", async () => {
    const { rig, oled } = rigged();
    await oled.initialize();
    const afterInit = rig.writes.slice(1);
    assert.equal(afterInit.length, 16); // 8 x (position command + blank data)
    for (let page = 0; page < 8; page++) {
      assert.deepEqual(afterInit[page * 2].bytes, [0xb0 | page, 0x10, 0x00]);
      assert.equal(afterInit[page * 2].dc, false);
      assert.equal(afterInit[page * 2 + 1].bytes.length, 128);
      assert.equal(afterInit[page * 2 + 1].dc, true);
      assert.ok(afterInit[page * 2 + 1].bytes.every((byte) => byte === 0));
    }
  });

  it("frames every write in chip select", async () => {
    const { rig, oled } = rigged();
    await oled.display();
    for (let i = 0; i < rig.ops.length; i++) {
      if (rig.ops[i] !== "write") continue;
      assert.equal(rig.ops[i - 1], "select");
      assert.equal(rig.ops[i + 1], "deselect");
    }
  });

  it("pushes 6 pages at the visible window's column offset of 32", async () => {
    const { rig, oled } = rigged();
    await oled.display();
    assert.equal(rig.writes.length, 12); // 6 x (position command + page data)
    for (let page = 0; page < 6; page++) {
      assert.deepEqual(rig.writes[page * 2].bytes, [0xb0 | page, 0x12, 0x00]);
      assert.equal(rig.writes[page * 2 + 1].bytes.length, 64);
    }
  });

  it("maps pixels into the page-major frame buffer", async () => {
    const { rig, oled } = rigged();
    oled.setPixel(3, 10); // page 1, bit 2
    oled.setPixel(63, 47); // page 5 last byte, bit 7
    await oled.display();
    assert.equal(rig.writes[3].bytes[3], 1 << 2);
    assert.equal(rig.writes[11].bytes[63], 1 << 7);
  });

  it("rejects frames of the wrong size", async () => {
    const { oled } = rigged();
    await assert.rejects(async () => oled.showFrame(new Uint8Array(100)), /384 bytes/);
  });

  it("encodes invert as the two SSD1306 display modes", async () => {
    const { rig, oled } = rigged();
    await oled.invert(true);
    await oled.invert(false);
    assert.deepEqual(rig.writes.map((w) => w.bytes), [[0xa7], [0xa6]]);
    assert.ok(rig.writes.every((w) => w.dc === false));
  });
});
